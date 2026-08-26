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
 * 离屏画布。一律画在逻辑像素网格上（1 逻辑像素 = 1 真实像素），放大留到最后
 * 一步整数倍呈现时做，中间任何一层都不许出现半像素的平滑插值 —— 那正是把
 * 像素块边缘抹成油画的来源。
 *
 * 逻辑尺寸记在 `c.lw / c.lh` 上，`blit` 按它们画。
 */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = c.lw = Math.max(1, Math.ceil(w));
  c.height = c.lh = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  setBase(g, 1, 0, 0, 1, 0, 0);
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

/** 画一张 makeCanvas 出来的贴图：按它的**逻辑**尺寸画，不按真实像素 */
export function blit(g, c, x, y) {
  g.drawImage(c, x, y, c.lw || c.width, c.lh || c.height);
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
