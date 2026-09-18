const MODES = {
  silent: { label: '🤫 Stillarbeit', multiplier: 0.82 },
  partner: { label: '👥 Partnerarbeit', multiplier: 1.0 },
  group: { label: '👨‍👩‍👧‍👦 Gruppenarbeit', multiplier: 1.17 },
  free: { label: '🎨 Freiarbeit', multiplier: 1.3 },
};

const defaults = {
  classes: {
    'Meine Klasse': { xp: 0 },
  },
  selectedClass: 'Meine Klasse',
  mode: 'silent',
  durationMinutes: 30,
  rewardXp: 5,
  assignment: '1. Bearbeitet die Aufgaben.\n2. Vergleicht eure Ergebnisse.\n3. Einigt euch auf eine gemeinsame Lösung.',
  threshold: 62,
  toleranceMs: 2000,
};

let state = loadState();
let timer = null;
let running = false;
let remainingSec = state.durationMinutes * 60;
let elapsedSec = 0;
let qualitySeconds = 0;
let badSince = null;
let currentNoise = 0;
let successAwarded = false;

let audioCtx = null;
let analyser = null;
let audioData = null;
let micStream = null;
let rafId = null;

const els = Object.fromEntries([
  'classTitle','settingsBtn','fullscreenBtn','noiseText','modePill','meterFill','progressText','progressFill','progressNote','dinoGrid','timerDisplay','startBtn','pauseBtn','resetBtn','assignmentDisplay','xpText','rewardXpText','settingsDialog','settingsForm','classSelect','modeSelect','durationInput','rewardXpInput','assignmentInput','thresholdInput','thresholdValue','toleranceSelect','newClassInput','addClassBtn','micBtn','saveSettingsBtn','toast','egg','dinoFace','sparkles'
].map(id => [id, document.getElementById(id)]));

function loadState() {
  try {
    const raw = localStorage.getItem('classroomQuestState');
    return raw ? { ...defaults, ...JSON.parse(raw) } : structuredClone(defaults);
  } catch {
    return structuredClone(defaults);
  }
}

function saveState() {
  localStorage.setItem('classroomQuestState', JSON.stringify(state));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

function populateClasses() {
  els.classSelect.innerHTML = '';
  Object.keys(state.classes).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    els.classSelect.appendChild(opt);
  });
  els.classSelect.value = state.selectedClass;
}

function render() {
  els.classTitle.textContent = state.selectedClass;
  els.modePill.textContent = MODES[state.mode].label;
  els.assignmentDisplay.textContent = state.assignment;
  els.xpText.textContent = `${state.classes[state.selectedClass]?.xp ?? 0} XP`;
  els.rewardXpText.textContent = `+${state.rewardXp}`;
  renderTimer();
  renderProgress();
}

function renderTimer() {
  const min = Math.floor(remainingSec / 60).toString().padStart(2,'0');
  const sec = (remainingSec % 60).toString().padStart(2,'0');
  els.timerDisplay.textContent = `${min}:${sec}`;
}

function effectiveThreshold() {
  return Math.min(98, state.threshold * MODES[state.mode].multiplier);
}

function progressPercent() {
  const total = state.durationMinutes * 60;
  const earliestFinish = Math.max(1, total - 180);

  // A perfect phase may finish exactly 3 minutes early. Noise costs quality time,
  // so a louder class finishes later or may not complete the challenge at all.
  const qualityProgress = qualitySeconds / earliestFinish;
  const timeCap = elapsedSec / earliestFinish;
  let value = Math.min(qualityProgress, timeCap);

  // Never allow completion before the final three-minute window.
  if (elapsedSec < earliestFinish) value = Math.min(value, 0.99);

  return Math.max(0, Math.min(1, value));
}

function renderProgress() {
  const p = progressPercent();
  const pct = Math.round(p * 100);
  els.progressText.textContent = `${pct} %`;
  els.progressFill.style.width = `${pct}%`;

  const total = state.durationMinutes * 60;
  const unlockAt = Math.max(0, total - 180);
  if (elapsedSec < unlockAt) {
    const mins = Math.ceil((unlockAt - elapsedSec) / 60);
    els.progressNote.textContent = `Der Abschluss wird in ca. ${mins} Min. freigeschaltet.`;
  } else if (p < 1) {
    els.progressNote.textContent = 'Finalphase! Haltet die passende Arbeitslautstärke.';
  } else {
    els.progressNote.textContent = 'Challenge geschafft – Arbeitszeit läuft trotzdem weiter.';
  }

  const doneCount = Math.floor(p * 9 + 0.0001);
  [...els.dinoGrid.children].forEach((node, i) => {
    node.textContent = i < doneCount ? '🦖' : '🥚';
    node.classList.toggle('done', i < doneCount);
  });

  const stage = p >= 1 ? 5 : p >= .72 ? 4 : p >= .48 ? 3 : p >= .24 ? 2 : p > .03 ? 1 : 0;
  els.egg.className = 'egg';
  if (stage > 0) els.egg.classList.add('active');
  if (stage >= 2) els.egg.classList.add('stage-2');
  if (stage >= 3) els.egg.classList.add('stage-3','hatching');
  if (stage >= 4) els.egg.classList.add('stage-4');
  if (stage >= 5) els.egg.classList.add('stage-5');
  els.sparkles.classList.toggle('show', stage >= 5);

  if (p >= 1 && !successAwarded) {
    successAwarded = true;
    const cls = state.classes[state.selectedClass];
    cls.xp += Number(state.rewardXp || 0);
    saveState();
    render();
    showToast(`🎉 Challenge geschafft! +${state.rewardXp} XP für ${state.selectedClass}`);
  }
}

function classifyNoise(level) {
  const t = effectiveThreshold();
  if (level < t * .62) return 'quiet';
  if (level <= t) return 'good';
  return 'loud';
}

function updateNoiseUi(level) {
  currentNoise = level;
  els.meterFill.style.width = `${Math.min(100, level)}%`;
  const cls = classifyNoise(level);
  if (cls === 'quiet') els.noiseText.textContent = 'Sehr ruhig – super!';
  else if (cls === 'good') els.noiseText.textContent = 'Passende Arbeitslautstärke';
  else els.noiseText.textContent = 'Gerade zu laut';
}

async function enableMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    source.connect(analyser);
    audioData = new Uint8Array(analyser.fftSize);
    measureAudio();
    showToast('🎤 Mikrofon aktiviert');
    els.micBtn.textContent = '✓ Mikrofon aktiv';
  } catch (err) {
    console.error(err);
    showToast('Mikrofon konnte nicht aktiviert werden.');
  }
}

function measureAudio() {
  if (!analyser) return;
  analyser.getByteTimeDomainData(audioData);
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    const v = (audioData[i] - 128) / 128;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / audioData.length);
  const scaled = Math.min(100, rms * 480);
  updateNoiseUi(scaled);
  rafId = requestAnimationFrame(measureAudio);
}

function tick() {
  if (!running) return;
  if (remainingSec <= 0) {
    running = false;
    clearInterval(timer);
    renderProgress();
    return;
  }

  remainingSec -= 1;
  elapsedSec += 1;

  const noiseClass = analyser ? classifyNoise(currentNoise) : 'good';
  if (noiseClass === 'loud') {
    if (!badSince) badSince = Date.now();
    const tooLong = Date.now() - badSince >= state.toleranceMs;
    if (!tooLong) qualitySeconds += 0.45;
  } else {
    badSince = null;
    qualitySeconds += noiseClass === 'quiet' ? 1 : 0.93;
  }

  renderTimer();
  renderProgress();
}

function startTimer() {
  if (running) return;
  running = true;
  if (!analyser) showToast('Tipp: Mikrofon aktivieren, sonst läuft die Demo neutral.');
  timer = setInterval(tick, 1000);
}
function pauseTimer() { running = false; clearInterval(timer); }
function resetTimer() {
  pauseTimer();
  remainingSec = state.durationMinutes * 60;
  elapsedSec = 0;
  qualitySeconds = 0;
  badSince = null;
  successAwarded = false;
  render();
}

function openSettings() {
  populateClasses();
  els.classSelect.value = state.selectedClass;
  els.modeSelect.value = state.mode;
  els.durationInput.value = state.durationMinutes;
  els.rewardXpInput.value = state.rewardXp;
  els.assignmentInput.value = state.assignment;
  els.thresholdInput.value = state.threshold;
  els.thresholdValue.textContent = state.threshold;
  els.toleranceSelect.value = String(state.toleranceMs);
  els.settingsDialog.showModal();
}

function applySettings() {
  state.selectedClass = els.classSelect.value;
  state.mode = els.modeSelect.value;
  state.durationMinutes = Number(els.durationInput.value || 30);
  state.rewardXp = Number(els.rewardXpInput.value || 0);
  state.assignment = els.assignmentInput.value.trim() || 'Arbeitsauftrag folgt.';
  state.threshold = Number(els.thresholdInput.value || 62);
  state.toleranceMs = Number(els.toleranceSelect.value || 2000);
  saveState();
  resetTimer();
}

function initDinos() {
  els.dinoGrid.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    const item = document.createElement('div');
    item.className = 'dino-token';
    item.textContent = '🥚';
    els.dinoGrid.appendChild(item);
  }
}

els.settingsBtn.addEventListener('click', openSettings);
els.fullscreenBtn.addEventListener('click', async () => {
  if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  else await document.exitFullscreen?.();
});
els.startBtn.addEventListener('click', startTimer);
els.pauseBtn.addEventListener('click', pauseTimer);
els.resetBtn.addEventListener('click', resetTimer);
els.micBtn.addEventListener('click', enableMic);
els.thresholdInput.addEventListener('input', () => els.thresholdValue.textContent = els.thresholdInput.value);
els.addClassBtn.addEventListener('click', () => {
  const name = els.newClassInput.value.trim();
  if (!name) return;
  if (!state.classes[name]) state.classes[name] = { xp: 0 };
  state.selectedClass = name;
  saveState();
  populateClasses();
  els.classSelect.value = name;
  els.newClassInput.value = '';
  showToast(`${name} angelegt`);
});
els.settingsForm.addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  applySettings();
  els.settingsDialog.close();
});

initDinos();
populateClasses();
render();
openSettings();
