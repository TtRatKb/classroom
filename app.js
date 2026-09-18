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
  sensitivity: 55,
  toleranceMs: 2000,
};

const HATCH_SCHEDULE = [
  { start: 0.00, duration: 0.20, x: 11, y: 18, scale: 0.92, dino: '🦖' },
  { start: 0.10, duration: 0.20, x: 30, y: 10, scale: 0.78, dino: '🦕' },
  { start: 0.20, duration: 0.20, x: 48, y: 20, scale: 0.88, dino: '🦖' },
  { start: 0.30, duration: 0.20, x: 68, y: 11, scale: 0.76, dino: '🦕' },
  { start: 0.40, duration: 0.20, x: 82, y: 23, scale: 0.84, dino: '🦖' },
  { start: 0.50, duration: 0.20, x: 20, y: 51, scale: 0.80, dino: '🦕' },
  { start: 0.60, duration: 0.20, x: 39, y: 57, scale: 0.90, dino: '🦖' },
  { start: 0.70, duration: 0.20, x: 62, y: 53, scale: 0.82, dino: '🦕' },
  { start: 0.80, duration: 0.20, x: 79, y: 57, scale: 0.94, dino: '🦖' },
];

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
  'classTitle','settingsBtn','fullscreenBtn','noiseText','modePill','meterFill','thresholdMarker','progressText','progressFill','progressNote','dinoGrid','timerDisplay','startBtn','pauseBtn','resetBtn','assignmentDisplay','xpText','rewardXpText','settingsDialog','settingsForm','classSelect','modeSelect','durationInput','rewardXpInput','assignmentInput','sensitivityInput','sensitivityValue','toleranceSelect','newClassInput','addClassBtn','micBtn','saveSettingsBtn','toast','hatchery','sceneMessage','liveSensitivityInput','liveSensitivityValue','liveToleranceSelect'
].map(id => [id, document.getElementById(id)]));

function loadState() {
  try {
    const raw = localStorage.getItem('classroomQuestState');
    if (!raw) return structuredClone(defaults);

    const parsed = JSON.parse(raw);
    const merged = { ...defaults, ...parsed };

    // Migration from v0.1: old builds stored a direct threshold instead of sensitivity.
    if (typeof parsed.sensitivity !== 'number' && typeof parsed.threshold === 'number') {
      merged.sensitivity = Math.max(0, Math.min(100, Math.round((100 - parsed.threshold) / 0.72)));
    }

    return merged;
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
  syncLiveControls();
  renderTimer();
  renderProgress();
  updateNoiseUi(currentNoise);
}

function renderTimer() {
  const min = Math.floor(remainingSec / 60).toString().padStart(2,'0');
  const sec = (remainingSec % 60).toString().padStart(2,'0');
  els.timerDisplay.textContent = `${min}:${sec}`;
}

function baseThresholdFromSensitivity() {
  // 0% sensitivity ≈ very forgiving, 100% = very strict.
  return Math.max(22, 100 - state.sensitivity * 0.72);
}

function effectiveThreshold() {
  return Math.min(98, baseThresholdFromSensitivity() * MODES[state.mode].multiplier);
}

function progressPercent() {
  const total = state.durationMinutes * 60;
  const earliestFinish = Math.max(1, total - 180);

  // Perfect noise discipline may complete exactly three minutes early.
  // Loud periods reduce quality time, so completion moves later.
  const qualityProgress = qualitySeconds / earliestFinish;
  const timeCap = elapsedSec / earliestFinish;
  let value = Math.min(qualityProgress, timeCap);

  if (elapsedSec < earliestFinish) value = Math.min(value, 0.99);

  return Math.max(0, Math.min(1, value));
}

function localHatchProgress(globalProgress, item) {
  return Math.max(0, Math.min(1, (globalProgress - item.start) / item.duration));
}

function hatchStage(local) {
  if (local <= 0) return 'hidden';
  if (local < 0.18) return 'arriving';
  if (local < 0.42) return 'wobble';
  if (local < 0.67) return 'crack';
  if (local < 0.86) return 'peek';
  return 'hatched';
}

function renderHatchery(globalProgress) {
  const units = [...els.hatchery.children];
  let hatched = 0;
  let active = 0;

  units.forEach((unit, index) => {
    const local = localHatchProgress(globalProgress, HATCH_SCHEDULE[index]);
    const stage = hatchStage(local);

    unit.dataset.stage = stage;
    unit.style.setProperty('--local-progress', local.toFixed(3));

    if (local > 0 && local < 1) active += 1;
    if (stage === 'hatched') hatched += 1;
  });

  if (globalProgress <= 0.001) {
    els.sceneMessage.textContent = 'Die ersten Eier warten schon …';
  } else if (hatched === 0) {
    els.sceneMessage.textContent = `${active} Ei${active === 1 ? '' : 'er'} in Bewegung …`;
  } else if (hatched < 9) {
    els.sceneMessage.textContent = `${hatched}/9 Dinos geschlüpft · ${active} gerade aktiv`;
  } else {
    els.sceneMessage.textContent = '🎉 Alle 9 Dinos sind da! Haltet die Lautstärke bis zum Ende.';
  }

  return { hatched, active };
}

function renderProgress() {
  const p = progressPercent();
  const pct = Math.round(p * 100);
  els.progressText.textContent = `${pct} %`;
  els.progressFill.style.width = `${pct}%`;

  const { hatched, active } = renderHatchery(p);
  const total = state.durationMinutes * 60;
  const unlockAt = Math.max(0, total - 180);

  if (elapsedSec < unlockAt) {
    const mins = Math.ceil((unlockAt - elapsedSec) / 60);
    els.progressNote.textContent = `${hatched}/9 geschlüpft · ${active} aktiv · kompletter Abschluss frühestens in ca. ${mins} Min.`;
  } else if (p < 1) {
    els.progressNote.textContent = `${hatched}/9 geschlüpft · Finalphase! Haltet die passende Arbeitslautstärke.`;
  } else {
    els.progressNote.textContent = '9/9 geschlüpft · Challenge geschafft – die Arbeitszeit läuft trotzdem weiter.';
  }

  [...els.dinoGrid.children].forEach((node, index) => {
    const local = localHatchProgress(p, HATCH_SCHEDULE[index]);
    const stage = hatchStage(local);
    node.textContent = stage === 'hatched' ? HATCH_SCHEDULE[index].dino : local > 0 ? '🐣' : '🥚';
    node.classList.toggle('active', local > 0 && stage !== 'hatched');
    node.classList.toggle('done', stage === 'hatched');
  });

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
  if (level < t * 0.62) return 'quiet';
  if (level <= t) return 'good';
  return 'loud';
}

function updateNoiseUi(level) {
  currentNoise = level;
  els.meterFill.style.width = `${Math.min(100, level)}%`;
  const threshold = effectiveThreshold();
  els.thresholdMarker.style.left = `${Math.min(98, threshold)}%`;

  if (!analyser) {
    els.noiseText.textContent = 'Mikrofon noch nicht gestartet';
    return;
  }

  const cls = classifyNoise(level);
  if (cls === 'quiet') els.noiseText.textContent = 'Sehr ruhig – super!';
  else if (cls === 'good') els.noiseText.textContent = 'Passende Arbeitslautstärke';
  else els.noiseText.textContent = 'Gerade zu laut';
}

async function enableMic() {
  try {
    if (micStream) {
      showToast('🎤 Mikrofon ist bereits aktiv');
      return;
    }

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
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
    qualitySeconds += 1;
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

function pauseTimer() {
  running = false;
  clearInterval(timer);
}

function resetTimer() {
  pauseTimer();
  remainingSec = state.durationMinutes * 60;
  elapsedSec = 0;
  qualitySeconds = 0;
  badSince = null;
  successAwarded = false;
  render();
}

function syncLiveControls() {
  els.liveSensitivityInput.value = state.sensitivity;
  els.liveSensitivityValue.textContent = `${state.sensitivity}%`;
  els.liveToleranceSelect.value = String(state.toleranceMs);
}

function setSensitivity(value, source = 'live') {
  state.sensitivity = Math.max(0, Math.min(100, Number(value)));
  saveState();

  els.liveSensitivityInput.value = state.sensitivity;
  els.liveSensitivityValue.textContent = `${state.sensitivity}%`;
  els.sensitivityInput.value = state.sensitivity;
  els.sensitivityValue.textContent = state.sensitivity;
  updateNoiseUi(currentNoise);

  if (source === 'live') {
    clearTimeout(setSensitivity.t);
    setSensitivity.t = setTimeout(() => showToast(`Mic-Sensitivity: ${state.sensitivity}%`), 220);
  }
}

function setTolerance(value, source = 'live') {
  state.toleranceMs = Number(value);
  saveState();
  els.liveToleranceSelect.value = String(state.toleranceMs);
  els.toleranceSelect.value = String(state.toleranceMs);
  badSince = null;
  if (source === 'live') showToast(`Lärm-Toleranz: ${state.toleranceMs / 1000} Sek.`);
}

function openSettings() {
  populateClasses();
  els.classSelect.value = state.selectedClass;
  els.modeSelect.value = state.mode;
  els.durationInput.value = state.durationMinutes;
  els.rewardXpInput.value = state.rewardXp;
  els.assignmentInput.value = state.assignment;
  els.sensitivityInput.value = state.sensitivity;
  els.sensitivityValue.textContent = state.sensitivity;
  els.toleranceSelect.value = String(state.toleranceMs);
  els.settingsDialog.showModal();
}

function applySettings() {
  const oldDuration = state.durationMinutes;
  state.selectedClass = els.classSelect.value;
  state.mode = els.modeSelect.value;
  state.durationMinutes = Number(els.durationInput.value || 30);
  state.rewardXp = Number(els.rewardXpInput.value || 0);
  state.assignment = els.assignmentInput.value.trim() || 'Arbeitsauftrag folgt.';
  state.sensitivity = Number(els.sensitivityInput.value || 55);
  state.toleranceMs = Number(els.toleranceSelect.value || 2000);

  if (!state.classes[state.selectedClass]) state.classes[state.selectedClass] = { xp: 0 };

  if (elapsedSec === 0) {
    remainingSec = state.durationMinutes * 60;
  } else if (oldDuration !== state.durationMinutes) {
    remainingSec = Math.max(0, state.durationMinutes * 60 - elapsedSec);
  }

  saveState();
  render();
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

function initHatchery() {
  els.hatchery.innerHTML = '';

  HATCH_SCHEDULE.forEach((item, index) => {
    const unit = document.createElement('div');
    unit.className = 'hatch-unit';
    unit.dataset.stage = 'hidden';
    unit.style.setProperty('--x', `${item.x}%`);
    unit.style.setProperty('--y', `${item.y}%`);
    unit.style.setProperty('--scale', item.scale);
    unit.style.setProperty('--delay', `${(index % 4) * -0.35}s`);
    unit.innerHTML = `
      <div class="mini-nest"></div>
      <div class="scene-egg" aria-label="Dino-Ei ${index + 1}">
        <i class="egg-spot spot-a"></i>
        <i class="egg-spot spot-b"></i>
        <i class="egg-spot spot-c"></i>
        <i class="egg-crack crack-a"></i>
        <i class="egg-crack crack-b"></i>
        <i class="egg-crack crack-c"></i>
      </div>
      <div class="scene-dino" aria-hidden="true">${item.dino}</div>
      <div class="hatch-sparkle" aria-hidden="true">✨</div>
    `;
    els.hatchery.appendChild(unit);
  });
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

els.liveSensitivityInput.addEventListener('input', event => setSensitivity(event.target.value, 'live'));
els.liveToleranceSelect.addEventListener('change', event => setTolerance(event.target.value, 'live'));
els.sensitivityInput.addEventListener('input', () => {
  els.sensitivityValue.textContent = els.sensitivityInput.value;
});

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

els.settingsForm.addEventListener('submit', event => {
  if (event.submitter?.value === 'cancel') return;
  event.preventDefault();
  applySettings();
  els.settingsDialog.close();
});

initDinos();
initHatchery();
populateClasses();
render();
openSettings();
