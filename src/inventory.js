import {
  drawPistolIcon, drawFlashIcon, drawMagIcon, drawBadgeIcon, drawPortrait, PORTRAIT_HANDS,
  OUTFITS,
} from './art.js';

export const ITEMS = {
  pistol: {
    name: '手枪 M1911',
    tag: '武器',
    hand: true,
    prefer: 'right',
    desc: '半自动手枪，弹匣容量 6 发。装备到手上后可用鼠标左键射击，R 键换弹。',
    icon: (g, w, h) => drawPistolIcon(g, w, h),
  },
  flashlight: {
    name: '战术手电筒',
    tag: '工具',
    hand: true,
    prefer: 'left',
    desc: '强光 LED 手电。装备到手上后照亮角色朝向的区域，F 键开关。',
    icon: (g, w, h, st) => drawFlashIcon(g, w, h, st ? st.flashOn : true),
  },
  mag: {
    name: '9mm 备用弹匣',
    tag: '弹药',
    stack: true,
    desc: '装满 6 发的备用弹匣。换弹时会自动从背包中消耗一个。',
    icon: (g, w, h) => drawMagIcon(g, w, h),
  },
  badge: {
    name: '员工识别卡（已消磁）',
    tag: '杂物',
    desc: '姓名一栏被血糊住了。磁条已经失效 —— 门禁系统根本读不到它。',
    icon: (g, w, h) => drawBadgeIcon(g, w, h),
  },
};

const SLOT_COUNT = 15;

export const inv = {
  bag: new Array(SLOT_COUNT).fill(null),
  left: null,
  right: null,
  flashOn: true,
  open: false,
};

let listeners = [];
export function onInvChange(fn) {
  listeners.push(fn);
}
function changed() {
  render();
  for (const fn of listeners) fn(inv);
}

/* ------------------------------------------------------------------ *
 * 数据操作
 * ------------------------------------------------------------------ */

export function addItem(id, n = 1) {
  const def = ITEMS[id];
  if (!def) return false;
  if (def.stack) {
    const slot = inv.bag.find((s) => s && s.id === id);
    if (slot) {
      slot.n += n;
      changed();
      return true;
    }
  }
  const i = inv.bag.indexOf(null);
  if (i < 0) return false;
  inv.bag[i] = { id, n };
  changed();
  return true;
}

export function countItem(id) {
  let c = 0;
  for (const s of inv.bag) if (s && s.id === id) c += s.n;
  for (const s of [inv.left, inv.right]) if (s && s.id === id) c += s.n;
  return c;
}

export function consumeItem(id, n = 1) {
  for (let i = 0; i < inv.bag.length; i++) {
    const s = inv.bag[i];
    if (!s || s.id !== id) continue;
    const take = Math.min(n, s.n);
    s.n -= take;
    n -= take;
    if (s.n <= 0) inv.bag[i] = null;
    if (n <= 0) break;
  }
  changed();
  return n <= 0;
}

export function has(id) {
  return countItem(id) > 0;
}

/** 该物品当前装备在哪只手 */
export function equipped(id) {
  if (inv.left && inv.left.id === id) return 'left';
  if (inv.right && inv.right.id === id) return 'right';
  return null;
}

export function handItem(hand) {
  return inv[hand] ? inv[hand].id : null;
}

/** 键盘快捷装备/卸下 */
export function quickEquip(id) {
  const def = ITEMS[id];
  if (!def || !def.hand) return 'none';
  const cur = equipped(id);
  if (cur) {
    const i = inv.bag.indexOf(null);
    if (i < 0) return 'full';
    inv.bag[i] = inv[cur];
    inv[cur] = null;
    changed();
    return 'unequipped';
  }
  const idx = inv.bag.findIndex((s) => s && s.id === id);
  if (idx < 0) return 'missing';
  const prefer = def.prefer || 'right';
  const other = prefer === 'left' ? 'right' : 'left';
  const hand = inv[prefer] === null ? prefer : inv[other] === null ? other : prefer;
  const displaced = inv[hand];
  inv[hand] = inv.bag[idx];
  inv.bag[idx] = displaced;
  changed();
  return hand;
}

export function toggleFlash() {
  inv.flashOn = !inv.flashOn;
  changed();
}

/** 回主菜单时清空：下一局「开始游戏」不该带着上一局捡到的东西 */
export function resetInventory() {
  inv.bag.fill(null);
  inv.left = null;
  inv.right = null;
  inv.flashOn = true;
  changed();
}

/* ------------------------------------------------------------------ *
 * DOM / 拖拽
 * ------------------------------------------------------------------ */

const el = {};
let drag = null;
let hovered = null;

export function initInventory() {
  el.root = document.getElementById('bag');
  el.grid = document.getElementById('bag-grid');
  el.portrait = document.getElementById('portrait');
  el.slotL = document.querySelector('[data-slot="left"]');
  el.slotR = document.querySelector('[data-slot="right"]');
  el.infoName = document.querySelector('#bag-info .bi-name');
  el.infoTag = document.querySelector('#bag-info .bi-tag');
  el.infoDesc = document.querySelector('#bag-info .bi-desc');

  el.portrait.width = 240;
  el.portrait.height = 400;
  el.pctx = el.portrait.getContext('2d');
  el.pctx.imageSmoothingEnabled = false;

  // 依据立绘中手部的高度对齐左右手格子
  // 格子高 6.6em、立绘高 21em -> 半个格子约占立绘高度的 15.7%
  const HALF = ((6.6 / 21) * 100) / 2;
  for (const [node, key] of [
    [el.slotL, 'left'],
    [el.slotR, 'right'],
  ]) {
    node.style.top = ((PORTRAIT_HANDS[key].y / PORTRAIT_HANDS.h) * 100 - HALF).toFixed(2) + '%';
  }

  el.grid.innerHTML = '';
  for (let i = 0; i < SLOT_COUNT; i++) {
    const c = document.createElement('div');
    c.className = 'cell';
    c.dataset.cell = String(i);
    const cv = document.createElement('canvas');
    cv.width = 56;
    cv.height = 56;
    cv.className = 'icon';
    const n = document.createElement('span');
    n.className = 'count';
    c.append(cv, n);
    el.grid.appendChild(c);
  }

  el.root.addEventListener('pointerdown', onDown);
  el.root.addEventListener('pointermove', onHover);
  el.root.addEventListener('dblclick', onDblClick);
  el.root.addEventListener('pointerleave', () => setInfo(null));
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);

  render();
}

function slotRefFrom(node) {
  if (!node) return null;
  const cell = node.closest('[data-cell]');
  if (cell) return { type: 'bag', index: Number(cell.dataset.cell) };
  const hand = node.closest('[data-slot]');
  if (hand) return { type: 'hand', hand: hand.dataset.slot };
  return null;
}

function getRef(ref) {
  return ref.type === 'bag' ? inv.bag[ref.index] : inv[ref.hand];
}
function setRef(ref, v) {
  if (ref.type === 'bag') inv.bag[ref.index] = v;
  else inv[ref.hand] = v;
}

function onDown(e) {
  if (e.button !== 0) return;
  const ref = slotRefFrom(e.target);
  if (!ref) return;
  const item = getRef(ref);
  if (!item) return;
  e.preventDefault();

  drag = { ref, item, moved: false, x: e.clientX, y: e.clientY };
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const cv = document.createElement('canvas');
  cv.width = 56;
  cv.height = 56;
  ITEMS[item.id].icon(cv.getContext('2d'), 56, 56, inv);
  ghost.appendChild(cv);
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  moveGhost(e.clientX, e.clientY);

  el.root.classList.add('dragging');
  if (ITEMS[item.id].hand) el.root.classList.add('hand-ok');
  setInfo(item.id);
}

function moveGhost(x, y) {
  if (drag && drag.ghost) drag.ghost.style.transform = `translate(${x}px, ${y}px)`;
}

function onDragMove(e) {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
  moveGhost(e.clientX, e.clientY);
  const t = document.elementFromPoint(e.clientX, e.clientY);
  const ref = slotRefFrom(t);
  document.querySelectorAll('.drop-hover').forEach((n) => n.classList.remove('drop-hover'));
  if (ref) {
    const node = ref.type === 'bag' ? el.grid.children[ref.index] : ref.hand === 'left' ? el.slotL : el.slotR;
    if (node && canDrop(ref)) node.classList.add('drop-hover');
  }
}

function canDrop(target) {
  if (!drag) return false;
  if (target.type === 'hand') return !!ITEMS[drag.item.id].hand;
  const cur = inv.bag[target.index];
  if (drag.ref.type === 'hand' && cur && !ITEMS[cur.id].hand) return false;
  return true;
}

function onDragEnd(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.ghost) d.ghost.remove();
  el.root.classList.remove('dragging', 'hand-ok');
  document.querySelectorAll('.drop-hover').forEach((n) => n.classList.remove('drop-hover'));

  const target = slotRefFrom(document.elementFromPoint(e.clientX, e.clientY));

  // 没移动 = 单击：快速装备
  if (!d.moved) {
    if (d.ref.type === 'bag' && ITEMS[d.item.id].hand) quickEquip(d.item.id);
    else if (d.ref.type === 'hand') quickEquip(d.item.id);
    return;
  }
  if (!target) return;
  drag = d;
  const ok = canDrop(target);
  drag = null;
  if (!ok) {
    bump(target);
    return;
  }
  if (target.type === d.ref.type && target.index === d.ref.index && target.hand === d.ref.hand) return;

  // 同种可堆叠物品合并
  const dst = getRef(target);
  if (dst && dst.id === d.item.id && ITEMS[d.item.id].stack) {
    dst.n += d.item.n;
    setRef(d.ref, null);
  } else {
    setRef(d.ref, dst || null);
    setRef(target, d.item);
  }
  changed();
}

function bump(target) {
  const node = target.type === 'bag' ? el.grid.children[target.index] : target.hand === 'left' ? el.slotL : el.slotR;
  if (!node) return;
  node.classList.remove('reject');
  void node.offsetWidth;
  node.classList.add('reject');
}

function onHover(e) {
  if (drag) return;
  const ref = slotRefFrom(e.target);
  const item = ref ? getRef(ref) : null;
  const id = item ? item.id : null;
  if (id !== hovered) setInfo(id);
}

function onDblClick(e) {
  const ref = slotRefFrom(e.target);
  if (!ref) return;
  const item = getRef(ref);
  if (item && item.id === 'flashlight' && ref.type === 'hand') toggleFlash();
}

function setInfo(id) {
  hovered = id;
  if (!id) {
    el.infoName.textContent = '—';
    el.infoTag.textContent = '';
    el.infoDesc.textContent = '拖动物品到立绘两侧的「左手 / 右手」格子即可装备。';
    return;
  }
  const d = ITEMS[id];
  el.infoName.textContent = d.name;
  el.infoTag.textContent = d.tag || '';
  el.infoDesc.textContent = d.desc || '';
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

/* 立绘的穿着与长相。outfit 存**键名**（art.js 有带 ?v= 与不带两份模块实例，
   传对象跨实例可能拿错），绘制时用本模块自己的 OUTFITS 解析。 */
const style = { outfit: 'lab', look: null, name: '' };

/** 登记完成 / 读档 / 回主菜单时由 main.js 调：换装 + 改立绘下的名字 */
export function setPortraitStyle(outfit, look, name) {
  style.outfit = outfit || 'lab';
  style.look = look || null;
  style.name = name || '';
  const label = document.querySelector('.portrait-name');
  if (label) {
    label.childNodes[0].textContent = style.name ? style.name + ' · 已登记' : '研究员 · 未知身份';
  }
  render();
}

function paintSlot(node, item) {
  const cv = node.querySelector('canvas');
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  node.classList.toggle('filled', !!item);
  const cnt = node.querySelector('.count');
  if (item) {
    ITEMS[item.id].icon(g, cv.width, cv.height, inv);
    if (cnt) cnt.textContent = item.n > 1 ? 'x' + item.n : '';
  } else if (cnt) cnt.textContent = '';
}

export function render() {
  if (!el.grid) return;
  for (let i = 0; i < SLOT_COUNT; i++) paintSlot(el.grid.children[i], inv.bag[i]);
  paintSlot(el.slotL, inv.left);
  paintSlot(el.slotR, inv.right);
  el.slotL.classList.toggle('off', !!inv.left && inv.left.id === 'flashlight' && !inv.flashOn);
  el.slotR.classList.toggle('off', !!inv.right && inv.right.id === 'flashlight' && !inv.flashOn);
  drawPortrait(el.pctx, el.portrait.width, el.portrait.height, {
    left: inv.left && inv.left.id,
    right: inv.right && inv.right.id,
    flashOn: inv.flashOn,
    outfit: OUTFITS[style.outfit] || OUTFITS.lab,
    look: style.look || undefined,
  });
}

export function setOpen(v) {
  inv.open = v;
  el.root.classList.toggle('hidden', !v);
  if (v) {
    render();
    setInfo(null);
  }
}
export function isOpen() {
  return inv.open;
}
