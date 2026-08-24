import { HW, HH } from './config.js';

/**
 * 触屏操作层：左摇杆移动 + 右摇杆瞄准 + 动作按钮。
 * 对上层暴露与键鼠一致的"意图"，main.js 不关心输入来自哪里。
 */
export const pad = {
  enabled: false,
  move: { x: 0, y: 0, mag: 0 }, // 屏幕空间方向
  aim: { x: 1, y: 0.5 }, // 屏幕空间方向（松手后保持）
  aimMag: 0,
  firing: false,
  taps: new Set(),
};

const el = {};
let onTap = null;

export function isTouchDevice() {
  const q = new URLSearchParams(location.search);
  if (q.get('touch') === '1') return true;
  if (q.get('touch') === '0') return false;
  return (
    (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0
  );
}

/** 屏幕方向 -> 世界方向（等距逆变换），返回单位向量 */
export function screenDirToWorld(sx, sy) {
  const wx = sx / HW + sy / HH;
  const wy = sy / HH - sx / HW;
  const l = Math.hypot(wx, wy) || 1;
  return { x: wx / l, y: wy / l };
}

/** 世界方向 -> 屏幕方向单位向量 */
export function worldDirToScreen(a) {
  const x = (Math.cos(a) - Math.sin(a)) * HW;
  const y = (Math.cos(a) + Math.sin(a)) * HH;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function bindStick(base, knob, onVec, keepOnRelease) {
  let id = null;
  let cx = 0;
  let cy = 0;
  let radius = 1;

  const measure = () => {
    const r = base.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    radius = r.width * 0.42;
  };

  const apply = (px, py) => {
    let dx = px - cx;
    let dy = py - cy;
    const d = Math.hypot(dx, dy);
    const clamped = Math.min(d, radius);
    const mag = radius > 0 ? clamped / radius : 0;
    if (d > 0.001) {
      dx /= d;
      dy /= d;
    } else {
      dx = 0;
      dy = 0;
    }
    knob.style.transform = `translate(${dx * clamped}px, ${dy * clamped}px)`;
    onVec(dx, dy, mag);
  };

  base.addEventListener(
    'pointerdown',
    (e) => {
      if (id !== null) return;
      id = e.pointerId;
      base.setPointerCapture(id);
      base.classList.add('held');
      measure();
      apply(e.clientX, e.clientY);
      e.preventDefault();
    },
    { passive: false },
  );
  base.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerId !== id) return;
      apply(e.clientX, e.clientY);
      e.preventDefault();
    },
    { passive: false },
  );
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    base.classList.remove('held');
    knob.style.transform = '';
    if (!keepOnRelease) onVec(0, 0, 0);
    else onVec(null, null, 0);
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);
}

export function initControls(handler) {
  onTap = handler;
  el.root = document.getElementById('pad');
  if (!el.root) return;
  pad.enabled = isTouchDevice();
  el.root.classList.toggle('hidden', !pad.enabled);
  document.body.classList.toggle('touch', pad.enabled);
  if (!pad.enabled) return;

  bindStick(
    document.getElementById('stick-move'),
    document.querySelector('#stick-move i'),
    (x, y, mag) => {
      if (x === null) {
        pad.move.mag = 0;
        return;
      }
      pad.move.x = x;
      pad.move.y = y;
      pad.move.mag = mag;
    },
    false,
  );

  bindStick(
    document.getElementById('stick-aim'),
    document.querySelector('#stick-aim i'),
    (x, y, mag) => {
      pad.aimMag = mag;
      if (x === null || mag < 0.16) return;
      pad.aim.x = x;
      pad.aim.y = y;
    },
    true,
  );

  // 动作按钮
  for (const b of el.root.querySelectorAll('[data-act]')) {
    const act = b.dataset.act;
    const hold = b.dataset.hold === '1';
    b.addEventListener(
      'pointerdown',
      (e) => {
        b.setPointerCapture(e.pointerId);
        b.classList.add('held');
        if (hold) pad.firing = true;
        else {
          pad.taps.add(act);
          if (onTap) onTap(act);
        }
        e.preventDefault();
      },
      { passive: false },
    );
    const up = () => {
      b.classList.remove('held');
      if (hold) pad.firing = false;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
}

/** 显示/隐藏按钮（互动、换弹等按情况出现） */
export function setButton(act, visible, label) {
  if (!pad.enabled || !el.root) return;
  const b = el.root.querySelector(`[data-act="${act}"]`);
  if (!b) return;
  b.classList.toggle('hidden', !visible);
  if (label !== undefined) {
    const s = b.querySelector('span');
    if (s) s.textContent = label;
  }
}

/** 打开背包等模态界面时屏蔽摇杆 */
export function setPadVisible(v) {
  if (!pad.enabled || !el.root) return;
  el.root.classList.toggle('off', !v);
  if (!v) {
    pad.move.mag = 0;
    pad.firing = false;
  }
}

export function endFrameControls() {
  pad.taps.clear();
}
