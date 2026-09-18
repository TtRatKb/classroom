const MODES = {
  silent: { label: '🤫 Stillarbeit', multiplier: 0.72 },
  partner: { label: '👥 Partnerarbeit', multiplier: 1.0 },
  group: { label: '👨‍👩‍👧‍👦 Gruppenarbeit', multiplier: 1.28 },
  free: { label: '🎨 Freiarbeit', multiplier: 1.48 },
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

const DINO_PALETTES = [
  { body: '#63a890', dark: '#478a76', light: '#9bd3b4', accent: '#ef9c93', spot: '#3f8e77' },
  { body: '#e99a58', dark: '#cc7742', light: '#f6c380', accent: '#f3e0a0', spot: '#c96d45' },
  { body: '#6f9fc5', dark: '#527fa6', light: '#a6c9df', accent: '#f2a7a7', spot: '#4d85ad' },
  { body: '#7fae69', dark: '#5f8d50', light: '#add093', accent: '#f2a0a4', spot: '#5a9651' },
  { body: '#b58dc3', dark: '#8f6ca0', light: '#d7b5df', accent: '#f2a5a5', spot: '#9369a7' },
  { body: '#e4b64e', dark: '#bd8e36', light: '#f1d47d', accent: '#ef9797', spot: '#b9862f' },
  { body: '#77b9b2', dark: '#4d948d', light: '#a9d9d4', accent: '#f3a6a0', spot: '#4a9790' },
  { body: '#d97f7d', dark: '#b45f61', light: '#efadab', accent: '#f5d497', spot: '#b75b5e' },
  { body: '#759ccf', dark: '#567bb0', light: '#a6c2e5', accent: '#ef9c9c', spot: '#527caf' },
];

// Overlapping schedule: at five minutes of a perfect 30-minute phase,
// the first dinosaur is already emerging while the next eggs are active.
const HATCH_SCHEDULE = [
  { start: -0.015, duration: 0.26, x: 48, y: 7,  scale: 1.10, depth: 'front', species: 'longneck', palette: 0 },
  { start:  0.040, duration: 0.27, x: 22, y: 34, scale: 0.64, depth: 'back',  species: 'runner',   palette: 2 },
  { start:  0.095, duration: 0.27, x: 69, y: 19, scale: 0.82, depth: 'mid',   species: 'trike',    palette: 1 },
  { start:  0.185, duration: 0.28, x: 84, y: 8,  scale: 0.96, depth: 'front', species: 'runner',   palette: 3 },
  { start:  0.285, duration: 0.27, x: 35, y: 21, scale: 0.78, depth: 'mid',   species: 'trike',    palette: 4 },
  { start:  0.390, duration: 0.27, x: 12, y: 10, scale: 0.90, depth: 'front', species: 'longneck', palette: 5 },
  { start:  0.505, duration: 0.28, x: 59, y: 38, scale: 0.61, depth: 'back',  species: 'runner',   palette: 6 },
  { start:  0.630, duration: 0.27, x: 76, y: 39, scale: 0.57, depth: 'back',  species: 'longneck', palette: 7 },
  { start:  0.765, duration: 0.235,x: 91, y: 26, scale: 0.68, depth: 'mid',   species: 'trike',    palette: 8 },
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

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const raw = localStorage.getItem('classroomQuestState');
    if (!raw) return clone(defaults);

    const parsed = JSON.parse(raw);
    const merged = { ...clone(defaults), ...parsed };
    merged.classes = { ...defaults.classes, ...(parsed.classes || {}) };

    if (typeof parsed.sensitivity !== 'number' && typeof parsed.threshold === 'number') {
      merged.sensitivity = Math.max(0, Math.min(100, Math.round((86 - parsed.threshold) / 0.78)));
    }

    return merged;
  } catch {
    return clone(defaults);
  }
}

function saveState() {
  localStorage.setItem('classroomQuestState', JSON.stringify(state));
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0));
  return x * x * (3 - 2 * x);
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
  // Wide range so 100% really can be very strict even with quieter laptop microphones.
  return Math.max(8, 86 - state.sensitivity * 0.78);
}

function effectiveThreshold() {
  return Math.min(98, baseThresholdFromSensitivity() * MODES[state.mode].multiplier);
}

function progressPercent() {
  const total = state.durationMinutes * 60;
  const earliestFinish = Math.max(1, total - 180);

  // Perfect noise discipline can complete at most three minutes early.
  // Loud periods reduce quality time and therefore delay the hatch progress.
  const qualityProgress = qualitySeconds / earliestFinish;
  const timeCap = elapsedSec / earliestFinish;
  let value = Math.min(qualityProgress, timeCap);

  if (elapsedSec < earliestFinish) value = Math.min(value, 0.99);
  return clamp(value);
}

function localHatchProgress(globalProgress, item) {
  return clamp((globalProgress - item.start) / item.duration);
}

function visualHatchState(local) {
  return {
    arrive: smoothstep(0.00, 0.12, local),
    crack: smoothstep(0.27, 0.49, local),
    hatch: smoothstep(0.47, 0.79, local),
    grow: smoothstep(0.67, 1.00, local),
    hatched: local >= 0.82,
  };
}

function renderHatchery(globalProgress) {
  const units = [...els.hatchery.children];
  let hatched = 0;
  let active = 0;

  units.forEach((unit, index) => {
    const item = HATCH_SCHEDULE[index];
    const local = localHatchProgress(globalProgress, item);
    const v = visualHatchState(local);

    const wholeOpacity = 1 - smoothstep(0.49, 0.67, local);
    const shellOpacity = smoothstep(0.48, 0.61, local) * (0.98 - 0.20 * v.grow);
    const dinoOpacity = smoothstep(0.48, 0.58, local);
    const dinoY = 44 - 62 * v.hatch;
    const dinoScale = 0.38 + 0.34 * v.hatch + 0.28 * v.grow;
    const unitScale = item.scale * (0.77 + 0.23 * v.arrive);
    const unitOpacity = local > 0 ? Math.max(0.18, v.arrive) : 0;

    unit.style.setProperty('--unit-scale', unitScale.toFixed(3));
    unit.style.setProperty('--unit-opacity', unitOpacity.toFixed(3));
    unit.style.setProperty('--whole-opacity', wholeOpacity.toFixed(3));
    unit.style.setProperty('--crack-opacity', v.crack.toFixed(3));
    unit.style.setProperty('--shell-opacity', shellOpacity.toFixed(3));
    unit.style.setProperty('--shell-squash', (0.92 - v.grow * 0.14).toFixed(3));
    unit.style.setProperty('--dino-opacity', dinoOpacity.toFixed(3));
    unit.style.setProperty('--dino-y', `${dinoY.toFixed(1)}px`);
    unit.style.setProperty('--dino-scale', dinoScale.toFixed(3));
    unit.style.setProperty('--cap-x', `${(-9 * v.hatch).toFixed(1)}px`);
    unit.style.setProperty('--cap-y', `${(-31 * v.hatch).toFixed(1)}px`);
    unit.style.setProperty('--cap-rot', `${(-18 * v.hatch).toFixed(1)}deg`);

    unit.dataset.active = String(local > 0 && local < 1);
    unit.dataset.cracking = String(local >= 0.27 && local < 0.70);
    unit.dataset.hatched = String(v.hatched);

    if (local > 0 && local < 1) active += 1;
    if (v.hatched) hatched += 1;
  });

  if (globalProgress <= 0.002) {
    els.sceneMessage.textContent = 'Ruhig: Die ersten Eier beginnen zu wackeln';
  } else if (hatched === 0) {
    els.sceneMessage.textContent = `${active} Ei${active === 1 ? '' : 'er'} sind gerade aktiv`;
  } else if (hatched < 9) {
    els.sceneMessage.textContent = `${hatched}/9 Dinos geschlüpft · ${active} Eier entwickeln sich`;
  } else {
    els.sceneMessage.textContent = 'Alle 9 Dinos sind da – Lautstärke bis zum Ende halten';
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
    const v = visualHatchState(local);
    node.classList.toggle('active', local > 0 && !v.hatched);
    node.classList.toggle('done', v.hatched);
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
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.72;
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
  const scaled = Math.min(100, rms * 500);
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
    // A brief peak still earns a little progress; sustained loudness pauses it.
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

function dinoSvgLongneck(p) {
  return `
    <svg class="dino-svg" viewBox="0 0 140 130" aria-hidden="true">
      <path d="M42 83 C22 82 12 73 5 65 C16 69 27 65 37 59" fill="none" stroke="${p.dark}" stroke-width="15" stroke-linecap="round"/>
      <ellipse cx="66" cy="84" rx="35" ry="26" fill="${p.body}"/>
      <ellipse cx="51" cy="88" rx="11" ry="8" fill="${p.light}" opacity=".7"/>
      <path d="M77 76 C84 59 87 43 88 28" fill="none" stroke="${p.body}" stroke-width="18" stroke-linecap="round"/>
      <ellipse cx="91" cy="25" rx="18" ry="14" fill="${p.body}"/>
      <ellipse cx="99" cy="29" rx="11" ry="8" fill="${p.light}" opacity=".92"/>
      <circle cx="93" cy="21" r="4.3" fill="#fff"/><circle cx="94" cy="21" r="2.1" fill="#2e3a34"/>
      <circle cx="105" cy="28" r="1.6" fill="${p.dark}"/>
      <circle cx="85" cy="31" r="3.2" fill="${p.accent}" opacity=".72"/>
      <rect x="46" y="101" width="14" height="23" rx="7" fill="${p.dark}"/>
      <rect x="77" y="101" width="14" height="23" rx="7" fill="${p.dark}"/>
      <circle cx="60" cy="71" r="5" fill="${p.spot}" opacity=".55"/>
      <circle cx="73" cy="67" r="4" fill="${p.spot}" opacity=".48"/>
      <circle cx="84" cy="61" r="3.6" fill="${p.spot}" opacity=".44"/>
    </svg>`;
}

function dinoSvgRunner(p) {
  return `
    <svg class="dino-svg" viewBox="0 0 140 130" aria-hidden="true">
      <path d="M48 82 C28 82 14 75 4 64 C20 68 30 60 43 55" fill="none" stroke="${p.dark}" stroke-width="14" stroke-linecap="round"/>
      <ellipse cx="70" cy="80" rx="35" ry="27" fill="${p.body}" transform="rotate(-6 70 80)"/>
      <path d="M83 64 C91 55 98 46 102 38" fill="none" stroke="${p.body}" stroke-width="16" stroke-linecap="round"/>
      <ellipse cx="106" cy="36" rx="23" ry="17" fill="${p.body}" transform="rotate(-4 106 36)"/>
      <ellipse cx="117" cy="40" rx="13" ry="8" fill="${p.light}"/>
      <circle cx="109" cy="31" r="4.2" fill="#fff"/><circle cx="110" cy="31" r="2" fill="#28343a"/>
      <circle cx="125" cy="39" r="1.6" fill="${p.dark}"/>
      <circle cx="99" cy="44" r="3.2" fill="${p.accent}" opacity=".72"/>
      <path d="M85 73 l14 7" stroke="${p.dark}" stroke-width="5" stroke-linecap="round"/>
      <path d="M61 101 l-9 23 M84 101 l12 23" stroke="${p.dark}" stroke-width="11" stroke-linecap="round"/>
      <path d="M49 61 l-7 -10 l12 4 l3 -11 l9 12" fill="${p.light}" opacity=".85"/>
      <circle cx="58" cy="72" r="5" fill="${p.spot}" opacity=".48"/>
      <circle cx="72" cy="66" r="4" fill="${p.spot}" opacity=".42"/>
    </svg>`;
}

function dinoSvgTrike(p) {
  return `
    <svg class="dino-svg" viewBox="0 0 140 130" aria-hidden="true">
      <path d="M47 84 C28 84 17 78 8 71 C22 71 32 65 43 60" fill="none" stroke="${p.dark}" stroke-width="14" stroke-linecap="round"/>
      <ellipse cx="68" cy="83" rx="36" ry="27" fill="${p.body}"/>
      <path d="M88 48 C92 26 118 21 132 39 C126 52 111 61 94 60 Z" fill="${p.dark}" opacity=".96"/>
      <ellipse cx="105" cy="53" rx="24" ry="20" fill="${p.body}"/>
      <ellipse cx="118" cy="57" rx="13" ry="9" fill="${p.light}"/>
      <path d="M110 39 l7 -17 l5 19 M128 45 l8 -10 l-2 15" fill="${p.light}" stroke="${p.light}" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="108" cy="48" r="4.2" fill="#fff"/><circle cx="109" cy="48" r="2" fill="#2b3530"/>
      <circle cx="126" cy="57" r="1.6" fill="${p.dark}"/>
      <circle cx="98" cy="61" r="3.1" fill="${p.accent}" opacity=".7"/>
      <rect x="47" y="101" width="13" height="23" rx="6" fill="${p.dark}"/>
      <rect x="77" y="101" width="13" height="23" rx="6" fill="${p.dark}"/>
      <circle cx="58" cy="71" r="5" fill="${p.spot}" opacity=".46"/>
      <circle cx="73" cy="66" r="4" fill="${p.spot}" opacity=".4"/>
    </svg>`;
}

function makeDinoSvg(species, paletteIndex) {
  const p = DINO_PALETTES[paletteIndex % DINO_PALETTES.length];
  if (species === 'runner') return dinoSvgRunner(p);
  if (species === 'trike') return dinoSvgTrike(p);
  return dinoSvgLongneck(p);
}

function initDinoTracker() {
  els.dinoGrid.innerHTML = '';
  HATCH_SCHEDULE.forEach(item => {
    const token = document.createElement('div');
    token.className = 'dino-token';
    token.style.setProperty('--token-dino', DINO_PALETTES[item.palette].body);
    token.innerHTML = '<span class="mini-egg-icon" aria-hidden="true"></span>';
    els.dinoGrid.appendChild(token);
  });
}

function initHatchery() {
  els.hatchery.innerHTML = '';

  HATCH_SCHEDULE.forEach((item, index) => {
    const unit = document.createElement('div');
    unit.className = 'hatch-unit';
    unit.dataset.depth = item.depth;
    unit.dataset.active = 'false';
    unit.dataset.cracking = 'false';
    unit.dataset.hatched = 'false';
    unit.style.setProperty('--x', `${item.x}%`);
    unit.style.setProperty('--y', `${item.y}%`);
    unit.style.setProperty('--unit-scale', item.scale);
    unit.style.setProperty('--motion-delay', `${-((index % 5) * 0.63).toFixed(2)}s`);

    unit.innerHTML = `
      <div class="hatch-unit-inner">
        <div class="nest-shadow"></div>
        <div class="dino-wrap" aria-hidden="true">
          <div class="dino-bob">${makeDinoSvg(item.species, item.palette)}</div>
        </div>
        <div class="egg-whole" aria-label="Dino-Ei ${index + 1}">
          <span class="egg-dot"></span>
          <span class="crack-lines" aria-hidden="true"><i></i><i></i><i></i></span>
        </div>
        <div class="shell-bottom" aria-hidden="true"></div>
        <div class="shell-cap" aria-hidden="true"></div>
      </div>`;

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

window.addEventListener('beforeunload', () => {
  if (rafId) cancelAnimationFrame(rafId);
  micStream?.getTracks().forEach(track => track.stop());
});

initDinoTracker();
initHatchery();
populateClasses();
render();
openSettings();
