import { pixelScale, artScale } from './config.js';

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);

export function angLerp(a, b, t) {
  let d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

/** #rrggbb -> 明暗调整（amt: -1..1） */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/**
 * 离屏画布。逻辑尺寸仍是 w×h（640 空间），真实像素是 wN×hN。
 * 基础变换乘上 N，调用方继续写逻辑坐标；4K 时 N=6，格子就是 3840×2160。
 *
 * 逻辑尺寸记在 `c.lw / c.lh` 上，`blit` 按它们画，这样叠到同样带 N 变换
 * 的目标上是 1:1，不会再被乘一次。
 */
export function makeCanvas(w, h, n = pixelScale()) {
  const c = document.createElement('canvas');
  c.lw = Math.max(1, Math.ceil(w));
  c.lh = Math.max(1, Math.ceil(h));
  c.width = Math.max(1, Math.round(c.lw * n));
  c.height = Math.max(1, Math.round(c.lh * n));
  c.pix = n;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  setBase(g, n, 0, 0, n, 0, 0);
  return { c, g, lw: c.lw, lh: c.lh };
}

/**
 * 记住并应用一个上下文的**基础变换**。
 *
 * 地板/墙面那几套绘制空间原本是直接 setTransform 的绝对变换，一旦基础变换不再是
 * 单位阵（近景变焦），绝对 setTransform 就会把它抹掉。所以统一改成
 * 「先回到基础变换，再 transform 叠上去」。
 */
export function setBase(g, a, b, c, d, e, f) {
  g.baseT = [a, b, c, d, e, f];
  g.setTransform(a, b, c, d, e, f);
}

/** 回到基础变换（原来的 resetT） */
export function baseT(g) {
  const b = g.baseT;
  if (b) g.setTransform(b[0], b[1], b[2], b[3], b[4], b[5]);
  else g.setTransform(1, 0, 0, 1, 0, 0);
}

/** 在基础变换之上叠一层局部变换 */
export function localT(g, a, b, c, d, e, f) {
  baseT(g);
  g.transform(a, b, c, d, e, f);
}

/**
 * 美术用的离屏画布：分辨率取纹素网格（见 config.js 的 ART_TEXEL），
 * 比设备像素粗，贴回去时每个纹素是一块实心方块。
 */
export function makeArtCanvas(w, h) {
  return makeCanvas(w, h, artScale());
}

/** 画一张 makeCanvas 出来的贴图：按它的**逻辑**尺寸画，不按真实像素 */
export function blit(g, c, x, y) {
  g.drawImage(c, x, y, c.lw || c.width, c.lh || c.height);
}

/* ------------------------------------------------------------------ *
 * 每帧现画的东西怎么落到纹素网格上
 *
 * 道具那种一次生成、反复贴的精灵直接用 makeArtCanvas 就行。角色不一样：
 * 姿势、朝向、缩放每帧都变，没法预生成。做法是留一张暂存画布，
 * 每帧先把角色画在纹素网格上，再最近邻贴回去 —— 1.12 倍缩放、绕髋部旋转
 * 这些会产生小数边的变换，全都在量化之前完成，贴出来仍然是硬边方块。
 * ------------------------------------------------------------------ */

/* 暂存画布按「倍率 + 嵌套层数」缓存：直升机那一段是把玩家画进机舱图层里的，
   内外两次量化不能抢同一张画布。 */
const scratches = new Map();
let depth = 0;

function scratchFor(key, a, lw, lh) {
  const old = scratches.get(key);
  if (old && old.lw >= lw && old.lh >= lh) return old;
  const s = makeCanvas(Math.max(lw, old ? old.lw : 0), Math.max(lh, old ? old.lh : 0), a);
  scratches.set(key, s);
  return s;
}

/**
 * 在纹素网格上画一个精灵，然后贴到 g 的 (x, y)。
 *
 * box = { w, h, ax, ay }：暂存画布的逻辑尺寸，以及锚点在画布内的位置；
 * 精灵必须落在这个框里，超出的部分会被裁掉。
 * draw(g2, ax, ay) 里的写法跟直接画在目标上完全一样，只是原点换了。
 *
 * box.grid 指定纹素网格，默认跟同场景那些预生成的精灵一致（artScale）。
 * 主菜单整幕放大 2 倍，那一幕的静态层与道具也是按 2 倍烘的，所以它传 2。
 * 注意**不要**跟着 QTE 的近景变焦走：变焦是整帧一起放大的，地板与道具的
 * 纹素本来就会跟着变大，角色也得一起变大才不会显得比周围精细一档。
 *
 * 返回 { value, dx, dy }：value 是 draw 的返回值，dx/dy 用来把暂存画布里
 * 算出来的坐标（比如手的位置）换算回目标空间。
 */
export function pixelSprite(g, x, y, box, draw) {
  const a = Math.max(1, Math.round(box.grid || artScale()));
  const s = scratchFor(a + ':' + depth, a, box.w, box.h);
  baseT(s.g);
  s.g.clearRect(0, 0, box.w, box.h);
  depth++;
  let value;
  try {
    value = draw(s.g, box.ax, box.ay);
  } finally {
    depth--;
  }
  baseT(s.g);
  // 锚点落在整数逻辑格上，纹素边界才对得上设备像素
  const dx = Math.round(x) - box.ax;
  const dy = Math.round(y) - box.ay;
  g.drawImage(s.c, 0, 0, box.w * a, box.h * a, dx, dy, box.w, box.h);
  return { value, dx, dy };
}

/** 闪烁函数：返回 0..1 的亮度系数 */
export function flicker(t, seed, calm = 0.82) {
  const a = Math.sin(t * 11.3 + seed) * 0.5 + 0.5;
  const b = Math.sin(t * 37.7 + seed * 2.1) * 0.5 + 0.5;
  const c = Math.sin(t * 3.1 + seed * 5.7) * 0.5 + 0.5;
  let v = calm + (1 - calm) * (a * 0.4 + b * 0.25 + c * 0.35);
  // 偶发性熄灭
  const d = Math.sin(t * 1.7 + seed * 3.3) * Math.sin(t * 0.41 + seed);
  if (d > 0.955) v *= 0.12 + 0.5 * b;
  else if (d > 0.93) v *= 0.55 + 0.35 * a;
  return v;
}
