let ac = null;
let master = null;
let noiseBuf = null;
let started = false;

function noise(dur = 1) {
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// 主音量。设置面板可能在 AudioContext 还没建立时就改它，所以先存着，
// initAudio 时再套到 master 上。
let masterVol = 0.55;

export function setMasterVolume(v) {
  masterVol = Math.max(0, Math.min(1, v));
  if (master) master.gain.value = masterVol;
}

export function getMasterVolume() {
  return masterVol;
}

export function initAudio() {
  if (started) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return;
  }
  started = true;
  master = ac.createGain();
  master.gain.value = masterVol;
  master.connect(ac.destination);
  noiseBuf = noise(2);
  ambience();
}

export function resume() {
  if (ac && ac.state === 'suspended') ac.resume();
}

function env(node, t0, a, d, peak, sustain = 0, rel = 0) {
  const g = node.gain;
  g.cancelScheduledValues(t0);
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
  if (sustain > 0) {
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.6), t0 + a + d);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d + sustain + rel);
  } else {
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
}

function src(buf, t0, dur, filter, q, gain, type = 'lowpass') {
  const s = ac.createBufferSource();
  s.buffer = buf;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = filter;
  f.Q.value = q;
  const g = ac.createGain();
  s.connect(f).connect(g).connect(master);
  env(g, t0, 0.002, dur, gain);
  s.start(t0);
  s.stop(t0 + dur + 0.1);
  return { s, f, g };
}

/* ---------------- 环境音 ---------------- */
let hum, humGain, buzzGain;
function ambience() {
  // 低频嗡鸣
  hum = ac.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 47;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  humGain = ac.createGain();
  humGain.gain.value = 0.06;
  hum.connect(lp).connect(humGain).connect(master);
  hum.start();

  const hum2 = ac.createOscillator();
  hum2.type = 'sine';
  hum2.frequency.value = 94.5;
  const g2 = ac.createGain();
  g2.gain.value = 0.022;
  hum2.connect(g2).connect(master);
  hum2.start();

  // 荧光灯电流声
  const ns = ac.createBufferSource();
  ns.buffer = noiseBuf;
  ns.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2400;
  bp.Q.value = 1.4;
  buzzGain = ac.createGain();
  buzzGain.gain.value = 0.006;
  ns.connect(bp).connect(buzzGain).connect(master);
  ns.start();
}

/** 由灯光闪烁强度驱动电流声 */
export function setBuzz(v) {
  if (buzzGain) buzzGain.gain.value = 0.003 + v * 0.026;
}

/* ---------------- 音效 ---------------- */
export function sfxShot() {
  if (!ac) return;
  const t = ac.currentTime;
  // 爆响
  src(noiseBuf, t, 0.16, 900, 0.7, 0.85);
  src(noiseBuf, t, 0.045, 4200, 0.9, 0.5, 'highpass');
  // 低频冲击
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  const g = ac.createGain();
  o.connect(g).connect(master);
  env(g, t, 0.003, 0.18, 0.55);
  o.start(t);
  o.stop(t + 0.3);
  // 尾音混响
  src(noiseBuf, t + 0.03, 0.5, 500, 0.4, 0.12);
}

export function sfxDryFire() {
  if (!ac) return;
  const t = ac.currentTime;
  src(noiseBuf, t, 0.035, 2600, 3, 0.35, 'bandpass');
}

export function sfxReload(step) {
  if (!ac) return;
  const t = ac.currentTime;
  const freqs = [1500, 900, 2100];
  src(noiseBuf, t, 0.06, freqs[step % 3], 4, 0.32, 'bandpass');
  const o = ac.createOscillator();
  o.type = 'square';
  o.frequency.value = 180 + step * 60;
  const g = ac.createGain();
  o.connect(g).connect(master);
  env(g, t, 0.002, 0.04, 0.08);
  o.start(t);
  o.stop(t + 0.1);
}

export function sfxStep() {
  if (!ac) return;
  const t = ac.currentTime;
  src(noiseBuf, t, 0.09, 420 + Math.random() * 220, 1.2, 0.16);
}

export function sfxBeep(freq = 880, dur = 0.08, vol = 0.14) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'square';
  o.frequency.value = freq;
  const g = ac.createGain();
  o.connect(g).connect(master);
  env(g, t, 0.004, dur, vol);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sfxError() {
  if (!ac) return;
  const t = ac.currentTime;
  for (let i = 0; i < 3; i++) {
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = 118;
    const lfo = ac.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 26;
    const lg = ac.createGain();
    lg.gain.value = 0.5;
    const g = ac.createGain();
    lfo.connect(lg).connect(g.gain);
    o.connect(g).connect(master);
    g.gain.value = 0.12;
    o.start(t + i * 0.34);
    lfo.start(t + i * 0.34);
    o.stop(t + i * 0.34 + 0.24);
    lfo.stop(t + i * 0.34 + 0.24);
  }
}

export function sfxServo(up = true) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(up ? 220 : 520, t);
  o.frequency.exponentialRampToValueAtTime(up ? 520 : 200, t + 0.4);
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 900;
  const g = ac.createGain();
  o.connect(f).connect(g).connect(master);
  env(g, t, 0.05, 0.35, 0.07);
  o.start(t);
  o.stop(t + 0.5);
}

export function sfxThud() {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.22);
  const g = ac.createGain();
  o.connect(g).connect(master);
  env(g, t, 0.005, 0.26, 0.4);
  o.start(t);
  o.stop(t + 0.4);
  src(noiseBuf, t, 0.12, 700, 0.8, 0.25);
}

export function sfxSpark() {
  if (!ac) return;
  const t = ac.currentTime;
  src(noiseBuf, t, 0.05 + Math.random() * 0.09, 3000 + Math.random() * 2500, 2.2, 0.1, 'bandpass');
}

export function sfxPickup() {
  if (!ac) return;
  const t = ac.currentTime;
  [660, 880, 1180].forEach((f, i) => {
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ac.createGain();
    o.connect(g).connect(master);
    env(g, t + i * 0.07, 0.005, 0.12, 0.11);
    o.start(t + i * 0.07);
    o.stop(t + i * 0.07 + 0.2);
  });
}

export function sfxClick() {
  if (!ac) return;
  const t = ac.currentTime;
  src(noiseBuf, t, 0.03, 1800, 3, 0.2, 'bandpass');
}

/* ---------------- 暴雨 / 雷 / 旋翼 ---------------- */

/**
 * 循环环境层：一个常驻的噪声源 + 滤波器，只靠 gain 淡入淡出。
 * 每次进出天台都新建节点会在 WebAudio 里堆出一串跑不掉的 source，
 * 所以做成懒创建一次、之后只调音量。
 */
function makeLoop(type, freq, q) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.value = 0.0001;
  s.connect(f).connect(g).connect(master);
  s.start();
  return { g, f };
}

let rainLoop = null;
let rainHi = null;
export function setRain(on, level = 1) {
  if (!ac) return;
  if (!rainLoop) {
    rainLoop = makeLoop('lowpass', 1400, 0.6);
    rainHi = makeLoop('highpass', 3600, 0.7);
  }
  const t = ac.currentTime;
  for (const [node, peak] of [
    [rainLoop, 0.16],
    [rainHi, 0.075],
  ]) {
    node.g.gain.cancelScheduledValues(t);
    node.g.gain.setValueAtTime(Math.max(0.0001, node.g.gain.value), t);
    node.g.gain.linearRampToValueAtTime(on ? peak * level : 0.0001, t + (on ? 1.4 : 0.8));
  }
}

/** 雷：一记低频冲击 + 一段长的隆隆噪声尾巴 */
export function sfxThunder(near = 0.6) {
  if (!ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(58 + near * 30, t);
  o.frequency.exponentialRampToValueAtTime(24, t + 1.1);
  const og = ac.createGain();
  o.connect(og).connect(master);
  env(og, t, 0.02, 0.5, 0.34 + near * 0.3, 0.7, 0.6);
  o.start(t);
  o.stop(t + 2.6);

  const s = ac.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = 0.35 + Math.random() * 0.2;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(260 + near * 500, t);
  f.frequency.exponentialRampToValueAtTime(90, t + 2.2);
  const g = ac.createGain();
  s.connect(f).connect(g).connect(master);
  env(g, t, 0.05, 0.35, 0.3 + near * 0.32, 1.1, 0.9);
  s.start(t);
  s.stop(t + 3.2);
}

let rotorLoop = null;
let rotorOsc = null;
let rotorOscGain = null;
export function setRotor(level) {
  if (!ac) return;
  if (!rotorLoop) {
    rotorLoop = makeLoop('bandpass', 240, 0.9);
    rotorOsc = ac.createOscillator();
    rotorOsc.type = 'sawtooth';
    rotorOsc.frequency.value = 21; // 桨叶拍击的基频
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    rotorOscGain = ac.createGain();
    rotorOscGain.gain.value = 0.0001;
    rotorOsc.connect(lp).connect(rotorOscGain).connect(master);
    rotorOsc.start();
  }
  const t = ac.currentTime;
  const k = Math.max(0, Math.min(1, level));
  for (const [node, peak] of [
    [rotorLoop.g, 0.16],
    [rotorOscGain, 0.1],
  ]) {
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), t);
    node.gain.linearRampToValueAtTime(Math.max(0.0001, peak * k), t + 0.35);
  }
}

/** 对讲机的一段沙沙 */
export function sfxStatic(dur = 0.4, vol = 0.12) {
  if (!ac) return;
  const t = ac.currentTime;
  src(noiseBuf, t, dur, 1800, 1.2, vol, 'bandpass');
}

export function sfxImpact(metal) {
  if (!ac) return;
  const t = ac.currentTime;
  if (metal) {
    src(noiseBuf, t, 0.09, 3400, 2.5, 0.3, 'bandpass');
    const o = ac.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1600 + Math.random() * 900, t);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.25);
    const g = ac.createGain();
    o.connect(g).connect(master);
    env(g, t, 0.003, 0.28, 0.1);
    o.start(t);
    o.stop(t + 0.4);
  } else {
    src(noiseBuf, t, 0.1, 900, 1, 0.25);
  }
}
