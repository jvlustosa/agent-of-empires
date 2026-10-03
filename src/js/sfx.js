// 8-bit sound effects synthesized with WebAudio, no audio files. Every voice goes through one
// master chain per context: a low-pass that takes the edge off square waves and a short echo.
let context = null;
const masters = new WeakMap();

function audio() {
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume();
  return context;
}

const MASTER_VOLUME = 0.9;
const LOWPASS_HZ = 4800;
const ECHO_DELAY_S = 0.13;
const ECHO_FEEDBACK = 0.22;
const ECHO_MIX = 0.22;

function master(ac) {
  if (masters.has(ac)) return masters.get(ac);
  const input = ac.createGain();
  input.gain.value = MASTER_VOLUME;
  const lowpass = ac.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = LOWPASS_HZ;
  const echo = ac.createDelay(1);
  echo.delayTime.value = ECHO_DELAY_S;
  const feedback = ac.createGain();
  feedback.gain.value = ECHO_FEEDBACK;
  const wet = ac.createGain();
  wet.gain.value = ECHO_MIX;
  input.connect(lowpass);
  lowpass.connect(ac.destination);
  lowpass.connect(echo);
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(ac.destination);
  masters.set(ac, input);
  return input;
}

function tone(ac, frequency, start, duration, { type = 'square', volume = 0.05, vibrato = 0 } = {}) {
  const oscillator = ac.createOscillator();
  const gain = ac.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (vibrato > 0) {
    // A slow wobble on long notes makes them sing instead of buzz.
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = 6;
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(oscillator.frequency);
    lfo.start(start);
    lfo.stop(start + duration + 0.05);
  }
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(master(ac));
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

const NOTE = { C4: 261.63, G5: 783.99, C5: 523.25, E5: 659.25, C6: 1046.5, E6: 1318.51, G6: 1567.98, C7: 2093.0 };

// Inside the app the native side plays the sound: WebAudio is silent in WebKitGTK and paused
// while the window is hidden. WebAudio stays as the fallback (plain browser, offline renders).
function playNative(name) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) return false;
  invoke('play_sound', { name }).catch((err) => console.error('[sfx]', err));
  return true;
}

/** A Claude finished its turn: a harp sweep up, then a bell chord over a low C, like a quest handed in. */
export function playFinished(ac = null) {
  if (!ac && playNative('finished')) return;
  ac ??= audio();
  const t = ac.currentTime + 0.02;
  [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((frequency, i) => tone(ac, frequency, t + i * 0.045, 0.55, { type: 'triangle', volume: 0.035 }));
  const chord = t + 0.3;
  tone(ac, NOTE.C4, chord, 0.8, { type: 'triangle', volume: 0.07 });
  tone(ac, NOTE.G5, chord, 0.9, { type: 'sine', volume: 0.04 });
  tone(ac, NOTE.C6, chord, 1.1, { type: 'sine', volume: 0.08 });
  tone(ac, NOTE.C6 * 2.76, chord, 0.3, { type: 'sine', volume: 0.02 }); // the bell's clang
  tone(ac, NOTE.E6, chord + 0.04, 0.9, { type: 'sine', volume: 0.045 });
  tone(ac, NOTE.C7, chord + 0.25, 0.35, { type: 'sine', volume: 0.025 });
}

/** The soundtrack (music.rs). Native only: there is no WebAudio twin of the songs. */
export function setMusic(isOn) {
  window.__TAURI__?.core?.invoke('set_music', { isOn }).catch((err) => console.error('[music]', err));
}

/** Soundtrack loudness, 0 to 1.5 (1 is the mix as written); heard mid-song. */
export function setMusicVolume(volume) {
  window.__TAURI__?.core?.invoke('set_music_volume', { volume }).catch((err) => console.error('[music]', err));
}

/** A Claude is blocked on you (question or permission): two descending "uh-oh" blips. */
export function playNeedsYou(ac = null) {
  if (!ac && playNative('needs_you')) return;
  ac ??= audio();
  const t = ac.currentTime + 0.02;
  for (const offset of [0, 0.3]) {
    tone(ac, 739.99, t + offset, 0.1, { volume: 0.07 });
    tone(ac, 554.37, t + offset + 0.11, 0.14, { volume: 0.07 });
  }
}

/** A base advanced an era: trumpet pickup, then a held major chord. */
export function playAgeUp(ac = null) {
  if (!ac && playNative('age_up')) return;
  ac ??= audio();
  const t = ac.currentTime + 0.02;
  [392.0, NOTE.C5, NOTE.E5].forEach((frequency, i) => tone(ac, frequency, t + i * 0.11, 0.1, { volume: 0.05 }));
  const chord = t + 0.36;
  tone(ac, NOTE.C4, chord, 0.9, { type: 'triangle', volume: 0.08 });
  tone(ac, NOTE.G5, chord, 0.95, { volume: 0.035, vibrato: 6 });
  tone(ac, NOTE.C6, chord, 1.0, { type: 'triangle', volume: 0.06, vibrato: 6 });
  tone(ac, NOTE.E6, chord + 0.12, 0.8, { type: 'triangle', volume: 0.04 });
  tone(ac, NOTE.C7, chord + 0.5, 0.12, { type: 'sine', volume: 0.025 });
}

/** A plan limit reset: a bugle sounds the charge (G C E G, E, G) to send the villagers back to work. */
export function playLimitReset(ac = null) {
  if (!ac && playNative('limit_reset')) return;
  ac ??= audio();
  const t = ac.currentTime + 0.02;
  [392.0, NOTE.C5, NOTE.E5].forEach((frequency, i) => tone(ac, frequency, t + i * 0.12, 0.11, { volume: 0.05 }));
  tone(ac, NOTE.G5, t + 0.36, 0.3, { volume: 0.05, vibrato: 5 });
  tone(ac, NOTE.E5, t + 0.7, 0.12, { volume: 0.05 });
  const call = t + 0.84;
  tone(ac, NOTE.C4, call, 0.6, { type: 'triangle', volume: 0.08 });
  tone(ac, NOTE.C5, call, 0.6, { volume: 0.025, vibrato: 5 });
  tone(ac, NOTE.E5, call, 0.6, { volume: 0.025, vibrato: 5 });
  tone(ac, NOTE.G5, call, 0.6, { volume: 0.05, vibrato: 5 });
  tone(ac, NOTE.C7, call + 0.3, 0.12, { type: 'sine', volume: 0.025 });
}

/** An achievement unlocked: three rising sparkles. */
export function playAchievement(ac = null) {
  if (!ac && playNative('achievement')) return;
  ac ??= audio();
  const t = ac.currentTime + 0.02;
  [NOTE.E6, NOTE.G6, NOTE.C7].forEach((frequency, i) => tone(ac, frequency, t + i * 0.08, 0.16, { type: 'triangle', volume: 0.06 }));
}

// WebKit may start the context suspended until a user gesture; any click unlocks it.
export function unlockOnFirstGesture() {
  window.addEventListener('pointerdown', () => audio(), { once: true });
}
