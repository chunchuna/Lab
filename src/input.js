import { VIEW_W, VIEW_H } from './config.js';
import { isTouchDevice } from './controls.js';

let touchMode = false;

export const keys = new Set();
export const pressed = new Set();
export const mouse = { x: VIEW_W / 2, y: VIEW_H / 2, cx: 0, cy: 0, down: false, clicked: false, inside: false };
export const view = { scale: 1, left: 0, top: 0 };

let stageEl = null;

export function layout() {
  if (!stageEl) return;
  const ww = window.innerWidth;
  const wh = window.innerHeight;
  const scale = Math.min(ww / VIEW_W, wh / VIEW_H);
  const w = Math.round(VIEW_W * scale);
  const h = Math.round(VIEW_H * scale);
  stageEl.style.width = w + 'px';
  stageEl.style.height = h + 'px';
  // 手机屏幕物理尺寸小，UI 需要相对更大才点得中
  stageEl.style.fontSize = (scale * (touchMode ? 9.0 : 7.6)).toFixed(2) + 'px';
  const r = stageEl.getBoundingClientRect();
  view.scale = scale;
  view.left = r.left;
  view.top = r.top;
}

export function initInput(stage, onKey) {
  stageEl = stage;
  touchMode = isTouchDevice();
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 120));

  // 触屏：任意点击可以唤醒音频 / 跳过标题
  window.addEventListener('pointerdown', (e) => {
    if (onKey) onKey('__pointer', e);
  });
  // 禁止移动端的滚动、双击缩放、长按菜单
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', ' ', 'tab'].includes(k)) e.preventDefault();
    if (!keys.has(k)) {
      pressed.add(k);
      if (onKey) onKey(k, e);
    }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  window.addEventListener('mousemove', (e) => {
    mouse.cx = e.clientX;
    mouse.cy = e.clientY;
    const r = stageEl.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) / view.scale;
    mouse.y = (e.clientY - r.top) / view.scale;
    mouse.inside = mouse.x >= 0 && mouse.y >= 0 && mouse.x <= VIEW_W && mouse.y <= VIEW_H;
  });
  window.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      mouse.down = true;
      mouse.clicked = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouse.down = false;
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function endFrame() {
  pressed.clear();
  mouse.clicked = false;
}

export const isDown = (k) => keys.has(k);
export const justPressed = (k) => pressed.has(k);
