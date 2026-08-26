import { drawPistolIcon, drawFlashIcon, drawPortraitBust, PORTRAIT_BUST } from './art.js';
import { MAG_SIZE } from './config.js';
import * as SFX from './audio.js';
import { VERSION } from './version.js';

const $ = (s) => document.querySelector(s);

const el = {};
let scanCtx = null;

export const ITEM_NAMES = { pistol: '手枪 M1911', flashlight: '手电筒' };

export function initUI() {
  el.hud = $('#hud');
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
  el.qte = $('#qte');
  el.qteTitle = $('#qte-title');
  el.qteBeats = $('#qte-beats');
  el.qteRing = $('#qte-ring');
  el.qteKeyLabel = $('#qte-key-label');
  el.qteCaption = $('#qte-caption');
  el.qteMash = $('#qte-mash-fill');
  el.ending = $('#ending');
  el.endingLine = $('#ending-line');
  el.buildVer = $('#build-ver');
  if (el.buildVer) el.buildVer.textContent = 'v' + VERSION;

  const sc = $('#scan-canvas');
  sc.width = 880;
  sc.height = 660;
  scanCtx = sc.getContext('2d');
  scanCtx.scale(2, 2);

  setCursor('dot');
  updateHands({ left: null, right: null, flashOn: false });
}

/* ---------------- 基本 HUD ---------------- */

/* 目标 HUD 已删除：目标信息一律由字幕（msg）与对讲机台词承担。 */

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

/* ---------------- QTE ---------------- *
 *
 * 电影化 QTE 的 DOM 侧：一次只显示**一个**键。
 * 每一拍分两段 —— 先是运镜引子（只更新节拍点与动作名，键还不出现），
 * 到关键瞬间才 qteShowKey() 把那一个大键帽弹出来，外面套一圈往内收的
 * 限时环。收缩环本身就是倒计时，玩家不用去读进度条。
 */

const KEY_LABEL = { ' ': '空格', space: '空格' };
export const keyLabel = (k) => KEY_LABEL[k] || k.toUpperCase();

/** 开一段 QTE：只搭外壳（标题 + n 个节拍点），键还不出 */
export function qteBegin(title, n) {
  el.qte.className = '';
  el.hud.classList.add('qte-on'); // 字幕让位，别压在动作名上
  el.qteTitle.textContent = title;
  el.qteCaption.textContent = '';
  el.qteMash.style.width = '0%';
  el.qteBeats.innerHTML = '';
  for (let i = 0; i < n; i++) el.qteBeats.appendChild(document.createElement('i'));
}

/** 进入第 i 拍的运镜引子：更新节拍点与动作名，键仍然不出现 */
export function qteBeat(i, caption) {
  el.qte.classList.remove('on', 'hit', 'mash', 'punch');
  el.qteCaption.textContent = caption || '';
  const n = el.qteBeats.children.length;
  for (let k = 0; k < n; k++) {
    el.qteBeats.children[k].className = k < i ? 'done' : k === i ? 'now' : '';
  }
}

/** 关键瞬间：把这一拍唯一的那个键弹出来。mash=true 时是连按段落 */
export function qteShowKey(key, mash) {
  el.qteKeyLabel.textContent = keyLabel(key);
  el.qte.classList.remove('hit');
  el.qte.classList.toggle('mash', !!mash);
  el.qte.classList.add('on');
  qteTime(1);
}

/** 限时：k 从 1 收到 0，环跟着往键帽上贴 */
export function qteTime(k) {
  const t = Math.max(0, Math.min(1, k));
  el.qteRing.style.transform = `scale(${(1 + t * 1.6).toFixed(3)})`;
  el.qteRing.style.opacity = (0.35 + 0.55 * (1 - t)).toFixed(2);
}

/** 按对了：键帽炸开一下 */
export function qteHit() {
  el.qte.classList.remove('on');
  el.qte.classList.add('hit');
}

/** 连按进度（0..1），并给键帽一下弹动 */
export function qteMash(k, punch) {
  el.qteMash.style.width = (Math.max(0, Math.min(1, k)) * 100).toFixed(1) + '%';
  if (punch) {
    el.qte.classList.add('punch');
    setTimeout(() => el.qte.classList.remove('punch'), 80);
  }
}

export function qteFailed(title) {
  el.qte.classList.add('fail');
  el.qte.classList.remove('on', 'mash');
  el.qteTitle.textContent = title;
}

export function hideQTE() {
  el.qte.className = 'hidden';
  el.hud.classList.remove('qte-on');
}

/* ---------------- 序章结束 ---------------- */

export function showEnding(line) {
  if (line) el.endingLine.textContent = line;
  el.ending.classList.remove('hidden');
  // 先上屏再加 .on，transition 才会真的跑一遍
  requestAnimationFrame(() => el.ending.classList.add('on'));
}

export function hideEnding() {
  el.ending.classList.remove('on');
  el.ending.classList.add('hidden');
}

/* ---------------- 准星 ---------------- */

// 初始为 null：否则 initUI 里那次 setCursor('dot') 会被"模式没变"挡掉，
// 结果没拿枪时准星根本没画出来。
let cursorMode = null;
export function setCursor(mode) {
  if (cursorMode === mode) return;
  cursorMode = mode;
  // 有枪和没枪用同一套准星，只是没枪时更小更淡 —— 形态一致，玩家不会
  // 觉得这是两套不同的东西。
  const armed = mode === 'cross';
  const a = armed ? 1 : 0.5;
  const w = armed ? 2 : 1.5;
  const g0 = armed ? 7 : 11; // 内缺口
  const g1 = armed ? 14 : 15;
  el.cursorG.innerHTML = `
    <g stroke="rgba(222,216,200,${a})" stroke-width="${w}" id="ticks">
      <line x1="20" y1="${g0}" x2="20" y2="${g1}"/>
      <line x1="20" y1="${40 - g0}" x2="20" y2="${40 - g1}"/>
      <line x1="${g0}" y1="20" x2="${g1}" y2="20"/>
      <line x1="${40 - g0}" y1="20" x2="${40 - g1}" y2="20"/>
    </g>
    <rect x="19" y="19" width="2" height="2" fill="rgba(222,216,200,${a})"/>`;
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

// 半身立绘在 440x330 摄像画面里的位置：整数缩放，像素边界不会糊
const BUST = { x: 68, y: 30, s: 4 };
const BX = (u) => BUST.x + u * BUST.s;
const BY = (u) => BUST.y + u * BUST.s;

let landmarks = null;
function buildLandmarks() {
  const B = PORTRAIT_BUST;
  const pts = [];
  const cx = BX(B.faceCx);
  // 下颌轮廓：从眉线绕到下巴
  const jawCy = BY(B.browY);
  const jawRy = BY(B.chinY) - jawCy;
  const jawRx = (B.head.w / 2) * BUST.s;
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI * (0.08 + (i / 16) * 0.84);
    pts.push({ x: cx - Math.cos(a) * jawRx, y: jawCy + Math.sin(a) * jawRy, g: 'jaw' });
  }
  // 眉毛
  for (const ox of [-11, 3]) {
    for (let i = 0; i < 5; i++) {
      pts.push({ x: BX(B.faceCx + ox + i * 2.25), y: BY(B.browY) - Math.sin((i / 4) * 3.14) * 3, g: 'brow' });
    }
  }
  // 鼻梁 + 鼻翼
  for (let i = 0; i < 4; i++) pts.push({ x: cx, y: BY(B.noseTop + i * 4), g: 'nose' });
  for (let i = 0; i < 5; i++) pts.push({ x: BX(B.faceCx - 4 + i * 2), y: BY(B.noseBaseY), g: 'nose' });
  // 眼睛
  for (const ex of [-B.eyeDx, B.eyeDx]) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push({
        x: BX(B.faceCx + ex) + Math.cos(a) * B.eyeRx * BUST.s,
        y: BY(B.eyeY) + Math.sin(a) * B.eyeRy * BUST.s,
        g: 'eye',
      });
    }
  }
  // 嘴
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push({
      x: cx + Math.cos(a) * B.mouthRx * BUST.s,
      y: BY(B.mouthY) + Math.sin(a) * B.mouthRy * BUST.s,
      g: 'mouth',
    });
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

  // 摄像头拍到的人：主角半身立绘，肩部由画面下缘裁掉
  if (t > 0.7) {
    g.save();
    g.beginPath();
    g.rect(0, 0, W, H);
    g.clip();
    g.globalAlpha = Math.min(1, (t - 0.7) / 0.6);
    drawPortraitBust(g, BUST.x, BUST.y, BUST.s);
    g.globalAlpha = 1;
    // 压暗成监控画面的曝光
    g.fillStyle = 'rgba(20,20,26,0.4)';
    g.fillRect(0, 0, W, H);
    g.restore();
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
