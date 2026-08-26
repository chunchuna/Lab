import { VIEW_W, VIEW_H, pixelScale } from './config.js';
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
  const dpr = window.devicePixelRatio || 1;

  /* 舞台只取整数倍尺寸：逻辑 640×360 对应真实 640N×360N 的像素网格，
     CSS 尺寸 = 真实像素 / dpr，浏览器那一层 1:1。窗口不是 16:9 的整数倍时
     留黑边，宁可四周黑一点，也不做非整数拉伸。 */
  const pix = pixelScale();
  let w = (VIEW_W * pix) / dpr;
  let h = (VIEW_H * pix) / dpr;
  if (w > ww + 0.01 || h > wh + 0.01) {
    // 窗口比一个逻辑视口还小，只剩等比缩一条路，这时谈不上整数倍
    const s = Math.min(ww / VIEW_W, wh / VIEW_H);
    w = VIEW_W * s;
    h = VIEW_H * s;
  }
  const scale = w / VIEW_W;
  stageEl.style.width = w.toFixed(3) + 'px';
  stageEl.style.height = h.toFixed(3) + 'px';
  /* 居中位置也要落在设备像素的整格上。舞台停在半个设备像素上的话，浏览器会把
     整张画布重采样一次，辛苦对齐的像素块边缘照样糊掉。 */
  stageEl.style.left = (Math.round(((ww - w) / 2) * dpr) / dpr).toFixed(3) + 'px';
  stageEl.style.top = (Math.round(((wh - h) / 2) * dpr) / dpr).toFixed(3) + 'px';
  // 手机屏幕物理尺寸小，UI 需要相对更大才点得中
  stageEl.style.fontSize = (scale * (touchMode ? 9.0 : 7.6)).toFixed(2) + 'px';
  // 竖屏时画面会被压到很小，引导用户转横屏（浏览器里无法强制）
  document.body.classList.toggle('portrait', touchMode && wh > ww * 1.05);
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
    const isTilde = e.code === 'Backquote' || e.key === '`' || e.key === '~';
    if (isTilde) {
      e.preventDefault();
      if (onKey) onKey('`', e);
      return;
    }
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    if (typing) {
      if (e.key === 'Escape' && onKey) onKey('escape', e);
      return;
    }
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', ' ', 'tab'].includes(k)) e.preventDefault();
    if (!keys.has(k)) {
      pressed.add(k);
      if (onKey) onKey(k, e);
    }
    keys.add(k);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Backquote' || e.key === '`' || e.key === '~') return;
    keys.delete(e.key.toLowerCase());
  });
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
