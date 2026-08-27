import { pixelScale } from './config.js';

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
 * 美术用的离屏画布。曾经按更粗的"纹素网格"生成再最近邻放大，实测抗锯齿
 * 的过渡像素被放大后整体发糊，已回到全分辨率（见 config.js 顶部说明）。
 * 像素感由 finishArt() 的调色板量化 + 有序抖动负责。
 */
export function makeArtCanvas(w, h) {
  return makeCanvas(w, h);
}

/* ------------------------------------------------------------------ *
 * 烘焙贴图的"像素语言"后处理
 * ------------------------------------------------------------------ */

// 4×4 Bayer 矩阵（经典有序抖动的阈值表）
const BAYER4 = Uint8Array.of(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);

/** 量化步长：每通道 256/QSTEP ≈ 18 级。调像素感的强弱改这一个数。 */
const QSTEP = 14;

let quantLUT = null;
function buildQuantLUT() {
  const lut = new Uint8Array(16 * 256);
  for (let b = 0; b < 16; b++) {
    const dth = ((BAYER4[b] + 0.5) / 16 - 0.5) * QSTEP;
    for (let v = 0; v < 256; v++) {
      const q = Math.round((v + dth) / QSTEP) * QSTEP;
      lut[b * 256 + v] = q < 0 ? 0 : q > 255 ? 255 : q;
    }
  }
  return lut;
}

/**
 * 给一张**烘焙**贴图上像素语言：有限调色板（每通道量化到 QSTEP 一档）+
 * 4×4 有序抖动。抖动格子对齐**逻辑像素**（画布的 pix 倍率），所以渐变
 * 断成色带后，带间的抖点是边长 N 设备像素的实心方块 —— 分辨率一点没降
 * （形状边缘仍是设备像素级），但大面积的渐变读起来就是像素游戏的做法。
 *
 * 只在生成时跑一次（道具精灵、区域静态层、前景层、远景层），
 * 每帧现画的角色与光照**不要**过这里 —— 光照要保持平滑，角色跑不起逐像素。
 */
export function finishArt(o) {
  const c = o.c || o;
  const g = o.g || c.getContext('2d');
  const w = c.width;
  const h = c.height;
  if (!w || !h) return o;
  const n = Math.max(1, Math.round(c.pix || 1));
  if (!quantLUT) quantLUT = buildQuantLUT();
  const lut = quantLUT;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const by = (((y / n) | 0) & 3) * 4;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      const a = d[i + 3];
      /* 全透明跳过；极淡的玻璃/辉光也跳过 —— 预乘存储在低 alpha 下
         往返取整的噪声会被量化放大成杂色。 */
      if (a < 24) continue;
      const bi = ((((x / n) | 0) & 3) + by) * 256;
      d[i] = lut[bi + d[i]];
      d[i + 1] = lut[bi + d[i + 1]];
      d[i + 2] = lut[bi + d[i + 2]];
    }
  }
  g.putImageData(img, 0, 0);
  return o;
}

/** 画一张 makeCanvas 出来的贴图：按它的**逻辑**尺寸画，不按真实像素 */
export function blit(g, c, x, y) {
  g.drawImage(c, x, y, c.lw || c.width, c.lh || c.height);
}

/* ------------------------------------------------------------------ *
 * 每帧现画的角色
 *
 * 道具那种一次生成、反复贴的精灵走 makeArtCanvas + finishArt。角色不一样：
 * 姿势、朝向、缩放每帧都变，逐像素后处理跑不起，就直接全分辨率画在
 * 目标上（跟 v1.5 的画法一致，零插值、设备像素级锐利）。
 * pixelSprite 保留的只有一件事：**整数锚点吸附** —— 落点取整到逻辑格上，
 * 人走路不会亚像素游移。纹素时代的暂存画布/最近邻回贴已移除，
 * 那一步的低分辨率抗锯齿正是"看起来糊"的元凶。
 * ------------------------------------------------------------------ */

/**
 * 在 g 的 (x, y)（取整到逻辑格）处画一个精灵。
 *
 * box = { w, h, ax, ay }：精灵的逻辑包围框与锚点位置，沿用旧签名 ——
 * 调用方（手、枪口这些附着点）都按"框内坐标 + dx/dy 平移"换算。
 * draw(g2, ax, ay) 里的写法跟直接画在目标上完全一样，只是原点换了。
 *
 * 返回 { value, dx, dy }：value 是 draw 的返回值，dx/dy 用来把框内
 * 算出来的坐标（比如手的位置）换算回目标空间。
 */
export function pixelSprite(g, x, y, box, draw) {
  const dx = Math.round(x) - box.ax;
  const dy = Math.round(y) - box.ay;
  g.save();
  g.translate(dx, dy);
  let value;
  try {
    value = draw(g, box.ax, box.ay);
  } finally {
    g.restore();
  }
  return { value, dx, dy };
}

/* ------------------------------------------------------------------ *
 * 像素绘制助手 —— 直升机段落验证过的那套语言，抽出来给全游戏共用：
 * 整数网格上的 fillRect、逐行/逐列扫描的轮廓、硬分带 + 棋盘抖动，
 * 不用 stroke 曲线 / 椭圆 / 渐变。
 * ------------------------------------------------------------------ */

/** 像素直线：逐格取整落点画 th×th 的方块，代替 stroke（硬边台阶，无抗锯齿） */
export function pxLine(g, x0, y0, x1, y1, c, th = 1) {
  const n = Math.max(Math.abs(Math.round(x1) - Math.round(x0)), Math.abs(Math.round(y1) - Math.round(y0)), 1);
  g.fillStyle = c;
  let lx = null;
  let ly = null;
  for (let i = 0; i <= n; i++) {
    const xx = Math.round(x0 + ((x1 - x0) * i) / n);
    const yy = Math.round(y0 + ((y1 - y0) * i) / n);
    if (xx === lx && yy === ly) continue;
    g.fillRect(xx, yy, th, th);
    lx = xx;
    ly = yy;
  }
}

/** 像素折线：一串点用 pxLine 连起来（线缆、裂纹、垂管都走这里） */
export function pxPolyline(g, pts, c, th = 1) {
  for (let i = 1; i < pts.length; i++) {
    pxLine(g, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], c, th);
  }
}

/** 棋盘抖动行：两个色带的交界处隔格点上一层，像素画的渐变过渡 */
export function pxDither(g, x0, x1, y, c) {
  g.fillStyle = c;
  const a = Math.round(x0);
  const b = Math.round(x1);
  const yy = Math.round(y);
  for (let x = a + ((a + yy) & 1); x < b; x += 2) g.fillRect(x, yy, 1, 1);
}

/** 沿任意直线的棋盘抖动：走 pxLine 的落点，但只点棋盘格奇偶的一半 */
export function pxDitherLine(g, x0, y0, x1, y1, c) {
  const n = Math.max(Math.abs(Math.round(x1) - Math.round(x0)), Math.abs(Math.round(y1) - Math.round(y0)), 1);
  g.fillStyle = c;
  for (let i = 0; i <= n; i++) {
    const xx = Math.round(x0 + ((x1 - x0) * i) / n);
    const yy = Math.round(y0 + ((y1 - y0) * i) / n);
    if ((xx + yy) & 1) g.fillRect(xx, yy, 1, 1);
  }
}

/** 棋盘抖动列（竖向的色带交界） */
export function pxDitherV(g, x, y0, y1, c) {
  g.fillStyle = c;
  const a = Math.round(y0);
  const b = Math.round(y1);
  const xx = Math.round(x);
  for (let y = a + ((a + xx) & 1); y < b; y += 2) g.fillRect(xx, y, 1, 1);
}

/** 沿多段线在 y 处取 x（pts = [[y, x], ...]，y 升序，越界取端点） */
export function edgeAt(pts, y) {
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (y <= pts[i][0]) {
      const [ya, xa] = pts[i - 1];
      const [yb, xb] = pts[i];
      return xa + ((xb - xa) * (y - ya)) / (yb - ya);
    }
  }
  return pts[pts.length - 1][1];
}

/** 逐行扫描两条边，取整成每行 [xl, xr] —— 像素轮廓的台阶就是这么来的 */
export function rowScan(L, R, y0, y1) {
  const rows = [];
  for (let y = y0; y <= y1; y++) rows.push([Math.round(edgeAt(L, y)), Math.round(edgeAt(R, y))]);
  return rows;
}

/**
 * 凸多边形的逐行扫描填充：每行取整成 [xl, xr] 一条 fillRect。
 * 代替 beginPath/fill —— 斜边变成硬边台阶而不是抗锯齿的糊线。
 */
export function pxPoly(g, pts, fill) {
  let ty = Infinity;
  let by = -Infinity;
  for (const p of pts) {
    if (p[1] < ty) ty = p[1];
    if (p[1] > by) by = p[1];
  }
  const y0 = Math.round(ty);
  const y1 = Math.round(by);
  g.fillStyle = fill;
  const n = pts.length;
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    let xl = Infinity;
    let xr = -Infinity;
    for (let i = 0; i < n; i++) {
      const ax = pts[i][0];
      const ay = pts[i][1];
      const bx = pts[(i + 1) % n][0];
      const by2 = pts[(i + 1) % n][1];
      if (ay <= yc === by2 <= yc) continue;
      const x = ax + ((bx - ax) * (yc - ay)) / (by2 - ay);
      if (x < xl) xl = x;
      if (x > xr) xr = x;
    }
    if (xr < xl) continue;
    const rl = Math.round(xl);
    g.fillRect(rl, y, Math.max(1, Math.round(xr) - rl), 1);
  }
}

/** 逐行扫描的实心像素椭圆 */
export function pxEllipse(g, cx, cy, rx, ry, c) {
  const X = Math.round(cx);
  const Y = Math.round(cy);
  const R = Math.max(1, Math.round(ry));
  g.fillStyle = c;
  for (let y = -R; y <= R; y++) {
    const k = 1 - (y / (ry || 1)) ** 2;
    if (k <= 0) continue;
    const w = Math.max(1, Math.round(rx * Math.sqrt(k)));
    g.fillRect(X - w, Y + y, w * 2, 1);
  }
}

/** 行扫 + 列扫的像素椭圆环（两遍才不会在圆顶/圆底漏格） */
export function pxEllipseRing(g, cx, cy, rx, ry, c, th = 1) {
  const X = Math.round(cx);
  const Y = Math.round(cy);
  g.fillStyle = c;
  const R2 = Math.max(1, Math.round(ry));
  for (let y = -R2; y <= R2; y++) {
    const k = Math.max(0, 1 - (y / (ry || 1)) ** 2);
    const w = Math.round(rx * Math.sqrt(k));
    g.fillRect(X - w, Y + y, th, 1);
    g.fillRect(X + w - th + 1, Y + y, th, 1);
  }
  const R1 = Math.max(1, Math.round(rx));
  for (let x = -R1; x <= R1; x++) {
    const k = Math.max(0, 1 - (x / (rx || 1)) ** 2);
    const h = Math.round(ry * Math.sqrt(k));
    g.fillRect(X + x, Y - h, 1, th);
    g.fillRect(X + x, Y + h - th + 1, 1, th);
  }
}

/** 脚下阴影：三档同心的像素椭圆平涂，代替径向渐变 */
export function pxShadow(g, cx, cy, rx, ry, a = 0.45) {
  for (const [f, al] of [
    [1, a * 0.3],
    [0.66, a * 0.32],
    [0.36, a * 0.34],
  ]) {
    pxEllipse(g, cx, cy, Math.max(1, rx * f), Math.max(1, ry * f), `rgba(0,0,0,${al.toFixed(3)})`);
  }
}

/** 洒在地上/墙上的一摊：逐行扫描 + 随机咬边，摊子不会是光滑椭圆 */
export function pxBlob(g, cx, cy, rx, ry, c, rand) {
  const X = Math.round(cx);
  const Y = Math.round(cy);
  const R = Math.max(1, Math.round(ry));
  g.fillStyle = c;
  for (let y = -R; y <= R; y++) {
    const k = 1 - (y / (ry || 1)) ** 2;
    if (k <= 0) continue;
    let w = Math.round(rx * Math.sqrt(k));
    if (rand) w -= (rand() * 2) | 0;
    if (w <= 0) continue;
    const off = rand ? ((rand() * 3) | 0) - 1 : 0;
    g.fillRect(X - w + off, Y + y, w * 2, 1);
  }
}

/** 三档同心方块的辉光（lighter 合成由调用方开）。跟直升机航行灯同一读法 */
export function pxGlow(g, x, y, r, rgb, k) {
  if (k <= 0.01) return;
  for (const [f, a] of [
    [1, 0.09],
    [0.5, 0.2],
    [0.18, 0.8],
  ]) {
    const q = Math.max(1, Math.round(r * f));
    g.fillStyle = `rgba(${rgb},${(k * a).toFixed(3)})`;
    g.fillRect(Math.round(x) - q, Math.round(y) - q, q * 2, q * 2);
  }
}

/* 3×5 像素字模：烘焙层里的小字（门牌、楼层号、警示喷涂）全用它拼，
   canvas 的 fillText 在这个字号下只是一团糊。 */
const FONT3 = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
  M: '101111101101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
  Q: '010101101010001', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101',
  Y: '101101010010010', Z: '111001010100111',
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001010010',
  8: '111101111101111', 9: '111101111001111',
  '-': '000000111000000', '=': '000111000111000', '/': '001001010100100', '.': '000000000000010',
  ':': '000010000010000', ' ': '000000000000000',
};

/** 手拼像素字。x,y 是左上角，s 是整数放大倍数，字距 1 格 */
export function pxText(g, x, y, str, c, s = 1) {
  g.fillStyle = c;
  let cx = Math.round(x);
  const cy = Math.round(y);
  const up = String(str).toUpperCase();
  for (const ch of up) {
    const m = FONT3[ch];
    if (m) {
      for (let i = 0; i < 15; i++) {
        if (m[i] === '1') g.fillRect(cx + (i % 3) * s, cy + ((i / 3) | 0) * s, s, s);
      }
    }
    cx += 4 * s;
  }
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
