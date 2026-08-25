import { drawPistolIcon, drawFlashIcon } from './art.js';
import { MAG_SIZE } from './config.js';
import * as SFX from './audio.js';

const $ = (s) => document.querySelector(s);

const el = {};
let scanCtx = null;

export const ITEM_NAMES = { pistol: '手枪 M1911', flashlight: '手电筒' };

export function initUI() {
  el.objective = $('#objective-text');
  el.messages = $('#messages');
  el.prompt = $('#prompt');
  el.promptText = $('#prompt-text');
  el.handL = $('#hand-left');
  el.handR = $('#hand-right');
  el.ammo = $('#ammo');
  el.ammoMag = $('#ammo-mag');
  el.ammoCount = $('#ammo-count');
  el.ammoSpare = $('#ammo-spare');
  el.reloadBar = $('#reload-bar');
  el.reloadFill = $('#reload-bar i');
  el.cursor = $('#cursor');
  el.cursorG = $('#cursor-g');
  el.title = $('#title');
  el.help = $('#help');
  el.los = $('#los-state');
  el.scan = $('#scan');
  el.scanStatus = $('#scan-status');
  el.scanBar = $('#scan-bar-fill');
  el.scanLog = $('#scan-log');
  el.scanSubject = $('#scan-subject');
  el.scanMarks = $('#scan-marks');
  el.scanMatch = $('#scan-match');
  el.scanDb = $('#scan-db');

  const sc = $('#scan-canvas');
  sc.width = 880;
  sc.height = 660;
  scanCtx = sc.getContext('2d');
  scanCtx.scale(2, 2);

  setCursor('dot');
  updateHands({ left: null, right: null, flashOn: false });
}

/* ---------------- 基本 HUD ---------------- */

export function setObjective(t) {
  el.objective.textContent = t;
  el.objective.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 500 });
}

export function msg(text, type = '') {
  const d = document.createElement('div');
  d.className = 'msg ' + type;
  d.textContent = text;
  el.messages.appendChild(d);
  while (el.messages.children.length > 2) el.messages.removeChild(el.messages.firstChild);
  setTimeout(() => d.classList.add('fade'), 3400);
  setTimeout(() => d.remove(), 4200);
}

export function setPrompt(text, isHint) {
  if (!text) {
    el.prompt.classList.add('hidden');
  } else {
    el.promptText.textContent = text;
    el.prompt.classList.remove('hidden');
    // 纯提示（比如"往上走"）不需要显示按键，它靠走过去触发
    el.prompt.classList.toggle('nokey', !!isHint);
  }
}

/**
 * 把互动提示摆到互动物所在的位置（传入舞台内的 CSS 像素坐标）。
 * 锚点是提示条的底边中点，即"浮在物体上方"，并夹住不让它出屏。
 */
export function setPromptAt(x, y, stageW, stageH) {
  const w = el.prompt.offsetWidth;
  const h = el.prompt.offsetHeight;
  const m = 6;
  let px = x - w / 2;
  let py = y - h;
  px = Math.max(m, Math.min(stageW - w - m, px));
  py = Math.max(m, Math.min(stageH - h - m, py));
  el.prompt.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;
}

export function toggleHelp() {
  el.help.classList.toggle('hidden');
}

export function setLosState(on) {
  if (el.los) {
    el.los.textContent = on ? '开' : '关';
    el.los.style.opacity = on ? '1' : '0.55';
  }
}

export function hideTitle() {
  el.title.classList.add('out');
  setTimeout(() => el.title.classList.add('hidden'), 1200);
}

export function updateHands(inv) {
  for (const [node, item] of [
    [el.handL, inv.left],
    [el.handR, inv.right],
  ]) {
    const icon = node.querySelector('.icon');
    const g = icon.getContext('2d');
    const label = node.querySelector('.item');
    node.classList.toggle('active', !!item);
    node.classList.remove('off');
    if (!item) {
      g.clearRect(0, 0, icon.width, icon.height);
      label.textContent = '空';
    } else if (item === 'pistol') {
      drawPistolIcon(g, icon.width, icon.height);
      label.textContent = ITEM_NAMES.pistol;
    } else {
      drawFlashIcon(g, icon.width, icon.height, inv.flashOn);
      label.textContent = ITEM_NAMES.flashlight + (inv.flashOn ? '' : '（关）');
      if (!inv.flashOn) node.classList.add('off');
    }
  }
}

export function updateAmmo(w, show) {
  el.ammo.classList.toggle('hidden', !show);
  if (!show) return;
  if (el.ammoMag.children.length !== MAG_SIZE) {
    el.ammoMag.innerHTML = '';
    for (let i = 0; i < MAG_SIZE; i++) {
      const b = document.createElement('i');
      b.className = 'bullet';
      el.ammoMag.appendChild(b);
    }
  }
  for (let i = 0; i < MAG_SIZE; i++) {
    el.ammoMag.children[i].className = 'bullet' + (i < w.mag ? '' : ' empty');
  }
  el.ammoCount.textContent = w.mag;
  el.ammoSpare.textContent = w.spare;
  const rl = w.reload > 0;
  el.reloadBar.classList.toggle('on', rl);
  if (rl) el.reloadFill.style.width = (w.reloadProgress * 100).toFixed(1) + '%';
}

/* ---------------- 准星 ---------------- */

let cursorMode = 'dot';
export function setCursor(mode) {
  if (cursorMode === mode) return;
  cursorMode = mode;
  if (mode === 'cross') {
    el.cursorG.innerHTML = `
      <g stroke="#ded8c8" stroke-width="2" id="ticks">
        <line x1="20" y1="7" x2="20" y2="14"/>
        <line x1="20" y1="26" x2="20" y2="33"/>
        <line x1="7" y1="20" x2="14" y2="20"/>
        <line x1="26" y1="20" x2="33" y2="20"/>
      </g>
      <rect x="19" y="19" width="2" height="2" fill="#ded8c8"/>`;
  } else {
    el.cursorG.innerHTML = `
      <rect x="16" y="19.5" width="8" height="1.5" fill="rgba(222,216,200,0.7)"/>
      <rect x="19.5" y="16" width="1.5" height="8" fill="rgba(222,216,200,0.7)"/>`;
  }
}

export function showCursor(on) {
  el.cursor.style.display = on ? '' : 'none';
}

export function moveCursor(x, y, spread = 0) {
  el.cursor.style.transform = `translate(${x}px, ${y}px)`;
  const t = el.cursorG.querySelector('#ticks');
  if (t) t.style.transform = `scale(${1 + spread})`;
  if (t) t.style.transformOrigin = '20px 20px';
}

/* ---------------- 人脸识别序列 ---------------- */

const SCAN_TIMELINE = [
  { t: 0.0, status: '正在初始化传感器…', log: '> BIO-ID v4.2.1 启动' },
  { t: 0.45, status: '红外投射阵列启动…', log: '> IR-DOT PROJECTOR ... OK' },
  { t: 0.95, status: '检测到面部 · 正在对焦', log: '> FACE DETECTED @ 0.62m' },
  { t: 1.5, status: '正在采集面部特征点…', log: '> EXTRACTING LANDMARKS' },
  { t: 2.5, status: '构建三维深度模型…', log: '> DEPTH MESH BUILD 68/68' },
  { t: 3.2, status: '正在比对生物特征数据库…', log: '> QUERY: PERSONNEL_DB_L7' },
  { t: 4.3, status: '数据库响应超时，正在重试…', log: '! LINK TIMEOUT (1/3)', err: true },
  { t: 4.9, status: '数据库响应超时，正在重试…', log: '! LINK TIMEOUT (2/3)', err: true },
  { t: 5.4, status: '数据库响应超时，正在重试…', log: '! LINK TIMEOUT (3/3)', err: true },
  { t: 5.9, status: '人脸识别系统错误', log: '! ERR_0x37 BIOMETRIC SERVICE DOWN', err: true, fail: true },
  { t: 6.4, status: '人脸识别系统错误 · 门禁保持锁定', log: '! DOOR D-01 REMAINS LOCKED', err: true },
];

export const scan = {
  active: false,
  t: 0,
  step: 0,
  failed: false,
  onDone: null,
};

export function startScan(onDone) {
  scan.active = true;
  scan.t = 0;
  scan.step = 0;
  scan.failed = false;
  scan.onDone = onDone;
  el.scan.classList.remove('hidden', 'err');
  el.scanLog.innerHTML = '';
  el.scanBar.style.width = '0%';
  el.scanSubject.textContent = '采集中…';
  el.scanMarks.textContent = '0 / 68';
  el.scanMatch.textContent = '--.-%';
  el.scanDb.textContent = '连接中…';
  el.scanStatus.textContent = SCAN_TIMELINE[0].status;
}

export function updateScan(dt) {
  if (!scan.active) return;
  scan.t += dt;
  const t = scan.t;

  while (scan.step < SCAN_TIMELINE.length && t >= SCAN_TIMELINE[scan.step].t) {
    const s = SCAN_TIMELINE[scan.step];
    el.scanStatus.textContent = s.status;
    const d = document.createElement('div');
    if (s.err) d.className = 'e';
    d.textContent = s.log;
    el.scanLog.appendChild(d);
    // 只保留最近几行：滚动会把顶部那行切成半截，看起来像渲染错误
    while (el.scanLog.children.length > 6) el.scanLog.removeChild(el.scanLog.firstChild);
    if (s.fail) {
      scan.failed = true;
      el.scan.classList.add('err');
      SFX.sfxError();
    } else if (s.err) {
      SFX.sfxBeep(220, 0.12, 0.1);
    } else {
      SFX.sfxBeep(1100 + scan.step * 90, 0.05, 0.08);
    }
    scan.step++;
  }

  // 进度与读数
  const prog = Math.min(1, t / 5.9);
  el.scanBar.style.width = (scan.failed ? 100 : prog * 100).toFixed(1) + '%';
  const marks = Math.min(68, Math.floor(Math.max(0, (t - 1.5) / 1.0) * 68));
  el.scanMarks.textContent = `${marks} / 68`;
  if (t > 0.95) el.scanSubject.textContent = scan.failed ? 'UNRESOLVED' : 'HUMAN · 成年';
  if (t > 3.2) {
    if (scan.failed) {
      el.scanMatch.textContent = 'ERROR';
      el.scanDb.textContent = '不可用';
    } else {
      el.scanMatch.textContent = (Math.random() * 42 + 5).toFixed(1) + '%';
      el.scanDb.textContent = t > 4.3 ? '超时重试' : '查询中…';
    }
  }

  drawScanFace(t, scan.failed);

  if (t > 8.2) {
    scan.active = false;
    el.scan.classList.add('hidden');
    if (scan.onDone) scan.onDone();
  }
}

/* --- 人脸网格绘制 --- */
let landmarks = null;
function buildLandmarks() {
  const pts = [];
  const cx = 220,
    cy = 158;
  // 下颌轮廓
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (0.08 + (i / 16) * 0.84);
    pts.push({ x: cx - Math.cos(a) * 62, y: cy + Math.sin(a) * 86, g: 'jaw' });
  }
  // 眉毛
  for (let i = 0; i < 5; i++) pts.push({ x: cx - 44 + i * 11, y: cy - 34 - Math.sin((i / 4) * 3.14) * 6, g: 'brow' });
  for (let i = 0; i < 5; i++) pts.push({ x: cx + 2 + i * 11, y: cy - 34 - Math.sin((i / 4) * 3.14) * 6, g: 'brow' });
  // 鼻梁
  for (let i = 0; i < 4; i++) pts.push({ x: cx, y: cy - 22 + i * 13, g: 'nose' });
  for (let i = 0; i < 5; i++) pts.push({ x: cx - 16 + i * 8, y: cy + 34, g: 'nose' });
  // 眼睛
  for (const ex of [-26, 26]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push({ x: cx + ex + Math.cos(a) * 14, y: cy - 12 + Math.sin(a) * 6.5, g: 'eye' });
    }
  }
  // 嘴
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * 24, y: cy + 62 + Math.sin(a) * 9, g: 'mouth' });
  }
  return pts;
}

function drawScanFace(t, failed) {
  if (!landmarks) landmarks = buildLandmarks();
  const g = scanCtx;
  const W = 440,
    H = 330;
  g.clearRect(0, 0, W, H);

  const acc = '#ded8c8';
  const accDim = 'rgba(222,216,200,0.3)';
  const jit = failed ? (Math.random() - 0.5) * 3.2 : 0;

  // 背景
  g.fillStyle = '#16161a';
  g.fillRect(0, 0, W, H);

  g.save();
  g.translate(jit, jit * 0.6);

  // 摄像头噪点头像轮廓（"看到的人"）
  if (t > 0.7) {
    const a = Math.min(1, (t - 0.7) / 0.6);
    g.globalAlpha = a * 0.55;
    g.fillStyle = 'rgba(222,216,200,0.14)';
    g.beginPath();
    g.ellipse(220, 150, 66, 90, 0, 0, 6.3);
    g.fill();
    // 肩
    g.beginPath();
    g.ellipse(220, 320, 120, 62, 0, 0, 6.3);
    g.fill();
    g.globalAlpha = 1;
  }

  // 对焦框
  if (t > 0.3) {
    const lock = Math.min(1, (t - 0.3) / 0.5);
    const pad = 60 * (1 - lock);
    const bx = 150 - pad,
      by = 58 - pad,
      bw = 140 + pad * 2,
      bh = 200 + pad * 2;
    g.strokeStyle = acc;
    g.lineWidth = 1.6;
    const c = 20;
    for (const [sx, sy, dx, dy] of [
      [bx, by, 1, 1],
      [bx + bw, by, -1, 1],
      [bx, by + bh, 1, -1],
      [bx + bw, by + bh, -1, -1],
    ]) {
      g.beginPath();
      g.moveTo(sx + dx * c, sy);
      g.lineTo(sx, sy);
      g.lineTo(sx, sy + dy * c);
      g.stroke();
    }
    g.strokeStyle = accDim;
    g.lineWidth = 0.8;
    g.strokeRect(bx, by, bw, bh);
  }

  // 特征点
  if (t > 1.4) {
    const p = Math.min(1, (t - 1.4) / 1.1);
    const n = Math.floor(landmarks.length * p);
    // 网格连线
    g.strokeStyle = accDim;
    g.lineWidth = 0.7;
    g.beginPath();
    for (let i = 1; i < n; i++) {
      const a = landmarks[i - 1],
        b = landmarks[i];
      if (a.g === b.g) {
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
    }
    // 交叉网格
    for (let i = 0; i < n; i += 3) {
      const a = landmarks[i];
      const b = landmarks[(i * 7 + 11) % Math.max(1, n)];
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    g.stroke();
    for (let i = 0; i < n; i++) {
      const pt = landmarks[i];
      g.fillStyle = acc;
      g.fillRect(pt.x - 1.2, pt.y - 1.2, 2.4, 2.4);
    }
  }

  // 扫描线：一条实线，不做渐变拖尾
  if (t > 1.0 && t < 6.0) {
    const sy = 40 + ((t * 105) % 250);
    g.fillStyle = acc;
    g.fillRect(140, sy, 160, 2);
  }

  // 失败叠加：反色色块 + 划叉，不用红色
  if (failed) {
    g.strokeStyle = acc;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(150, 58);
    g.lineTo(290, 258);
    g.moveTo(290, 58);
    g.lineTo(150, 258);
    g.stroke();
    g.fillStyle = acc;
    g.fillRect(148, 284, 148, 26);
    g.fillStyle = '#24242a';
    g.font = 'bold 20px monospace';
    g.fillText('NO MATCH', 158, 303);
  }

  g.restore();

  // 静电噪点
  g.globalAlpha = failed ? 0.1 : 0.04;
  for (let i = 0; i < 180; i++) {
    g.fillStyle = Math.random() > 0.5 ? '#ded8c8' : '#000';
    g.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }
  g.globalAlpha = 1;

  // 角标信息
  g.fillStyle = 'rgba(222,216,200,0.6)';
  g.font = '10px monospace';
  g.fillText('CAM-01', 8, 16);
  g.fillText(failed ? '故障' : '扫描中', 8, 322);
  g.fillText((t * 1000).toFixed(0).padStart(6, '0') + 'ms', 372, 322);
}
