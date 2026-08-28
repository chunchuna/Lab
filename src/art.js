import { HW, HH, TILE_W, TILE_Z } from './config.js';
import {
  makeCanvas, makeArtCanvas, finishArt, mulberry32, shade, baseT, localT, blit,
  pxLine, pxPolyline, pxDither, pxDitherV, pxDitherLine, pxPoly, pxEllipse, pxEllipseRing,
  pxShadow, pxBlob, pxGlow, pxText, edgeAt, rowScan,
} from './util.js';

// 像素 helper 从这里再导出一份：zombies/menu/main 习惯从 art 拿绘制工具
export { pxLine, pxPolyline, pxDither, pxDitherV, pxDitherLine, pxPoly, pxEllipse, pxEllipseRing, pxShadow, pxBlob, pxGlow, pxText };

export const PAL = {
  floor: '#343b40',
  floorAlt: '#2d3439',
  floorLite: '#3e474d',
  grout: '#1b2024',
  wall: '#39413f',
  wallDark: '#262d2d',
  wallLite: '#4b5553',
  metal: '#4d5459',
  metalDark: '#2c3236',
  metalLite: '#737e84',
  metalHi: '#98a3a8',
  rust: '#6d4a30',
  rust2: '#8f6038',
  dirt: '#2a2620',
  cyan: '#79d2cc',
  green: '#79c07d',
  amber: '#e0a552',
  red: '#c94a3a',
  glass: '#1d2a2c',
  coat: '#cdd6d9',
  coatShade: '#98a4a9',
  coatDark: '#6f7a80',
  pants: '#3f474e',
  pantsD: '#2b3238',
  shoe: '#20262b',
  skin: '#c79a76',
  skinD: '#9c7355',
  hair: '#4a3728',
  blood: '#4a1a16',
};

/* ------------------------------------------------------------------ *
 * 服装与外貌（第一章起玩家可自定义）
 *
 * outfit 描述"穿什么"：上衣三档 + 内衬 + 裤 + 鞋，drawCharacter /
 * drawPortrait 都吃同一份。look 描述"长什么样"：肤色 + 发型 + 发色。
 * 序章的白大褂就是 OUTFITS.lab，不传 outfit 时行为与旧版完全一致。
 * ------------------------------------------------------------------ */

export const OUTFITS = {
  // 研究员白大褂（序章默认）
  lab: {
    coat: '#cdd6d9', shade: '#98a4a9', dark: '#6f7a80', lining: '#4d565c',
    pants: '#3f474e', pantsD: '#2b3238', shoe: '#20262b',
  },
  // 营地统一配发的工装：土黄帆布夹克
  camp: {
    coat: '#93835f', shade: '#6f6248', dark: '#4e4534', lining: '#3b382c',
    pants: '#4a4a3e', pantsD: '#34342c', shoe: '#2a2620',
  },
  // 士兵作战服（配头盔 + 防弹背心）
  soldier: {
    coat: '#4f5742', shade: '#3b4232', dark: '#262b1d', lining: '#414936',
    pants: '#3b4232', pantsD: '#2d3327', shoe: '#1d211a', vest: true, helmet: true,
  },
  // 登记官：更深一号的军装，不穿背心
  officer: {
    coat: '#44503f', shade: '#333d30', dark: '#232b21', lining: '#2c3527',
    pants: '#333a2e', pantsD: '#252a21', shoe: '#1d211a',
  },
};

/** 难民的旧衣服：一组低饱和的杂色，按索引循环分配 */
export const REFUGEE_OUTFITS = [
  { coat: '#6e5f4c', shade: '#544936', dark: '#3a3226', lining: '#332d22', pants: '#41403a', pantsD: '#2d2c28', shoe: '#26221d' },
  { coat: '#5c6068', shade: '#45484f', dark: '#303237', lining: '#2a2c30', pants: '#3d3a34', pantsD: '#2b2925', shoe: '#22201c' },
  { coat: '#725548', shade: '#574036', dark: '#3c2c25', lining: '#332620', pants: '#3a3e38', pantsD: '#292c27', shoe: '#211f1a' },
  { coat: '#57634f', shade: '#424c3c', dark: '#2d3429', lining: '#272d24', pants: '#44403c', pantsD: '#302d2a', shoe: '#26221e' },
  { coat: '#7a705d', shade: '#5d5546', dark: '#413b30', lining: '#38332a', pants: '#3c4245', pantsD: '#2a2f31', shoe: '#22262a' },
];

export const HAIR_STYLES = ['messy', 'short', 'buzz', 'long', 'bald'];
export const HAIR_NAMES = { messy: '乱发', short: '短发', buzz: '寸头', long: '长发', bald: '光头' };
export const HAIR_COLORS = ['#4a3728', '#23201c', '#6e4a2a', '#93836c', '#5c2e22'];
export const SKIN_TONES = ['#c79a76', '#d9b08e', '#b08662', '#8f6a4e'];

export const DEFAULT_LOOK = { skin: SKIN_TONES[0], hair: 'messy', hairCol: HAIR_COLORS[0] };

/* ------------------------------------------------------------------ *
 * 基础绘制助手
 * ------------------------------------------------------------------ */

/**
 * 多边形：逐行扫描填充 + 像素直线描边。
 * 所有等距盒子（isoBox）的面都从这里过 —— 斜边全部变成硬边台阶。
 */
export function poly(g, pts, fill, stroke, lw = 1) {
  if (fill) pxPoly(g, pts, fill);
  if (stroke) {
    const th = Math.max(1, Math.round(lw));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      pxLine(g, a[0], a[1], b[0], b[1], stroke, th);
    }
  }
}

const P = (ox, oy, x, y, z) => [ox + (x - y) * HW, oy + (x + y) * HH - z * TILE_Z];

/** 等距长方体：x0,y0 为最小角（相对足迹中心），z0 底面高度 */
export function isoBox(g, ox, oy, x0, y0, z0, w, d, h, cTop, cR, cL, outline) {
  const x1 = x0 + w,
    y1 = y0 + d,
    z1 = z0 + h;
  if (cTop) poly(g, [P(ox, oy, x0, y0, z1), P(ox, oy, x1, y0, z1), P(ox, oy, x1, y1, z1), P(ox, oy, x0, y1, z1)], cTop, outline);
  if (cR) poly(g, [P(ox, oy, x1, y0, z1), P(ox, oy, x1, y1, z1), P(ox, oy, x1, y1, z0), P(ox, oy, x1, y0, z0)], cR, outline);
  if (cL) poly(g, [P(ox, oy, x1, y1, z1), P(ox, oy, x0, y1, z1), P(ox, oy, x0, y1, z0), P(ox, oy, x1, y1, z0)], cL, outline);
}

/** 顶面绘制空间（1 瓦片 = TILE_W 像素） */
export function faceTop(g, ox, oy, z) {
  localT(g, HW / TILE_W, HH / TILE_W, -HW / TILE_W, HH / TILE_W, ox, oy - z * TILE_Z);
}
/** +x 面（朝右下），u=y*TILE_W，v 向下为负 z */
export function faceRight(g, ox, oy, xr) {
  localT(g, -HW / TILE_W, HH / TILE_W, 0, 1, ox + xr * HW, oy + xr * HH);
}
/** +y 面（朝左下），u=x*TILE_W，v 向下为负 z */
export function faceLeft(g, ox, oy, yl) {
  localT(g, HW / TILE_W, HH / TILE_W, 0, 1, ox - yl * HW, oy + yl * HH);
}
export const resetT = baseT;

/** 足迹阴影：三档同心的像素椭圆平涂 + 外圈棋盘抖动，代替径向渐变 */
export function aoShadow(g, ox, oy, w, d, a = 0.45) {
  const r = ((w + d) / 2) * HW * 0.78;
  const ry = r * (HH / HW);
  pxShadow(g, ox, oy, r, ry, a);
  // 最外一圈的抖动边：椭圆行扫，隔格点一层，影子的边不再是光滑圆弧
  g.fillStyle = `rgba(0,0,0,${(a * 0.22).toFixed(3)})`;
  const R = Math.max(1, Math.round(ry));
  const X = Math.round(ox);
  const Y = Math.round(oy);
  for (let y = -R; y <= R; y++) {
    const k = 1 - (y / (ry || 1)) ** 2;
    if (k <= 0) continue;
    const xw = Math.round(r * Math.sqrt(k) * 1.16);
    const xi = Math.round(r * Math.sqrt(k));
    for (let x = -xw + ((X + Y + y + xw) & 1); x <= xw; x += 2) {
      if (x > -xi && x < xi) continue;
      g.fillRect(X + x, Y + y, 1, 1);
    }
  }
}

/** 在当前变换空间内撒噪点 */
export function speckle(g, x, y, w, h, rand, n, colors, sw = 1, sh = 1) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rand() * colors.length) | 0];
    g.fillRect(x + rand() * w, y + rand() * h, sw * (0.5 + rand()), sh * (0.5 + rand()));
  }
}

/**
 * 生成精灵的描边环（只有轮廓，中间是空的）。
 * 做法：把剪影按 8 个方向偏移叠画，再用 destination-out 挖掉原剪影。
 * 结果缓存下来，每帧只需一次 drawImage —— 描边画在光照之后，
 * 所以夜里也能看清。
 */
const ringCache = new Map();
export function clearRingCache() {
  ringCache.clear();
}
export function outlineRing(img, color = '#ded8c8', r = 1) {
  const key = img;
  let cached = ringCache.get(key);
  if (cached) return cached;

  const lw = img.lw || img.width;
  const lh = img.lh || img.height;
  // 描边跟着源精灵的网格走：粗细不一致的话，轮廓会比本体细一圈
  const n = img.pix;
  const sil = makeCanvas(lw, lh, n);
  blit(sil.g, img, 0, 0);
  sil.g.globalCompositeOperation = 'source-in';
  sil.g.fillStyle = color;
  sil.g.fillRect(0, 0, lw, lh);

  const pad = r + 1;
  const { c, g } = makeCanvas(lw + pad * 2, lh + pad * 2, n);
  for (const [dx, dy] of [
    [-r, 0], [r, 0], [0, -r], [0, r],
    [-r, -r], [r, -r], [-r, r], [r, r],
  ]) {
    blit(g, sil.c, pad + dx, pad + dy);
  }
  g.globalCompositeOperation = 'destination-out';
  blit(g, sil.c, pad, pad);
  g.globalCompositeOperation = 'source-over';

  cached = { img: c, pad };
  ringCache.set(key, cached);
  return cached;
}

/** 生成一个精灵：w,d 为足迹（瓦片），h 为高度（高度单位） */
export function makeProp(w, d, h, draw, pad = 6) {
  const s = (w + d) / 2;
  const cw = Math.ceil(2 * s * HW) + pad * 2;
  const ch = Math.ceil(2 * s * HH + h * TILE_Z) + pad * 2;
  const ox = pad + s * HW;
  const oy = pad + s * HH + h * TILE_Z;
  const { c, g } = makeArtCanvas(cw, ch);
  draw(g, ox, oy);
  resetT(g);
  finishArt({ c, g });
  return { img: c, ox, oy, w, d, h };
}

/* ------------------------------------------------------------------ *
 * 道具
 * ------------------------------------------------------------------ */

export function makeBed(seed = 7) {
  const rand = mulberry32(seed);
  const W = 3.0,
    D = 1.5;
  return makeProp(W + 0.4, D + 0.4, 1.15, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.5);
    const legs = [
      [-1.35, -0.62],
      [1.2, -0.62],
      [-1.35, 0.5],
      [1.2, 0.5],
    ];
    for (const [lx, ly] of legs) isoBox(g, ox, oy, lx, ly, 0, 0.14, 0.13, 0.44, PAL.metalDark, '#232a2e', '#1b2124');
    // 轮子
    for (const [lx, ly] of legs) {
      const p = P(ox, oy, lx + 0.07, ly + 0.07, 0);
      pxEllipse(g, p[0], p[1] + 1, 2.4, 1.4, '#15191c');
    }
    // 床架
    isoBox(g, ox, oy, -1.45, -0.72, 0.42, 2.9, 1.42, 0.1, PAL.metal, PAL.metalDark, '#242a2e');
    // 床垫
    isoBox(g, ox, oy, -1.38, -0.66, 0.52, 2.76, 1.3, 0.22, '#7d857f', '#5b625c', '#4a504b');
    // 床垫顶面污渍 / 皱褶
    faceTop(g, ox, oy, 0.74);
    g.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      g.fillStyle = ['#6d746e', '#616862', '#767d77', '#575d58'][(rand() * 4) | 0];
      g.fillRect((-1.3 + rand() * 2.6) * TILE_W, (-0.6 + rand() * 1.18) * TILE_W, (0.1 + rand() * 0.5) * TILE_W, (0.06 + rand() * 0.18) * TILE_W);
    }
    g.globalAlpha = 0.42;
    for (let i = 0; i < 7; i++) {
      const bx = 0.15 + rand() * 0.7,
        by = -0.35 + rand() * 0.7;
      pxBlob(g, bx * TILE_W, by * TILE_W, (0.06 + rand() * 0.16) * TILE_W, (0.05 + rand() * 0.13) * TILE_W, PAL.blood, rand);
    }
    g.globalAlpha = 0.28;
    g.fillStyle = '#5b5348';
    g.fillRect(-1.3 * TILE_W, 0.1 * TILE_W, 2.5 * TILE_W, 0.45 * TILE_W);
    g.globalAlpha = 1;
    resetT(g);
    // 枕头
    isoBox(g, ox, oy, -1.3, -0.5, 0.74, 0.62, 0.98, 0.14, '#98a09a', '#767d77', '#666c67');
    // 束缚带
    faceTop(g, ox, oy, 0.75);
    g.fillStyle = 'rgba(38,34,30,0.85)';
    g.fillRect(-0.35 * TILE_W, -0.66 * TILE_W, 0.11 * TILE_W, 1.3 * TILE_W);
    g.fillRect(0.75 * TILE_W, -0.66 * TILE_W, 0.11 * TILE_W, 1.3 * TILE_W);
    resetT(g);
    // 床头/床尾护栏
    for (const [rx, hgt] of [
      [-1.5, 0.62],
      [1.4, 0.44],
    ]) {
      isoBox(g, ox, oy, rx, -0.7, 0.52, 0.08, 0.07, hgt, PAL.metalLite, PAL.metal, PAL.metalDark);
      isoBox(g, ox, oy, rx, 0.62, 0.52, 0.08, 0.07, hgt, PAL.metalLite, PAL.metal, PAL.metalDark);
      isoBox(g, ox, oy, rx, -0.7, 0.52 + hgt - 0.07, 0.08, 1.39, 0.07, PAL.metalLite, PAL.metal, PAL.metalDark);
      isoBox(g, ox, oy, rx + 0.01, -0.7, 0.52 + hgt * 0.55, 0.05, 1.39, 0.05, PAL.metal, PAL.metalDark, PAL.metalDark);
    }
    // 侧栏（放下的一侧）
    isoBox(g, ox, oy, -1.0, 0.66, 0.2, 1.8, 0.06, 0.32, PAL.metal, PAL.metalDark, '#20262a');
  });
}

export function makeLocker(open, seed = 3, empty = false) {
  const rand = mulberry32(seed);
  const W = 1.1,
    D = 1.55,
    H = 2.3;
  return makeProp(W + (open ? 1.5 : 0.2), D + 0.2, H + 0.1, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.55);
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, '#5c6560', '#3d4643', '#2e3633');
    // 右面（正面）柜门
    faceRight(g, ox, oy, W / 2);
    const h = H * TILE_Z;
    g.fillStyle = '#414a47';
    g.fillRect(-(D / 2) * TILE_W, -h, D * TILE_W, h);
    // 门缝 + 面板（1px 描边用四条 fillRect 拼，strokeRect 的半像素线会糊）
    g.fillStyle = '#2a312f';
    g.fillRect(-0.02 * TILE_W, -h + 2, 0.04 * TILE_W, h - 4);
    {
      const px0 = Math.round(-(D / 2 - 0.06) * TILE_W);
      const pw = Math.round((D - 0.12) * TILE_W);
      const py0 = Math.round(-h + 4);
      const ph = Math.round(h - 8);
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(px0, py0, pw, 1);
      g.fillRect(px0, py0 + ph - 1, pw, 1);
      g.fillRect(px0, py0, 1, ph);
      g.fillRect(px0 + pw - 1, py0, 1, ph);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(px0, py0, pw, 2);
    }
    // 通风百叶
    g.fillStyle = '#242a28';
    for (let i = 0; i < 5; i++) {
      g.fillRect(-(D / 2 - 0.2) * TILE_W, -h + 8 + i * 4, (D / 2 - 0.28) * TILE_W, 2);
      g.fillRect(0.14 * TILE_W, -h + 8 + i * 4, (D / 2 - 0.28) * TILE_W, 2);
    }
    // 把手
    g.fillStyle = PAL.metalHi;
    g.fillRect(-0.16 * TILE_W, -h * 0.52, 0.1 * TILE_W, 5);
    g.fillRect(0.07 * TILE_W, -h * 0.52, 0.1 * TILE_W, 5);
    // 标签：像素字，fillText 在这个字号下是一团糊
    g.fillStyle = 'rgba(224,165,82,0.75)';
    g.fillRect(-(D / 2 - 0.16) * TILE_W, -h + 6, 0.5 * TILE_W, 7);
    pxText(g, -(D / 2 - 0.14) * TILE_W, -h + 7, 'EMG-04', '#1a1c18', 1);
    // 锈迹
    g.globalAlpha = 0.35;
    speckle(g, -(D / 2) * TILE_W, -h, D * TILE_W, h, rand, 60, [PAL.rust, PAL.rust2, '#2a2320'], 1.6, 1.2);
    g.globalAlpha = 1;

    if (open) {
      // 门内：昏暗内腔 + 隔板 + 物品
      g.fillStyle = '#0d1110';
      g.fillRect(-(D / 2 - 0.05) * TILE_W, -h + 4, (D - 0.1) * TILE_W, h - 8);
      g.fillStyle = '#1b201f';
      g.fillRect(-(D / 2 - 0.05) * TILE_W, -h * 0.58, (D - 0.1) * TILE_W, 2);
      g.fillRect(-(D / 2 - 0.05) * TILE_W, -h * 0.3, (D - 0.1) * TILE_W, 2);
      if (empty) {
        resetT(g);
        isoBox(g, ox, oy, W / 2 + 0.02, -D / 2 - 0.02, 0.05, 0.72, 0.1, H - 0.12, '#4d5653', '#39413e', '#2b3230');
        isoBox(g, ox, oy, W / 2 + 0.02, D / 2 - 0.08, 0.05, 0.72, 0.1, H - 0.12, '#4d5653', '#3f4744', '#303735');
        isoBox(g, ox, oy, -0.3, -0.45, H, 0.5, 0.42, 0.28, '#5b5346', '#443e35', '#37322b');
        return;
      }
      // 手枪
      g.fillStyle = '#2b3034';
      g.fillRect(-0.35 * TILE_W, -h * 0.62, 11, 3);
      g.fillRect(-0.24 * TILE_W, -h * 0.62 + 3, 3, 4);
      g.fillStyle = '#42484d';
      g.fillRect(-0.35 * TILE_W, -h * 0.62, 11, 1);
      // 手电筒
      g.fillStyle = '#3a4147';
      g.fillRect(0.05 * TILE_W, -h * 0.34, 10, 3);
      g.fillStyle = '#d9e6c8';
      g.fillRect(0.05 * TILE_W + 10, -h * 0.34, 2, 3);
      // 急救箱
      g.fillStyle = '#8d3a34';
      g.fillRect(-0.3 * TILE_W, -h * 0.26, 8, 6);
      g.fillStyle = '#dfe7e4';
      g.fillRect(-0.3 * TILE_W + 3, -h * 0.26 + 1, 2, 4);
      g.fillRect(-0.3 * TILE_W + 1, -h * 0.26 + 2.2, 6, 1.6);
      resetT(g);
      // 敞开的门板（向外摆）
      isoBox(g, ox, oy, W / 2 + 0.02, -D / 2 - 0.02, 0.05, 0.72, 0.1, H - 0.12, '#4d5653', '#39413e', '#2b3230');
      isoBox(g, ox, oy, W / 2 + 0.02, D / 2 - 0.08, 0.05, 0.72, 0.1, H - 0.12, '#4d5653', '#3f4744', '#303735');
    }
    resetT(g);
    // 顶部杂物
    isoBox(g, ox, oy, -0.3, -0.45, H, 0.5, 0.42, 0.28, '#5b5346', '#443e35', '#37322b');
  });
}

export function makeConsole(w, d, h, seed, opts = {}) {
  const rand = mulberry32(seed);
  return makeProp(w + 0.2, d + 0.2, h + 0.45, (g, ox, oy) => {
    aoShadow(g, ox, oy, w, d, 0.5);
    isoBox(g, ox, oy, -w / 2, -d / 2, 0, w, d, h * 0.55, '#4a524f', '#333b39', '#262d2b');
    isoBox(g, ox, oy, -w / 2 + 0.06, -d / 2 + 0.06, h * 0.55, w - 0.12, d - 0.12, h * 0.45, '#525b58', '#3a4340', '#2c3432');
    // 正面（+x）细节
    faceRight(g, ox, oy, w / 2);
    const hh = h * 0.55 * TILE_Z;
    g.fillStyle = '#333b39';
    g.fillRect(-(d / 2) * TILE_W, -hh, d * TILE_W, hh);
    g.fillStyle = '#252b29';
    g.fillRect(-(d / 2 - 0.1) * TILE_W, -hh + 3, (d - 0.2) * TILE_W, hh - 8);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = ['#c94a3a', '#e0a552', '#79c07d'][i];
      g.globalAlpha = 0.85;
      g.fillRect(-(d / 2 - 0.16) * TILE_W + i * 4, -hh + 6, 2, 2);
    }
    g.globalAlpha = 1;
    resetT(g);
    // 上部：斜置控制台 + 屏幕
    const zTop = h;
    isoBox(g, ox, oy, -w / 2 + 0.08, -d / 2 + 0.08, h * 0.98, w - 0.16, d - 0.16, 0.06, '#5d6764', '#414947', '#333b39');
    faceTop(g, ox, oy, zTop + 0.04);
    g.fillStyle = '#2b3230';
    g.fillRect((-w / 2 + 0.14) * TILE_W, (-d / 2 + 0.14) * TILE_W, (w - 0.28) * TILE_W, (d - 0.28) * TILE_W);
    // 按键阵列
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 7; c++) {
        g.fillStyle = rand() > 0.85 ? '#6a7472' : '#464e4c';
        g.fillRect((-w / 2 + 0.2) * TILE_W + c * 3.1, (-d / 2 + 0.2) * TILE_W + r * 3.1, 2.2, 2.2);
      }
    }
    resetT(g);
    // 屏幕（背板）
    if (opts.screen !== false) {
      const sw = Math.min(w * 0.72, 1.1);
      isoBox(g, ox, oy, -sw / 2, -d / 2 + 0.14, h, sw, 0.1, 0.72, '#39413f', '#2a312f', '#222826');
      // 屏幕面（朝左下）
      faceLeft(g, ox, oy, -d / 2 + 0.24);
      const zb = -h * TILE_Z;
      g.fillStyle = opts.dead ? '#161c1e' : '#0b1a1c';
      g.fillRect((-sw / 2) * TILE_W, zb - 0.66 * TILE_Z, sw * TILE_W, 0.6 * TILE_Z);
      if (!opts.dead) {
        g.fillStyle = opts.color || 'rgba(121,210,204,0.5)';
        for (let i = 0; i < 7; i++) {
          g.fillRect((-sw / 2 + 0.08) * TILE_W, zb - 0.6 * TILE_Z + i * 1.3, (0.2 + rand() * (sw - 0.3)) * TILE_W, 0.8);
        }
      } else {
        // 裂纹：像素放射线
        const cx = 0,
          cy = zb - 0.36 * TILE_Z;
        for (let i = 0; i < 7; i++) {
          pxLine(g, cx, cy, cx + Math.cos((i / 7) * 6.28) * (4 + rand() * 8), cy + Math.sin((i / 7) * 6.28) * (3 + rand() * 5), 'rgba(190,205,205,0.4)', 1);
        }
      }
      {
        const bx0 = Math.round((-sw / 2) * TILE_W);
        const bw = Math.round(sw * TILE_W);
        const by0 = Math.round(zb - 0.66 * TILE_Z);
        const bh = Math.round(0.6 * TILE_Z);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(bx0, by0, bw, 1);
        g.fillRect(bx0, by0 + bh - 1, bw, 1);
        g.fillRect(bx0, by0, 1, bh);
        g.fillRect(bx0 + bw - 1, by0, 1, bh);
      }
      resetT(g);
    }
    // 线缆：两段像素折线拼出下垂
    for (let i = 0; i < 3; i++) {
      const a = P(ox, oy, w / 2 - 0.1, -d / 2 + 0.2 + i * 0.2, h * 0.2);
      const b = P(ox, oy, w / 2 + 0.5 + rand() * 0.5, d / 2 + rand() * 0.4, 0);
      pxPolyline(g, [[a[0], a[1]], [a[0] + 4, a[1] + 9], [(a[0] + b[0]) / 2 + 3, (a[1] + b[1]) / 2 + 5], [b[0], b[1]]], '#191d1f', 1);
    }
  });
}

export function makeTable(seed = 11) {
  const rand = mulberry32(seed);
  const W = 2.3,
    D = 1.05,
    H = 0.86;
  return makeProp(W + 0.3, D + 0.3, H + 0.7, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.45);
    for (const [lx, ly] of [
      [-W / 2 + 0.08, -D / 2 + 0.08],
      [W / 2 - 0.2, -D / 2 + 0.08],
      [-W / 2 + 0.08, D / 2 - 0.2],
      [W / 2 - 0.2, D / 2 - 0.2],
    ])
      isoBox(g, ox, oy, lx, ly, 0, 0.12, 0.12, H - 0.08, '#3d4547', '#2a3133', '#222829');
    isoBox(g, ox, oy, -W / 2, -D / 2, H - 0.08, W, D, 0.08, '#6b7370', '#4a5250', '#3b4341');
    // 台面污渍与器材
    faceTop(g, ox, oy, H);
    g.globalAlpha = 0.35;
    for (let i = 0; i < 14; i++) {
      pxBlob(g, (-W / 2 + rand() * W) * TILE_W, (-D / 2 + rand() * D) * TILE_W, 2 + rand() * 5, 1.5 + rand() * 3, ['#4b5b4a', '#5c5340', '#3f4a4c'][(rand() * 3) | 0], rand);
    }
    g.globalAlpha = 1;
    resetT(g);
    // 玻璃器皿
    const glassware = [
      [-0.75, -0.2, 5, 8],
      [-0.45, 0.15, 4, 6],
      [0.2, -0.1, 6, 9],
      [0.62, 0.2, 3, 5],
    ];
    for (const [gx, gy, gw, gh] of glassware) {
      const p = P(ox, oy, gx, gy, H);
      pxPoly(g, [
        [p[0] - gw / 2, p[1]],
        [p[0] - gw / 4, p[1] - gh],
        [p[0] + gw / 4, p[1] - gh],
        [p[0] + gw / 2, p[1]],
      ], 'rgba(150,190,185,0.28)');
      g.fillStyle = 'rgba(120,190,140,0.5)';
      g.fillRect(p[0] - gw / 2 + 1, p[1] - gh * 0.35, gw - 2, gh * 0.35);
      g.fillStyle = 'rgba(230,245,245,0.35)';
      g.fillRect(p[0] - gw / 4, p[1] - gh + 1, 1, gh - 2);
    }
    // 碎玻璃
    const pb = P(ox, oy, 0.9, 0.35, H);
    g.fillStyle = 'rgba(180,215,210,0.4)';
    for (let i = 0; i < 9; i++) g.fillRect(pb[0] - 6 + rand() * 12, pb[1] - 3 + rand() * 5, 1.4, 1.2);
    // 微型离心机
    isoBox(g, ox, oy, 0.75, -0.32, H, 0.42, 0.36, 0.3, '#adb6b3', '#7d8683', '#69726f');
  });
}

export function makeCrate(size, seed) {
  const rand = mulberry32(seed);
  return makeProp(size + 0.1, size + 0.1, size * 0.95, (g, ox, oy) => {
    aoShadow(g, ox, oy, size, size, 0.5);
    const h = size * 0.95;
    isoBox(g, ox, oy, -size / 2, -size / 2, 0, size, size, h, '#5a5344', '#413c31', '#332f26');
    faceRight(g, ox, oy, size / 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect((-size / 2 + 0.08) * TILE_W, -h * TILE_Z + 3, (size - 0.16) * TILE_W, h * TILE_Z - 6);
    g.fillStyle = 'rgba(224,165,82,0.55)';
    g.fillRect((-size / 2 + 0.12) * TILE_W, -h * TILE_Z * 0.6, (size - 0.24) * TILE_W, 2);
    g.globalAlpha = 0.3;
    speckle(g, (-size / 2) * TILE_W, -h * TILE_Z, size * TILE_W, h * TILE_Z, rand, 24, [PAL.rust, '#2a241c'], 1.4, 1.2);
    g.globalAlpha = 1;
    resetT(g);
  });
}

export function makeBarrel(seed = 5) {
  const rand = mulberry32(seed);
  const R = 0.44,
    H = 1.12;
  return makeProp(R * 2 + 0.2, R * 2 + 0.2, H + 0.1, (g, ox, oy) => {
    aoShadow(g, ox, oy, R * 2, R * 2, 0.5);
    const rx = Math.round(R * HW * 2 * 0.72),
      ry = Math.round(R * HH * 2 * 0.72);
    const top = Math.round(oy - H * TILE_Z);
    const X = Math.round(ox);
    const Y = Math.round(oy);
    /* 桶身：逐列扫描。明暗按 x 分四档硬带，带交界处逐列棋盘抖动；
       下缘沿椭圆弧收，台阶轮廓由取整给出。 */
    const cols = ['#2f3a33', '#4e5c4f', '#3c473e', '#232b26'];
    const bandAt = (u) => (u < -0.55 ? 0 : u < 0.1 ? 1 : u < 0.62 ? 2 : 3);
    for (let x = -rx; x <= rx; x++) {
      const u = x / rx;
      const yBot = Y + Math.round(ry * Math.sqrt(Math.max(0, 1 - u * u)));
      const b = bandAt(u);
      g.fillStyle = cols[b];
      g.fillRect(X + x, top, 1, yBot - top);
      // 相邻带的交界列：棋盘抖动咬合
      if (b < 3 && bandAt((x + 2) / rx) > b) {
        g.fillStyle = cols[b + 1];
        for (let y = top + ((top + x) & 1); y < yBot; y += 2) g.fillRect(X + x, y, 1, 1);
      }
    }
    // 桶身两侧 1px 描边
    g.fillStyle = '#181e1a';
    g.fillRect(X - rx, top, 1, Y - top);
    g.fillRect(X + rx, top, 1, Y - top);
    // 箍：像素椭圆环 + 一条横向压暗
    for (const t of [0.22, 0.5, 0.78]) {
      const hy = top + H * TILE_Z * t;
      pxEllipseRing(g, X, hy, rx, ry, 'rgba(0,0,0,0.32)', 1);
      g.fillStyle = 'rgba(0,0,0,0.32)';
      g.fillRect(X - rx, Math.round(hy) - 1, rx * 2, 3);
    }
    // 顶盖：像素椭圆两档 + 1px 环
    pxEllipse(g, X, top, rx, ry, '#5b6a5c');
    pxEllipseRing(g, X, top, rx, ry, '#39443b', 1);
    pxEllipse(g, X, top, rx * 0.6, ry * 0.6, '#48544a');
    /* 生化标：像素圆盘 + 三个方块斑，读得出"有个警示圆标"即可 */
    const mx = X - 2;
    const my = Math.round(top + H * TILE_Z * 0.42);
    pxEllipse(g, mx, my, 4, 4, 'rgba(224,165,82,0.7)');
    g.fillStyle = '#1d211d';
    g.fillRect(mx - 1, my - 1, 2, 2);
    g.fillRect(mx - 3, my - 3, 2, 2);
    g.fillRect(mx + 1, my - 3, 2, 2);
    g.fillRect(mx - 1, my + 2, 2, 2);
    g.globalAlpha = 0.3;
    speckle(g, X - rx, top, rx * 2, H * TILE_Z, rand, 40, [PAL.rust, '#20261f'], 1.5, 1.2);
    g.globalAlpha = 1;
  });
}

export function makeMonitorCart(seed = 21) {
  const rand = mulberry32(seed);
  const W = 0.85,
    D = 0.75,
    H = 1.5;
  return makeProp(W + 0.2, D + 0.2, H + 0.1, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.45);
    for (const [lx, ly] of [
      [-0.3, -0.28],
      [0.22, -0.28],
      [-0.3, 0.2],
      [0.22, 0.2],
    ])
      isoBox(g, ox, oy, lx, ly, 0, 0.08, 0.08, 0.62, '#333a3c', '#242a2c', '#1d2224');
    isoBox(g, ox, oy, -W / 2, -D / 2, 0.62, W, D, 0.07, '#5a6260', '#3f4745', '#333937');
    // 主机
    isoBox(g, ox, oy, -0.34, -0.3, 0.69, 0.68, 0.6, 0.3, '#565f5c', '#3c4442', '#2f3634');
    // 显示器
    isoBox(g, ox, oy, -0.32, -0.26, 0.99, 0.64, 0.52, 0.48, '#4f5754', '#39403e', '#2b3230');
    faceLeft(g, ox, oy, -0.26);
    g.fillStyle = '#10181a';
    g.fillRect(-0.26 * TILE_W, -1.44 * TILE_Z, 0.52 * TILE_W, 0.38 * TILE_Z);
    // 破裂屏：像素放射裂纹 + 像素圆黑斑
    const cx = 1,
      cy = -1.25 * TILE_Z;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.28 + rand();
      pxLine(g, cx, cy, cx + Math.cos(a) * (4 + rand() * 7), cy + Math.sin(a) * (2 + rand() * 4), 'rgba(190,210,210,0.45)', 1);
    }
    pxEllipse(g, cx, cy, 3.2, 3.2, 'rgba(0,0,0,0.55)');
    resetT(g);
    // 线缆垂落：像素折线
    const a0 = P(ox, oy, 0.3, 0.1, 0.72);
    pxPolyline(g, [[a0[0], a0[1]], [a0[0] + 6, a0[1] + 8], [a0[0] + 5, a0[1] + 14], [a0[0] + 2, oy + 4]], '#171b1d', 1);
  });
}

export function makeShelf(seed = 31) {
  const rand = mulberry32(seed);
  const W = 0.8,
    D = 1.7,
    H = 2.05;
  return makeProp(W + 0.2, D + 0.2, H + 0.1, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.5);
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, '#4a4034', '#332c24', '#28221c');
    faceRight(g, ox, oy, W / 2);
    const h = H * TILE_Z;
    g.fillStyle = '#151512';
    g.fillRect(-(D / 2 - 0.05) * TILE_W, -h + 3, (D - 0.1) * TILE_W, h - 6);
    for (let s = 0; s < 4; s++) {
      const yy = -h + 8 + s * ((h - 12) / 4);
      g.fillStyle = '#3d352b';
      g.fillRect(-(D / 2 - 0.05) * TILE_W, yy, (D - 0.1) * TILE_W, 2);
      const n = 2 + ((rand() * 4) | 0);
      for (let i = 0; i < n; i++) {
        const bw = 2 + rand() * 3,
          bh = 3 + rand() * 5;
        g.fillStyle = ['rgba(150,190,185,0.4)', 'rgba(120,190,140,0.45)', 'rgba(200,180,120,0.4)', '#4a5250'][(rand() * 4) | 0];
        g.fillRect(-(D / 2 - 0.12) * TILE_W + i * 6 + rand() * 3, yy - bh, bw, bh);
      }
    }
    resetT(g);
  });
}

export function makeChair(seed = 41) {
  return makeProp(1.0, 0.8, 0.5, (g, ox, oy) => {
    aoShadow(g, ox, oy, 0.9, 0.7, 0.4);
    // 翻倒的椅子
    isoBox(g, ox, oy, -0.4, -0.3, 0.16, 0.62, 0.58, 0.08, '#4a5250', '#343b39', '#2a3130');
    isoBox(g, ox, oy, -0.42, -0.32, 0.0, 0.1, 0.1, 0.18, '#2c3335', '#232829', '#1c2122');
    isoBox(g, ox, oy, 0.18, 0.18, 0.0, 0.1, 0.1, 0.18, '#2c3335', '#232829', '#1c2122');
    isoBox(g, ox, oy, 0.2, -0.3, 0.24, 0.1, 0.56, 0.3, '#414947', '#2f3634', '#262c2b');
  });
}

export function makeRubble(seed) {
  const rand = mulberry32(seed);
  return makeProp(1.2, 1.0, 0.3, (g, ox, oy) => {
    aoShadow(g, ox, oy, 1.0, 0.8, 0.35);
    for (let i = 0; i < 12; i++) {
      const x = -0.45 + rand() * 0.9,
        y = -0.35 + rand() * 0.7;
      const s = 0.08 + rand() * 0.16;
      const c = ['#565e5c', '#454c4a', '#6a716e', '#39403e'][(rand() * 4) | 0];
      isoBox(g, ox, oy, x, y, 0, s, s * 0.9, s * 0.7 + 0.03, shade(c, 0.12), c, shade(c, -0.25));
    }
  });
}

export function makePipeStack(seed = 61) {
  const rand = mulberry32(seed);
  const W = 0.5,
    D = 1.4,
    H = 2.6;
  return makeProp(W + 0.4, D + 0.3, H, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.4);
    for (let i = 0; i < 3; i++) {
      const off = -0.4 + i * 0.42;
      isoBox(g, ox, oy, -W / 2, off, 0, W * 0.55, 0.24, H - rand() * 0.3, '#5a5348', '#3f4a4c', '#2f3839');
    }
    // 阀门：像素圆环
    const p = P(ox, oy, 0, -0.2, H * 0.42);
    pxEllipseRing(g, p[0] + 4, p[1], 4, 4, '#7a6b4a', 2);
  });
}

/* ------------------------------------------------------------------ *
 * 角色
 * ------------------------------------------------------------------ */

/**
 * 姿势。平时全是 0，等于原来的站立/行走；QTE 与过场把这些字段填出来，
 * 角色才有"看得见的动作"而不是只有坐标在动。全部是**像素偏移**，
 * 在角色自身的精灵空间里算（+x 屏幕右，+y 屏幕下）。
 *
 *   face      强制朝向（>0 朝右），不给就跟着 aim
 *   crouch    屈身：髋部往下沉多少像素，腿同时缩短
 *   lean      上半身绕髋部旋转的弧度
 *   sink      整个人往下压（趴地 / 被压住）
 *   legs      { a, b } 两条腿各自的水平偏移；{ la, lb } 抬腿高度
 *   arms      { far:{x,y}, near:{x,y} } 手相对**肩膀**的偏移，覆盖默认摆臂
 *   armAng    手里那件东西的角度（不给就用 aim 的角度）
 *   headTilt  头的额外偏移 { x, y }
 *   hideItems 手上的东西先不画（"拔枪"那一拍之前枪还在枪套里）
 *   holster   在腰侧画一个枪套
 */
const NO_POSE = {};

/**
 * 绘制研究员角色。
 * sx, sy = 脚底屏幕坐标
 * o = { aim:{x,y}(屏幕方向单位向量), walk, moving, leftItem, rightItem, flashOn, pose,
 *       outfit(OUTFITS 里的一套), look({skin,hair,hairCol}), slung(胸前挎枪) }
 *
 * 返回两只手与枪口的屏幕坐标（已经过 scale），QTE 要靠枪口位置发弹道。
 */
export function drawCharacter(g, sx, sy, o) {
  const sc = o.scale || 1;
  if (sc !== 1) {
    g.save();
    g.translate(sx, sy);
    g.scale(sc, sc);
    g.translate(-sx, -sy);
  }
  const r = drawCharacterBody(g, sx, sy, o);
  if (sc !== 1) {
    g.restore();
    // 精灵空间 -> 屏幕：缩放是绕脚底做的，手的坐标要跟着换算回去
    for (const k of ['left', 'right', 'muzzle']) {
      if (!r[k]) continue;
      r[k] = { x: sx + (r[k].x - sx) * sc, y: sy + (r[k].y - sy) * sc };
    }
  }
  return r;
}

function drawCharacterBody(g, sx, sy, o) {
  const aim = o.aim || { x: 1, y: 0.5 };
  const po = o.pose || NO_POSE;
  const dirRight = (po.face === undefined ? aim.x : po.face) >= 0 ? 1 : -1;
  const back = aim.y < -0.12 && !po.noBack;
  const phase = o.walk || 0;
  const bob = o.moving ? Math.abs(Math.sin(phase * Math.PI)) * 1.2 : 0;
  const sw = o.moving ? Math.sin(phase * Math.PI * 2) : 0;
  const x = Math.round(sx);
  const y = Math.round(sy);

  // 服装与外貌：不传就是序章的白大褂研究员，旧调用零改动
  const fit = o.outfit || OUTFITS.lab;
  const lk = o.look || DEFAULT_LOOK;
  const skin = lk.skin || PAL.skin;
  const skinD = shade(skin, -0.24);
  const hairCol = lk.hairCol || PAL.hair;
  const hairStyle = lk.hair || 'messy';

  /* 姿势量取整/量化：屈身与下沉落在整像素上，上身旋转量化到 7.5° 一档 ——
     过场里的动作从平滑补间变成一格一格的定格步进 */
  const crouch = Math.round(po.crouch || 0);
  const sink = Math.round(po.sink || 0);
  const lean = po.lean ? qz(po.lean, Math.PI / 24) : 0;
  const legs = po.legs || null;

  // 影子：屈身/趴下时人更贴地，影子更实（两档像素椭圆，无渐变）
  g.save();
  g.globalAlpha = 0.5 + Math.min(0.25, (crouch + sink) * 0.02);
  pxEllipse(g, x, y, 6.2 + crouch * 0.14, 3.1, 'rgba(0,0,0,0.55)');
  pxEllipse(g, x, y, 4.2 + crouch * 0.1, 2.1, 'rgba(0,0,0,0.5)');
  g.restore();

  const baseY = y - Math.round(bob) + sink;
  // 髋部：上半身绕它旋转，屈身时它整个下沉
  const hipY = baseY - 11 + crouch;

  // 腿：摆腿量取整，脚落在整像素格上
  const l1 = Math.round(legs ? legs.a : sw * 2.2);
  const l2 = Math.round(legs ? legs.b : -sw * 2.2);
  const la = Math.round(legs && legs.la ? legs.la : 0);
  const lb = Math.round(legs && legs.lb ? legs.lb : 0);
  const legTop = baseY - 9 + crouch;
  const legH = Math.max(2, 8 - crouch);
  g.fillStyle = fit.pants;
  g.fillRect(x - 4 + l1, legTop - la, 3, legH);
  g.fillRect(x + 1 + l2, legTop - lb, 3, legH);
  g.fillStyle = fit.pantsD;
  g.fillRect(x - 4 + l1, legTop - la, 1, legH);
  g.fillRect(x + 1 + l2, legTop - lb, 1, legH);
  g.fillStyle = fit.shoe;
  g.fillRect(x - 4 + l1 - (dirRight > 0 ? 0 : 1), legTop + legH - 2 - la, 4, 2);
  g.fillRect(x + 1 + l2 - (dirRight > 0 ? 0 : 1), legTop + legH - 2 - lb, 4, 2);

  /* 上半身：整体绕髋部旋转。侧闪、被压住、举枪格挡这些"看得出用力"的动作
     全靠这一下 —— 只挪坐标是读不出身体在做什么的。 */
  g.save();
  if (lean) {
    g.translate(x, hipY);
    g.rotate(lean);
    g.translate(-x, -hipY);
  }
  const upY = crouch; // 上半身随屈身一起下沉

  // 上衣下摆（白大褂/夹克同一块，颜色跟服装走）
  g.fillStyle = fit.shade;
  g.fillRect(x - 5, baseY - 13 + upY, 10, 5);
  g.fillStyle = fit.coat;
  g.fillRect(x - 5, baseY - 13 + upY, 10, 3);

  // 躯干
  g.fillStyle = fit.coat;
  g.fillRect(x - 5, baseY - 21 + upY, 10, 9);
  // 阴影侧
  g.fillStyle = fit.shade;
  g.fillRect(x + (dirRight > 0 ? 2 : -5), baseY - 21 + upY, 3, 9);
  // 内衬 / 前襟
  g.fillStyle = fit.lining;
  if (!back) {
    g.fillRect(x - 1 + dirRight, baseY - 20 + upY, 2, 7);
    g.fillStyle = fit.dark;
    g.fillRect(x - 2 + dirRight, baseY - 20 + upY, 1, 8);
  } else {
    g.fillStyle = fit.dark;
    g.fillRect(x - 5, baseY - 17 + upY, 10, 1);
  }
  // 领子
  g.fillStyle = fit.dark;
  g.fillRect(x - 4, baseY - 21 + upY, 8, 1);

  // 防弹背心：压在躯干中段的一块深色板 + 一条肩带
  if (fit.vest) {
    g.fillStyle = '#33392a';
    g.fillRect(x - 4, baseY - 20 + upY, 8, 6);
    g.fillStyle = '#22271c';
    g.fillRect(x + (dirRight > 0 ? 1 : -4), baseY - 20 + upY, 3, 6);
    g.fillStyle = '#454d38';
    g.fillRect(x - 4, baseY - 20 + upY, 8, 1);
  }

  // 腰侧的枪套：拔枪那一拍之前枪在这里，"手去摸枪"才有东西可摸
  if (po.holster) {
    const gx = x + dirRight * 3.4 - 1;
    g.fillStyle = '#2a2f33';
    g.fillRect(gx, baseY - 13 + upY, 3, 5);
    g.fillStyle = '#3d444a';
    g.fillRect(gx, baseY - 13 + upY, 3, 1);
  }

  // 头
  const htx = po.headTilt ? Math.round(po.headTilt.x) : 0;
  const hty = po.headTilt ? Math.round(po.headTilt.y) : 0;
  const hx = x - 3 + dirRight + htx;
  const hy = baseY - 28 + upY + hty;
  g.fillStyle = skin;
  g.fillRect(hx, hy + 1, 6, 6);
  g.fillStyle = skinD;
  g.fillRect(hx + (dirRight > 0 ? 4 : 0), hy + 1, 2, 6);
  // 头发：按发型堆方块。光头什么都不画，寸头只描一层贴皮短茬
  g.fillStyle = hairCol;
  if (fit.helmet) {
    // 头盔盖住头发：台阶收顶 + 帽檐一条
    g.fillStyle = '#3e4433';
    g.fillRect(hx - 1, hy - 1, 8, 3);
    g.fillRect(hx, hy - 2, 6, 1);
    g.fillStyle = '#4c5340';
    g.fillRect(hx, hy - 2, 4, 1);
    g.fillStyle = '#2c3125';
    g.fillRect(hx - 1, hy + 2, 8, 1);
  } else if (hairStyle === 'bald') {
    g.fillStyle = shade(skin, 0.08);
    g.fillRect(hx, hy, 6, 1);
  } else if (hairStyle === 'buzz') {
    g.fillStyle = shade(hairCol, -0.28);
    g.fillRect(hx - 1, hy, 8, 2);
  } else if (hairStyle === 'short') {
    g.fillRect(hx - 1, hy, 8, 2);
    g.fillRect(hx - 1, hy, 1, 4);
    g.fillRect(hx + 6, hy, 1, 3);
  } else if (hairStyle === 'long') {
    g.fillRect(hx - 1, hy, 8, 3);
    g.fillRect(hx - 2, hy, 3, 8);
    g.fillRect(hx + 6, hy, 2, 8);
  } else {
    // messy（默认，序章同款）
    g.fillRect(hx - 1, hy, 8, 3);
    g.fillRect(hx - 1, hy, 2, 5);
    g.fillRect(hx + 6, hy, 1, 5);
  }
  if (back) {
    if (fit.helmet) {
      g.fillStyle = '#3e4433';
      g.fillRect(hx - 1, hy - 1, 8, 8);
      g.fillStyle = '#2c3125';
      g.fillRect(hx - 1, hy + 4, 8, 1);
    } else if (hairStyle === 'bald') {
      g.fillStyle = skin;
      g.fillRect(hx, hy + 1, 6, 6);
      g.fillStyle = skinD;
      g.fillRect(hx + (dirRight > 0 ? 4 : 0), hy + 1, 2, 6);
    } else if (hairStyle === 'buzz') {
      g.fillStyle = shade(hairCol, -0.28);
      g.fillRect(hx - 1, hy, 8, 5);
    } else if (hairStyle === 'long') {
      g.fillStyle = hairCol;
      g.fillRect(hx - 1, hy, 8, 9);
    } else {
      g.fillStyle = hairCol;
      g.fillRect(hx - 1, hy, 8, 7);
    }
  } else {
    g.fillStyle = '#1a1a1a';
    const ey = hy + 4;
    if (o.eyesShut) {
      // 闭眼：一条横线，起床时用
      if (dirRight > 0) g.fillRect(hx + 3, ey, 3, 1);
      else g.fillRect(hx, ey, 3, 1);
    } else if (dirRight > 0) {
      g.fillRect(hx + 3, ey, 1, 1);
      g.fillRect(hx + 5, ey, 1, 1);
    } else {
      g.fillRect(hx, ey, 1, 1);
      g.fillRect(hx + 2, ey, 1, 1);
    }
    // 咬牙：用力那几拍嘴张开，脸上有事发生
    if (po.grit) {
      g.fillStyle = '#2b1c18';
      g.fillRect(hx + (dirRight > 0 ? 3 : 1), hy + 6, 3, 1);
    }
  }
  // 脖颈阴影
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(hx + 1, hy + 7, 4, 1);

  // 手臂
  const shoulderY = baseY - 19 + upY;
  const armLen = 7;
  const itemAng = po.armAng === undefined ? null : po.armAng;
  let muzzle = null;
  const drawArm = (side, item, off) => {
    const shx = Math.round(x + side * 4.2);
    let ax, ay;
    if (off) {
      ax = shx + off.x;
      ay = shoulderY + off.y;
    } else if (item) {
      ax = shx + aim.x * armLen;
      ay = shoulderY + aim.y * armLen * 0.72;
    } else {
      ax = shx + side * 1.4 + (o.moving ? -sw * side * 1.6 : 0);
      ay = shoulderY + 8 + (o.moving ? Math.abs(sw) * 0.8 : 0);
    }
    ax = Math.round(ax);
    ay = Math.round(ay);
    // 手臂：2px 像素直线 + 1px 底缘压暗，代替 round cap 的 stroke
    pxLine(g, shx, shoulderY, ax, ay, fit.coat, 2);
    pxLine(g, shx, shoulderY + 2, ax, ay + 2, 'rgba(0,0,0,0.18)', 1);
    g.fillStyle = skin;
    g.fillRect(ax, ay, 2, 2);
    if (item) {
      const a = itemAng === null ? Math.atan2(aim.y, aim.x) : itemAng;
      drawHeldItem(g, ax, ay, a, item, o);
      if (item === 'pistol') muzzle = { x: ax + Math.cos(a) * 7.5, y: ay + Math.sin(a) * 7.5 };
    }
    return { x: ax, y: ay };
  };

  // 先画远手（背对镜头一侧）
  const farSide = dirRight > 0 ? -1 : 1;
  const nearSide = -farSide;
  const hide = !!po.hideItems;
  const farItem = hide ? null : farSide < 0 ? o.leftItem : o.rightItem;
  const nearItem = hide ? null : nearSide < 0 ? o.leftItem : o.rightItem;
  const arms = po.arms || null;
  const farPos = drawArm(farSide, farItem, arms && arms.far);

  // 挎枪：斜挂胸前的卡宾枪（画在远手之后、近手之前，被近臂自然压住一角）
  if (o.slung) {
    const gy = baseY - 17 + upY;
    pxLine(g, x - dirRight * 5, gy - 2, x + dirRight * 5, gy + 3, '#1c211d', 2);
    pxLine(g, x - dirRight * 5, gy - 3, x + dirRight * 5, gy + 2, '#333a34', 1);
    g.fillStyle = '#15181a';
    g.fillRect(x + dirRight * 2 - 1, gy + 2, 2, 3);
  }

  const nearPos = drawArm(nearSide, nearItem, arms && arms.near);
  g.restore();

  // 上半身是绕髋部转过的，返回的手/枪口坐标也要跟着转，否则弹道会从旧位置飞出
  if (lean) {
    const cs = Math.cos(lean);
    const sn = Math.sin(lean);
    const rot = (p) => {
      if (!p) return p;
      const dx = p.x - x;
      const dy = p.y - hipY;
      return { x: x + dx * cs - dy * sn, y: hipY + dx * sn + dy * cs };
    };
    return {
      left: rot(farSide < 0 ? farPos : nearPos),
      right: rot(farSide < 0 ? nearPos : farPos),
      muzzle: rot(muzzle),
    };
  }

  return {
    left: farSide < 0 ? farPos : nearPos,
    right: farSide < 0 ? nearPos : farPos,
    muzzle,
  };
}

/**
 * 手持物：不再用 rotate（旋转的 fillRect 会被抗锯齿糊掉），
 * 枪身/筒身沿瞄准方向铺台阶像素线，跟机组人员胸前的卡宾枪同一画法。
 */
function drawHeldItem(g, ax, ay, a, item, o) {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const X = Math.round(ax);
  const Y = Math.round(ay);
  if (item === 'pistol') {
    // 枪身：2px 像素线 + 1px 顶部受光
    pxLine(g, X, Y - 1, X + ca * 7, Y - 1 + sa * 7, '#20262a', 2);
    pxLine(g, X, Y - 2, X + ca * 7, Y - 2 + sa * 7, '#39434a', 1);
    // 握把：垂在手下
    g.fillStyle = '#171b1e';
    g.fillRect(X, Y + 1, 2, 3);
  } else if (item === 'flashlight') {
    // 筒身：3px 像素线（后端在手后一点）
    pxLine(g, X - ca * 2, Y - 1 - sa * 2, X + ca * 4, Y - 1 + sa * 4, '#2f373c', 3);
    pxLine(g, X - ca * 2, Y - 2 - sa * 2, X + ca * 4, Y - 2 + sa * 4, '#4c565c', 1);
    // 灯头
    g.fillStyle = o.flashOn ? '#fff6d8' : '#8d9490';
    g.fillRect(Math.round(X + ca * 5) - 1, Math.round(Y + sa * 5) - 2, 3, 4);
  }
}

/* 躺姿不再单独画一套等距盒子身体：那样和站姿比例不一致。起床动画改成
   对同一个角色精灵做"绕髋部旋转"，见 main.js 的 wakePose()。 */

/* ------------------------------------------------------------------ *
 * 火焰：按水平像素带堆叠，不用平滑渐变
 * ------------------------------------------------------------------ */

export function drawFlames(g, cx, cy, w, h, t, seed = 0) {
  const bands = 14;
  const cols = ['#3a1608', '#7a2c0a', '#c2560f', '#e8871c', '#f5bb3e', '#ffe6a0'];
  for (let i = 0; i < bands; i++) {
    const k = i / (bands - 1); // 0 底部 1 顶部
    const wob = Math.sin(t * 7.3 + i * 0.9 + seed) * 0.5 + Math.sin(t * 11.7 + i * 1.7 + seed * 2) * 0.5;
    const bw = w * (1 - k * 0.82) * (0.75 + 0.25 * (Math.sin(t * 9 + i + seed) * 0.5 + 0.5));
    const bx = cx - bw / 2 + wob * w * 0.16 * k;
    const by = cy - k * h;
    const ci = Math.min(cols.length - 1, Math.round(k * (cols.length - 1) + (Math.sin(t * 13 + i * 2.3) > 0.5 ? 1 : 0)));
    g.fillStyle = cols[ci];
    g.fillRect(Math.round(bx), Math.round(by), Math.max(1, Math.round(bw)), Math.ceil(h / bands) + 1);
  }
  // 火星
  for (let i = 0; i < 5; i++) {
    const p = (t * 1.4 + i * 0.37 + seed) % 1;
    const sx = cx + Math.sin(t * 5 + i * 2.1) * w * 0.5;
    const sy = cy - h * (0.7 + p * 0.9);
    g.fillStyle = p > 0.7 ? '#8a3a12' : '#f5bb3e';
    g.fillRect(Math.round(sx), Math.round(sy), 1, 1);
  }
}

/* ------------------------------------------------------------------ *
 * 楼梯：逐级抬高的等距台阶
 * ------------------------------------------------------------------ */

/**
 * 单级台阶（含一段扶手）。整段楼梯拆成一级一级独立的道具，靠深度排序
 * 各自和玩家比较 —— 做成一整张精灵的话，玩家走到梯段上半段时深度键会
 * 小于整段楼梯，人就被楼梯整体挡住了。
 * 扶手放在 -x 侧（远离镜头那侧），不会糊住玩家。
 */
export function makeStep(wTiles, run, rise, seed = 1) {
  const rand = mulberry32(seed);
  const railH = 0.72;
  return makeProp(wTiles + 0.5, run + 0.2, rise + railH + 0.4, (g, ox, oy) => {
    const w2 = wTiles / 2;
    // 踏面亮、踢面暗，这个明暗差是"看出这是台阶"的关键
    isoBox(g, ox, oy, -w2, -run / 2, 0, wTiles, run, rise, shade('#575e62', 0.08), '#2e3437', '#20262a');
    const p = P(ox, oy, -w2, -run / 2, rise);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(p[0] + 2, p[1], wTiles * TILE_W * 0.5 - 3, 1.2);
    if (rand() > 0.66) {
      pxBlob(g, p[0] + 5 + rand() * 12, p[1] + 3 + rand() * 3, 3 + rand() * 5, 2 + rand() * 3, 'rgba(63,18,16,0.5)', rand);
    }
    // 扶手立柱
    const hx = -w2 - 0.04;
    isoBox(g, ox, oy, hx, -run / 2, rise, 0.1, 0.1, railH, '#7d8589', '#4a5155', '#383e42');
    // 斜扶手：本级柱顶连到下一级（+y 更低一级）柱顶
    const a = P(ox, oy, hx + 0.05, -run / 2 + 0.05, rise + railH);
    const b = P(ox, oy, hx + 0.05, run / 2 + 0.05, rise - rise + railH);
    pxLine(g, a[0], a[1], b[0], b[1], '#8b9296', 2);
  });
}

/** 梯段顶部的平台 */
export function makeLanding(wTiles, dTiles, seed = 3) {
  const rand = mulberry32(seed);
  return makeProp(wTiles + 0.5, dTiles + 0.2, 0.9, (g, ox, oy) => {
    const w2 = wTiles / 2;
    isoBox(g, ox, oy, -w2, -dTiles / 2, 0, wTiles, dTiles, 0.16, '#5d6468', '#333a3d', '#252b2e');
    const hx = -w2 - 0.04;
    isoBox(g, ox, oy, hx, -dTiles / 2, 0.16, 0.1, 0.1, 0.72, '#7d8589', '#4a5155', '#383e42');
    isoBox(g, ox, oy, hx, dTiles / 2 - 0.1, 0.16, 0.1, 0.1, 0.72, '#7d8589', '#4a5155', '#383e42');
    const a = P(ox, oy, hx + 0.05, -dTiles / 2, 0.88);
    const b = P(ox, oy, hx + 0.05, dTiles / 2, 0.88);
    pxLine(g, a[0], a[1], b[0], b[1], '#8b9296', 2);
    if (rand() > 0.4) {
      const p = P(ox, oy, 0, 0, 0.16);
      pxBlob(g, p[0], p[1], 9, 5, 'rgba(63,18,16,0.4)', rand);
    }
  });
}

/**
 * 下行楼梯：在地面上开一个洞，只露出最上面几级台阶，往下沉入黑暗。
 * 等距下画完整的下行梯段会被自己的地面挡住，"洞 + 几级台阶"最容易读懂。
 */
export function makeStairsDown(wTiles, dTiles, seed = 2) {
  const rand = mulberry32(seed);
  return makeProp(wTiles + 0.5, dTiles + 0.5, 1.4, (g, ox, oy) => {
    const w2 = wTiles / 2;
    const d2 = dTiles / 2;
    // 洞口：纯黑，边缘一圈亮口沿
    poly(
      g,
      [P(ox, oy, -w2, -d2, 0), P(ox, oy, w2, -d2, 0), P(ox, oy, w2, d2, 0), P(ox, oy, -w2, d2, 0)],
      '#05070700',
    );
    poly(
      g,
      [P(ox, oy, -w2, -d2, 0), P(ox, oy, w2, -d2, 0), P(ox, oy, w2, d2, 0), P(ox, oy, -w2, d2, 0)],
      '#060809',
    );
    // 往下的几级台阶（从洞口后缘开始下沉）
    const steps = 4;
    const rise = 0.3;
    const run = 0.42;
    for (let i = 0; i < steps; i++) {
      const z = -i * rise;
      const y0 = -d2 + i * run;
      const k = 1 - i / steps;
      isoBox(
        g, ox, oy, -w2 + 0.1, y0, z - rise, wTiles - 0.2, run, rise,
        shade('#4a5054', -0.15 - 0.16 * i), shade('#262c2f', -0.2 * i), shade('#1a1f22', -0.2 * i),
      );
      const p = P(ox, oy, -w2 + 0.1, y0, z);
      g.fillStyle = `rgba(255,255,255,${0.1 * k})`;
      g.fillRect(p[0] + 2, p[1], (wTiles - 0.2) * TILE_W * 0.5 - 3, 1);
    }
    // 口沿
    poly(g, [P(ox, oy, -w2, -d2, 0), P(ox, oy, w2, -d2, 0), P(ox, oy, w2, d2, 0), P(ox, oy, -w2, d2, 0)], null, '#6d757a', 2);
    // 洞口边的扶手
    const hx = w2 - 0.06;
    for (let i = 0; i < 3; i++) {
      isoBox(g, ox, oy, hx, -d2 + i * (dTiles / 2.6), 0, 0.1, 0.1, 0.74, '#7d8589', '#4a5155', '#383e42');
    }
    const a = P(ox, oy, hx + 0.05, -d2, 0.74);
    const b = P(ox, oy, hx + 0.05, d2, 0.74);
    pxLine(g, a[0], a[1], b[0], b[1], '#8b9296', 2);
    // 血手印拖向洞口
    g.globalAlpha = 0.45;
    g.fillStyle = '#3f1210';
    for (let i = 0; i < 6; i++) {
      const p = P(ox, oy, -w2 + rand() * wTiles, d2 - rand() * 0.5, 0);
      g.fillRect(p[0], p[1], 2 + rand() * 5, 2 + rand() * 3);
    }
    g.globalAlpha = 1;
  });
}

/* ------------------------------------------------------------------ *
 * 天台：帐篷、通风口、直升机、绳索
 * ------------------------------------------------------------------ */

/**
 * 露营帐篷。脊线沿 +x，两片坡面朝 ±y —— 这个投影里可见面是 +x / +y / +z，
 * 所以真正看得见的是近侧（+y）坡面和 +x 端的入口三角。远侧坡面只留一条
 * 暗色轮廓压在后面，不然帐篷会缺一块。
 */
export function makeTent(seed = 701) {
  const rand = mulberry32(seed);
  const RX = 1.05; // 半长（沿 x）
  const RY = 0.78; // 半宽（沿 y）
  const H = 1.24; // 脊高
  return makeProp(RX * 2 + 0.9, RY * 2 + 0.9, H + 0.2, (g, ox, oy) => {
    aoShadow(g, ox, oy, RX * 2, RY * 2, 0.55);

    const ridgeA = P(ox, oy, -RX, 0, H);
    const ridgeB = P(ox, oy, RX, 0, H);

    // 远侧坡面（几乎侧视，只当轮廓用）
    poly(
      g,
      [P(ox, oy, -RX, -RY, 0), P(ox, oy, RX, -RY, 0), ridgeB, ridgeA],
      '#2b3129',
    );
    // 近侧坡面：主要的受光面。三档硬分带（脊线亮 → 下摆暗），交界棋盘抖动
    const hemA = P(ox, oy, -RX, RY, 0);
    const hemB = P(ox, oy, RX, RY, 0);
    const mixPt = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const bandCols = ['#5c6a4c', '#47533c', '#333d2d'];
    const cuts = [0, 0.4, 0.72, 1];
    for (let b = 0; b < 3; b++) {
      poly(g, [
        mixPt(ridgeA, hemA, cuts[b]), mixPt(ridgeB, hemB, cuts[b]),
        mixPt(ridgeB, hemB, cuts[b + 1]), mixPt(ridgeA, hemA, cuts[b + 1]),
      ], bandCols[b]);
      if (b > 0) {
        const u = mixPt(ridgeA, hemA, cuts[b]);
        const v = mixPt(ridgeB, hemB, cuts[b]);
        pxDitherLine(g, u[0], u[1], v[0], v[1], bandCols[b - 1]);
      }
    }
    // 布面褶皱：沿脊线往下摆拉几条暗纹（像素直线）
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const a = P(ox, oy, -RX + t * RX * 2, 0.02, H - 0.03);
      const b = P(ox, oy, -RX + t * RX * 2 + 0.06, RY, 0);
      pxLine(g, a[0], a[1], b[0], b[1], 'rgba(0,0,0,0.28)', 1);
    }
    // 脊线与压条
    pxLine(g, ridgeA[0], ridgeA[1], ridgeB[0], ridgeB[1], '#7d8a68', 2);

    // +x 端：敞开的入口，里面是黑的
    const e0 = P(ox, oy, RX, -RY, 0);
    const e1 = P(ox, oy, RX, RY, 0);
    poly(g, [e0, e1, ridgeB], '#3d4736');
    poly(
      g,
      [
        [(e0[0] + e1[0]) / 2 - 5, (e0[1] + e1[1]) / 2 - 1],
        [(e0[0] + e1[0]) / 2 + 6, (e0[1] + e1[1]) / 2 + 4],
        [ridgeB[0] + 1, ridgeB[1] + 6],
      ],
      '#07090a',
    );
    // 掀开、撕烂的门帘
    poly(g, [
      [ridgeB[0], ridgeB[1] + 2],
      [ridgeB[0] + 9, ridgeB[1] + 12],
      [ridgeB[0] + 3, ridgeB[1] + 22],
      [ridgeB[0] - 2, ridgeB[1] + 10],
    ], '#4e5a40', '#1b2018', 1);

    // 撕裂口：从入口往近侧坡面撕开一道
    const tr = P(ox, oy, 0.42, 0.3, 0.6);
    poly(g, [
      [tr[0], tr[1]],
      [tr[0] + 7, tr[1] - 5],
      [tr[0] + 13, tr[1] + 3],
      [tr[0] + 6, tr[1] + 9],
    ], '#0a0d0b');

    // 地钉与拉绳
    for (const [gx, gy] of [
      [-RX - 0.35, RY + 0.3],
      [RX + 0.3, RY + 0.32],
      [-RX - 0.3, -RY - 0.28],
    ]) {
      const a = P(ox, oy, gx > 0 ? RX : -RX, 0, H - 0.06);
      const b = P(ox, oy, gx, gy, 0);
      pxLine(g, a[0], a[1], b[0], b[1], 'rgba(190,196,178,0.5)', 1);
      g.fillStyle = '#6b736e';
      g.fillRect(b[0] - 1, b[1] - 2, 2, 3);
    }

    // 血：帐篷上的喷溅 + 从入口拖出来的一道
    g.globalAlpha = 0.62;
    for (let i = 0; i < 16; i++) {
      const ty = rand() * RY; // 0 在脊线，RY 在下摆
      const zz = (1 - ty / RY) * H * (0.15 + rand() * 0.75);
      const p = P(ox, oy, -RX + rand() * RX * 2, ty, zz);
      pxBlob(g, p[0], p[1], 1 + rand() * 4.5, 1 + rand() * 3, '#3f1210', rand);
    }
    for (let i = 0; i < 9; i++) {
      const p = P(ox, oy, RX + rand() * 0.8, -RY * 0.4 + rand() * RY * 1.4, 0);
      pxBlob(g, p[0], p[1], 2 + rand() * 6, 1.4 + rand() * 3, '#3f1210', rand);
    }
    g.globalAlpha = 1;
  });
}

/**
 * 天台的楼梯出口小屋（bulkhead）。
 *
 * 以前这东西是画在西墙平面上的一段满高墙 + 门洞，等距下看就是"室内房间的
 * 一面墙"，这正是天台不像露天的原因之一。现在它是一个立在屋面上的独立体块，
 * 四周留空、背后就是夜空，门开在 +x 面（玩家走过来的那一侧）。
 */
export function makeRoofBulkhead(seed = 731) {
  const rand = mulberry32(seed);
  const W = 1.1; // 沿 x（进深）
  const D = 3.8; // 沿 y（面宽）
  const H = 2.55;
  return makeProp(W + 0.5, D + 0.5, H + 0.55, (g, ox, oy) => {
    aoShadow(g, ox, oy, W + 0.5, D + 0.5, 0.6);

    // 主体
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, '#3b4443', '#333c3b', '#232a2a');
    // 屋面压顶（比主体外扩一点，屋檐才有一条硬边）
    isoBox(g, ox, oy, -W / 2 - 0.09, -D / 2 - 0.09, H, W + 0.18, D + 0.18, 0.14, '#4a5352', '#3a4342', '#282f2f');

    /* --- +x 面：门与门头灯 --- */
    faceRight(g, ox, oy, W / 2);
    const uw = (u) => u * TILE_W;
    const vz = (z) => -z * TILE_Z;
    // 混凝土面的横向分缝
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let i = 1; i < 4; i++) g.fillRect(uw(-D / 2), vz(i * 0.6), uw(D), 1.1);
    // 门框凹槽
    g.fillStyle = '#101413';
    g.fillRect(uw(-0.95), vz(2.12), uw(1.9), 2.12 * TILE_Z);
    g.fillStyle = '#2a3231';
    g.fillRect(uw(-0.88), vz(2.05), uw(1.76), 2.05 * TILE_Z);
    // 钢门：两扇，硬分带明暗 + 交界棋盘抖动列，中缝 + 下部危险条纹
    const dh = Math.round(1.98 * TILE_Z);
    const dy0 = Math.round(vz(1.98));
    for (const [u0, u1, dc] of [
      [-0.8, -0.45, '#465052'],
      [-0.45, -0.03, '#5b6568'],
      [-0.03, 0.42, '#3e4749'],
      [0.42, 0.8, '#4a5355'],
    ]) {
      g.fillStyle = dc;
      g.fillRect(Math.round(uw(u0)), dy0, Math.round(uw(u1)) - Math.round(uw(u0)), dh);
    }
    pxDitherV(g, uw(-0.45), dy0, dy0 + dh, '#465052');
    pxDitherV(g, uw(0.42), dy0, dy0 + dh, '#3e4749');
    g.fillStyle = '#161a1a';
    g.fillRect(uw(-0.03), vz(1.98), 2, 1.98 * TILE_Z);
    // 推杠与门牌
    g.fillStyle = '#8d968f';
    g.fillRect(uw(-0.62), vz(1.05), uw(1.24), 2);
    g.fillStyle = 'rgba(200,200,190,0.32)';
    g.fillRect(uw(-0.26), vz(1.66), uw(0.52), 7);
    pxText(g, uw(-0.06), vz(1.66) + 1, 'R', '#1a1c1a', 1);
    // 门缝渗出的一点楼道光
    g.fillStyle = 'rgba(190,208,200,0.14)';
    g.fillRect(uw(-0.03), vz(1.9), 1.6, 1.8 * TILE_Z);
    // 门头雨棚 + 应急灯壳（灯光本身由烘焙光源给）
    g.fillStyle = '#2b3332';
    g.fillRect(uw(-1.15), vz(2.32), uw(2.3), 3.2);
    g.fillStyle = '#404a48';
    g.fillRect(uw(-1.15), vz(2.32), uw(2.3), 1.2);
    g.fillStyle = '#232a2b';
    g.fillRect(uw(-0.3), vz(2.2), uw(0.6), 4.4);
    g.fillStyle = 'rgba(198,224,238,0.5)';
    g.fillRect(uw(-0.24), vz(2.14), uw(0.48), 2.6);
    // 锈迹与水痕
    g.globalAlpha = 0.3;
    speckle(g, uw(-D / 2), vz(H), uw(D), H * TILE_Z, rand, 46, [PAL.rust, '#1b201f', '#3f1210'], 1.6, 2.4);
    g.globalAlpha = 1;
    resetT(g);

    /* --- +y 面：只有污渍与一道排水管 --- */
    faceLeft(g, ox, oy, D / 2);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(-W / 2 * TILE_W, -H * TILE_Z, W * TILE_W, H * TILE_Z);
    g.fillStyle = '#39423f';
    g.fillRect(-0.3 * TILE_W, -H * TILE_Z, 2.4, H * TILE_Z);
    g.globalAlpha = 0.28;
    speckle(g, -W / 2 * TILE_W, -H * TILE_Z, W * TILE_W, H * TILE_Z, rand, 18, [PAL.rust, '#141817'], 1.4, 2.2);
    g.globalAlpha = 1;
    resetT(g);

    /* --- 屋顶上的杂物：通风帽、天线、水箱 --- */
    isoBox(g, ox, oy, -0.28, -1.4, H + 0.14, 0.56, 0.56, 0.42, '#4f5856', '#3c4544', '#2c3332');
    isoBox(g, ox, oy, -0.34, -1.46, H + 0.56, 0.68, 0.68, 0.1, '#5d6664', '#414a48', '#303735');
    isoBox(g, ox, oy, -0.3, 0.9, H + 0.14, 0.6, 0.9, 0.5, '#4a5350', '#39413f', '#2a3130');
    // 天线杆 + 拉线（像素直线）
    const top = P(ox, oy, 0.1, -0.2, H + 1.5);
    const foot = P(ox, oy, 0.1, -0.2, H + 0.14);
    pxLine(g, foot[0], foot[1], top[0], top[1], '#59635e', 1);
    for (const [gx, gy] of [[-0.4, -1.1], [0.4, 0.7], [-0.4, 0.7]]) {
      const b = P(ox, oy, gx, gy, H + 0.16);
      pxLine(g, top[0], top[1], b[0], b[1], 'rgba(120,132,128,0.5)', 1);
    }
    // 天线顶的障碍灯
    g.fillStyle = 'rgba(255,90,70,0.75)';
    g.fillRect(top[0] - 1, top[1] - 2, 2, 2.4);
  });
}

/** 天台通风口：带百叶的方形风帽 */
export function makeRoofVent(seed = 711) {
  const rand = mulberry32(seed);
  const W = 0.95;
  const D = 0.95;
  const H = 0.92;
  return makeProp(W + 0.3, D + 0.3, H + 0.25, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.5);
    // 底座
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, 0.16, '#3c4544', '#2a3231', '#212827');
    // 风管
    isoBox(g, ox, oy, -W / 2 + 0.1, -D / 2 + 0.1, 0.16, W - 0.2, D - 0.2, H - 0.34, '#4d5654', '#343d3c', '#272e2d');
    // 百叶（+x 面）
    faceRight(g, ox, oy, W / 2 - 0.1);
    for (let i = 0; i < 5; i++) {
      const v = -(H - 0.24) * TILE_Z + 4 + i * 5;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect((-(D - 0.2) / 2 + 0.04) * TILE_W, v, (D - 0.28) * TILE_W, 2.4);
      g.fillStyle = 'rgba(200,212,208,0.12)';
      g.fillRect((-(D - 0.2) / 2 + 0.04) * TILE_W, v + 2.4, (D - 0.28) * TILE_W, 0.9);
    }
    resetT(g);
    // 风帽
    isoBox(g, ox, oy, -W / 2 - 0.08, -D / 2 - 0.08, H - 0.18, W + 0.16, D + 0.16, 0.12, '#5b6462', '#3b4442', '#2d3433');
    g.globalAlpha = 0.32;
    speckle(g, ox - W * HW, oy - H * TILE_Z, W * HW * 2, H * TILE_Z, rand, 26, [PAL.rust, '#20261f'], 1.4, 1.2);
    g.globalAlpha = 1;
  });
}

/* ------------------------------------------------------------------ *
 * 直升机
 *
 * 屏幕空间绘制（它在天上，不参与等距深度排序）。整段是**像素画**的画法：
 * 所有几何直接落在 640×360 的整数像素网格上（fillRect + 整数坐标），
 * 轮廓由逐行扫描的台阶构成，明暗是分带平涂 + 交界行棋盘抖动，
 * 没有任何 stroke 曲线 / 椭圆 / 渐变 —— 跟 drawCharacter、丧尸同一套语言。
 *
 * 挂点（heliAnchor 等）沿用 HELI_S 单位导出，main.js 的爬绳标定
 * （GRAB_UP / SILL_UP）依赖它们，**数值不能动**；机体绘制内部
 * 已换成把这些单位预先乘好的像素常量。
 * ------------------------------------------------------------------ */

/** 机体整体缩放。改这个数字，挂点/探照灯/绳索粗细会一起跟着走 */
export const HELI_S = 1.95;

/** 舱门绞盘的挂绳点（机身中心 -> 画布坐标）。dir=-1 时舱门朝画面左侧 */
export function heliAnchor(x, y, dir = -1) {
  return { x: x + 11 * HELI_S * dir, y: y + 9.5 * HELI_S };
}

/** 机腹探照灯的灯口位置 */
export function heliLampAt(x, y, dir = -1) {
  return { x: x - 13 * HELI_S * dir, y: y + 6.5 * HELI_S };
}

/** 舱门口那名士兵伸到最长时手套的位置 —— 玩家的手腕要被抓在这里 */
export function heliGrabAt(x, y, dir = -1) {
  return { x: x + 10.2 * HELI_S * dir, y: y + 6.9 * HELI_S };
}

/** 舱门门槛：人被拽进去之后脚踩在这个高度 */
export function heliSillAt(x, y, dir = -1) {
  return { x: x + 9.0 * HELI_S * dir, y: y + CABIN.y1 * HELI_S };
}

/** 舱内地板中心：人被拽进去之后停在这里 */
export function heliCabinAt(x, y, dir = -1) {
  return { x: x + 7.0 * HELI_S * dir, y: y + 2.4 * HELI_S };
}

/** 侧舱门开口（机体局部单位）。舱内背景、门板、机组站位都按它排 */
const CABIN = { x0: 1.5, x1: 13.0, y0: -5.5, y1: 5.5 };

/* 像素动画量化器：值对齐到 step 的格上、时间按 hz 定格。
   平滑的正弦补间读起来是矢量动画，量化成跳变的定格才像逐帧画的。
   （pxLine / pxDither / edgeAt / rowScan 这些像素 helper 已上移到 util.js，
   全游戏共用；这里只剩直升机自己的量化器。） */
export const qz = (v, step) => Math.round(v / step) * step;
export const tick = (t, hz) => Math.floor(t * hz) / hz;

/* 机体调色板：硬分档，不做半透明叠色，也不描黑边（跟场景道具统一） */
const HP = {
  hi: '#5c665f', // 机背受光
  mid: '#454f49', // 上侧
  low: '#333b36', // 下侧
  belly: '#252b27', // 机腹
  chin: '#191e1b', // 机头下颌
  seam: '#2a322d', // 蒙皮拼缝
  steel: '#7f8a84', // 金属亮件
  steelD: '#3a423e',
};

/* ------------------------------------------------------------------ *
 * 白天的机体：调色板整体抬亮 + 暖移
 *
 * 夜里（天台）机体压得很暗没问题 —— 周围也是暗的；停到清晨的营地里，
 * 同一套近黑配色贴在亮暖的地皮上，整个剪影就读成了"描着黑边的贴纸"。
 * 所以 drawHeli 接 o.sun：把每一笔 fillStyle 过一遍暖色抬升（乘性提亮
 * 为主、加一点暖色底），暗部不再是黑、亮部偏卡其 —— 跟军帐的受光语言
 * （顶亮偏暖 / 背光橄榄暗）落在同一档。转换按颜色串做缓存，量化后的
 * 颜色是有限集合，不会越积越多。
 * ------------------------------------------------------------------ */

const SUN_TINT_CACHE = new Map();
function sunColor(c) {
  let v = SUN_TINT_CACHE.get(c);
  if (v) return v;
  let r;
  let gg;
  let b;
  let a = null;
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    r = n >> 16;
    gg = (n >> 8) & 255;
    b = n & 255;
  } else {
    const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
    if (!m) {
      SUN_TINT_CACHE.set(c, c);
      return c;
    }
    r = +m[1];
    gg = +m[2];
    b = +m[3];
    a = m[4] === undefined ? 1 : +m[4];
  }
  const R = Math.min(255, Math.round(r * 1.3 + 30));
  const G = Math.min(255, Math.round(gg * 1.24 + 21));
  const B = Math.min(255, Math.round(b * 1.02 + 8));
  v = a === null ? `rgb(${R},${G},${B})` : `rgba(${R},${G},${B},${a})`;
  SUN_TINT_CACHE.set(c, v);
  return v;
}

/** 包一层 ctx：fillStyle 一律过 sunColor，其余读写/方法原样转发 */
function sunlitCtx(g) {
  const bound = new Map();
  return new Proxy(g, {
    get(t, p) {
      const v = t[p];
      if (typeof v !== 'function') return v;
      let f = bound.get(p);
      if (!f) {
        f = v.bind(t);
        bound.set(p, f);
      }
      return f;
    },
    set(t, p, v) {
      t[p] = p === 'fillStyle' && typeof v === 'string' ? sunColor(v) : v;
      return true;
    },
  });
}

/* 机身侧影（像素坐标，机头在 -x）：逐行 [xl, xr]，行号从 HULL_Y0 起 */
const HULL_Y0 = -18;
const HULL_ROWS = rowScan(
  [[-18, -17], [-13, -28], [-6, -34], [3, -36], [9, -33], [14, -29], [17, -22], [19, -13]],
  [[-18, 16], [-12, 30], [-8, 34], [0, 36], [7, 35], [13, 28], [17, 20], [19, 7]],
  HULL_Y0, 19
);

/* 风挡玻璃区（含上下帽的框行） */
const GLASS_Y0 = -17;
const GLASS_ROWS = rowScan(
  [[-16, -19], [-12, -29], [-5, -34], [3, -32], [8, -21]],
  [[-16, -19], [-14, -5], [-2, -3], [8, -8]],
  GLASS_Y0, 9
);

/* 垂尾 */
const FIN_Y0 = -31;
const FIN_ROWS = rowScan([[-31, 88], [-1, 67]], [[-29, 97], [-1, 84]], FIN_Y0, -1);

/* ------------------------------------------------------------------ *
 * 机组人员
 *
 * 画在直升机的**局部像素**里（1 单位 = 1 屏幕像素，跟着机体一起镜像），
 * 整个人是 fillRect 方块拼的，跟 drawCharacter 同一套读法：
 * 靴子 / 作战裤 / 战术背心（弹匣袋、肩带）/ 台阶斜置的卡宾枪 /
 * 方块脸 + 台阶收顶的头盔（盔沿、夜视仪座、耳罩）。
 * 只有伸出去抓人的那条手臂是 pxLine 的像素折线 —— 它要跟着目标走。
 * ------------------------------------------------------------------ */

const CREW = {
  helm: '#5c6450',
  helmHi: '#828c6d',
  helmDark: '#31362a',
  vest: '#414936',
  vestHi: '#5b6449',
  vestDark: '#262b1d',
  sleeve: '#4f5742',
  pant: '#3b4232',
  pantD: '#2d3327',
  boot: '#1d211a',
  glove: '#2a2e22',
  skin: '#c79a76',
  skinD: '#8f6a4e',
  gun: '#191d1b',
  gunHi: '#3d443e',
};

const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 一名机组人员。(x, y) 是髋部（局部像素），+x 是机尾/舱门更外的那一侧。
 *
 * o = {
 *   t,                      // 秒，用来做机身颠簸
 *   pose: 'sit' | 'stand',  // 坐在舱门槛上（腿垂在外面）/ 站在舱内
 *   reach: 0..1,            // 近侧那条手臂往 aim 伸出去多少
 *   aim: {x, y},            // 伸手的目标（局部像素）
 *   gun: true,              // 挎着卡宾枪
 *   seed,
 * }
 */
export function drawCrew(g, x, y, o = {}) {
  const t = o.t || 0;
  const seed = o.seed || 0;
  const sit = o.pose === 'sit';
  const reach = c01(o.reach || 0);
  /* 悬停中的机身一直在抖，人跟着抖 —— 抖动量化到**整像素**的跳变。
     亚像素的平滑浮动是"贴图在飘"，一格一格地颠才是机身在震。 */
  const bob = qz(Math.sin(t * 2.1 + seed) * 0.9 + Math.sin(t * 9.7 + seed * 2) * 0.3, 1);
  const lean = Math.round(reach * 4); // 伸手时整个人往舱外探

  g.save();
  g.translate(x + lean, y + bob);

  /* --- 远侧手臂：先画，会被躯干压住一半 --- */
  g.fillStyle = CREW.pantD;
  g.fillRect(-6, -12, 2, 6);
  g.fillRect(-7, -7, 2, 5);

  /* --- 腿 --- */
  if (sit) {
    // 坐在门槛上：大腿朝舱外伸，小腿垂在机外
    g.fillStyle = CREW.pant;
    g.fillRect(-4, -3, 10, 5);
    g.fillStyle = '#464e3b';
    g.fillRect(-4, -3, 10, 2);
    g.fillStyle = CREW.pantD;
    g.fillRect(2, 2, 3, 8);
    g.fillStyle = CREW.pant;
    g.fillRect(4, 3, 3, 9);
    g.fillStyle = CREW.boot;
    g.fillRect(2, 9, 4, 3);
    g.fillRect(4, 11, 5, 3);
    g.fillStyle = '#0f120d';
    g.fillRect(4, 13, 5, 1);
  } else {
    g.fillStyle = CREW.pantD;
    g.fillRect(-4, -3, 3, 11);
    g.fillStyle = CREW.pant;
    g.fillRect(1, -3, 3, 11);
    g.fillStyle = CREW.boot;
    g.fillRect(-5, 8, 5, 3);
    g.fillRect(0, 8, 5, 3);
  }

  /* --- 躯干：作战服在里，战术背心叠在外 --- */
  g.fillStyle = CREW.sleeve;
  g.fillRect(-5, -14, 11, 13);
  g.fillStyle = CREW.vest;
  g.fillRect(-4, -13, 9, 11);
  g.fillStyle = CREW.vestHi;
  g.fillRect(-4, -13, 9, 2);
  // 弹匣袋：三个方块 + 1px 受光行，一眼能读出"这是战术背心"
  for (let i = 0; i < 3; i++) {
    g.fillStyle = CREW.vestDark;
    g.fillRect(-4 + i * 3, -9, 2, 4);
    g.fillStyle = '#7b846c';
    g.fillRect(-4 + i * 3, -9, 2, 1);
  }
  // 肩带：两条 1px 竖列
  g.fillStyle = CREW.vestDark;
  g.fillRect(-3, -13, 1, 11);
  g.fillRect(2, -13, 1, 11);

  /* --- 挎在胸前的卡宾枪：台阶斜置（2px 一步），不做旋转 --- */
  if (o.gun) {
    g.fillStyle = CREW.gun;
    for (let i = 0; i < 6; i++) g.fillRect(-6 + i * 2, -4 - i, 2, 2);
    g.fillRect(-7, -4, 3, 3); // 枪托
    g.fillRect(-1, -5, 2, 4); // 弹匣
    g.fillStyle = CREW.gunHi;
    for (let i = 0; i < 6; i++) g.fillRect(-6 + i * 2, -4 - i, 2, 1);
    g.fillRect(5, -10, 1, 1); // 准星
  }

  /* --- 头：方块脸 + 台阶收顶的头盔（跟 drawCharacter 的头一个做法） --- */
  g.fillStyle = CREW.skinD;
  g.fillRect(-1, -15, 3, 2); // 脖子
  g.fillStyle = CREW.skin;
  g.fillRect(-1, -19, 4, 5); // 脸
  g.fillStyle = CREW.skinD;
  g.fillRect(-2, -18, 1, 4); // 背光那一列
  g.fillStyle = '#181a14';
  g.fillRect(0, -17, 3, 1); // 眼睛那一道阴影
  g.fillStyle = CREW.helm;
  g.fillRect(-4, -22, 9, 4); // 盔体
  g.fillRect(-3, -23, 7, 1); // 台阶收顶
  g.fillRect(-2, -24, 5, 1);
  g.fillStyle = CREW.helmHi;
  g.fillRect(-2, -23, 4, 1);
  g.fillRect(-1, -24, 3, 1);
  g.fillStyle = CREW.helmDark;
  g.fillRect(-4, -19, 9, 1); // 盔沿
  g.fillRect(1, -25, 2, 3); // 夜视仪座
  g.fillStyle = CREW.helmHi;
  g.fillRect(1, -25, 2, 1);
  g.fillStyle = CREW.helmDark;
  g.fillRect(-5, -20, 3, 4); // 耳罩
  g.fillRect(-2, -15, 3, 1); // 下巴带
  g.fillRect(0, -14, 2, 1);

  /* --- 近侧手臂：伸手抓人的就是这一条，画在最上面 --- *
   * aim 是**相对 (x, y) 原点**的目标，而整个人已经被 lean/bob 挪过了，
   * 所以这里要把那两个偏移减掉，reach=1 时手套才正好落在目标上（拉人那段
   * 靠这个跟玩家的手腕对齐；身体照样跟着机身抖，只有手是钉住的）。 */
  const aim = o.aim || { x: 7, y: 3 };
  const rx = 5 + (aim.x - lean - 5) * reach;
  const ry = -4 + (aim.y - bob + 4) * reach;
  const ex = Math.round(2 + (rx - 2) * 0.55 + (1 - reach) * 2);
  const ey = Math.round(-12 + (ry + 12) * 0.45 + (1 - reach) * 3);
  const hx2 = Math.round(rx);
  const hy2 = Math.round(ry);
  pxLine(g, 4, -12, ex, ey, CREW.sleeve, 2); // 上臂（袖）
  /* 小臂用肤色（袖子挽起来）。整条都画成橄榄绿的话，它跟垂在门外的小腿
     一模一样，"伸手去抓"就读成了"又一条腿"。 */
  pxLine(g, ex, ey, hx2, hy2, CREW.skinD, 2);
  pxLine(g, ex, ey - 1, hx2, hy2 - 1, CREW.skin, 1);
  // 手套：方块 + 1px 受光行
  g.fillStyle = CREW.glove;
  g.fillRect(hx2 - 2, hy2 - 2, 4, 4);
  g.fillStyle = '#707c68';
  g.fillRect(hx2 - 2, hy2 - 2, 4, 1);

  // 肩上的红色识别灯：一闪一闪，暗处能看出舱里确实有人
  if (Math.sin(t * 3.4 + seed * 3) > 0.55) {
    g.fillStyle = '#ff5a46';
    g.fillRect(-5, -13, 2, 2);
  }

  g.restore();
  return { x: x + lean + rx, y: y + bob + ry };
}

/**
 * t 用来转桨与闪航行灯。基础朝向是机头在 -x、尾梁在 +x，所以
 * dir=-1 画出来是**机头朝右**（天台段落用的朝向），dir=1 机头朝左。
 *
 * o 里跟"拉人进舱"那段过场有关的几个：
 *   reach    0..1  舱门口那名士兵探身伸手的程度
 *   grabTo   {x,y} 手要伸到哪（**画布坐标**，内部换算成机体局部单位）
 *   doorShut 0..1  舱门滑回来封住舱口
 *   inCabin  fn(g) 在"舱内背景 + 站姿士兵"之后、"门口士兵 + 舱门"之前回调一次。
 *                  玩家精灵挂在这里，才会被舱内的黑压住、又被接应的士兵和
 *                  滑上来的舱门盖住 —— 直接画在世界层的话它永远在机身背后。
 *                  回调里已经把机体的缩放/镜像还原掉了，用画布坐标画即可。
 */
export function drawHeli(g, x, y, t, o = {}) {
  const sc = o.scale === undefined ? 1 : o.scale;
  const dir = o.dir === undefined ? -1 : o.dir;
  // 白天（营地）：所有颜色过一遍暖色抬升，机体跟晨光里的道具同一档亮度
  if (o.sun) g = sunlitCtx(g);
  const X = Math.round(x);
  const Y = Math.round(y);
  g.save();
  g.translate(X, Y);
  if (sc !== 1) g.scale(sc, sc);
  g.scale(dir, 1); // 只镜像，不缩放 —— 整数矩形镜像后还在像素格上

  /* --- 尾梁：逐列扫描的锥管，上缘 2px 受光、下缘 2px 压暗 --- */
  for (let bx = 14; bx <= 82; bx++) {
    const f = (bx - 14) / 68;
    const yT = Math.round(-9 + 3 * f);
    const yB = Math.round(11 - 8 * f);
    g.fillStyle = HP.low;
    g.fillRect(bx, yT, 1, yB - yT);
    g.fillStyle = HP.hi;
    g.fillRect(bx, yT, 1, 2);
    g.fillStyle = HP.belly;
    g.fillRect(bx, yB - 2, 1, 2);
  }
  // 尾梁加强环：整数格上的暗色竖条
  g.fillStyle = HP.seam;
  for (let i = 0; i < 5; i++) {
    const bx = 30 + i * 10;
    const f = (bx - 14) / 68;
    const yT = Math.round(-9 + 3 * f);
    const yB = Math.round(11 - 8 * f);
    g.fillRect(bx, yT, 2, yB - yT);
  }
  // 平尾：台阶斜置的薄板
  for (let i = 0; i < 5; i++) {
    g.fillStyle = HP.low;
    g.fillRect(58 + i * 4, -2 - i, 5, 2);
    g.fillStyle = HP.hi;
    g.fillRect(58 + i * 4, -3 - i, 5, 1);
  }
  // 垂尾：逐行扫描 + 前缘 2px 亮带
  for (let i = 0; i < FIN_ROWS.length; i++) {
    const yy = FIN_Y0 + i;
    const [xl, xr] = FIN_ROWS[i];
    if (xr <= xl) continue;
    g.fillStyle = HP.low;
    g.fillRect(xl, yy, xr - xl, 1);
    g.fillStyle = HP.mid;
    g.fillRect(xl, yy, Math.min(2, xr - xl), 1);
  }
  /* 尾桨：桨位量化到 1/8 圈，像素直线在格点间跳；残影是上一格的半透明像素线 */
  const TSTEP = Math.PI / 4;
  const ta = Math.floor((t * 40) / TSTEP) * TSTEP;
  for (let i = 0; i < 2; i++) {
    for (let gh = 1; gh >= 0; gh--) {
      const a = ta + i * 1.57 - gh * TSTEP;
      const bc = Math.cos(a) * 13;
      const bs = Math.sin(a) * 13;
      pxLine(g, 88 - bc, -18 - bs, 88 + bc, -18 + bs, gh ? 'rgba(198,208,212,0.25)' : '#cdd8da', 1);
    }
  }
  // 尾桨毂
  g.fillStyle = HP.steelD;
  g.fillRect(85, -21, 6, 6);
  g.fillStyle = HP.steel;
  g.fillRect(86, -20, 4, 4);
  // 尾桨护环：行扫 + 列扫的像素圆（两遍才不会在圆顶/圆底漏格）
  for (let yy = -16; yy <= 16; yy++) {
    const xw = Math.round(Math.sqrt(16 * 16 - yy * yy));
    g.fillStyle = yy < -8 ? HP.steel : HP.steelD;
    g.fillRect(88 - xw, -18 + yy, 1, 1);
    g.fillRect(88 + xw, -18 + yy, 1, 1);
  }
  for (let xx = -16; xx <= 16; xx++) {
    const yw = Math.round(Math.sqrt(16 * 16 - xx * xx));
    g.fillStyle = HP.steelD;
    g.fillRect(88 + xx, -18 - yw, 1, 1);
    g.fillRect(88 + xx, -18 + yw, 1, 1);
  }

  /* --- 机身：逐行扫描的像素侧影 ---
     每行 [xl, xr] 来自 HULL_ROWS；按高度分带平涂，交界行棋盘抖动。 */
  const hulln = HULL_ROWS.length;
  for (let i = 0; i < hulln; i++) {
    const yy = HULL_Y0 + i;
    const [xl, xr] = HULL_ROWS[i];
    g.fillStyle = yy < -13 ? HP.hi : yy < -4 ? HP.mid : yy < 7 ? HP.low : HP.belly;
    g.fillRect(xl, yy, xr - xl, 1);
  }
  for (const [yy, c] of [[-13, HP.hi], [-4, HP.mid], [7, HP.low]]) {
    const [xl, xr] = HULL_ROWS[yy - HULL_Y0];
    pxDither(g, xl, xr, yy, c);
  }
  // 机背最亮的一道脊线
  g.fillStyle = '#68726a';
  g.fillRect(-15, -17, 30, 1);
  // 机头下颌：最暗的一块，交界是 1px 的锯齿列
  for (let yy = 8; yy <= 19; yy++) {
    const [xl, xr] = HULL_ROWS[yy - HULL_Y0];
    const xe = Math.min(-10 + (yy & 1), xr);
    if (xe > xl) {
      g.fillStyle = HP.chin;
      g.fillRect(xl, yy, xe - xl, 1);
    }
  }
  // 蒙皮拼缝与铆钉
  g.fillStyle = HP.seam;
  g.fillRect(0, -17, 1, 27);
  g.fillRect(29, -9, 1, 21);
  g.fillStyle = '#2e3632';
  for (let i = 0; i < 8; i++) g.fillRect(-14 + i * 4, -16, 1, 1);
  for (let i = 0; i < 6; i++) g.fillRect(-10 + i * 4, 13, 1, 1);
  // 机头天线
  g.fillStyle = '#5a635c';
  g.fillRect(-26, -19, 1, 6);
  g.fillStyle = '#96a09a';
  g.fillRect(-26, -19, 1, 1);

  /* --- 发动机舱与排气 --- */
  g.fillStyle = HP.mid;
  g.fillRect(-10, -24, 31, 7);
  g.fillStyle = HP.hi;
  g.fillRect(-10, -24, 31, 2);
  pxDither(g, -10, 21, -22, HP.hi);
  g.fillStyle = HP.seam; // 进气格栅
  for (let i = 0; i < 5; i++) g.fillRect(-6 + i * 5, -22, 2, 4);
  // 排气口：两档平涂的余烬色块
  g.fillStyle = '#141614';
  g.fillRect(22, -22, 5, 4);
  g.fillStyle = '#8a4630';
  g.fillRect(23, -21, 3, 2);
  g.fillStyle = '#c97a4a';
  g.fillRect(24, -21, 1, 1);

  /* --- 风挡：逐行扫描的玻璃 + 1px 窗框 + 台阶斜带反光 --- */
  for (let i = 0; i < GLASS_ROWS.length; i++) {
    const [xl, xr] = GLASS_ROWS[i];
    if (xr <= xl) continue;
    g.fillStyle = '#0e181d';
    g.fillRect(xl, GLASS_Y0 + i, xr - xl, 1);
  }
  // 飞行员剪影 + 目镜 + 仪表绿光
  g.fillStyle = '#0a0f11';
  g.fillRect(-21, -9, 8, 13);
  g.fillRect(-20, -13, 6, 5);
  g.fillStyle = '#1d2a30';
  g.fillRect(-20, -11, 3, 2);
  g.fillStyle = 'rgba(120,220,160,0.5)';
  g.fillRect(-28, -2, 5, 2);
  g.fillStyle = '#9fe6b8';
  g.fillRect(-27, -2, 1, 1);
  // 中央窗框柱
  g.fillStyle = '#454f4a';
  g.fillRect(-13, -14, 2, 22);
  // 玻璃反光：两条台阶斜带（2px 一步），硬边
  g.fillStyle = 'rgba(150,198,214,0.30)';
  for (let i = 0; i < 8; i++) g.fillRect(-31 + i * 2, 2 - i * 2, 2, 4);
  g.fillStyle = 'rgba(150,198,214,0.16)';
  for (let i = 0; i < 6; i++) g.fillRect(-24 + i * 2, 4 - i * 2, 1, 3);

  /* --- 敞开的侧舱门 + 探身的机组 ---
     门洞是 CABIN 的像素化（x 3..25、y -11..11，门槛行对齐 heliSillAt）。 */
  const doorShut = c01(o.doorShut || 0);
  g.fillStyle = '#060a0b';
  g.fillRect(3, -11, 22, 22);
  // 舱内顶灯：三档硬边色带 + 交界抖动行
  g.fillStyle = 'rgba(210,198,158,0.30)';
  g.fillRect(4, -11, 20, 6);
  g.fillStyle = 'rgba(178,172,140,0.12)';
  g.fillRect(4, -5, 20, 6);
  pxDither(g, 4, 24, -5, 'rgba(210,198,158,0.30)');
  pxDither(g, 4, 24, 1, 'rgba(178,172,140,0.12)');
  // 舱内地板反光
  g.fillStyle = 'rgba(148,168,158,0.16)';
  g.fillRect(4, 7, 20, 3);
  // 舱壁固定件
  g.fillStyle = 'rgba(16,22,20,0.7)';
  g.fillRect(4, -9, 3, 6);
  g.fillRect(21, -8, 3, 9);
  // 门框：上沿受光、门槛最亮（人踩上去那条边）
  g.fillStyle = '#5e6963';
  g.fillRect(3, -12, 22, 1);
  g.fillStyle = '#49524d';
  g.fillRect(2, -11, 1, 22);
  g.fillRect(25, -11, 1, 22);
  g.fillStyle = '#7b857f';
  g.fillRect(3, 10, 22, 1);

  /* 机组两名：里面那个站着待命，门口那个坐在门槛上接应。
     drawCrew 画在机体局部像素里，跟着 dir 一起镜像。 */
  drawCrew(g, 8, -1, { t, pose: 'stand', gun: true, seed: 1.7, aim: { x: 6, y: -7 }, reach: 0.55 });

  /* 玩家：夹在两名机组之间。见函数头的 inCabin 说明 */
  if (o.inCabin) {
    g.save();
    g.scale(dir / sc, 1 / sc);
    g.translate(-X, -Y);
    o.inCabin(g);
    g.restore();
  }

  /* 门口那名：手要伸到 grabTo（画布坐标）。局部像素 = (画布 - 机心) / 缩放，
     x 还要再除一次 dir，因为机体是镜像画的。 */
  const gsit = { x: 19, y: 5 };
  let gaim = { x: 9, y: 10 };
  if (o.grabTo) {
    gaim = {
      x: (o.grabTo.x - X) / (sc * dir) - gsit.x,
      y: (o.grabTo.y - Y) / sc - gsit.y,
    };
  }
  drawCrew(g, gsit.x, gsit.y, {
    t, pose: 'sit', gun: false, seed: 4.1,
    reach: o.reach === undefined ? 0.26 : c01(o.reach),
    aim: gaim,
  });

  // 滑轨上的门板：先画关上的整块，再画前缘立柱；全部整数格
  const dx0 = Math.round(25 - doorShut * 22);
  if (doorShut > 0.02) {
    const dw = 26 - (dx0 + 5);
    if (dw > 0) {
      g.fillStyle = '#3c4540';
      g.fillRect(dx0 + 5, -11, dw, 22);
      g.fillStyle = '#57615b';
      g.fillRect(dx0 + 5, -11, dw, 2);
      pxDither(g, dx0 + 5, dx0 + 5 + dw, -9, '#57615b');
      // 方形小舷窗
      g.fillStyle = '#22282a';
      g.fillRect(dx0 + 7, -6, 8, 7);
      g.fillStyle = '#31424a';
      g.fillRect(dx0 + 8, -5, 6, 5);
      g.fillStyle = 'rgba(150,190,200,0.35)';
      g.fillRect(dx0 + 8, -5, 2, 5);
    }
  }
  g.fillStyle = '#4c5651';
  g.fillRect(dx0, -12, 6, 24);
  g.fillStyle = '#666f6a';
  g.fillRect(dx0 + 1, -11, 4, 2);

  /* --- 绞盘吊臂：像素折线的吊臂 + 方块套方块的滑轮组 --- */
  pxLine(g, 8, -13, 21, -16, HP.steelD, 2);
  g.fillStyle = HP.steelD;
  g.fillRect(4, -18, 8, 7);
  g.fillStyle = HP.steel;
  g.fillRect(5, -17, 6, 5);
  g.fillStyle = HP.steelD;
  g.fillRect(5, -14, 6, 2);
  g.fillStyle = '#5a6560';
  g.fillRect(19, -20, 8, 8);
  g.fillStyle = '#7f8a84';
  g.fillRect(20, -19, 6, 6);
  g.fillStyle = HP.steelD;
  g.fillRect(22, -17, 2, 2);

  /* --- 起落滑橇：支柱是像素斜线，横杆是整数条，前端台阶上翘 ---
     支柱用钢件暗色而不是近黑 —— 近黑的斜线贴在亮地皮上读起来像描边 */
  for (const [sx0, sx1] of [[-17, -21], [16, 20], [-17, -9], [16, 9]]) {
    pxLine(g, sx0, 13, sx1, 25, '#2f3833', 2);
  }
  g.fillStyle = '#454f4a';
  g.fillRect(-30, 25, 60, 3);
  g.fillStyle = '#5a6358';
  g.fillRect(-29, 25, 58, 1);
  for (let i = 1; i <= 4; i++) {
    g.fillStyle = '#3a423e';
    g.fillRect(-30 - i, 25 - i, 3, 3);
  }
  g.fillStyle = '#454f4a';
  g.fillRect(-33, 21, 2, 2);

  /* --- 机腹探照灯：方形灯罩 + 方形灯口，灯口位置仍对齐 heliLampAt --- */
  g.fillStyle = HP.steelD;
  g.fillRect(-32, 8, 13, 10);
  g.fillStyle = HP.steelD;
  g.fillRect(-31, 9, 11, 8);
  g.fillStyle = HP.steel;
  g.fillRect(-31, 9, 11, 2);
  g.fillStyle = '#dfeef4';
  g.fillRect(-29, 13, 8, 4);
  g.fillStyle = '#9fb6ba';
  g.fillRect(-29, 13, 8, 1);

  /* --- 机身编号：手拼的像素字 L7（字体在 4px 下会糊，像素字不会） --- */
  g.save();
  g.scale(dir, 1); // 字不跟着机身镜像
  const bx0 = dir < 0 ? -49 : 39;
  g.fillStyle = '#96a09a';
  g.fillRect(bx0, -3, 1, 5);
  g.fillRect(bx0 + 1, 1, 3, 1);
  g.fillRect(bx0 + 6, -3, 4, 1);
  g.fillRect(bx0 + 9, -2, 1, 1);
  g.fillRect(bx0 + 8, -1, 1, 1);
  g.fillRect(bx0 + 7, 0, 1, 2);
  g.restore();

  /* --- 主旋翼：桨位量化到 1/10 圈，在格点间跳；每片桨是 2px 的像素直线，
     拖两份分档递暗的像素残影 —— 扫掠感全靠离散的残影段。 --- */
  const mastX = -1;
  const mastY = -28;
  g.fillStyle = HP.steelD;
  g.fillRect(mastX - 3, -26, 8, 4);
  const RSTEP = Math.PI / 5;
  const ra = Math.floor((t * 26) / RSTEP) * RSTEP;
  for (let gh = 2; gh >= 0; gh--) {
    const col = gh === 0 ? '#d9e3e5' : gh === 1 ? 'rgba(206,218,222,0.30)' : 'rgba(198,210,214,0.14)';
    for (let i = 0; i < 4; i++) {
      const a = ra + (i * Math.PI) / 2 - gh * RSTEP;
      pxLine(g, mastX, mastY, mastX + Math.cos(a) * 76, mastY + Math.sin(a) * 11, col, gh === 0 ? 2 : 1);
    }
  }
  // 桨毂盖在桨根上
  g.fillStyle = HP.steel;
  g.fillRect(mastX - 4, mastY - 3, 10, 6);
  g.fillStyle = HP.steel;
  g.fillRect(mastX - 3, mastY - 2, 8, 4);
  g.fillStyle = '#aab5b2';
  g.fillRect(mastX - 1, mastY - 2, 3, 1);

  g.restore();

  // 航行灯：红绿交替闪 + 机背的防撞频闪。辉光是三档同心方块的平涂。
  const blink = Math.sin(t * 7) > 0;
  const strobe = Math.sin(t * 11) > 0.86;
  const lamps = [
    [X - 35 * sc * dir, Y + 4 * sc, '255,70,60', blink ? 0.85 : 0.12, 13],
    [X + 92 * sc * dir, Y - 27 * sc, '120,255,140', blink ? 0.12 : 0.85, 13],
    [X - 1 * sc * dir, Y - 25 * sc, '255,250,235', strobe ? 0.9 : 0.05, 19],
  ];
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [lx, ly, rgb, k, rr] of lamps) {
    if (k < 0.06) continue;
    const r = rr * sc * 0.6;
    for (const [f, a] of [[1, 0.09], [0.5, 0.2], [0.18, 0.8]]) {
      const q = Math.max(1, Math.round(r * f));
      g.fillStyle = `rgba(${rgb},${(k * a).toFixed(3)})`;
      g.fillRect(Math.round(lx) - q, Math.round(ly) - q, q * 2, q * 2);
    }
  }
  g.restore();
}

/**
 * 直升机的探照灯锥：逐段扫描带拼出来的硬边锥 —— 每 3px 一条横带，
 * 带内是三档嵌套的平涂矩形，隔带明暗交替（扫描线的读法）。
 * 亮度量化到 5 档，闪烁是跳变而不是呼吸。低饱和、无渐变。
 */
export function drawHeliBeam(g, x, y, tx, ty, w, k) {
  const kq = qz(c01(k), 1 / 5);
  if (kq <= 0.01) return;
  const Y0 = Math.round(y);
  const Y1 = Math.round(ty);
  const H = Y1 - Y0;
  if (H < 8) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const STEP = 3;
  for (let yy = 0; yy < H; yy += STEP) {
    const f = yy / H;
    const cx = x + (tx - x) * f;
    const hw = 2.5 + (w - 2.5) * f;
    const bh = Math.min(STEP, H - yy);
    const band = (yy / STEP) & 1 ? 1.25 : 0.8; // 硬扫描带的明暗交替
    for (const [fw, a] of [[1, 0.045], [0.6, 0.065], [0.28, 0.1]]) {
      const q = Math.max(1, Math.round(hw * fw));
      g.fillStyle = `rgba(188,200,204,${(a * kq * band).toFixed(3)})`;
      g.fillRect(Math.round(cx - q), Y0 + yy, q * 2, bh);
    }
  }
  // 灯口的亮块
  g.fillStyle = `rgba(220,234,240,${(0.5 * kq).toFixed(3)})`;
  g.fillRect(Math.round(x) - 2, Y0 - 1, 4, 3);
  // 地面光斑：三档同心的扁矩形台阶
  const R = Math.round(w * 0.6);
  for (const [fr, a] of [[1, 0.05], [0.62, 0.07], [0.3, 0.09]]) {
    const q = Math.max(2, Math.round(R * fr));
    g.fillStyle = `rgba(196,208,206,${(a * kq).toFixed(3)})`;
    g.fillRect(Math.round(tx) - q, Y1 - Math.round(q * 0.45), q * 2, Math.max(2, Math.round(q * 0.9)));
  }
  g.restore();
}

/**
 * 垂下的绳索：逐像素往下铺的 4px 宽像素绳 —— 1px 暗色包边 + 两股
 * 隔两行交错的亮暗芯，读出"搓出来的麻绳"；末端是行扫的像素圆套环。
 * 摆动相位按 7fps 定格、横向偏移量化到整像素：一格一格地甩，
 * 不是平滑的正弦蠕动。
 */
export function drawRope(g, x0, y0, x1, y1, t, sway = 1, loop = true) {
  const tq = tick(t, 7); // 摆动定格
  const X0 = Math.round(x0);
  const Y0 = Math.round(y0);
  const X1 = Math.round(x1);
  const Y1 = Math.round(y1);
  const n = Math.max(Math.abs(Y1 - Y0), Math.abs(X1 - X0), 1);
  let ly = null;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const swx = qz(Math.sin(tq * 2.3 + k * 3.2) * 5 * sway * Math.sin(k * Math.PI), 1);
    const xx = Math.round(X0 + (X1 - X0) * k + swx);
    const yy = Math.round(Y0 + (Y1 - Y0) * k);
    if (yy === ly) continue; // 每行只铺一次
    ly = yy;
    g.fillStyle = '#241f15';
    g.fillRect(xx - 2, yy, 4, 1);
    const st = (yy >> 1) & 1; // 两股交错
    g.fillStyle = st ? '#93875f' : '#6d6448';
    g.fillRect(xx - 1, yy, 2, 1);
    g.fillStyle = st ? '#b3a375' : '#93875f';
    g.fillRect(xx - 1 + st, yy, 1, 1);
  }
  // 末端救援套环。人抓住绳子之后不画：那时末端就在他手里，再挂一个圈很怪
  if (loop) {
    const rx = 7;
    const ry = 8;
    const cy = Y1 + 6;
    for (let yy = -ry; yy <= ry; yy++) {
      const xw = Math.round(rx * Math.sqrt(Math.max(0, 1 - (yy / ry) * (yy / ry))));
      for (const sx of [X1 - xw, X1 + xw]) {
        g.fillStyle = '#241f15';
        g.fillRect(sx - 1, cy + yy, 3, 1);
        g.fillStyle = (cy + yy) & 2 ? '#a99b78' : '#7d7355';
        g.fillRect(sx, cy + yy, 1, 1);
      }
    }
    // 顶部锁扣
    g.fillStyle = '#39413d';
    g.fillRect(X1 - 2, cy - ry - 3, 4, 5);
    g.fillStyle = '#8f9a93';
    g.fillRect(X1 - 1, cy - ry - 3, 2, 2);
  }
}

/* ------------------------------------------------------------------ *
 * HUD 图标
 * ------------------------------------------------------------------ */

export function drawPistolIcon(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  const s = w / 48;
  g.scale(s, s);
  g.fillStyle = '#2c3439';
  g.fillRect(-16, -6, 28, 8);
  g.fillStyle = '#47535a';
  g.fillRect(-16, -6, 28, 2);
  g.fillStyle = '#1b2124';
  g.fillRect(-16, 2, 8, 12);
  g.fillStyle = '#232a2e';
  g.fillRect(-8, 2, 12, 3);
  g.fillStyle = '#5c686e';
  g.fillRect(8, -8, 3, 3);
  g.fillStyle = '#151a1d';
  g.fillRect(12, -5, 4, 5);
  g.restore();
}

/* ------------------------------------------------------------------ *
 * 背包立绘（正面全身）
 * ------------------------------------------------------------------ */

/** 手部在 120x200 设计空间中的位置，供 UI 定位左右手格子 */
export const PORTRAIT_HANDS = { left: { x: 38, y: 139 }, right: { x: 82, y: 139 }, w: 120, h: 200 };

export function drawPortrait(g, W, H, o = {}) {
  g.clearRect(0, 0, W, H);
  const s = Math.min(W / 120, H / 200);
  g.save();
  g.translate((W - 120 * s) / 2, (H - 200 * s) / 2);
  g.scale(s, s);

  // 服装与外貌：不传 = 序章白大褂 + 默认长相，跟旧版逐像素一致
  const fit = o.outfit || OUTFITS.lab;
  const lk = o.look || DEFAULT_LOOK;
  const isLab = !o.outfit || o.outfit === OUTFITS.lab;
  const skin = lk.skin || PAL.skin;
  const skinD = shade(skin, -0.24);
  const hairCol = lk.hairCol || PAL.hair;
  const hairStyle = lk.hair || 'messy';

  // 背景：一块纯色，不加网格和光斑
  g.fillStyle = '#1b1b20';
  g.fillRect(0, 0, 120, 200);
  // 地面阴影：两档像素椭圆
  pxEllipse(g, 60, 192, 30, 6, 'rgba(0,0,0,0.3)');
  pxEllipse(g, 60, 192, 20, 4, 'rgba(0,0,0,0.35)');

  const R = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };

  // 腿
  R(47, 130, 11, 54, fit.pants);
  R(62, 130, 11, 54, fit.pants);
  R(47, 130, 3, 54, fit.pantsD);
  R(62, 130, 3, 54, fit.pantsD);
  R(55, 130, 3, 54, 'rgba(0,0,0,0.18)');
  R(70, 130, 3, 54, 'rgba(0,0,0,0.18)');
  // 鞋
  R(44, 183, 15, 9, fit.shoe);
  R(61, 183, 15, 9, fit.shoe);
  R(44, 183, 15, 2, shade(fit.shoe, 0.22));
  R(44, 190, 15, 2, shade(fit.shoe, -0.4));
  R(61, 190, 15, 2, shade(fit.shoe, -0.4));

  // 上衣主体
  R(40, 62, 40, 80, fit.coat);
  // 下摆（略微展开）：逐行扫描的斜边台阶
  pxPoly(g, [
    [40, 120],
    [80, 120],
    [83, 144],
    [37, 144],
  ], fit.coat);
  // 侧面阴影
  R(72, 62, 11, 82, fit.shade);
  R(37, 62, 4, 82, 'rgba(0,0,0,0.12)');

  // 内衬 + 领口
  pxPoly(g, [
    [52, 60],
    [68, 60],
    [60, 86],
  ], isLab ? '#39464d' : fit.lining);
  // 衣襟
  pxPoly(g, [
    [40, 62],
    [58, 62],
    [61, 90],
    [58, 144],
    [37, 144],
    [40, 120],
  ], fit.coat);
  pxPolyline(g, [
    [58, 62],
    [61, 90],
    [59, 144],
  ], fit.dark, 1);

  if (isLab) {
    // 领子（白大褂翻领）
    pxPoly(g, [
      [50, 58],
      [60, 74],
      [56, 58],
    ], '#e2e8ea');
    pxPoly(g, [
      [70, 58],
      [60, 74],
      [64, 58],
    ], '#e2e8ea');
    // 纽扣
    g.fillStyle = fit.dark;
    for (let i = 0; i < 4; i++) g.fillRect(62, 96 + i * 11, 2, 2);

    // 口袋 + 笔（1px 描边用四条 fillRect 拼）
    R(43, 100, 13, 14, 'rgba(0,0,0,0.10)');
    g.fillStyle = fit.dark;
    g.fillRect(43, 100, 13, 1);
    g.fillRect(43, 113, 13, 1);
    g.fillRect(43, 100, 1, 14);
    g.fillRect(55, 100, 1, 14);
    R(46, 96, 2, 9, '#3f6f8a');
    R(50, 96, 2, 9, '#8a3f3f');

    // 工牌
    R(66, 84, 12, 15, '#c8d0d3');
    R(66, 84, 12, 4, '#8e989c');
    R(68, 90, 4, 5, '#4c585e');
    R(73, 90, 4, 1, '#7c868a');
    R(73, 93, 4, 1, '#7c868a');
    pxLine(g, 72, 84, 70, 78, '#6d7679', 1);

    // 污渍 / 血迹：像素摊
    pxBlob(g, 50, 128, 7, 5, 'rgba(74,26,22,0.5)');
    pxBlob(g, 45, 137, 4, 3, 'rgba(74,26,22,0.5)');
    pxBlob(g, 70, 116, 9, 7, 'rgba(60,58,44,0.28)');
  } else {
    // 帆布工装：布翻领 + 按扣 + 两只带盖胸袋，没有工牌也没有血
    pxPoly(g, [
      [50, 58],
      [60, 70],
      [56, 58],
    ], shade(fit.coat, 0.14));
    pxPoly(g, [
      [70, 58],
      [60, 70],
      [64, 58],
    ], shade(fit.coat, 0.14));
    g.fillStyle = fit.dark;
    for (let i = 0; i < 4; i++) g.fillRect(62, 96 + i * 11, 2, 2);
    for (const px of [43, 64]) {
      R(px, 88, 13, 11, 'rgba(0,0,0,0.10)');
      g.fillStyle = fit.dark;
      g.fillRect(px, 88, 13, 1);
      g.fillRect(px, 98, 13, 1);
      g.fillRect(px, 88, 1, 11);
      g.fillRect(px + 12, 88, 1, 11);
      R(px + 5, 87, 3, 3, fit.dark);
    }
    // 下摆缝线
    pxLine(g, 38, 138, 82, 138, 'rgba(0,0,0,0.16)', 1);
  }

  // 手臂
  for (const side of [-1, 1]) {
    const ax = side < 0 ? 33 : 77;
    R(ax, 64, 10, 66, fit.coat);
    R(ax + (side < 0 ? 0 : 7), 64, 3, 66, side < 0 ? 'rgba(0,0,0,0.14)' : fit.shade);
    // 袖口
    R(ax - 1, 124, 11, 5, isLab ? '#b9c2c6' : shade(fit.coat, -0.2));
    // 手
    R(ax + 1, 129, 9, 11, skin);
    R(ax + (side < 0 ? 1 : 7), 129, 3, 11, skinD);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(ax + 1, 138, 9, 1);
  }

  // 肩线
  R(38, 60, 44, 4, shade(fit.coat, 0.16));
  R(38, 60, 44, 1, shade(fit.coat, 0.3));

  // 脖子
  R(55, 50, 10, 12, skin);
  R(55, 50, 10, 12, 'rgba(0,0,0,0)');
  R(55, 56, 10, 6, 'rgba(0,0,0,0.22)');

  // 头
  R(50, 26, 20, 28, skin);
  R(64, 26, 6, 28, skinD);
  R(48, 36, 2, 8, skin); // 耳
  R(70, 36, 2, 8, skinD);
  // 头发：横条堆方块，按发型换轮廓，不用曲线
  drawPortraitHair(g, hairStyle, hairCol, skin);
  // 眉
  R(53, 37, 6, 2, shade(hairCol, -0.3));
  R(62, 37, 6, 2, shade(hairCol, -0.3));
  // 眼
  R(53, 40, 6, 4, '#e6ecec');
  R(62, 40, 6, 4, '#cdd4d4');
  R(55, 40, 3, 3, '#2a3b42');
  R(64, 40, 3, 3, '#22323a');
  R(55, 40, 1, 1, '#dff0f2');
  R(64, 40, 1, 1, '#c9dcdf');
  // 黑眼圈
  g.fillStyle = 'rgba(60,40,40,0.22)';
  g.fillRect(53, 44, 6, 2);
  g.fillRect(62, 44, 6, 2);
  // 鼻 / 嘴
  R(59, 45, 2, 3, PAL.skinD);
  R(56, 50, 8, 2, '#8a5a4c');
  // 额头伤口
  R(52, 32, 5, 1, 'rgba(120,36,30,0.75)');
  R(53, 33, 3, 1, 'rgba(90,26,22,0.6)');
  // 胡茬
  g.fillStyle = 'rgba(50,40,32,0.16)';
  g.fillRect(53, 47, 14, 6);

  // 手中的装备
  if (o.left) drawPortraitItem(g, 38, 141, o.left, o);
  if (o.right) drawPortraitItem(g, 82, 141, o.right, o);

  g.restore();
}

/** 立绘头发：120x200 设计空间，头部矩形 (50,26)-(70,54)，全部横条方块堆 */
function drawPortraitHair(g, style, col, skin) {
  const R = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  if (style === 'bald') {
    R(52, 24, 16, 2, shade(skin, 0.1));
    return;
  }
  if (style === 'buzz') {
    const c = shade(col, -0.28);
    for (const [bx, by, bw, bh] of [
      [54, 20, 12, 2],
      [51, 22, 18, 2],
      [49, 24, 22, 4],
    ]) R(bx, by, bw, bh, c);
    R(48, 28, 2, 6, c);
    R(70, 28, 2, 6, c);
    return;
  }
  if (style === 'short') {
    for (const [bx, by, bw, bh] of [
      [54, 18, 12, 2],
      [51, 20, 18, 2],
      [49, 22, 22, 3],
      [48, 25, 24, 6],
    ]) R(bx, by, bw, bh, col);
    R(48, 31, 3, 6, col);
    R(69, 31, 3, 5, col);
    R(52, 22, 12, 2, shade(col, 0.14));
    return;
  }
  if (style === 'long') {
    for (const [bx, by, bw, bh] of [
      [54, 16, 12, 2],
      [51, 18, 18, 2],
      [49, 20, 22, 3],
      [48, 23, 24, 8],
    ]) R(bx, by, bw, bh, col);
    // 两侧垂到肩
    R(46, 30, 5, 34, col);
    R(69, 30, 5, 34, col);
    R(46, 60, 5, 4, shade(col, -0.2));
    R(69, 60, 5, 4, shade(col, -0.2));
    R(52, 20, 12, 3, shade(col, 0.14));
    return;
  }
  // messy（默认，序章同款轮廓）
  for (const [bx, by, bw, bh] of [
    [54, 16, 12, 2],
    [51, 18, 18, 2],
    [49, 20, 22, 3],
    [48, 23, 24, 8],
    [48, 31, 3, 11],
    [69, 30, 3, 10],
  ]) R(bx, by, bw, bh, col);
  R(52, 20, 12, 3, shade(col, 0.16));
  R(56, 16, 3, 3, col);
  R(64, 17, 2, 3, col);
}

function drawPortraitItem(g, x, y, id, o) {
  g.save();
  g.translate(x, y);
  if (id === 'pistol') {
    g.fillStyle = '#20262a';
    g.fillRect(-4, -2, 8, 14);
    g.fillStyle = '#39434a';
    g.fillRect(-4, -2, 3, 14);
    g.fillStyle = '#171b1e';
    g.fillRect(-4, 4, 8, 5);
    g.fillStyle = '#5c686e';
    g.fillRect(-2, 12, 4, 2);
  } else if (id === 'flashlight') {
    g.fillStyle = '#2f373c';
    g.fillRect(-4, -2, 7, 15);
    g.fillStyle = '#4c565c';
    g.fillRect(-4, -2, 2, 15);
    g.fillStyle = o.flashOn ? '#fff6d8' : '#8d9490';
    g.fillRect(-5, 13, 9, 3);
    if (o.flashOn) {
      // 光锥：逐带展宽的硬边横条，亮度分档递减
      for (let i = 0; i < 5; i++) {
        const yy = 16 + i * 4;
        const hw = 5 + i * 1.4;
        g.fillStyle = `rgba(255,244,206,${(0.5 - i * 0.1).toFixed(2)})`;
        g.fillRect(Math.round(-hw), yy, Math.round(hw * 2), 4);
      }
    }
  }
  g.restore();
}

/* ------------------------------------------------------------------ *
 * 半身立绘（头 + 肩，下缘裁切）——人脸识别摄像头里看到的主角
 * ------------------------------------------------------------------ */

/** 设计空间 76x96；五官坐标同时供扫描界面对齐特征点，改这里两边一起动 */
export const PORTRAIT_BUST = {
  w: 76,
  h: 96,
  head: { x: 23, y: 10, w: 30, h: 40 },
  faceCx: 38,
  chinY: 50,
  browY: 25,
  eyeY: 31,
  eyeDx: 6.5,
  eyeRx: 4.5,
  eyeRy: 3,
  noseTop: 28,
  noseBaseY: 41,
  mouthY: 44,
  mouthRx: 6,
  mouthRy: 2.5,
};

export function drawPortraitBust(g, x, y, s) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);

  const R = (rx, ry, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(rx, ry, w, h);
  };

  // 脖子（先画，肩和头会盖住两端）
  R(32, 44, 12, 18, PAL.skin);
  R(40, 44, 4, 18, PAL.skinD);
  R(32, 44, 12, 5, 'rgba(0,0,0,0.3)');

  // 肩：逐段外扩的横条，最后一段画到设计空间以下由画面裁掉
  const torso = new Path2D();
  for (const [by, bh, bx, bw] of [
    [58, 3, 15, 46],
    [61, 3, 9, 58],
    [64, 4, 1, 74],
    [68, 34, -9, 94],
  ])
    torso.rect(bx, by, bw, bh);
  g.fillStyle = PAL.coat;
  g.fill(torso);

  g.save();
  g.clip(torso);
  R(46, 56, 50, 48, PAL.coatShade);
  R(-10, 56, 22, 48, 'rgba(0,0,0,0.14)');
  R(15, 58, 46, 1.5, '#eef2f3');
  // 衬衫领口
  pxPoly(g, [
    [31, 56],
    [45, 56],
    [38, 78],
  ], '#39464d');
  // 大褂翻领
  pxPoly(g, [
    [27, 56],
    [38, 76],
    [34, 56],
  ], '#e2e8ea');
  pxPoly(g, [
    [49, 56],
    [38, 76],
    [42, 56],
  ], '#e2e8ea');
  pxPolyline(g, [
    [34, 57],
    [38, 77],
    [38, 96],
  ], PAL.coatDark, 1);
  // 血渍
  R(18, 70, 7, 3, 'rgba(74,26,22,0.45)');
  R(20, 73, 4, 2, 'rgba(74,26,22,0.35)');
  R(56, 78, 5, 2, 'rgba(60,58,44,0.3)');
  g.restore();

  // 耳
  R(21, 26, 2, 9, PAL.skin);
  R(53, 26, 2, 9, PAL.skinD);

  // 头：横条堆出圆角轮廓
  const head = new Path2D();
  for (const [by, bh, bx, bw] of [
    [10, 3, 26, 24],
    [13, 3, 24, 28],
    [16, 28, 23, 30],
    [44, 3, 24, 28],
    [47, 3, 27, 22],
  ])
    head.rect(bx, by, bw, bh);
  g.fillStyle = PAL.skin;
  g.fill(head);

  g.save();
  g.clip(head);
  // 受光：右侧一整条暗面
  R(44, 10, 9, 40, PAL.skinD);
  R(51, 10, 2, 40, 'rgba(0,0,0,0.16)');
  R(23, 41, 30, 9, 'rgba(120,80,58,0.12)');
  // 眉
  R(27, 24, 9, 2, '#3a2a1e');
  R(41, 24, 9, 2, '#3a2a1e');
  R(28, 23, 5, 1, '#3a2a1e');
  R(44, 23, 5, 1, '#3a2a1e');
  // 眼
  R(27, 27, 9, 1, 'rgba(70,44,34,0.25)');
  R(27, 28, 9, 6, '#e6ecec');
  R(41, 28, 9, 6, '#cdd4d4');
  R(30, 29, 4, 4, '#2a3b42');
  R(44, 29, 4, 4, '#22323a');
  R(31, 30, 2, 2, '#101a1e');
  R(45, 30, 2, 2, '#0d161a');
  R(30, 29, 1, 1, '#dff0f2');
  R(44, 29, 1, 1, '#c9dcdf');
  R(27, 34, 9, 1, 'rgba(0,0,0,0.22)');
  R(41, 34, 9, 1, 'rgba(0,0,0,0.22)');
  // 黑眼圈
  R(27, 35, 9, 2, 'rgba(60,40,40,0.22)');
  R(41, 35, 9, 2, 'rgba(60,40,40,0.22)');
  // 鼻
  R(39, 28, 2, 11, PAL.skinD);
  R(35, 38, 7, 3, PAL.skin);
  R(39, 38, 3, 3, PAL.skinD);
  R(35, 40, 2, 1, 'rgba(0,0,0,0.3)');
  R(40, 40, 2, 1, 'rgba(0,0,0,0.34)');
  // 嘴
  R(33, 42, 10, 1, 'rgba(0,0,0,0.12)');
  R(32, 43, 12, 2, '#8a5a4c');
  R(33, 45, 10, 1, 'rgba(0,0,0,0.16)');
  // 胡茬
  R(28, 40, 20, 9, 'rgba(50,40,32,0.18)');
  // 额头伤口
  R(27, 20, 7, 2, 'rgba(120,36,30,0.75)');
  R(28, 22, 4, 1, 'rgba(90,26,22,0.6)');
  g.restore();

  // 头发：贴着头顶的横条 + 鬓角 + 乱翘的碎发
  g.fillStyle = PAL.hair;
  for (const [by, bh, bx, bw] of [
    [6, 2, 30, 16],
    [8, 2, 26, 24],
    [10, 3, 24, 28],
    [13, 4, 23, 30],
    [17, 10, 23, 3],
    [17, 10, 50, 3],
  ])
    g.fillRect(bx, by, bw, bh);
  R(30, 6, 12, 2, '#5c452f');
  R(26, 9, 10, 2, '#5c452f');
  // 碎发翘起
  R(28, 4, 3, 2, PAL.hair);
  R(41, 3, 2, 3, PAL.hair);
  R(47, 6, 3, 2, PAL.hair);
  // 刘海：留出额头，只压住发际线一带
  R(24, 17, 5, 3, PAL.hair);
  R(34, 17, 4, 2, PAL.hair);
  R(45, 17, 6, 3, PAL.hair);

  g.restore();
}

export function drawMagIcon(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  const s = w / 48;
  g.scale(s, s);
  g.fillStyle = '#2b3236';
  g.fillRect(-8, -16, 16, 30);
  g.fillStyle = '#3f484d';
  g.fillRect(-8, -16, 4, 30);
  g.fillStyle = '#1a1f22';
  g.fillRect(-8, 12, 16, 4);
  // 观察孔里的子弹
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#d9ab4e';
    g.fillRect(3, -12 + i * 6, 4, 4);
  }
  g.fillStyle = '#c7a24b';
  g.fillRect(-6, -20, 12, 5);
  g.fillStyle = '#e5c877';
  g.fillRect(-6, -20, 12, 2);
  g.restore();
}

export function drawBadgeIcon(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  const s = w / 48;
  g.scale(s, s);
  g.fillStyle = '#5a6469';
  g.fillRect(-3, -20, 6, 5);
  g.fillStyle = '#d7dde0';
  g.fillRect(-13, -15, 26, 30);
  g.fillStyle = '#9aa5aa';
  g.fillRect(-13, -15, 26, 7);
  g.fillStyle = '#48545a';
  g.fillRect(-9, -5, 8, 9);
  pxEllipse(g, -5, -1, 2.6, 2.6, '#8d979b');
  g.fillStyle = '#7b868a';
  for (let i = 0; i < 3; i++) g.fillRect(2, -4 + i * 3, 9, 2);
  g.fillStyle = '#2a3034';
  g.fillRect(-13, 8, 26, 3);
  pxBlob(g, 4, 6, 7, 5, 'rgba(74,26,22,0.7)');
  g.restore();
}

/* ------------------------------------------------------------------ *
 * 主菜单画面：收容舱 · 舱内个体 · 舱外的观察人员
 *
 * 全部程序化生成，跟场景里的道具走同一套等距画法。收容舱拆成"背面"与
 * "正面"两张精灵：个体夹在两者之间画，玻璃才真的挡在它前面。
 * ------------------------------------------------------------------ */

const CH = {
  r: 1.06, // 半径（瓦片）
  base: 0.42, // 底座高（高度单位）
  glass: 3.0, // 玻璃段高：舱里那位要站得下，还得留出头顶的空间
  cap: 0.3, // 顶盖高
};
CH.top = CH.base + CH.glass;
CH.full = CH.top + CH.cap;

const CH_RX = CH.r * HW * Math.SQRT2;
const CH_RY = CH_RX * (HH / HW);

/**
 * 圆柱剪影的行半宽：y 是行坐标，cy 是下底中心。直筒段全宽，
 * 上帽/下帽内按椭圆弧收，帽外返回 0。逐行扫描圆柱全靠它。
 */
function cylRowHW(y, cy, rx, ry, h) {
  let dy = 0;
  if (y < cy - h) dy = cy - h - y;
  else if (y > cy) dy = y - cy;
  if (dy > ry) return 0;
  return rx * Math.sqrt(Math.max(0, 1 - (dy / ry) ** 2));
}

/** 像素圆柱：逐行扫描平涂（rowCol(f) 按 0 顶 1 底给色则出横向分带） */
function pxCylFill(g, cx, cy, rx, ry, h, rowCol) {
  const X = Math.round(cx);
  const y0 = Math.round(cy - h - ry);
  const y1 = Math.round(cy + ry);
  for (let y = y0; y <= y1; y++) {
    const hw = Math.round(cylRowHW(y, cy, rx, ry, h));
    if (!hw) continue;
    g.fillStyle = typeof rowCol === 'function' ? rowCol((y - y0) / (y1 - y0)) : rowCol;
    g.fillRect(X - hw, y, hw * 2, 1);
  }
}

function ellipseFill(g, cx, cy, rx, ry, fill) {
  pxEllipse(g, cx, cy, rx, ry, fill);
}

/** 椭圆的一半：near=true 取靠近镜头的下半。逐列扫描的像素弧，台阶间补竖向缺口 */
function halfArc(g, cx, cy, rx, ry, near, stroke, lw = 1) {
  const X = Math.round(cx);
  const Y = Math.round(cy);
  const RX = Math.round(rx);
  const th = Math.max(1, Math.round(lw));
  g.fillStyle = stroke;
  let last = null;
  for (let x = -RX; x <= RX; x++) {
    const arc = Math.round(ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)));
    const y = near ? Y + arc : Y - arc;
    if (last !== null && Math.abs(y - last) > 1) {
      const a = Math.min(y, last);
      g.fillRect(X + x, a, th, Math.abs(y - last) + th);
    } else {
      g.fillRect(X + x, y, th, th);
    }
    last = y;
  }
}

/**
 * 收容舱。返回 { back, front, r, h }，back / front 是两张精灵，
 * 中间留给舱内个体。
 */
export function makeChamber(seed = 907) {
  const foot = CH.r * 2 + 0.5;
  const back = makeProp(foot, foot, CH.full, (g, ox, oy) => {
    const rand = mulberry32(seed);
    aoShadow(g, ox, oy, foot, foot, 0.55);

    const zBase = CH.base * TILE_Z;
    const zGlass = CH.glass * TILE_Z;

    // 底座：金属圆台。逐行扫描三档硬带（亮/中/暗），交界行棋盘抖动
    pxCylFill(g, ox, oy, CH_RX, CH_RY, zBase, (f) => (f < 0.3 ? PAL.metalLite : f < 0.6 ? PAL.metal : PAL.metalDark));
    {
      const y0 = Math.round(oy - zBase - CH_RY);
      const y1 = Math.round(oy + CH_RY);
      for (const [f, dc] of [[0.3, PAL.metalLite], [0.6, PAL.metal]]) {
        const y = Math.round(y0 + (y1 - y0) * f);
        const hw = Math.round(cylRowHW(y, oy, CH_RX, CH_RY, zBase));
        if (hw) pxDither(g, ox - hw, ox + hw, y, dc);
      }
    }
    // 底座上的散热槽
    g.fillStyle = 'rgba(0,0,0,0.34)';
    for (let i = -5; i <= 5; i++) {
      const u = (i / 6) * CH_RX;
      const k = Math.sqrt(Math.max(0, 1 - (u / CH_RX) ** 2));
      g.fillRect(Math.round(ox + u - 1), Math.round(oy - zBase + 2 + CH_RY * k * 0.5), 1, Math.round(zBase - 4));
    }
    // 舱内地面
    ellipseFill(g, ox, oy - zBase, CH_RX, CH_RY, '#39433f');
    ellipseFill(g, ox, oy - zBase, CH_RX * 0.86, CH_RY * 0.86, '#232c2b');
    ellipseFill(g, ox, oy - zBase, CH_RX * 0.7, CH_RY * 0.7, 'rgba(121,210,204,0.16)');
    // 排水格栅：1px 像素竖条
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = -3; i <= 3; i++) {
      const u = (i / 4) * CH_RX * 0.8;
      const k = Math.sqrt(Math.max(0, 1 - (u / (CH_RX * 0.8)) ** 2));
      const yv0 = Math.round(oy - zBase - CH_RY * 0.8 * k);
      const yv1 = Math.round(oy - zBase + CH_RY * 0.8 * k);
      g.fillRect(Math.round(ox + u), yv0, 1, yv1 - yv0);
    }

    // 舱内空气：底部亮、顶部暗。三档硬带 + 交界行棋盘抖动，像素雾
    const gy = oy - zBase;
    pxCylFill(g, ox, gy, CH_RX, CH_RY, zGlass, (f) =>
      f < 0.42 ? 'rgba(14,26,30,0.92)' : f < 0.78 ? 'rgba(20,42,46,0.8)' : 'rgba(58,116,116,0.55)');
    {
      const y0 = Math.round(gy - zGlass - CH_RY);
      const y1 = Math.round(gy + CH_RY);
      for (const [f, dc] of [[0.42, 'rgba(14,26,30,0.92)'], [0.78, 'rgba(20,42,46,0.8)']]) {
        const y = Math.round(y0 + (y1 - y0) * f);
        const hw = Math.round(cylRowHW(y, gy, CH_RX, CH_RY, zGlass));
        if (hw) pxDither(g, ox - hw, ox + hw, y, dc);
      }
    }
    // 远侧内壁的反光：一条平涂带 + 三道像素斜线
    g.fillStyle = 'rgba(150,205,205,0.07)';
    g.fillRect(Math.round(ox - CH_RX), Math.round(gy - zGlass), Math.round(CH_RX * 2), Math.round(zGlass * 0.34));
    for (let i = 0; i < 3; i++) {
      pxLine(g, ox - CH_RX + 4 + i * 9, gy - zGlass, ox - CH_RX + 12 + i * 9, gy, 'rgba(170,220,215,0.12)', 1);
    }
    // 底部积雾
    g.save();
    g.globalAlpha = 0.5;
    ellipseFill(g, ox, gy - 3, CH_RX * 0.88, CH_RY * 0.7, 'rgba(140,215,210,0.2)');
    g.globalAlpha = 1;
    g.restore();

    // 远侧上下环
    halfArc(g, ox, gy, CH_RX, CH_RY, false, PAL.metal, 2.4);
    halfArc(g, ox, gy - zGlass, CH_RX, CH_RY, false, PAL.metalDark, 2.4);
    // 远侧的竖向支撑
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (const u of [-0.55, 0.55]) {
      g.fillRect(ox + u * CH_RX - 1, gy - zGlass, 2, zGlass);
    }
    // 底座的油污（收进直筒段内，不再需要剪裁）
    g.globalAlpha = 0.35;
    speckle(g, ox - CH_RX * 0.86, oy - zBase, CH_RX * 1.72, zBase + CH_RY * 0.6, rand, 40, ['#0d1112', PAL.rust, '#6d7377'], 1.3, 1);
    g.globalAlpha = 1;
  });

  const front = makeProp(foot, foot, CH.full, (g, ox, oy) => {
    const rand = mulberry32(seed + 13);
    const zBase = CH.base * TILE_Z;
    const zGlass = CH.glass * TILE_Z;
    const gy = oy - zBase;
    const ty = gy - zGlass;

    /* 玻璃本体：只压很淡的一层 —— 再重一点，舱里的东西就看不清了，
       而那正是这张画面唯一的主角。三档硬带按行扫描铺在圆柱剪影内。 */
    pxCylFill(g, ox, gy, CH_RX, CH_RY, zGlass, (f) =>
      f < 0.4 ? 'rgba(196,226,228,0.1)' : f < 0.75 ? 'rgba(150,196,200,0.03)' : 'rgba(110,170,175,0.07)');
    // 斜向高光条：只走两侧，中间留给舱里的个体（台阶斜条，收在直筒段内）
    g.globalAlpha = 0.42;
    for (const [u, w] of [
      [-0.74, 4],
      [-0.55, 2],
      [0.68, 3],
    ]) {
      pxPoly(g, [
        [ox + u * CH_RX, ty],
        [ox + u * CH_RX + w, ty],
        [ox + u * CH_RX + w + 7, gy],
        [ox + u * CH_RX + 7, gy],
      ], 'rgba(226,240,238,0.3)');
    }
    g.globalAlpha = 1;
    // 被从里面撞出来的裂纹：像素放射线
    const cx0 = ox + CH_RX * 0.3;
    const cy0 = gy - zGlass * 0.52;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * 6.28 + rand();
      pxLine(g, cx0, cy0, cx0 + Math.cos(a) * (3 + rand() * 11), cy0 + Math.sin(a) * (3 + rand() * 9), 'rgba(232,244,240,0.42)', 1);
    }

    // 近侧的上下金属环
    halfArc(g, ox, gy, CH_RX, CH_RY, true, PAL.metalLite, 2.6);
    halfArc(g, ox, gy + 1.6, CH_RX, CH_RY, true, 'rgba(0,0,0,0.45)', 1.6);
    halfArc(g, ox, ty, CH_RX, CH_RY, true, PAL.metal, 2.4);

    // 玻璃两侧的边光：没有它，圆柱在亮墙前面会整个化掉（1px 像素竖列）
    g.fillStyle = 'rgba(198,226,224,0.35)';
    g.fillRect(Math.round(ox - CH_RX), Math.round(ty), 1, Math.round(zGlass));
    g.fillRect(Math.round(ox + CH_RX), Math.round(ty), 1, Math.round(zGlass));

    // 立柱：左右两根 + 正面一道接缝
    for (const [u, w, col] of [
      [-1, 3.2, PAL.metalLite],
      [1, 3.2, PAL.metalLite],
      [0.02, 1.6, 'rgba(140,152,156,0.5)'],
    ]) {
      g.fillStyle = col;
      g.fillRect(ox + u * CH_RX - w / 2, ty, w, zGlass);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(ox + u * CH_RX - w / 2, ty, Math.max(1, w * 0.3), zGlass);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      for (let v = 6; v < zGlass; v += 13) g.fillRect(ox + u * CH_RX - w / 2, ty + v, w, 1);
    }

    /* 底座近侧：警示斜条纹。逐行扫描圆柱前凸的剪影，行内按斜移后的
       5px 周期分色 —— 不用 clip，台阶天然对齐像素格。 */
    {
      const RY = Math.round(CH_RY);
      for (let dy = 0; dy <= RY; dy++) {
        const hw = Math.round(CH_RX * Math.sqrt(Math.max(0, 1 - (dy / CH_RY) ** 2)));
        if (!hw) continue;
        const y = Math.round(oy) + dy;
        const shift = Math.round((dy / CH_RY) * 5);
        for (let x = -hw; x < hw; ) {
          const idx = Math.floor((x + shift) / 5);
          const runEnd = Math.min(hw, (idx + 1) * 5 - shift);
          g.fillStyle = ((idx % 2) + 2) % 2 === 0 ? '#8a7433' : '#1e2220';
          g.fillRect(Math.round(ox) + x, y, Math.max(1, runEnd - x), 1);
          x = runEnd;
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(Math.round(ox - CH_RX), Math.round(oy - zBase - 2), Math.round(CH_RX * 2), 3);
    }
    // 控制面板
    g.fillStyle = '#20272a';
    g.fillRect(ox + 6, oy - zBase + 1, 15, 7);
    g.fillStyle = '#39434a';
    g.fillRect(ox + 6, oy - zBase + 1, 15, 1);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = ['rgba(121,210,204,0.85)', 'rgba(224,165,82,0.8)', 'rgba(201,74,58,0.7)'][i];
      g.fillRect(ox + 8 + i * 4, oy - zBase + 4, 2, 2);
    }

    /* 顶盖 + 管线。盖子压暗：它是从上方看到的一整片，画亮了会变成整幅画里
       最抢眼的东西，而这一幕的主角在玻璃后面。 */
    const zc = CH.cap * TILE_Z;
    const capR = 1.0;
    // 顶盖筒身：两档硬带
    pxCylFill(g, ox, ty, CH_RX * capR, CH_RY * capR, zc, (f) => (f < 0.5 ? '#454e51' : '#232a2c'));
    ellipseFill(g, ox, ty - zc, CH_RX * capR, CH_RY * capR, '#39413f');
    ellipseFill(g, ox, ty - zc, CH_RX * 0.78, CH_RY * 0.78, '#2b3234');
    ellipseFill(g, ox, ty - zc, CH_RX * 0.3, CH_RY * 0.3, '#1b2123');
    halfArc(g, ox, ty - zc, CH_RX * capR, CH_RY * capR, false, 'rgba(150,162,166,0.55)', 1.2);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 6.28;
      g.fillRect(ox + Math.cos(a) * CH_RX * 0.9 - 1, ty - zc + Math.sin(a) * CH_RY * 0.9 - 1, 2, 2);
    }
    // 顶上的软管：像素折线（3px 管身 + 1px 受光芯）
    for (const [dx, dy] of [
      [-14, -16],
      [10, -20],
    ]) {
      const pts = [
        [ox + dx * 0.3, ty - zc - 1],
        [ox + dx * 0.75, ty - zc - 6],
        [ox + dx * 1.2, ty - zc - 4 + dy * 0.5],
        [ox + dx * 1.5, ty - zc + dy],
      ];
      pxPolyline(g, pts, '#1b2022', 3);
      pxPolyline(g, pts.map(([px, py]) => [px, py - 1]), '#333c3e', 1);
    }
  });

  return { back, front, r: CH.r, h: CH.full, glassTop: CH.top, floorZ: CH.base };
}

/** 舱内个体在舱里的落脚高度（高度单位） */
export const CHAMBER_FLOOR_Z = CH.base;

/* ---------------- 舱内个体 ---------------- */

const SPEC = {
  skin: '#a3b096',
  skinD: '#65735f',
  skinHi: '#d2dbc2',
  rim: 'rgba(186,236,226,0.55)', // 舱内冷光打出来的轮廓光
  vein: '#54654f',
  maw: '#3d1a1b',
  scar: '#4a1512',
};

/**
 * 舱内的个体：佝偻、四肢过长、没有毛发。
 * o = { t, scale, press }（press: 0..1 扑向玻璃）
 */
export function drawSpecimen(g, sx, sy, o = {}) {
  const sc = o.scale || 1;
  g.save();
  g.translate(sx, sy);
  if (sc !== 1) g.scale(sc, sc);
  specimenBody(g, o);
  g.restore();
}

function specimenBody(g, o) {
  const t = o.t || 0;
  const press = o.press || 0;
  // 呼吸：胸腔起伏；晃动：整体绕脚踝极轻微地摆
  const br = Math.sin(t * 1.5) * 0.55 + Math.sin(t * 0.63 + 1.2) * 0.3;
  const sway = Math.sin(t * 0.47) * 0.02;
  const lean = press * 3.4;

  // 脚下的影子：两档像素椭圆
  pxEllipse(g, 0, 0, 10, 3.8, 'rgba(0,0,0,0.3)');
  pxEllipse(g, 0, 0, 6.6, 2.5, 'rgba(0,0,0,0.35)');

  g.save();
  g.rotate(sway);

  const hipY = -19 - br * 0.3;
  const shY = -35 - br;

  // 远侧腿
  leg(g, -1, hipY, SPEC.skinD, t, 0.7);
  // 躯干：胸腔宽、腰细，整体前倾
  g.save();
  g.translate(lean * 0.4, 0);
  g.rotate(press * 0.05);
  poly(
    g,
    [
      [-8.4, shY + 1],
      [8.4, shY - 1],
      [5.4, hipY],
      [-5.4, hipY + 1],
    ],
    SPEC.skin,
  );
  // 背脊的隆起
  poly(
    g,
    [
      [-8.4, shY + 1],
      [-5.2, shY - 5],
      [1.2, shY - 4.4],
      [3.6, shY - 0.5],
    ],
    SPEC.skinD,
  );
  // 暗侧
  poly(
    g,
    [
      [-8.4, shY + 1],
      [-4, shY + 0.4],
      [-3, hipY + 1],
      [-5.4, hipY + 1],
    ],
    'rgba(0,0,0,0.3)',
  );
  // 舱内冷光在胸口右缘打出的轮廓光
  pxLine(g, 8.2, shY - 0.6, 5.4, hipY, SPEC.rim, 1);
  // 肋：三段像素折线拱出弧度
  for (let i = 0; i < 5; i++) {
    const y = shY + 4.5 + i * 2.9;
    pxPolyline(g, [
      [-5.2, y],
      [0, y + 1.2 + br * 0.4],
      [5.8, y - 0.6],
    ], SPEC.vein, 1);
  }
  // 缝合痕
  pxLine(g, 1.6, shY + 3, 1.6, hipY - 1, SPEC.scar, 1);
  for (let i = 0; i < 4; i++) {
    pxLine(g, -0.8, shY + 5.5 + i * 3.4, 4, shY + 4.5 + i * 3.4, SPEC.scar, 1);
  }
  g.restore();

  // 近侧腿
  leg(g, 1, hipY, SPEC.skin, t, 0);

  // 手臂：过长，垂到膝下；press 时近手拍在玻璃上
  arm(g, -1, shY, t, 0.9, 0, SPEC.skinD);
  arm(g, 1, shY, t, 0, press, SPEC.skin);

  // 头：拉长的颅骨，几乎没有脖子，向前探
  const hx = 3.6 + lean * 0.5;
  const hy = shY - 5.4 + Math.sin(t * 0.9) * 0.4;
  g.save();
  g.translate(hx, hy);
  g.rotate(0.2 + press * 0.14 + Math.sin(t * 0.31) * 0.06);
  // 颅骨
  poly(
    g,
    [
      [-6.6, -4],
      [3.8, -6],
      [7.2, -1.6],
      [6.2, 3.2],
      [0.8, 5.6],
      [-5.6, 2.6],
    ],
    SPEC.skin,
  );
  poly(
    g,
    [
      [-6.6, -4],
      [-1.2, -5.2],
      [-0.8, 3.2],
      [-5.6, 2.6],
    ],
    'rgba(0,0,0,0.26)',
  );
  // 头顶高光与轮廓光
  g.fillStyle = SPEC.skinHi;
  g.fillRect(-3, -5, 5, 1);
  pxPolyline(g, [
    [3.8, -5.6],
    [7, -1.6],
    [6, 3],
  ], SPEC.rim, 1);
  // 眼窝
  g.fillStyle = '#141c1b';
  g.fillRect(0.4, -3.2, 6.2, 3.8);
  // 颚：微张，露出牙
  poly(
    g,
    [
      [0.6, 2.6],
      [6.4, 1.6],
      [5.4, 4.4],
      [1, 4.8],
    ],
    SPEC.maw,
  );
  g.fillStyle = '#cfd6c2';
  for (let i = 0; i < 5; i++) g.fillRect(1.4 + i * 1.1, 2.5, 0.8, 1.4);
  g.restore();

  // 眼睛的冷光：三档同心方块辉光（跟直升机航行灯同一读法）
  const ex = hx + 3.2;
  const ey = hy - 1.4;
  const glow = 0.6 + Math.sin(t * 2.3) * 0.12 + press * 0.35;
  g.save();
  g.globalCompositeOperation = 'lighter';
  pxGlow(g, ex, ey, 8, '150,240,228', glow * 0.7);
  g.restore();
  g.fillStyle = '#e6fff8';
  g.fillRect(Math.round(ex) - 2, Math.round(ey) - 1, 2, 2);
  g.fillRect(Math.round(ex) + 2, Math.round(ey) - 1, 2, 2);

  // 颈环与拖在身后的线缆
  g.fillStyle = '#2c3438';
  g.fillRect(-2, shY - 4, 8, 3);
  g.fillStyle = '#5a6469';
  g.fillRect(-2, shY - 4, 8, 1);
  g.fillStyle = 'rgba(224,165,82,0.9)';
  g.fillRect(5, shY - 3, 1, 1);
  pxPolyline(g, [
    [-1.6, shY - 2.6],
    [-7, shY + 3],
    [-9.4, shY * 0.4 + 3],
    [-8, 0],
  ], '#1b2022', 1);

  g.restore();
}

function leg(g, side, hipY, col, t, ph) {
  const k = qz(Math.sin(t * 0.6 + ph) * 0.6, 1);
  // 大腿/小腿：4px 像素折线，硬边台阶
  pxPolyline(g, [
    [side * 3.6, hipY],
    [side * 6.2 + k, hipY * 0.45],
    [side * 4.6 + k * 0.4, -1],
  ], col, 4);
  // 脚掌
  g.fillStyle = col;
  g.fillRect(Math.round(side * 4.6 + k * 0.4 - (side > 0 ? 1 : 5)), -2, 6, 2);
}

function arm(g, side, shY, t, ph, press, col) {
  const drift = qz(Math.sin(t * 0.8 + ph) * 1.1, 0.5);
  const shx = side * 7.4;
  let ex, ey, hx, hy;
  if (press > 0.02) {
    // 抬手拍在玻璃上
    ex = shx + side * 6.6;
    ey = shY + 6 - press * 5;
    hx = shx + side * 9.4 + press * 3;
    hy = shY - 3.4 - press * 5;
  } else {
    ex = shx + side * 4.4 + drift * 0.4;
    ey = shY + 12.5;
    hx = shx + side * 2.6 + drift;
    hy = shY + 25 + drift * 0.5;
  }
  // 上臂/小臂：3px 像素折线
  pxPolyline(g, [
    [shx, shY + 1],
    [ex, ey],
    [hx, hy],
  ], col, 3);
  // 三根长指：1px 像素线
  const spread = press > 0.02 ? 1 : 0.5;
  for (let i = -1; i <= 1; i++) {
    pxLine(g, hx, hy, hx + i * 2.4 * spread + side * 0.6, hy + (press > 0.02 ? -3.8 : 5), col, 1);
  }
}

/* ---------------- 舱外的观察人员 ---------------- */

const TONES = {
  coat: { body: PAL.coat, shade: PAL.coatShade, dark: PAL.coatDark, pants: PAL.pants },
  suit: { body: '#4c565f', shade: '#39424a', dark: '#262d33', pants: '#2c333a' },
  scrub: { body: '#61817e', shade: '#4a6564', dark: '#334846', pants: '#2f3a3c' },
};

/**
 * 观察人员。姿势是摆好的，不是走路循环 —— 这是一张定格的观察现场。
 * o = { kind: 'note' | 'camera' | 'boss' | 'tech', dir, t, seed, scale, tone, mask, cap }
 */
export function drawStaff(g, sx, sy, o = {}) {
  const sc = o.scale || 1;
  g.save();
  g.translate(sx, sy);
  if (sc !== 1) g.scale(sc, sc);
  staffBody(g, o);
  g.restore();
}

function staffBody(g, o) {
  const kind = o.kind || 'note';
  const dir = o.dir === undefined ? 1 : o.dir;
  const t = o.t || 0;
  const seed = o.seed || 0;
  const tone = TONES[o.tone || (kind === 'boss' ? 'suit' : 'coat')];

  // 站姿的重心转移：很慢，只有 1px 上下，够让画面"不是静止图片"
  const shift = Math.sin(t * 0.6 + seed) * 0.5;
  // 记录员每隔几秒抬一次头看舱里
  const look = kind === 'note' ? Math.max(0, Math.sin(t * 0.42 + seed * 2.1) - 0.75) * 4 : 0;
  const baseY = -shift;

  // 影子：两档像素椭圆
  pxEllipse(g, 0, 0, 6, 2.8, 'rgba(0,0,0,0.28)');
  pxEllipse(g, 0, 0, 4, 1.8, 'rgba(0,0,0,0.3)');

  // 腿
  g.fillStyle = tone.pants;
  g.fillRect(-4, baseY - 9, 3, 9);
  g.fillRect(1, baseY - 9, 3, 9);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-4, baseY - 9, 1, 9);
  g.fillRect(1, baseY - 9, 1, 9);
  g.fillStyle = PAL.shoe;
  g.fillRect(-4 - (dir > 0 ? 0 : 1), baseY - 2, 4, 2);
  g.fillRect(1 - (dir > 0 ? 0 : 1), baseY - 2, 4, 2);

  // 下摆
  g.fillStyle = tone.shade;
  g.fillRect(-5, baseY - 13, 10, 5);
  g.fillStyle = tone.body;
  g.fillRect(-5, baseY - 13, 10, 3);

  // 躯干
  const shY = baseY - 21;
  g.fillStyle = tone.body;
  g.fillRect(-5, shY, 10, 9);
  g.fillStyle = tone.shade;
  g.fillRect(dir > 0 ? 2 : -5, shY, 3, 9);
  g.fillStyle = tone.dark;
  g.fillRect(-4, shY, 8, 1);
  g.fillStyle = kind === 'boss' ? '#8f2f2a' : '#4d565c';
  g.fillRect(-1 + dir, shY + 1, 2, 7); // 领带 / 前襟

  // 胸卡
  g.fillStyle = 'rgba(222,216,200,0.8)';
  g.fillRect(dir > 0 ? -3.5 : 1.5, shY + 4, 2.4, 3);

  // 头
  const hx = -3 + dir;
  const hy = baseY - 28 - look * 0.3;
  g.fillStyle = PAL.skin;
  g.fillRect(hx, hy + 1, 6, 6);
  g.fillStyle = PAL.skinD;
  g.fillRect(hx + (dir > 0 ? 4 : 0), hy + 1, 2, 6);
  g.fillStyle = o.cap ? '#4a5359' : PAL.hair;
  g.fillRect(hx - 1, hy, 8, 3);
  if (!o.cap) {
    g.fillRect(hx - 1, hy, 2, 5);
    g.fillRect(hx + 6, hy, 1, 5);
  }
  // 口罩
  if (o.mask !== false) {
    g.fillStyle = '#cfd6d4';
    g.fillRect(hx + (dir > 0 ? 1 : 0), hy + 4, 5, 3);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(hx + (dir > 0 ? 1 : 0), hy + 4, 5, 1);
  }
  g.fillStyle = '#1a1a1a';
  if (dir > 0) {
    g.fillRect(hx + 3, hy + 3, 1, 1);
    g.fillRect(hx + 5, hy + 3, 1, 1);
  } else {
    g.fillRect(hx, hy + 3, 1, 1);
    g.fillRect(hx + 2, hy + 3, 1, 1);
  }

  // 手臂与手上的东西：每种角色一套摆好的姿势（2px 像素线，硬边）
  const armStroke = (x0, y0, x1, y1, w = 2.4, col = tone.body) => {
    pxLine(g, x0, y0, x1, y1, col, Math.max(1, Math.round(w)));
  };
  const hand = (x, y) => {
    g.fillStyle = PAL.skin;
    g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
  };

  if (kind === 'note') {
    // 一只手托着写字板，另一只手在上面记录
    const bx = dir * 5.2;
    const by = shY + 4;
    armStroke(-dir * 4.2, shY + 2, bx - dir * 1.6, by + 2, 2.4, tone.shade);
    // 写字板：不再旋转 —— 旋转的 fillRect 会被抗锯齿糊掉
    g.save();
    g.translate(Math.round(bx), Math.round(by));
    g.fillStyle = '#5b6266';
    g.fillRect(-4, -5, 7, 9);
    g.fillStyle = 'rgba(222,216,200,0.82)';
    g.fillRect(-3, -4, 6, 8);
    g.fillStyle = 'rgba(60,66,68,0.7)';
    for (let i = 0; i < 4; i++) g.fillRect(-2, -3 + i * 2, 4, 1);
    g.fillStyle = '#3a4145';
    g.fillRect(-4, -6, 7, 1);
    g.restore();
    // 记录的那只手：笔尖在纸上小幅移动
    const wob = Math.sin(t * 5.2 + seed) * 1.1;
    const px = bx + dir * 1.2 + wob * 0.6;
    const py = by - 1 + Math.cos(t * 4.1 + seed) * 0.8;
    armStroke(dir * 4.2, shY + 2, px, py);
    hand(px, py);
    pxLine(g, px, py, px + dir * 2.4, py + 2.4, '#22282a', 1);
  } else if (kind === 'camera') {
    // 一手扶机身，一手在取景器上
    armStroke(-dir * 3.6, shY + 2, dir * 7, shY + 1, 2.4, tone.shade);
    hand(dir * 7, shY + 1);
    armStroke(dir * 4.2, shY + 2, dir * 8, shY - 2);
    hand(dir * 8, shY - 2);
  } else if (kind === 'boss') {
    // 背手站着看
    armStroke(-dir * 4.6, shY + 2, -dir * 6.4, shY + 8, 2.4, tone.shade);
    armStroke(dir * 4.6, shY + 2, -dir * 5.4, shY + 9, 2.4, tone.shade);
    hand(-dir * 5.8, shY + 9);
  } else {
    // 技术员：两手在控制台上敲
    const k1 = Math.sin(t * 6.4 + seed) * 1.2;
    const k2 = Math.sin(t * 5.7 + seed + 1.7) * 1.2;
    armStroke(-dir * 3.6, shY + 2, dir * 5.6, shY + 7 + k1, 2.4, tone.shade);
    hand(dir * 5.6, shY + 7 + k1);
    armStroke(dir * 4.2, shY + 2, dir * 7.4, shY + 6 + k2);
    hand(dir * 7.4, shY + 6 + k2);
  }
}

/** 三脚架上的记录设备（摄像机）。REC 灯由场景在光照之后单独画 */
export function makeCameraRig(seed = 811) {
  const rand = mulberry32(seed);
  const W = 0.9;
  const H = 1.62;
  return makeProp(W + 0.5, W + 0.5, H + 0.3, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, W, 0.42);
    const hy = oy - H * TILE_Z;
    // 三脚架：2px 像素腿 + 1px 受光芯
    for (const [dx, dy] of [
      [-9, 4],
      [9, 4],
      [0, -6],
    ]) {
      pxLine(g, ox, hy + 4, ox + dx, oy + dy * 0.4, '#2c3236', 2);
      pxLine(g, ox - 1, hy + 4, ox + dx - 1, oy + dy * 0.4, '#59636a', 1);
    }
    // 云台
    g.fillStyle = '#3c4449';
    g.fillRect(ox - 4, hy + 1, 8, 4);
    // 机身
    g.fillStyle = '#2a3135';
    g.fillRect(ox - 7, hy - 8, 15, 9);
    g.fillStyle = '#414a50';
    g.fillRect(ox - 7, hy - 8, 15, 2.4);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(ox - 7, hy - 1.4, 15, 1.4);
    // 镜头（朝右下，对着收容舱）
    g.fillStyle = '#20272a';
    g.fillRect(ox + 6, hy - 6.4, 6, 6);
    g.fillStyle = '#121819';
    g.fillRect(ox + 10, hy - 6, 2.6, 5.2);
    g.fillStyle = 'rgba(150,205,205,0.5)';
    g.fillRect(ox + 11.4, hy - 5.4, 1, 4);
    // 取景器与磁带仓
    g.fillStyle = '#39424a';
    g.fillRect(ox - 9.5, hy - 7, 3.4, 3.4);
    g.fillStyle = '#4c565c';
    g.fillRect(ox - 5, hy - 6.6, 6, 4);
    g.fillStyle = 'rgba(20,24,26,0.8)';
    g.fillRect(ox - 4.2, hy - 6, 4.4, 2.8);
    // 机身上的一点脏
    g.globalAlpha = 0.3;
    speckle(g, ox - 7, hy - 8, 15, 9, rand, 12, ['#0c0f10', '#6d7377'], 1.1, 1);
    g.globalAlpha = 1;
  });
}

/** 摄像机上 REC 指示灯在屏幕空间的位置（相对精灵落点） */
export const CAMERA_REC = { dx: -1, dy: -1.62 * TILE_Z - 9.4 };

export function drawFlashIcon(g, w, h, on) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.translate(w / 2, h / 2);
  const s = w / 48;
  g.scale(s, s);
  g.fillStyle = '#333c42';
  g.fillRect(-16, -5, 22, 10);
  g.fillStyle = '#4f5c63';
  g.fillRect(-16, -5, 22, 3);
  g.fillStyle = '#262d32';
  g.fillRect(-6, -5, 3, 10);
  pxPoly(g, [
    [6, -7],
    [13, -9],
    [13, 9],
    [6, 7],
  ], '#404a50');
  g.fillStyle = on ? '#fff3cf' : '#7b837f';
  g.fillRect(11, -8, 3, 16);
  if (on) {
    // 光锥：逐带展宽的硬边竖条，亮度分档递减
    for (let i = 0; i < 4; i++) {
      const xx = 14 + i * 4;
      const hh = 9 + i * 2;
      g.fillStyle = `rgba(255,240,200,${(0.6 - i * 0.14).toFixed(2)})`;
      g.fillRect(xx, -hh, 4, hh * 2);
    }
  }
  g.restore();
}

/* ------------------------------------------------------------------ *
 * 第一章 · 难民营地道具
 *
 * 清晨低角度阳光的约定（整章统一，别一个道具一个方向）：
 *   太阳在屏幕右上（世界 -y 侧），顶面最亮偏暖，+x 面次亮，
 *   +y 面背光偏冷暗，长影一律甩向世界 +y（屏幕左下）。
 * 影子直接烘进精灵 —— 白天场景不跑 lighting.finish()，没有运行时
 * 光照兜底，道具自己不带影子就会浮在地上。
 * ------------------------------------------------------------------ */

/** 清晨长影：足迹往世界 +y 拉出的斜四边形 + 抖动收边 */
export function morningShadow(g, ox, oy, w, d, len = 1.4, a = 0.2) {
  const p0 = P(ox, oy, -w / 2, -d / 2 + 0.15, 0);
  const p1 = P(ox, oy, w / 2, -d / 2 + 0.15, 0);
  const p2 = P(ox, oy, w / 2 - 0.3, d / 2 + len, 0);
  const p3 = P(ox, oy, -w / 2 - 0.3, d / 2 + len, 0);
  pxPoly(g, [p0, p1, p2, p3], `rgba(24,26,40,${a.toFixed(3)})`);
  pxDitherLine(g, p3[0], p3[1], p2[0], p2[1], `rgba(24,26,40,${(a * 0.7).toFixed(3)})`);
}

/**
 * 军用帐篷：干净的制式脊帐，入口在 +x 端。
 * opts = { rx, ry, h, open(默认 true), sign(门口挂一块方牌的颜色) }
 */
export function makeArmyTent(seed = 801, opts = {}) {
  const rand = mulberry32(seed);
  const RX = opts.rx || 2.0;
  const RY = opts.ry || 1.3;
  const H = opts.h || 1.8;
  const open = opts.open !== false;
  return makeProp(RX * 2 + 1.0, RY * 2 + 1.4, H + 0.3, (g, ox, oy) => {
    morningShadow(g, ox, oy, RX * 2, RY * 2, H * 1.2, 0.2);
    aoShadow(g, ox, oy, RX * 2, RY * 2, 0.35);

    const ridgeA = P(ox, oy, -RX, 0, H);
    const ridgeB = P(ox, oy, RX, 0, H);
    // 远侧坡面：只当轮廓
    poly(g, [P(ox, oy, -RX, -RY, 0), P(ox, oy, RX, -RY, 0), ridgeB, ridgeA], '#39412f');
    // 近侧坡面：三档受光分带，脊线亮 → 下摆暗
    const hemA = P(ox, oy, -RX, RY, 0);
    const hemB = P(ox, oy, RX, RY, 0);
    const mixPt = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const bandCols = ['#7c8a5e', '#606d49', '#495439'];
    const cuts = [0, 0.42, 0.74, 1];
    for (let b = 0; b < 3; b++) {
      poly(g, [
        mixPt(ridgeA, hemA, cuts[b]), mixPt(ridgeB, hemB, cuts[b]),
        mixPt(ridgeB, hemB, cuts[b + 1]), mixPt(ridgeA, hemA, cuts[b + 1]),
      ], bandCols[b]);
      if (b > 0) {
        const u = mixPt(ridgeA, hemA, cuts[b]);
        const v = mixPt(ridgeB, hemB, cuts[b]);
        pxDitherLine(g, u[0], u[1], v[0], v[1], bandCols[b - 1]);
      }
    }
    // 帆布接缝：沿脊线到下摆的直纹（制式帐篷，纹路等距不歪）
    const seams = Math.max(4, Math.round(RX * 4));
    for (let i = 1; i < seams; i++) {
      const t = i / seams;
      const a2 = P(ox, oy, -RX + t * RX * 2, 0.03, H - 0.04);
      const b2 = P(ox, oy, -RX + t * RX * 2, RY, 0);
      pxLine(g, a2[0], a2[1], b2[0], b2[1], 'rgba(0,0,0,0.16)', 1);
    }
    // 脊线
    pxLine(g, ridgeA[0], ridgeA[1], ridgeB[0], ridgeB[1], '#95a476', 2);

    // +x 端面
    const e0 = P(ox, oy, RX, -RY, 0);
    const e1 = P(ox, oy, RX, RY, 0);
    poly(g, [e0, e1, ridgeB], '#55613f');
    if (open) {
      // 门洞：往里是暗的，两侧门帘卷起
      const c0 = mixPt(e0, e1, 0.32);
      const c1 = mixPt(e0, e1, 0.68);
      poly(g, [
        [c0[0], c0[1]],
        [c1[0], c1[1]],
        [ridgeB[0] + 1, ridgeB[1] + 4],
      ], '#12160f');
      pxLine(g, c0[0], c0[1], ridgeB[0], ridgeB[1] + 2, '#6d7b52', 2);
      pxLine(g, c1[0], c1[1], ridgeB[0] + 2, ridgeB[1] + 3, '#3f4a30', 2);
    } else {
      // 系死的门缝
      const cm = mixPt(e0, e1, 0.5);
      pxLine(g, cm[0], cm[1], ridgeB[0], ridgeB[1], '#39412f', 1);
      g.fillStyle = '#39412f';
      for (let i = 1; i < 4; i++) {
        const p = mixPt(cm, ridgeB, i / 4);
        g.fillRect(Math.round(p[0]) - 1, Math.round(p[1]), 3, 1);
      }
    }
    if (opts.sign) {
      // 门口的方牌（内容不写字，交给 DOM 提示）
      const sp = mixPt(e0, e1, 0.16);
      g.fillStyle = '#20261f';
      g.fillRect(sp[0] - 1, sp[1] - 14, 2, 14);
      g.fillStyle = opts.sign;
      g.fillRect(sp[0] - 5, sp[1] - 20, 11, 7);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(sp[0] - 5, sp[1] - 15, 11, 2);
    }

    // 地钉 + 拉绳（干净制式，左右对称）
    for (const [gx, gy] of [
      [-RX - 0.45, RY + 0.35], [RX + 0.4, RY + 0.38],
      [-RX - 0.42, -RY - 0.3], [RX + 0.38, -RY - 0.32],
    ]) {
      const a3 = P(ox, oy, gx > 0 ? RX : -RX, 0, H - 0.05);
      const b3 = P(ox, oy, gx, gy, 0);
      pxLine(g, a3[0], a3[1], b3[0], b3[1], 'rgba(205,210,188,0.45)', 1);
      g.fillStyle = '#5d645c';
      g.fillRect(b3[0] - 1, b3[1] - 2, 2, 3);
    }
    // 布面一点旧渍
    g.globalAlpha = 0.2;
    for (let i = 0; i < 6; i++) {
      const p = P(ox, oy, -RX + rand() * RX * 2, rand() * RY, (1 - rand()) * H * 0.5);
      pxBlob(g, p[0], p[1], 1 + rand() * 3, 1 + rand() * 2, '#2c3122', rand);
    }
    g.globalAlpha = 1;
  });
}

/** 难民的简易棚：塑料布/旧帆布 A 字棚，四种配色按 variant 轮换 */
export function makeRefugeeTent(seed = 821, variant = 0) {
  const rand = mulberry32(seed + variant * 131);
  const RX = 0.9 + rand() * 0.3;
  const RY = 0.62 + rand() * 0.2;
  const H = 0.9 + rand() * 0.25;
  const [lit, mid, dark] = [
    ['#5b7186', '#46586a', '#354352'],
    ['#827961', '#645d4a', '#4a4537'],
    ['#77624c', '#5a4a39', '#41352a'],
    ['#68755f', '#50594a', '#3b4237'],
  ][variant % 4];
  return makeProp(RX * 2 + 0.9, RY * 2 + 1.1, H + 0.25, (g, ox, oy) => {
    morningShadow(g, ox, oy, RX * 2, RY * 2, H * 1.1, 0.18);
    aoShadow(g, ox, oy, RX * 2, RY * 2, 0.4);

    const ridgeA = P(ox, oy, -RX, 0, H);
    const ridgeB = P(ox, oy, RX, 0, H);
    poly(g, [P(ox, oy, -RX, -RY, 0), P(ox, oy, RX, -RY, 0), ridgeB, ridgeA], dark);
    const hemA = P(ox, oy, -RX, RY, 0);
    const hemB = P(ox, oy, RX, RY, 0);
    const mixPt = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let b = 0; b < 2; b++) {
      const cuts = [0, 0.55, 1];
      poly(g, [
        mixPt(ridgeA, hemA, cuts[b]), mixPt(ridgeB, hemB, cuts[b]),
        mixPt(ridgeB, hemB, cuts[b + 1]), mixPt(ridgeA, hemA, cuts[b + 1]),
      ], b ? mid : lit);
      if (b) {
        const u = mixPt(ridgeA, hemA, 0.55);
        const v = mixPt(ridgeB, hemB, 0.55);
        pxDitherLine(g, u[0], u[1], v[0], v[1], lit);
      }
    }
    // 皱褶：歪歪扭扭的暗纹
    for (let i = 1; i < 5; i++) {
      const t = i / 5 + (rand() - 0.5) * 0.08;
      const a2 = P(ox, oy, -RX + t * RX * 2, 0.02, H - 0.03);
      const b2 = P(ox, oy, -RX + t * RX * 2 + (rand() - 0.5) * 0.2, RY, 0);
      pxLine(g, a2[0], a2[1], b2[0], b2[1], 'rgba(0,0,0,0.24)', 1);
    }
    // 补丁：一两块异色方布
    for (let i = 0; i < 2; i++) {
      const p = P(ox, oy, -RX * 0.5 + rand() * RX, 0.2 + rand() * (RY * 0.6), H * 0.35);
      g.fillStyle = i ? 'rgba(120,110,90,0.8)' : 'rgba(90,100,110,0.8)';
      g.fillRect(Math.round(p[0]), Math.round(p[1]), 4 + (rand() * 3 | 0), 3 + (rand() * 2 | 0));
    }
    // 脊线（撑杆从两端露头）
    pxLine(g, ridgeA[0] - 2, ridgeA[1] + 1, ridgeB[0] + 2, ridgeB[1] - 1, shade(lit, 0.2), 1);
    // +x 端：洞开的口子
    const e0 = P(ox, oy, RX, -RY, 0);
    const e1 = P(ox, oy, RX, RY, 0);
    poly(g, [e0, e1, ridgeB], mid);
    poly(g, [
      [(e0[0] + e1[0]) / 2 - 3, (e0[1] + e1[1]) / 2],
      [(e0[0] + e1[0]) / 2 + 4, (e0[1] + e1[1]) / 2 + 3],
      [ridgeB[0], ridgeB[1] + 4],
    ], '#0d100e');
    // 门口杂物：一只锅/一捆布
    const m = P(ox, oy, RX + 0.45, RY * 0.4, 0);
    g.fillStyle = '#4a4d4f';
    g.fillRect(m[0] - 2, m[1] - 2, 5, 3);
    g.fillStyle = '#6a6e70';
    g.fillRect(m[0] - 2, m[1] - 2, 5, 1);
    // 压边的石头
    for (let i = 0; i < 3; i++) {
      const p = P(ox, oy, -RX + rand() * RX * 2, RY + 0.12, 0);
      g.fillStyle = ['#5d5d58', '#4c4c48'][i & 1];
      g.fillRect(p[0], p[1] - 1, 2 + (rand() * 2 | 0), 2);
    }
  });
}

/** 沙袋墙：两层交错码放，axis='x' 沿 x 铺，'y' 沿 y 铺 */
export function makeSandbags(seed = 831, len = 2, axis = 'x') {
  const rand = mulberry32(seed);
  const w = axis === 'x' ? len : 0.72;
  const d = axis === 'x' ? 0.72 : len;
  return makeProp(w + 0.4, d + 0.4, 0.75, (g, ox, oy) => {
    morningShadow(g, ox, oy, w, d, 0.55, 0.18);
    const n = Math.max(2, Math.round(len / 0.52));
    const step = len / n;
    for (let layer = 0; layer < 2; layer++) {
      const z = layer * 0.24;
      const off = layer ? step / 2 : 0;
      const cnt = layer ? n - 1 : n;
      for (let i = 0; i < cnt; i++) {
        const t = -len / 2 + off + i * step;
        const bx = axis === 'x' ? t : -0.32;
        const by = axis === 'x' ? -0.32 : t;
        const bw = axis === 'x' ? step * 0.94 : 0.64;
        const bd = axis === 'x' ? 0.64 : step * 0.94;
        const c = ['#8d7d5a', '#80714f', '#957f60'][(rand() * 3) | 0];
        isoBox(g, ox, oy, bx, by, z, bw, bd, 0.24, shade(c, 0.16), shade(c, 0.02), shade(c, -0.26));
        // 袋口束线
        const p = P(ox, oy, bx + bw / 2, by + bd / 2, z + 0.24);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.fillRect(p[0] - 2, p[1], 4, 1);
      }
    }
  });
}

/** 瞭望塔：四腿木架 + 平台围栏 + 顶棚，营地制高点 */
export function makeWatchtower(seed = 841) {
  const rand = mulberry32(seed);
  const S = 0.8; // 平台半宽
  const H = 2.6; // 平台高度
  return makeProp(2.8, 2.8, H + 1.9, (g, ox, oy) => {
    morningShadow(g, ox, oy, 1.9, 1.9, 2.8, 0.2);
    aoShadow(g, ox, oy, 1.7, 1.7, 0.4);
    // 四条腿：先远后近
    for (const [lx, ly] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
      isoBox(g, ox, oy, lx - 0.09, ly - 0.09, 0, 0.18, 0.18, H, '#71603f', '#5c4d31', '#413723');
    }
    // 交叉斜撑
    const c1 = P(ox, oy, -S, S, 0.15);
    const c2 = P(ox, oy, S, S, H * 0.72);
    const c3 = P(ox, oy, S, S, 0.15);
    const c4 = P(ox, oy, -S, S, H * 0.72);
    pxLine(g, c1[0], c1[1], c2[0], c2[1], '#5c4d31', 2);
    pxLine(g, c3[0], c3[1], c4[0], c4[1], '#52462c', 2);
    const d1 = P(ox, oy, S, -S, 0.15);
    const d2 = P(ox, oy, S, S, H * 0.72);
    pxLine(g, d1[0], d1[1], d2[0], d2[1], '#544831', 2);
    // 平台
    isoBox(g, ox, oy, -S - 0.2, -S - 0.2, H, (S + 0.2) * 2, (S + 0.2) * 2, 0.14, '#84714b', '#6b5a38', '#4e4128');
    // 围栏：四角立柱 + 顶横杆
    const rail = H + 0.14;
    for (const [lx, ly] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
      const b = P(ox, oy, lx, ly, rail);
      const t = P(ox, oy, lx, ly, rail + 0.55);
      pxLine(g, b[0], b[1], t[0], t[1], '#6b5a38', 1);
    }
    for (const [a, b] of [
      [[-S, S], [S, S]], [[S, -S], [S, S]],
    ]) {
      const p = P(ox, oy, a[0], a[1], rail + 0.52);
      const q = P(ox, oy, b[0], b[1], rail + 0.52);
      pxLine(g, p[0], p[1], q[0], q[1], '#84714b', 1);
    }
    // 顶棚支柱 + 布顶
    for (const [lx, ly] of [[-S + 0.1, -S + 0.1], [S - 0.1, -S + 0.1], [-S + 0.1, S - 0.1], [S - 0.1, S - 0.1]]) {
      const b = P(ox, oy, lx, ly, rail);
      const t = P(ox, oy, lx, ly, H + 1.35);
      pxLine(g, b[0], b[1], t[0], t[1], '#57492f', 1);
    }
    isoBox(g, ox, oy, -S - 0.3, -S - 0.3, H + 1.35, (S + 0.3) * 2, (S + 0.3) * 2, 0.1, '#66744c', '#4d583a', '#3b452e');
    // 顶棚布纹
    faceTop(g, ox, oy, H + 1.45);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    for (let i = 1; i < 4; i++) g.fillRect((-S - 0.3 + (i * (S + 0.3)) / 2) * TILE_W, (-S - 0.3) * TILE_W, 1, (S + 0.3) * 2 * TILE_W);
    resetT(g);
    // 平台上的探照灯（白天熄灭）
    const lp = P(ox, oy, S * 0.4, -S * 0.4, rail + 0.4);
    g.fillStyle = '#31383c';
    g.fillRect(lp[0] - 3, lp[1] - 4, 6, 5);
    g.fillStyle = '#565f64';
    g.fillRect(lp[0] - 3, lp[1] - 4, 6, 1);
    g.fillStyle = '#20262a';
    g.fillRect(lp[0] - 1, lp[1] + 1, 2, 4);
    // 木纹杂点
    g.globalAlpha = 0.3;
    for (let i = 0; i < 8; i++) {
      const p = P(ox, oy, -S + rand() * S * 2, S, rand() * H);
      g.fillStyle = '#3c3220';
      g.fillRect(p[0], p[1], 1, 2);
    }
    g.globalAlpha = 1;
  });
}

/** 铁丝网围栏：立柱 + 上下横管 + 抖动网面，axis='x'|'y' */
export function makeFence(seed = 851, len = 3, axis = 'x') {
  const H = 1.4;
  const w = axis === 'x' ? len : 0.36;
  const d = axis === 'x' ? 0.36 : len;
  return makeProp(w + 0.4, d + 0.4, H + 0.3, (g, ox, oy) => {
    const at = (t, z) => P(ox, oy, axis === 'x' ? t : 0, axis === 'x' ? 0 : t, z);
    // 影：细长一条
    morningShadow(g, ox, oy, axis === 'x' ? len : 0.2, axis === 'x' ? 0.2 : len, 0.9, 0.14);
    // 网面：低透明底色 + 斜织纹两向
    const q0 = at(-len / 2, 0.06);
    const q1 = at(len / 2, 0.06);
    const q2 = at(len / 2, H);
    const q3 = at(-len / 2, H);
    pxPoly(g, [q0, q1, q2, q3], 'rgba(150,160,158,0.14)');
    const wires = Math.max(3, Math.round(len * 3));
    for (let i = 0; i <= wires; i++) {
      const t = -len / 2 + (i / wires) * len;
      const a = at(t, 0.06);
      const b = at(Math.min(len / 2, t + len / wires), H);
      const b2 = at(Math.max(-len / 2, t - len / wires), H);
      pxLine(g, a[0], a[1], b[0], b[1], 'rgba(168,178,175,0.3)', 1);
      pxLine(g, a[0], a[1], b2[0], b2[1], 'rgba(140,150,148,0.26)', 1);
    }
    // 上下横管
    const t0 = at(-len / 2, H);
    const t1 = at(len / 2, H);
    pxLine(g, t0[0], t0[1], t1[0], t1[1], '#7b8683', 2);
    pxLine(g, q0[0], q0[1], q1[0], q1[1], '#5a6462', 1);
    // 立柱：每 ~1.5 瓦一根
    const posts = Math.max(2, Math.round(len / 1.5) + 1);
    for (let i = 0; i < posts; i++) {
      const t = -len / 2 + (i / (posts - 1)) * len;
      const b = at(t, 0);
      const tp = at(t, H + 0.12);
      pxLine(g, b[0], b[1], tp[0], tp[1], '#4d5654', 2);
      g.fillStyle = '#39413f';
      g.fillRect(b[0] - 2, b[1] - 1, 4, 2);
    }
  });
}

/** 火塘：石圈 + 焦土 + 架柴。火苗每帧用 drawFlames 画在 CAMPFIRE_FLAME 锚点 */
export const CAMPFIRE_FLAME = { dx: 0, dy: -3 };
export function makeCampfire(seed = 861) {
  const rand = mulberry32(seed);
  return makeProp(1.7, 1.7, 0.5, (g, ox, oy) => {
    // 焦土两档
    pxEllipse(g, ox, oy, 15, 7.5, '#26211b');
    pxEllipse(g, ox, oy, 10, 5, '#16120e');
    // 石圈：一圈方石块，顶缘受光
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const px = Math.round(ox + Math.cos(a) * 13);
      const py = Math.round(oy + Math.sin(a) * 6.2);
      const c = ['#6d6d66', '#5b5b54', '#63635c'][(rand() * 3) | 0];
      g.fillStyle = shade(c, -0.25);
      g.fillRect(px - 2, py - 1, 5, 3);
      g.fillStyle = c;
      g.fillRect(px - 2, py - 2, 5, 2);
    }
    // 架起的柴：交叉两根 + 焦黑一根
    pxLine(g, ox - 7, oy - 1, ox + 6, oy - 4, '#4c3a24', 2);
    pxLine(g, ox - 5, oy - 5, ox + 6, oy, '#3d2f1e', 2);
    pxLine(g, ox - 2, oy + 2, ox + 8, oy - 2, '#221c15', 2);
    // 灰烬
    g.fillStyle = '#8d8578';
    g.fillRect(ox - 2, oy - 1, 3, 1);
    g.fillRect(ox + 1, oy, 2, 1);
  });
}

/** 原木长凳：一截平顶木，坐人用（NPC 的 sit 锚点对齐顶面） */
export function makeLogBench(seed = 871, axis = 'x') {
  const rand = mulberry32(seed);
  const L = 1.5;
  const w = axis === 'x' ? L : 0.42;
  const d = axis === 'x' ? 0.42 : L;
  return makeProp(w + 0.3, d + 0.3, 0.5, (g, ox, oy) => {
    morningShadow(g, ox, oy, w, d, 0.4, 0.16);
    aoShadow(g, ox, oy, w, d, 0.3);
    isoBox(g, ox, oy, -w / 2, -d / 2, 0.08, w, d, 0.26, '#8a7350', '#6e5a3c', '#4e4029');
    // 端面年轮
    const e = axis === 'x' ? P(ox, oy, w / 2, 0, 0.22) : P(ox, oy, 0, d / 2, 0.22);
    pxEllipseRing(g, e[0], e[1], 3, 2, '#5a4930', 1);
    // 顶面木纹
    faceTop(g, ox, oy, 0.34);
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let i = 0; i < 3; i++) {
      if (axis === 'x') g.fillRect(-w / 2 * TILE_W + 2, (-d / 2 + 0.1 + i * 0.12) * TILE_W, w * TILE_W - 4, 1);
      else g.fillRect((-w / 2 + 0.1 + i * 0.12) * TILE_W, -d / 2 * TILE_W + 2, 1, d * TILE_W - 4);
    }
    resetT(g);
    void rand;
  });
}

/** 高架水箱：四腿钢架 + 方箱 + 龙头，底下一摊湿渍 */
export function makeWaterTank(seed = 881) {
  const rand = mulberry32(seed);
  const S = 0.55;
  const H = 1.15; // 架高
  const TH = 1.0; // 箱高
  return makeProp(2.0, 2.0, H + TH + 0.4, (g, ox, oy) => {
    morningShadow(g, ox, oy, 1.3, 1.3, 1.6, 0.2);
    aoShadow(g, ox, oy, 1.2, 1.2, 0.4);
    // 湿渍
    pxEllipse(g, ox + 6, oy + 5, 7, 3, 'rgba(40,52,58,0.4)');
    // 钢架
    for (const [lx, ly] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
      isoBox(g, ox, oy, lx - 0.06, ly - 0.06, 0, 0.12, 0.12, H, '#565f64', '#454d52', '#33393d');
    }
    const b1 = P(ox, oy, -S, S, 0.1);
    const b2 = P(ox, oy, S, S, H * 0.8);
    pxLine(g, b1[0], b1[1], b2[0], b2[1], '#454d52', 1);
    // 水箱
    isoBox(g, ox, oy, -S - 0.14, -S - 0.14, H, (S + 0.14) * 2, (S + 0.14) * 2, TH, '#7f8a8c', '#677274', '#4b5456');
    // 箱体水位线锈痕
    faceRight(g, ox, oy, S + 0.14);
    g.fillStyle = 'rgba(109,74,48,0.4)';
    g.fillRect(-(S + 0.14) * TILE_W, -(H + TH * 0.35) * TILE_Z, (S + 0.14) * 2 * TILE_W, 2);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(-(S + 0.14) * TILE_W, -(H + TH) * TILE_Z + 2, (S + 0.14) * 2 * TILE_W, 2);
    resetT(g);
    // 盖板
    isoBox(g, ox, oy, -0.2, -0.2, H + TH, 0.4, 0.4, 0.08, '#98a3a6', '#7b8689', '#5c6568');
    // 龙头：伸向 +x
    const tap = P(ox, oy, S + 0.34, 0.15, H * 0.6);
    pxLine(g, tap[0] - 6, tap[1] - 2, tap[0], tap[1], '#454d52', 2);
    g.fillStyle = '#6a7477';
    g.fillRect(tap[0] - 1, tap[1] - 1, 3, 4);
    // 底下接水的桶
    const bk = P(ox, oy, S + 0.42, 0.2, 0);
    g.fillStyle = '#4c565c';
    g.fillRect(bk[0] - 3, bk[1] - 5, 7, 6);
    g.fillStyle = '#39434a';
    g.fillRect(bk[0] - 3, bk[1] - 5, 2, 6);
    g.fillStyle = '#2b3d44';
    g.fillRect(bk[0] - 2, bk[1] - 4, 5, 1);
    void rand;
  });
}

/** 营地照明杆：配重底座 + 高杆 + 双灯头（白天熄灭，夜章再点亮） */
export function makeFloodlight(seed = 891) {
  const H = 3.1;
  return makeProp(1.4, 1.4, H + 0.5, (g, ox, oy) => {
    morningShadow(g, ox, oy, 0.5, 0.5, 2.4, 0.16);
    aoShadow(g, ox, oy, 0.8, 0.8, 0.35);
    // 配重
    isoBox(g, ox, oy, -0.3, -0.3, 0, 0.6, 0.6, 0.18, '#4d5457', '#3d4346', '#2d3235');
    // 杆
    const b = P(ox, oy, 0, 0, 0.18);
    const t = P(ox, oy, 0, 0, H);
    pxLine(g, b[0], b[1], t[0], t[1], '#5a6266', 2);
    pxLine(g, b[0] - 1, b[1], t[0] - 1, t[1], '#454d50', 1);
    // 横臂 + 两个灯头（朝 +x / +y 两边）
    pxLine(g, t[0] - 7, t[1] + 1, t[0] + 7, t[1] - 1, '#4d5457', 2);
    for (const dx of [-7, 7]) {
      g.fillStyle = '#31383c';
      g.fillRect(t[0] + dx - 2, t[1] - (dx > 0 ? 5 : 2), 5, 4);
      g.fillStyle = '#6e6f66';
      g.fillRect(t[0] + dx - 1, t[1] - (dx > 0 ? 4 : 1), 3, 2);
    }
    // 拉线
    pxLine(g, t[0], t[1] + 2, b[0] + 9, b[1] + 2, 'rgba(120,128,126,0.4)', 1);
  });
}

/** 旗杆：底座 + 细杆 + 一面向 +x 飘的旗（台阶锯齿边） */
export function makeFlagpole(seed = 895, col = '#9c5b34') {
  const H = 3.4;
  return makeProp(1.2, 1.2, H + 0.4, (g, ox, oy) => {
    morningShadow(g, ox, oy, 0.4, 0.4, 2.6, 0.14);
    aoShadow(g, ox, oy, 0.6, 0.6, 0.3);
    isoBox(g, ox, oy, -0.22, -0.22, 0, 0.44, 0.44, 0.14, '#6a716e', '#565e5c', '#414846');
    const b = P(ox, oy, 0, 0, 0.14);
    const t = P(ox, oy, 0, 0, H);
    pxLine(g, b[0], b[1], t[0], t[1], '#8a9295', 1);
    pxLine(g, b[0] + 1, b[1], t[0] + 1, t[1], '#5c6467', 1);
    // 旗面：三段台阶模拟飘动
    g.fillStyle = col;
    g.fillRect(t[0] + 1, t[1], 7, 6);
    g.fillRect(t[0] + 8, t[1] + 1, 6, 5);
    g.fillRect(t[0] + 14, t[1] + 2, 4, 3);
    g.fillStyle = shade(col, -0.25);
    g.fillRect(t[0] + 8, t[1] + 4, 6, 2);
    g.fillRect(t[0] + 14, t[1] + 4, 4, 1);
    g.fillStyle = shade(col, 0.15);
    g.fillRect(t[0] + 1, t[1], 7, 1);
    void seed;
  });
}

/** 行军床：帆布面 + X 型折叠腿（登记帐篷 / 医疗棚里用） */
export function makeCot(seed = 899) {
  const rand = mulberry32(seed);
  const W = 0.75, D = 1.7, H = 0.42;
  return makeProp(W + 0.4, D + 0.4, H + 0.2, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.35);
    // X 腿：两端各一组
    for (const yy of [-D / 2 + 0.12, D / 2 - 0.12]) {
      const a1 = P(ox, oy, -W / 2, yy, 0);
      const a2 = P(ox, oy, W / 2, yy, H);
      const a3 = P(ox, oy, W / 2, yy, 0);
      const a4 = P(ox, oy, -W / 2, yy, H);
      pxLine(g, a1[0], a1[1], a2[0], a2[1], '#4a4438', 1);
      pxLine(g, a3[0], a3[1], a4[0], a4[1], '#3c372d', 1);
    }
    // 帆布面
    isoBox(g, ox, oy, -W / 2, -D / 2, H, W, D, 0.06, '#7a7360', '#5f594a', '#454136');
    // 布面横褶
    faceTop(g, ox, oy, H + 0.06);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    for (let i = 1; i < 5; i++) g.fillRect(-W / 2 * TILE_W + 1, (-D / 2 + (i * D) / 5) * TILE_W, W * TILE_W - 2, 1);
    resetT(g);
    // 枕头位置一卷毯子
    const p = P(ox, oy, 0, -D / 2 + 0.22, H + 0.06);
    g.fillStyle = '#5d6b5e';
    g.fillRect(p[0] - 4, p[1] - 3, 9, 4);
    g.fillStyle = '#49564b';
    g.fillRect(p[0] - 4, p[1] - 1, 9, 2);
    void rand;
  });
}

/** 登记官的折叠桌：木板面 + 金属腿 + 纸堆台灯（+x 是玩家那侧） */
export function makeFieldDesk(seed = 903) {
  const rand = mulberry32(seed);
  const W = 1.7, D = 0.8, H = 0.78;
  return makeProp(W + 0.4, D + 0.4, H + 0.5, (g, ox, oy) => {
    aoShadow(g, ox, oy, W, D, 0.4);
    // 金属腿
    for (const [lx, ly] of [[-W / 2 + 0.1, -D / 2 + 0.08], [W / 2 - 0.1, -D / 2 + 0.08], [-W / 2 + 0.1, D / 2 - 0.08], [W / 2 - 0.1, D / 2 - 0.08]]) {
      isoBox(g, ox, oy, lx - 0.04, ly - 0.04, 0, 0.08, 0.08, H - 0.08, '#4a5154', '#3b4144', '#2c3134');
    }
    // 桌面
    isoBox(g, ox, oy, -W / 2, -D / 2, H - 0.08, W, D, 0.08, '#8a7550', '#6e5c3d', '#4e4229');
    // 桌面物件（顶面空间）
    faceTop(g, ox, oy, H);
    const u = (x) => x * TILE_W;
    // 纸堆
    g.fillStyle = '#c9c6b4';
    g.fillRect(u(-0.55), u(-0.22), 12, 9);
    g.fillStyle = '#b5b2a0';
    g.fillRect(u(-0.55), u(-0.22) + 8, 12, 2);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 3; i++) g.fillRect(u(-0.55) + 2, u(-0.22) + 2 + i * 2, 8, 1);
    // 第二叠歪的
    g.fillStyle = '#bdbaa8';
    g.fillRect(u(-0.2), u(0.02), 10, 7);
    // 墨水瓶 / 印章
    g.fillStyle = '#28313a';
    g.fillRect(u(0.28), u(-0.15), 4, 4);
    g.fillStyle = '#6c4a32';
    g.fillRect(u(0.42), u(0.1), 3, 5);
    resetT(g);
    // 台灯：绿罩老式
    const lp = P(ox, oy, W * 0.32, -D * 0.2, H);
    pxLine(g, lp[0], lp[1], lp[0] + 2, lp[1] - 8, '#3d4346', 1);
    g.fillStyle = '#3f5a44';
    g.fillRect(lp[0] - 2, lp[1] - 11, 9, 4);
    g.fillStyle = '#57785d';
    g.fillRect(lp[0] - 2, lp[1] - 11, 9, 1);
    g.fillStyle = '#efe6bb';
    g.fillRect(lp[0] - 1, lp[1] - 7, 7, 1);
    void rand;
  });
}

/** 物资堆：码起来的板条箱 + 盖布 + 几只桶，营地里反复摆 */
export function makeSupplyPile(seed = 907) {
  const rand = mulberry32(seed);
  return makeProp(2.6, 2.2, 1.6, (g, ox, oy) => {
    morningShadow(g, ox, oy, 1.8, 1.5, 1.0, 0.18);
    aoShadow(g, ox, oy, 1.8, 1.5, 0.4);
    // 底层三箱
    const woods = ['#7a6a48', '#6e5f40', '#816f4c'];
    for (const [bx, by, s] of [[-0.85, -0.5, 0.62], [-0.1, -0.55, 0.58], [-0.5, 0.1, 0.6]]) {
      const c = woods[(rand() * 3) | 0];
      isoBox(g, ox, oy, bx, by, 0, s, s, s * 0.72, shade(c, 0.14), c, shade(c, -0.26));
      // 箱板条
      const p = P(ox, oy, bx + s, by + s / 2, s * 0.36);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(p[0] - 3, p[1], 6, 1);
    }
    // 上层一箱 + 盖布
    isoBox(g, ox, oy, -0.55, -0.4, 0.45, 0.6, 0.6, 0.44, '#6a7455', '#525c42', '#3c4531');
    const t = P(ox, oy, -0.25, -0.1, 0.89);
    pxPoly(g, [
      [t[0] - 9, t[1] + 2], [t[0] + 8, t[1] - 3], [t[0] + 12, t[1] + 6], [t[0] - 5, t[1] + 10],
    ], '#5d684a');
    pxDitherLine(g, t[0] - 9, t[1] + 2, t[0] + 8, t[1] - 3, '#75825d');
    // 桶两只
    for (const [bx, by] of [[0.6, -0.2], [0.75, 0.35]]) {
      const c = rand() > 0.5 ? '#5a6a72' : '#6d5a3a';
      isoBox(g, ox, oy, bx - 0.2, by - 0.2, 0, 0.4, 0.4, 0.55, shade(c, 0.12), c, shade(c, -0.24));
      const p = P(ox, oy, bx, by, 0.55);
      pxEllipseRing(g, p[0], p[1], 4, 2, shade(c, -0.35), 1);
    }
  });
}

/* ------------------------------------------------------------------ *
 * 第一章 · 营地生活设施（v2.1.0 扩建）
 *
 * 同一套清晨光约定：顶面最亮偏暖、+x 面次亮、+y 面背光、长影甩向 +y。
 * 全部程序化像素绘制，零图片资源。烘焙层的小字只用 FONT3 的拉丁字模，
 * 中文说明一律走 DOM 的 hints / UI.msg。
 * ------------------------------------------------------------------ */

/** 食堂长桌：长条木板桌 + 两侧条凳 + 一排铁皮碗（axis 只做 'x'，够用） */
export function makeMessTable(seed = 941) {
  const rand = mulberry32(seed);
  const W = 3.1; // 桌长（x）
  const D = 0.72; // 桌宽（y）
  const H = 0.72;
  return makeProp(W + 0.8, D + 1.9, H + 0.4, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D + 1.2, 0.55, 0.16);
    aoShadow(g, ox, oy, W, D + 1.2, 0.3);
    // 两侧条凳（先画远侧）
    for (const sy of [-0.78, 0.78]) {
      isoBox(g, ox, oy, -W / 2 + 0.15, sy - 0.14, 0.26, W - 0.3, 0.28, 0.1, '#84714b', '#6b5a38', '#4e4128');
      for (const lx of [-W / 2 + 0.3, W / 2 - 0.3]) {
        isoBox(g, ox, oy, lx - 0.05, sy - 0.05, 0, 0.1, 0.1, 0.26, null, '#5c4d31', '#413723');
      }
    }
    // 桌腿
    for (const [lx, ly] of [[-W / 2 + 0.18, -D / 2 + 0.1], [W / 2 - 0.18, -D / 2 + 0.1], [-W / 2 + 0.18, D / 2 - 0.1], [W / 2 - 0.18, D / 2 - 0.1]]) {
      isoBox(g, ox, oy, lx - 0.06, ly - 0.06, 0, 0.12, 0.12, H - 0.08, null, '#5c4d31', '#3d3320');
    }
    // 桌面：拼板木，顶面拉几道板缝
    isoBox(g, ox, oy, -W / 2, -D / 2, H - 0.08, W, D, 0.08, '#8d7852', '#6e5c3d', '#4e4229');
    faceTop(g, ox, oy, H);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 1; i < 3; i++) g.fillRect(-W / 2 * TILE_W + 2, (-D / 2 + (i * D) / 3) * TILE_W, W * TILE_W - 4, 1);
    resetT(g);
    // 铁皮碗：桌面上两排，个别翻扣着
    for (let i = 0; i < 7; i++) {
      const bx = -W / 2 + 0.4 + (i % 4) * 0.72 + (rand() - 0.5) * 0.12;
      const by = (i < 4 ? -0.16 : 0.18) + (rand() - 0.5) * 0.08;
      const p = P(ox, oy, bx, by, H);
      const up = rand() > 0.25;
      g.fillStyle = '#8f979a';
      g.fillRect(p[0] - 3, p[1] - 2, 6, 2);
      pxEllipseRing(g, p[0], p[1] - 2, 3, 1.4, '#b3bbbe', 1);
      if (up) pxEllipse(g, p[0], p[1] - 2, 2, 1, '#3c4245');
      else pxEllipse(g, p[0], p[1] - 2, 2, 1, '#a8b0b3');
    }
    // 一把长柄勺搭在桌角
    const sp = P(ox, oy, W / 2 - 0.3, -0.1, H);
    pxLine(g, sp[0], sp[1] - 1, sp[0] + 7, sp[1] - 4, '#767e82', 1);
    pxEllipse(g, sp[0] + 8, sp[1] - 4, 2, 1, '#5c6467');
  });
}

/** 打饭棚：四柱布顶 + 打饭台 + 两口大锅 + 摞起来的碗（排队打饭的地方） */
export function makeServeCanopy(seed = 943) {
  const rand = mulberry32(seed);
  const RX = 1.7;
  const RY = 1.15;
  const H = 2.15; // 檐口高度
  return makeProp(RX * 2 + 1.0, RY * 2 + 1.4, H + 0.8, (g, ox, oy) => {
    morningShadow(g, ox, oy, RX * 2, RY * 2, H * 0.9, 0.18);
    aoShadow(g, ox, oy, RX * 2, RY * 2, 0.3);
    const pole = (px, py) => {
      const b = P(ox, oy, px, py, 0);
      const t = P(ox, oy, px, py, py < 0 ? H + 0.3 : H);
      pxLine(g, b[0], b[1], t[0], t[1], '#5c4d31', 2);
      pxLine(g, b[0] - 1, b[1], t[0] - 1, t[1], '#413723', 1);
      g.fillStyle = '#393120';
      g.fillRect(b[0] - 2, b[1] - 1, 5, 2);
    };
    // 远侧两根柱
    pole(-RX, -RY);
    pole(RX, -RY);
    // 打饭台：长条木台，+x 端留出打饭口
    isoBox(g, ox, oy, -RX + 0.25, -0.25, 0, RX * 2 - 0.5, 0.62, 0.72, '#84714b', '#6b5a38', '#4a3d27');
    // 台面两口大锅
    for (const [px, lid] of [[-0.75, true], [0.25, false]]) {
      const p = P(ox, oy, px, 0.02, 0.72);
      pxEllipse(g, p[0], p[1] - 5, 6, 3, '#2c3134');
      g.fillStyle = '#3a4145';
      g.fillRect(p[0] - 6, p[1] - 5, 12, 5);
      g.fillStyle = '#22282b';
      g.fillRect(p[0] - 6, p[1] - 2, 12, 2);
      if (lid) {
        pxEllipse(g, p[0], p[1] - 6, 5, 2, '#4c5459');
        g.fillStyle = '#6a7378';
        g.fillRect(p[0] - 1, p[1] - 8, 2, 2);
      } else {
        pxEllipse(g, p[0], p[1] - 6, 5, 2, '#5b4f36');
        pxEllipse(g, p[0] - 1, p[1] - 6, 3, 1, '#6d5e40');
      }
    }
    // 摞起来的铁皮碗 + 水桶
    const bs = P(ox, oy, RX - 0.55, 0.05, 0.72);
    for (let i = 0; i < 4; i++) {
      pxEllipse(g, bs[0], bs[1] - 3 - i * 2, 3, 1.2, i & 1 ? '#9aa2a5' : '#868e91');
    }
    const bk = P(ox, oy, -RX + 0.45, 0.55, 0);
    g.fillStyle = '#4c565c';
    g.fillRect(bk[0] - 3, bk[1] - 6, 7, 6);
    g.fillStyle = '#6a7477';
    g.fillRect(bk[0] - 3, bk[1] - 6, 7, 1);
    // 近侧两根柱
    pole(-RX, RY);
    pole(RX, RY);
    // 布顶：往 +y 略斜的单坡，三档受光分带 + 布幅接缝
    const r0 = P(ox, oy, -RX - 0.25, -RY - 0.3, H + 0.32);
    const r1 = P(ox, oy, RX + 0.25, -RY - 0.3, H + 0.32);
    const r2 = P(ox, oy, RX + 0.25, RY + 0.3, H - 0.02);
    const r3 = P(ox, oy, -RX - 0.25, RY + 0.3, H - 0.02);
    const mixPt = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    const cols = ['#7c8a5e', '#606d49', '#495439'];
    const cuts = [0, 0.45, 0.78, 1];
    for (let b = 0; b < 3; b++) {
      poly(g, [
        mixPt(r0, r3, cuts[b]), mixPt(r1, r2, cuts[b]),
        mixPt(r1, r2, cuts[b + 1]), mixPt(r0, r3, cuts[b + 1]),
      ], cols[b]);
      if (b > 0) {
        const u = mixPt(r0, r3, cuts[b]);
        const v = mixPt(r1, r2, cuts[b]);
        pxDitherLine(g, u[0], u[1], v[0], v[1], cols[b - 1]);
      }
    }
    for (let i = 1; i < 5; i++) {
      const a2 = mixPt(r0, r1, i / 5);
      const b2 = mixPt(r3, r2, i / 5);
      pxLine(g, a2[0], a2[1], b2[0], b2[1], 'rgba(0,0,0,0.16)', 1);
    }
    pxLine(g, r0[0], r0[1], r1[0], r1[1], '#95a476', 1);
    // 檐口挂的号牌：1 2 3，按号排队
    for (let i = 0; i < 3; i++) {
      const hp = mixPt(r3, r2, 0.22 + i * 0.26);
      g.fillStyle = '#c9c2a6';
      g.fillRect(hp[0] - 3, hp[1] + 2, 7, 8);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(hp[0] - 3, hp[1] + 2, 7, 1);
      pxText(g, hp[0] - 1, hp[1] + 4, String(i + 1), '#3a3a30', 1);
    }
    void rand;
  });
}

/** 洗衣区的水泥池：双格池 + 搓衣板 + 池边的湿渍 */
export function makeWashBasin(seed = 947) {
  const rand = mulberry32(seed);
  const W = 1.7;
  const D = 0.95;
  const H = 0.6;
  return makeProp(W + 0.6, D + 0.8, H + 0.3, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D, 0.45, 0.16);
    aoShadow(g, ox, oy, W, D, 0.35);
    // 池边溅出来的水
    pxBlob(g, ox + 8, oy + 6, 9, 4, 'rgba(40,52,58,0.35)', rand);
    // 池体：灰水泥
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, '#8f8d80', '#75736a', '#565550');
    // 顶面：池壁 + 两格水面
    faceTop(g, ox, oy, H);
    const u = (t) => Math.round(t * TILE_W);
    g.fillStyle = '#9b998c';
    g.fillRect(u(-W / 2), u(-D / 2), u(W), u(D));
    for (const [x0, x1] of [[-W / 2 + 0.12, -0.08], [0.08, W / 2 - 0.12]]) {
      g.fillStyle = '#4d5a58';
      g.fillRect(u(x0), u(-D / 2 + 0.12), u(x1 - x0), u(D - 0.24));
      g.fillStyle = '#5e6e6a';
      g.fillRect(u(x0), u(-D / 2 + 0.12), u(x1 - x0), 2);
      // 水面上漂的皂沫
      for (let i = 0; i < 4; i++) {
        g.fillStyle = 'rgba(210,214,206,0.5)';
        g.fillRect(u(x0) + 2 + ((rand() * (u(x1 - x0) - 5)) | 0), u(-D / 2 + 0.2) + ((rand() * (u(D - 0.4))) | 0), 2, 1);
      }
    }
    // 池壁裂缝
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(u(-0.06), u(-D / 2), 2, u(D));
    resetT(g);
    // 搓衣板斜靠在池边
    const wb = P(ox, oy, W / 2 - 0.2, -D / 2 - 0.12, 0);
    pxPoly(g, [
      [wb[0] - 3, wb[1] - 12], [wb[0] + 3, wb[1] - 13], [wb[0] + 5, wb[1] - 1], [wb[0] - 1, wb[1]],
    ], '#84714b');
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 4; i++) g.fillRect(wb[0] - 2, wb[1] - 10 + i * 3, 6, 1);
    // 池脚下的一块垫脚砖
    const br = P(ox, oy, -W / 2 + 0.3, D / 2 + 0.25, 0);
    g.fillStyle = '#7a5c48';
    g.fillRect(br[0] - 3, br[1] - 2, 7, 3);
    g.fillStyle = '#8f6e56';
    g.fillRect(br[0] - 3, br[1] - 3, 7, 1);
  });
}

/** 晾衣绳：两根木杆 + 下垂的绳 + 挂着的旧衣物。不给碰撞（只是视觉） */
export function makeClothesline(seed = 951, len = 3.2, axis = 'x') {
  const rand = mulberry32(seed);
  const H = 1.75;
  const w = axis === 'x' ? len : 0.5;
  const d = axis === 'x' ? 0.5 : len;
  return makeProp(w + 0.6, d + 0.6, H + 0.3, (g, ox, oy) => {
    const at = (t, z) => P(ox, oy, axis === 'x' ? t : 0, axis === 'x' ? 0 : t, z);
    morningShadow(g, ox, oy, axis === 'x' ? len : 0.3, axis === 'x' ? 0.3 : len, 0.5, 0.1);
    // 两端木杆
    for (const t of [-len / 2, len / 2]) {
      const b = at(t, 0);
      const tp = at(t, H);
      pxLine(g, b[0], b[1], tp[0], tp[1], '#6b5a38', 2);
      g.fillStyle = '#4e4128';
      g.fillRect(b[0] - 2, b[1] - 1, 5, 2);
    }
    // 绳：中段下垂 4px
    const a0 = at(-len / 2, H - 0.04);
    const a1 = at(len / 2, H - 0.04);
    const mid = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2 + 4];
    pxPolyline(g, [a0, mid, a1], '#b8b2a0', 1);
    // 衣物：布片挂在绳下，色块 + 一两道褶
    const n = Math.max(3, Math.round(len * 1.5));
    const cols = ['#6e5f4c', '#5c6068', '#57634f', '#8a8274', '#725548', '#7a7060'];
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + ((i + 0.5) / n) * len + (rand() - 0.5) * 0.15;
      const sag = 4 * (1 - Math.abs(t / (len / 2)) ** 2);
      const hp = at(t, H - 0.04);
      const w2 = 5 + ((rand() * 5) | 0);
      const h2 = 8 + ((rand() * 5) | 0);
      const c = cols[(rand() * cols.length) | 0];
      g.fillStyle = c;
      g.fillRect(hp[0] - (w2 >> 1), hp[1] + sag, w2, h2);
      g.fillStyle = shade(c, -0.22);
      g.fillRect(hp[0] - (w2 >> 1), hp[1] + sag + h2 - 2, w2, 2);
      g.fillStyle = shade(c, 0.14);
      g.fillRect(hp[0] - (w2 >> 1), hp[1] + sag, w2, 1);
      if (rand() > 0.5) {
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(hp[0] - (w2 >> 1) + 2, hp[1] + sag + 2, 1, h2 - 3);
      }
    }
  });
}

/** 浴室：三格淋浴棚，顶上一只供水桶，门口是分时段的牌子（字走 DOM 提示） */
export function makeShowerBlock(seed = 953) {
  const rand = mulberry32(seed);
  const W = 2.7;
  const D = 1.25;
  const H = 2.05;
  return makeProp(W + 0.8, D + 1.0, H + 0.9, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D, H * 0.9, 0.2);
    aoShadow(g, ox, oy, W, D, 0.35);
    // 门口的湿地 + 垫脚板
    pxBlob(g, ox - 2, oy + 9, 14, 5, 'rgba(40,52,58,0.3)', rand);
    const db = P(ox, oy, 0, D / 2 + 0.35, 0);
    g.fillStyle = '#6e5a3c';
    g.fillRect(db[0] - 12, db[1] - 3, 24, 4);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 5; i++) g.fillRect(db[0] - 10 + i * 5, db[1] - 3, 1, 4);
    // 主体：木框 + 帆布围挡
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, null, '#606d49', '#414a33');
    // +y 面（门脸）：三格门帘，中间一格掀开露出里面的桶
    faceLeft(g, ox, oy, D / 2);
    const uw = Math.round(W * TILE_W);
    const uh = Math.round(H * TILE_Z);
    g.fillStyle = '#4c5639';
    g.fillRect(Math.round(-W / 2 * TILE_W), -uh, uw, uh);
    for (let s = 0; s < 3; s++) {
      const x0 = Math.round((-W / 2 + 0.12 + s * (W / 3)) * TILE_W);
      const ww = Math.round((W / 3 - 0.24) * TILE_W);
      if (s === 1) {
        // 掀开的格子：里面是暗的，一只吊着的冲水桶 + 拉绳
        g.fillStyle = '#161a12';
        g.fillRect(x0, -uh + 6, ww, uh - 8);
        g.fillStyle = '#4c565c';
        g.fillRect(x0 + (ww >> 1) - 3, -uh + 12, 7, 6);
        g.fillStyle = '#6a7477';
        g.fillRect(x0 + (ww >> 1) - 3, -uh + 12, 7, 1);
        pxLine(g, x0 + (ww >> 1), -uh + 6, x0 + (ww >> 1), -uh + 12, '#8a8274', 1);
        pxLine(g, x0 + (ww >> 1) + 3, -uh + 18, x0 + (ww >> 1) + 5, -uh + 26, '#b8b2a0', 1);
        // 卷起系住的门帘
        pxLine(g, x0 + 1, -uh + 6, x0 + 2, -2, '#39412f', 3);
      } else {
        // 关着的门帘：布面分带 + 褶
        g.fillStyle = '#6d7450';
        g.fillRect(x0, -uh + 6, ww, Math.round(uh * 0.4));
        g.fillStyle = '#565e40';
        g.fillRect(x0, -uh + 6 + Math.round(uh * 0.4), ww, uh - 8 - Math.round(uh * 0.4));
        pxDither(g, x0, x0 + ww, -uh + 6 + Math.round(uh * 0.4), '#6d7450');
        g.fillStyle = 'rgba(0,0,0,0.2)';
        for (let i = 1; i < 3; i++) g.fillRect(x0 + Math.round((ww * i) / 3), -uh + 7, 1, uh - 10);
        // 下摆湿了一截
        g.fillStyle = 'rgba(30,38,40,0.4)';
        g.fillRect(x0, -6, ww, 5);
      }
      // 格间立柱
      g.fillStyle = '#393120';
      g.fillRect(x0 - 3, -uh + 2, 2, uh - 2);
    }
    g.fillStyle = '#393120';
    g.fillRect(Math.round((W / 2 - 0.06) * TILE_W), -uh + 2, 2, uh - 2);
    // 门楣横板
    g.fillStyle = '#6e5c3d';
    g.fillRect(Math.round(-W / 2 * TILE_W), -uh, uw, 5);
    g.fillStyle = '#84714b';
    g.fillRect(Math.round(-W / 2 * TILE_W), -uh, uw, 1);
    resetT(g);
    // 顶板 + 供水桶 + 引水管
    isoBox(g, ox, oy, -W / 2 - 0.08, -D / 2 - 0.08, H, W + 0.16, D + 0.16, 0.1, '#6e5c3d', '#54452c', '#3d3320');
    const dr = P(ox, oy, -0.4, 0, H + 0.1);
    g.fillStyle = '#4a545a';
    g.fillRect(dr[0] - 6, dr[1] - 11, 13, 11);
    g.fillStyle = '#5f6a70';
    g.fillRect(dr[0] - 6, dr[1] - 11, 13, 2);
    g.fillStyle = '#333c42';
    g.fillRect(dr[0] - 6, dr[1] - 3, 13, 3);
    pxEllipseRing(g, dr[0], dr[1] - 11, 6, 2.4, '#79858c', 1);
    // 水管沿顶板爬下去
    const pipeTo = P(ox, oy, W / 2 - 0.2, D / 2, H * 0.55);
    pxPolyline(g, [[dr[0] + 6, dr[1] - 4], [dr[0] + 14, dr[1] - 1], [pipeTo[0], pipeTo[1]]], '#4a545a', 2);
    // 时段牌：一块拉丁字牌（男/女的中文说明交给 hint）
    const sg = P(ox, oy, -W / 2 + 0.3, D / 2 + 0.05, H * 0.72);
    g.fillStyle = '#c9c2a6';
    g.fillRect(sg[0] - 6, sg[1] - 5, 13, 10);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(sg[0] - 6, sg[1] - 5, 13, 1);
    pxText(g, sg[0] - 4, sg[1] - 3, 'M-F', '#3a3a30', 1);
    pxText(g, sg[0] - 4, sg[1] + 1, '3', '#8a4030', 1);
  });
}

/** 旱厕：深坑式厕所棚，三扇木门，一根排气管，四周撒着石灰 */
export function makeLatrine(seed = 957) {
  const rand = mulberry32(seed);
  const W = 2.5;
  const D = 1.15;
  const H = 1.95;
  return makeProp(W + 1.0, D + 1.2, H + 0.8, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D, H * 0.9, 0.2);
    aoShadow(g, ox, oy, W, D, 0.35);
    // 四周撒的石灰：白色的粉带
    for (let i = 0; i < 8; i++) {
      const a = rand() * Math.PI * 2;
      const r = 14 + rand() * 12;
      pxBlob(g, ox + Math.cos(a) * r, oy + Math.sin(a) * r * 0.5 + 4, 4 + rand() * 6, 2 + rand() * 2, 'rgba(216,216,206,0.4)', rand);
    }
    // 主体：旧木板棚
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, null, '#5f5340', '#403626');
    // +y 门脸：三扇板门，一扇虚掩
    faceLeft(g, ox, oy, D / 2);
    const uw = Math.round(W * TILE_W);
    const uh = Math.round(H * TILE_Z);
    g.fillStyle = '#54452c';
    g.fillRect(Math.round(-W / 2 * TILE_W), -uh, uw, uh);
    // 板条竖纹
    g.fillStyle = 'rgba(0,0,0,0.2)';
    for (let x = 0; x < uw; x += 5) g.fillRect(Math.round(-W / 2 * TILE_W) + x, -uh, 1, uh);
    for (let s = 0; s < 3; s++) {
      const x0 = Math.round((-W / 2 + 0.12 + s * (W / 3)) * TILE_W);
      const ww = Math.round((W / 3 - 0.24) * TILE_W);
      const ajar = s === 2;
      g.fillStyle = ajar ? '#1a160f' : '#6b5a38';
      g.fillRect(x0, -uh + 8, ww, uh - 10);
      if (!ajar) {
        g.fillStyle = '#7d6a44';
        g.fillRect(x0, -uh + 8, ww, 2);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x0 + 1, -uh + 14, ww - 2, 1);
        g.fillRect(x0 + 1, -14, ww - 2, 1);
        // 门闩
        g.fillStyle = '#8a9295';
        g.fillRect(x0 + ww - 4, -uh + 22, 3, 2);
        // 通风口
        g.fillStyle = '#241f14';
        g.fillRect(x0 + (ww >> 1) - 3, -uh + 10, 6, 3);
      } else {
        // 虚掩：门板斜出一条缝
        pxPoly(g, [
          [x0 + 2, -uh + 8], [x0 + ww - 4, -uh + 10], [x0 + ww - 6, -2], [x0, -4],
        ], '#5f5040');
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(x0 + 2, -uh + 9, ww - 7, 1);
      }
      g.fillStyle = '#393120';
      g.fillRect(x0 - 3, -uh + 2, 2, uh - 2);
    }
    resetT(g);
    // 单坡顶
    const r0 = P(ox, oy, -W / 2 - 0.15, -D / 2 - 0.15, H + 0.3);
    const r1 = P(ox, oy, W / 2 + 0.15, -D / 2 - 0.15, H + 0.3);
    const r2 = P(ox, oy, W / 2 + 0.15, D / 2 + 0.2, H - 0.02);
    const r3 = P(ox, oy, -W / 2 - 0.15, D / 2 + 0.2, H - 0.02);
    poly(g, [r0, r1, r2, r3], '#6a6055');
    pxDitherLine(g, r3[0], r3[1], r2[0], r2[1], '#7c7266');
    pxLine(g, r0[0], r0[1], r1[0], r1[1], '#7f766a', 1);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 1; i < 5; i++) {
      const a2 = [r0[0] + ((r1[0] - r0[0]) * i) / 5, r0[1] + ((r1[1] - r0[1]) * i) / 5];
      const b2 = [r3[0] + ((r2[0] - r3[0]) * i) / 5, r3[1] + ((r2[1] - r3[1]) * i) / 5];
      pxLine(g, a2[0], a2[1], b2[0], b2[1], 'rgba(0,0,0,0.18)', 1);
    }
    // 排气管：后坡伸上去的一根黑管
    const vb = P(ox, oy, W / 2 - 0.35, -D / 2, H);
    pxLine(g, vb[0], vb[1], vb[0] + 1, vb[1] - 14, '#2e3336', 2);
    g.fillStyle = '#454d52';
    g.fillRect(vb[0] - 2, vb[1] - 16, 6, 3);
  });
}

/** 石灰袋：厕所边定期消毒用的一堆袋子 + 白粉 + 一把铁锹 */
export function makeLimeSacks(seed = 959) {
  const rand = mulberry32(seed);
  return makeProp(1.6, 1.4, 0.9, (g, ox, oy) => {
    aoShadow(g, ox, oy, 1.1, 0.9, 0.3);
    // 撒出来的白粉
    pxBlob(g, ox + 5, oy + 3, 10, 4, 'rgba(222,222,212,0.55)', rand);
    pxBlob(g, ox - 7, oy + 5, 6, 3, 'rgba(222,222,212,0.4)', rand);
    // 三只袋子
    for (const [bx, by, z] of [[-0.3, -0.15, 0], [0.25, 0.05, 0], [-0.05, -0.05, 0.32]]) {
      const c = ['#cfcabb', '#c2bdae'][(rand() * 2) | 0];
      isoBox(g, ox, oy, bx - 0.26, by - 0.2, z, 0.52, 0.4, 0.32, shade(c, 0.08), c, shade(c, -0.2));
      const p = P(ox, oy, bx + 0.26, by, z + 0.32);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(p[0] - 3, p[1], 5, 1);
    }
    // 标记：袋面上一个叉
    const m = P(ox, oy, 0.25, 0.25, 0.2);
    pxLine(g, m[0] - 2, m[1] - 2, m[0] + 2, m[1] + 2, '#6a6055', 1);
    pxLine(g, m[0] + 2, m[1] - 2, m[0] - 2, m[1] + 2, '#6a6055', 1);
    // 插在粉堆里的铁锹
    const s = P(ox, oy, 0.55, -0.3, 0);
    pxLine(g, s[0], s[1] - 1, s[0] + 4, s[1] - 14, '#6b5a38', 1);
    g.fillStyle = '#767e82';
    g.fillRect(s[0] - 2, s[1] - 4, 5, 5);
  });
}

/** 净水塔：军方管控的高架水罐，罐身水渍发黄，底下一排龙头和接水桶 */
export function makeWaterTower(seed = 961) {
  const rand = mulberry32(seed);
  const S = 0.72;
  const H = 1.7; // 架高
  const TH = 1.5; // 罐高
  return makeProp(2.6, 2.6, H + TH + 0.6, (g, ox, oy) => {
    morningShadow(g, ox, oy, 1.7, 1.7, 2.2, 0.2);
    aoShadow(g, ox, oy, 1.6, 1.6, 0.4);
    // 底下的黄泥水渍
    pxBlob(g, ox + 10, oy + 6, 12, 5, 'rgba(96,84,40,0.35)', rand);
    // 钢架四腿 + 斜撑
    for (const [lx, ly] of [[-S, -S], [S, -S], [-S, S], [S, S]]) {
      isoBox(g, ox, oy, lx - 0.07, ly - 0.07, 0, 0.14, 0.14, H, '#565f64', '#454d52', '#33393d');
    }
    const c1 = P(ox, oy, -S, S, 0.12);
    const c2 = P(ox, oy, S, S, H * 0.85);
    pxLine(g, c1[0], c1[1], c2[0], c2[1], '#454d52', 1);
    const c3 = P(ox, oy, S, S, 0.12);
    const c4 = P(ox, oy, -S, S, H * 0.85);
    pxLine(g, c3[0], c3[1], c4[0], c4[1], '#3d4449', 1);
    const d1 = P(ox, oy, S, -S, 0.12);
    const d2 = P(ox, oy, S, S, H * 0.85);
    pxLine(g, d1[0], d1[1], d2[0], d2[1], '#40474c', 1);
    // 罐体
    isoBox(g, ox, oy, -S - 0.16, -S - 0.16, H, (S + 0.16) * 2, (S + 0.16) * 2, TH, '#8a9598', '#6f7a7d', '#525b5e');
    // 罐身：黄色水渍一条条往下淌（军供水，水质发黄）
    faceRight(g, ox, oy, S + 0.16);
    const fw = Math.round((S + 0.16) * 2 * TILE_W);
    for (let i = 0; i < 7; i++) {
      const x = Math.round(rand() * fw) - fw;
      const hh = Math.round(6 + rand() * TH * TILE_Z * 0.7);
      g.fillStyle = `rgba(140,118,52,${(0.16 + rand() * 0.2).toFixed(2)})`;
      g.fillRect(x, -Math.round(H * TILE_Z) - hh, 2 + ((rand() * 2) | 0), hh);
    }
    // 水位刻度
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 1; i < 4; i++) g.fillRect(-fw, -Math.round((H + (TH * i) / 4) * TILE_Z), 6, 1);
    resetT(g);
    // 罐顶盖 + 检修口
    isoBox(g, ox, oy, -0.24, -0.24, H + TH, 0.48, 0.48, 0.1, '#9ba6a9', '#7e898c', '#5f686b');
    // 爬梯（+x 面）
    const lb = P(ox, oy, S + 0.18, -0.2, 0.1);
    const lt = P(ox, oy, S + 0.18, -0.2, H + TH);
    pxLine(g, lb[0], lb[1], lt[0], lt[1], '#454d52', 1);
    pxLine(g, lb[0] + 4, lb[1] - 2, lt[0] + 4, lt[1] - 2, '#454d52', 1);
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const y = lb[1] + (lt[1] - lb[1]) * t;
      g.fillStyle = '#565f64';
      g.fillRect(lb[0], Math.round(y), 5, 1);
    }
    // 落水总管 + 一排三只龙头
    const pm = P(ox, oy, 0, S + 0.3, 0);
    const pt2 = P(ox, oy, 0, S + 0.1, H);
    pxLine(g, pt2[0], pt2[1], pm[0], pm[1] - 10, '#4a545a', 2);
    g.fillStyle = '#4a545a';
    g.fillRect(pm[0] - 12, pm[1] - 10, 25, 3);
    for (const dx of [-9, 0, 9]) {
      g.fillStyle = '#6a7477';
      g.fillRect(pm[0] + dx, pm[1] - 8, 2, 4);
      g.fillStyle = '#8a9295';
      g.fillRect(pm[0] + dx - 1, pm[1] - 9, 4, 1);
    }
    // 接水的桶与壶
    for (const [dx, dy, c] of [[-10, 2, '#4c565c'], [1, 4, '#6d5a3a'], [10, 1, '#5a6a72']]) {
      g.fillStyle = shade(c, -0.2);
      g.fillRect(pm[0] + dx - 3, pm[1] + dy - 6, 7, 6);
      g.fillStyle = c;
      g.fillRect(pm[0] + dx - 3, pm[1] + dy - 6, 7, 2);
    }
    // 铁牌：H2O 配给
    const sg = P(ox, oy, -S - 0.2, S + 0.1, H * 0.6);
    g.fillStyle = '#7a8386';
    g.fillRect(sg[0] - 7, sg[1] - 6, 15, 11);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(sg[0] - 7, sg[1] - 6, 15, 2);
    pxText(g, sg[0] - 5, sg[1] - 3, 'H2O', '#2e3336', 1);
    pxText(g, sg[0] - 5, sg[1] + 2, '2L', '#7a3428', 1);
  });
}

/** 手压井：石圈台 + 压杆泵 + 出水口下的桶（水质发黄，井台泛着碱渍） */
export function makeWell(seed = 963) {
  const rand = mulberry32(seed);
  return makeProp(1.8, 1.8, 1.4, (g, ox, oy) => {
    aoShadow(g, ox, oy, 1.2, 1.2, 0.35);
    // 井台：石圈
    pxEllipse(g, ox, oy, 14, 7, '#8f8d80');
    pxEllipse(g, ox, oy - 2, 14, 7, '#9b998c');
    pxEllipseRing(g, ox, oy - 2, 14, 7, '#75736a', 1);
    // 碱渍
    pxBlob(g, ox - 4, oy + 2, 8, 3, 'rgba(150,132,70,0.35)', rand);
    for (let i = 0; i < 6; i++) {
      const a = rand() * 6.3;
      g.fillStyle = ['#84826f', '#6e6c5d'][(rand() * 2) | 0];
      g.fillRect(ox + Math.cos(a) * 11 - 1, oy - 2 + Math.sin(a) * 5, 3, 2);
    }
    // 泵体：立管 + 压杆 + 出水嘴
    const b = P(ox, oy, 0.1, -0.1, 0);
    pxLine(g, b[0], b[1] - 4, b[0], b[1] - 18, '#3d4449', 3);
    g.fillStyle = '#565f64';
    g.fillRect(b[0] - 2, b[1] - 21, 5, 4);
    // 压杆（斜向上翘）
    pxLine(g, b[0] + 1, b[1] - 20, b[0] + 10, b[1] - 26, '#6a7477', 2);
    g.fillStyle = '#8a9295';
    g.fillRect(b[0] + 9, b[1] - 27, 3, 3);
    // 出水嘴 + 滴下的黄水
    pxLine(g, b[0] - 1, b[1] - 16, b[0] - 6, b[1] - 14, '#4a545a', 2);
    g.fillStyle = 'rgba(150,128,60,0.6)';
    g.fillRect(b[0] - 7, b[1] - 12, 1, 4);
    // 接水桶
    g.fillStyle = '#4c565c';
    g.fillRect(b[0] - 10, b[1] - 8, 7, 7);
    g.fillStyle = '#6a7477';
    g.fillRect(b[0] - 10, b[1] - 8, 7, 1);
    pxEllipse(g, b[0] - 7, b[1] - 8, 3, 1, 'rgba(140,120,60,0.7)');
  });
}

/** 柴油发电机组：铁皮顶棚 + 机体 + 排气管（烟由运行期粒子喷）+ 电缆卷 */
export function makeGenerator(seed = 967) {
  const rand = mulberry32(seed);
  const W = 2.3;
  const D = 1.5;
  return makeProp(W + 0.9, D + 1.0, 2.6, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D, 1.4, 0.2);
    aoShadow(g, ox, oy, W, D, 0.4);
    // 混凝土基座
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, 0.12, '#8a887c', '#6e6c62', '#54524a');
    // 顶棚四柱（先远后近，柱子比机体高）
    const CH = 2.1;
    const pole = (px, py) => {
      const pb = P(ox, oy, px, py, 0.12);
      const pt2 = P(ox, oy, px, py, CH);
      pxLine(g, pb[0], pb[1], pt2[0], pt2[1], '#4a5154', 2);
    };
    pole(-W / 2 + 0.1, -D / 2 + 0.1);
    pole(W / 2 - 0.1, -D / 2 + 0.1);
    // 机体：军绿铁壳
    isoBox(g, ox, oy, -0.85, -0.45, 0.12, 1.7, 0.9, 0.85, '#5b6448', '#48513a', '#33392a');
    // 散热格栅（+x 端面）
    const gr = P(ox, oy, 0.85, 0, 0.55);
    g.fillStyle = '#2b3125';
    g.fillRect(gr[0] - 5, gr[1] - 7, 10, 12);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    for (let i = 0; i < 5; i++) g.fillRect(gr[0] - 4, gr[1] - 6 + i * 2.4, 8, 1);
    // 控制面板（+y 面）：几个小表盘
    const pn = P(ox, oy, -0.2, 0.45, 0.6);
    g.fillStyle = '#2e3336';
    g.fillRect(pn[0] - 6, pn[1] - 5, 12, 8);
    g.fillStyle = '#79d2cc';
    g.fillRect(pn[0] - 4, pn[1] - 3, 2, 2);
    g.fillStyle = '#e0a552';
    g.fillRect(pn[0], pn[1] - 3, 2, 2);
    g.fillStyle = '#5a6a72';
    g.fillRect(pn[0] - 4, pn[1] + 1, 8, 1);
    // 排气管：立管 + 防雨帽（烟从这里冒，运行期喷）
    const ex = P(ox, oy, -0.7, -0.35, 0.97);
    pxLine(g, ex[0], ex[1], ex[0] - 1, ex[1] - 15, '#3d4449', 2);
    g.fillStyle = '#565f64';
    g.fillRect(ex[0] - 4, ex[1] - 18, 7, 3);
    g.fillStyle = '#22262a';
    g.fillRect(ex[0] - 3, ex[1] - 15, 5, 1);
    // 油桶 + 电缆卷
    isoBox(g, ox, oy, W / 2 - 0.45, D / 2 - 0.5, 0.12, 0.42, 0.42, 0.6, '#6d5a3a', '#57482e', '#3d3320');
    const cd = P(ox, oy, -W / 2 + 0.35, D / 2 - 0.25, 0.12);
    pxEllipseRing(g, cd[0], cd[1] - 6, 6, 6, '#54452c', 2);
    pxEllipseRing(g, cd[0], cd[1] - 6, 3, 3, '#3d3320', 1);
    // 电缆爬出去（往 -y，通向探照灯）
    pxPolyline(g, [
      [cd[0], cd[1] - 1],
      [cd[0] - 8, cd[1] + 2],
      [cd[0] - 18, cd[1] - 2],
      [cd[0] - 26, cd[1] + 1],
    ], '#14181a', 2);
    // 近柱 + 铁皮单坡顶
    pole(-W / 2 + 0.1, D / 2 - 0.1);
    pole(W / 2 - 0.1, D / 2 - 0.1);
    const r0 = P(ox, oy, -W / 2 - 0.2, -D / 2 - 0.25, CH + 0.22);
    const r1 = P(ox, oy, W / 2 + 0.2, -D / 2 - 0.25, CH + 0.22);
    const r2 = P(ox, oy, W / 2 + 0.2, D / 2 + 0.25, CH - 0.06);
    const r3 = P(ox, oy, -W / 2 - 0.2, D / 2 + 0.25, CH - 0.06);
    poly(g, [r0, r1, r2, r3], '#6e7276');
    pxLine(g, r0[0], r0[1], r1[0], r1[1], '#878c90', 1);
    // 瓦楞纹
    for (let i = 1; i < 7; i++) {
      const a2 = [r0[0] + ((r1[0] - r0[0]) * i) / 7, r0[1] + ((r1[1] - r0[1]) * i) / 7];
      const b2 = [r3[0] + ((r2[0] - r3[0]) * i) / 7, r3[1] + ((r2[1] - r3[1]) * i) / 7];
      pxLine(g, a2[0], a2[1], b2[0], b2[1], 'rgba(0,0,0,0.16)', 1);
    }
    // 锈斑
    g.globalAlpha = 0.4;
    for (let i = 0; i < 5; i++) {
      const p = [r0[0] + rand() * (r2[0] - r0[0]), r0[1] + rand() * (r2[1] - r0[1])];
      pxBlob(g, p[0], p[1], 2 + rand() * 3, 1 + rand() * 2, '#6d4a30', rand);
    }
    g.globalAlpha = 1;
  });
}

/** 军械库：加固的钢制集装箱，双开门上锁，门脸上喷着编号 */
export function makeArmoryBox(seed = 971) {
  const rand = mulberry32(seed);
  const W = 2.3;
  const D = 1.25;
  const H = 1.5;
  return makeProp(W + 0.7, D + 0.9, H + 0.5, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D, H * 0.95, 0.2);
    aoShadow(g, ox, oy, W, D, 0.4);
    isoBox(g, ox, oy, -W / 2, -D / 2, 0, W, D, H, '#57604a', '#465041', '#333b30');
    // 顶面锈渍
    faceTop(g, ox, oy, H);
    for (let i = 0; i < 6; i++) {
      pxBlob(g, (rand() - 0.5) * W * TILE_W, (rand() - 0.5) * D * TILE_W, 2 + rand() * 5, 2 + rand() * 3, 'rgba(109,74,48,0.3)', rand);
    }
    resetT(g);
    // +x 端：双开门 + 锁杆 + 挂锁
    faceRight(g, ox, oy, W / 2);
    const fw = Math.round(D * TILE_W);
    const fh = Math.round(H * TILE_Z);
    g.fillStyle = '#4d5741';
    g.fillRect(-fw, -fh, fw, fh);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(-(fw >> 1) - 1, -fh + 2, 2, fh - 4);
    for (const x0 of [-fw + 2, -(fw >> 1) + 2]) {
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(x0, -fh + 2, 1, fh - 4);
      // 门杆
      g.fillStyle = '#39412f';
      g.fillRect(x0 + 4, -fh + 2, 2, fh - 4);
      g.fillStyle = '#6a7458';
      g.fillRect(x0 + 4, -fh + 4, 2, 2);
      g.fillRect(x0 + 4, -8, 2, 2);
    }
    // 挂锁
    g.fillStyle = '#8a9295';
    g.fillRect(-(fw >> 1) - 2, -(fh >> 1), 4, 4);
    g.fillStyle = '#565f64';
    g.fillRect(-(fw >> 1) - 1, -(fh >> 1) - 2, 2, 2);
    resetT(g);
    // +y 长面：波纹板 + 白漆编号
    faceLeft(g, ox, oy, D / 2);
    const lw = Math.round(W * TILE_W);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    for (let x = 0; x < lw; x += 5) g.fillRect(Math.round(-W / 2 * TILE_W) + x, -fh + 2, 2, fh - 4);
    pxText(g, Math.round(-W / 2 * TILE_W) + 8, -fh + 9, 'ARMORY', 'rgba(214,214,200,0.75)', 2);
    pxText(g, Math.round(-W / 2 * TILE_W) + 8, -14, 'NO ENTRY', 'rgba(180,86,60,0.7)', 1);
    // 锈痕从铆钉往下淌
    for (let i = 0; i < 6; i++) {
      const x = Math.round(-W / 2 * TILE_W) + 4 + ((rand() * (lw - 8)) | 0);
      g.fillStyle = 'rgba(109,74,48,0.35)';
      g.fillRect(x, -fh + 4 + ((rand() * 8) | 0), 1, 4 + ((rand() * 8) | 0));
    }
    resetT(g);
  });
}

/** 广播电线杆：木杆 + 横担 + 两只铁皮喇叭 + 下垂的线，杆上钉着布告 */
export function makeSpeakerPole(seed = 975) {
  const rand = mulberry32(seed);
  const H = 3.3;
  return makeProp(1.3, 1.3, H + 0.5, (g, ox, oy) => {
    morningShadow(g, ox, oy, 0.4, 0.4, 2.6, 0.14);
    aoShadow(g, ox, oy, 0.55, 0.55, 0.3);
    const b = P(ox, oy, 0, 0, 0);
    const t = P(ox, oy, 0, 0, H);
    // 杆体：两色木纹
    pxLine(g, b[0], b[1], t[0], t[1], '#6b5a38', 3);
    pxLine(g, b[0] + 1, b[1], t[0] + 1, t[1], '#4e4128', 1);
    g.fillStyle = '#393120';
    g.fillRect(b[0] - 2, b[1] - 1, 6, 2);
    // 横担
    pxLine(g, t[0] - 9, t[1] + 3, t[0] + 10, t[1] - 1, '#54452c', 2);
    // 两只喇叭：铁皮锥，一只朝 -x 一只朝 +x
    for (const dir of [-1, 1]) {
      const hx = t[0] + dir * 8;
      const hy = t[1] + (dir > 0 ? 0 : 3);
      pxPoly(g, [
        [hx, hy - 2], [hx + dir * 7, hy - 4], [hx + dir * 7, hy + 4], [hx, hy + 2],
      ], '#5f6a70');
      g.fillStyle = '#79858c';
      g.fillRect(Math.min(hx + dir * 7, hx + dir * 6), hy - 4, 2, 8);
      g.fillStyle = '#333c42';
      g.fillRect(hx - 1, hy - 2, 2, 4);
    }
    // 引下线 + 瓷瓶
    g.fillStyle = '#b8b2a0';
    g.fillRect(t[0] - 8, t[1] + 1, 2, 2);
    pxPolyline(g, [
      [t[0] - 7, t[1] + 3],
      [t[0] - 3, t[1] + 16],
      [t[0], t[1] + 30],
      [b[0] + 1, b[1] - 14],
    ], '#14181a', 1);
    // 布告：钉在齐眼高的地方，纸边卷角
    const n = P(ox, oy, 0.06, 0.06, 1.35);
    g.fillStyle = '#c9c2a6';
    g.fillRect(n[0] - 4, n[1] - 6, 9, 11);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let i = 0; i < 4; i++) g.fillRect(n[0] - 3, n[1] - 4 + i * 2.6, 7, 1);
    g.fillStyle = '#a89f88';
    g.fillRect(n[0] + 3, n[1] + 3, 2, 2);
    void rand;
  });
}

/** 垃圾堆：混着铁皮罐、破布、纸壳的一座小山（苍蝇由运行期画） */
export function makeTrashHeap(seed = 977, big = false) {
  const rand = mulberry32(seed);
  const R = big ? 1.4 : 1.0;
  return makeProp(R * 2 + 0.6, R * 2 * 0.8 + 0.6, 1.1, (g, ox, oy) => {
    aoShadow(g, ox, oy, R * 1.8, R * 1.4, 0.35);
    // 堆体：三层叠的杂色摊
    const base = ['#4a453a', '#3e3a30', '#55503f'];
    pxBlob(g, ox, oy, R * TILE_W * 0.62, R * TILE_W * 0.3, base[0], rand);
    pxBlob(g, ox - 3, oy - 4, R * TILE_W * 0.48, R * TILE_W * 0.24, base[1], rand);
    pxBlob(g, ox + 2, oy - 8, R * TILE_W * 0.34, R * TILE_W * 0.18, base[2], rand);
    // 顶部受光
    pxBlob(g, ox + 1, oy - 10, R * TILE_W * 0.2, R * TILE_W * 0.1, '#67614c', rand);
    // 杂物细节：罐头皮、玻璃、破布、纸壳
    const bits = [
      ['#9aa3a6', 2, 1], ['#7a8386', 2, 2], ['#4a6a4a', 1, 2],
      ['#b5b2a0', 3, 2], ['#6e4a3a', 2, 2], ['#54606a', 2, 1], ['#8a6a32', 1, 1],
    ];
    for (let i = 0; i < (big ? 26 : 16); i++) {
      const [c, w2, h2] = bits[(rand() * bits.length) | 0];
      const a = rand() * Math.PI * 2;
      const r = rand() * R * TILE_W * 0.55;
      g.fillStyle = c;
      g.fillRect(Math.round(ox + Math.cos(a) * r), Math.round(oy - 4 + Math.sin(a) * r * 0.45 - rand() * 8), w2, h2);
    }
    // 一只倒着的破桶 + 露出来的车轮
    const dp = P(ox, oy, R * 0.6, R * 0.3, 0);
    g.fillStyle = '#5a5248';
    g.fillRect(dp[0] - 4, dp[1] - 4, 8, 5);
    pxEllipseRing(g, dp[0] + 4, dp[1] - 2, 2, 2, '#33393d', 1);
    if (big) {
      const wl = P(ox, oy, -R * 0.7, R * 0.2, 0);
      pxEllipseRing(g, wl[0], wl[1] - 3, 5, 4, '#22262a', 2);
      pxEllipseRing(g, wl[0], wl[1] - 3, 2, 1.6, '#454d52', 1);
    }
    // 渗出来的污水
    pxBlob(g, ox + R * TILE_W * 0.4, oy + 6, 8, 3, 'rgba(52,54,36,0.5)', rand);
  });
}

/** 焚烧坑：土坎围出的浅坑，烧到一半的垃圾（火苗与浓烟由运行期画） */
export function makeBurnPit(seed = 979) {
  const rand = mulberry32(seed);
  return makeProp(2.6, 2.4, 0.8, (g, ox, oy) => {
    // 大片焦土
    pxEllipse(g, ox, oy, 26, 12, '#2c2620');
    pxEllipse(g, ox, oy, 19, 8.6, '#1c1813');
    // 土坎围了一圈
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      const px = Math.round(ox + Math.cos(a) * 24);
      const py = Math.round(oy + Math.sin(a) * 10.6);
      const c = ['#6a5a42', '#5a4c38'][(rand() * 2) | 0];
      g.fillStyle = shade(c, -0.25);
      g.fillRect(px - 2, py - 1, 6, 3);
      g.fillStyle = c;
      g.fillRect(px - 2, py - 3, 6, 2);
    }
    // 烧到一半的东西：焦木、铁皮、一只烧黑的桶
    pxLine(g, ox - 8, oy - 2, ox + 7, oy - 5, '#241c12', 2);
    pxLine(g, ox - 4, oy + 3, ox + 9, oy, '#180f08', 2);
    g.fillStyle = '#3a3f42';
    g.fillRect(ox + 3, oy - 6, 6, 3);
    const bb = P(ox, oy, -0.55, 0.35, 0);
    g.fillStyle = '#26221c';
    g.fillRect(bb[0] - 3, bb[1] - 8, 7, 8);
    g.fillStyle = '#3d362c';
    g.fillRect(bb[0] - 3, bb[1] - 8, 7, 1);
    // 灰烬
    g.fillStyle = '#8d8578';
    g.fillRect(ox - 3, oy - 1, 4, 1);
    g.fillRect(ox + 2, oy + 2, 3, 1);
    g.fillStyle = '#a89f92';
    g.fillRect(ox - 1, oy - 3, 2, 1);
  });
}

/** 军犬围栏：矮铁网圈 + 犬舍 + 拴桩铁链 + 食盆 */
export function makeKennel(seed = 981) {
  const rand = mulberry32(seed);
  const W = 2.2;
  const D = 1.7;
  const H = 0.85;
  return makeProp(W + 0.8, D + 0.8, 1.6, (g, ox, oy) => {
    morningShadow(g, ox, oy, W, D, 0.6, 0.14);
    // 围栏：四边矮网（远侧两边先画）
    const mesh = (x0, y0, x1, y1) => {
      const a = P(ox, oy, x0, y0, 0.05);
      const b = P(ox, oy, x1, y1, 0.05);
      const a2 = P(ox, oy, x0, y0, H);
      const b2 = P(ox, oy, x1, y1, H);
      pxPoly(g, [a, b, b2, a2], 'rgba(150,160,158,0.12)');
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const wires = Math.max(3, Math.round(L / 5));
      for (let i = 0; i <= wires; i++) {
        const t = i / wires;
        const px = a[0] + (b[0] - a[0]) * t;
        const py = a[1] + (b[1] - a[1]) * t;
        const px2 = a2[0] + (b2[0] - a2[0]) * t;
        const py2 = a2[1] + (b2[1] - a2[1]) * t;
        pxLine(g, px, py, px2, py2, 'rgba(160,170,168,0.25)', 1);
      }
      pxLine(g, a2[0], a2[1], b2[0], b2[1], '#7b8683', 1);
      pxLine(g, a[0], a[1], b[0], b[1], '#5a6462', 1);
      for (const [px, py, pz] of [[x0, y0, 0], [x1, y1, 0]]) {
        const pb = P(ox, oy, px, py, pz);
        const pt2 = P(ox, oy, px, py, H + 0.08);
        pxLine(g, pb[0], pb[1], pt2[0], pt2[1], '#4d5654', 2);
      }
    };
    mesh(-W / 2, -D / 2, W / 2, -D / 2);
    mesh(-W / 2, -D / 2, -W / 2, D / 2);
    // 地面刨出来的土坑
    pxBlob(g, ox + 6, oy + 2, 7, 3, 'rgba(70,56,40,0.5)', rand);
    pxBlob(g, ox - 8, oy + 4, 5, 2, 'rgba(70,56,40,0.4)', rand);
    // 犬舍：小尖顶木屋，洞口朝 +x
    const kx = -W / 2 + 0.55;
    const ky = -D / 2 + 0.5;
    isoBox(g, ox, oy, kx - 0.4, ky - 0.35, 0, 0.8, 0.7, 0.55, null, '#6b5a38', '#4a3d27');
    const ra = P(ox, oy, kx - 0.45, ky, 0.85);
    const rb = P(ox, oy, kx + 0.45, ky, 0.85);
    const e0 = P(ox, oy, kx + 0.4, ky - 0.35, 0.55);
    const e1 = P(ox, oy, kx + 0.4, ky + 0.35, 0.55);
    const f0 = P(ox, oy, kx - 0.4, ky - 0.35, 0.55);
    const f1 = P(ox, oy, kx - 0.4, ky + 0.35, 0.55);
    poly(g, [f0, ra, rb, e0], '#57492f');
    poly(g, [f1, ra, rb, e1], '#84714b');
    poly(g, [e0, e1, rb], '#6e5c3d');
    // 洞口
    const hm = [(e0[0] + e1[0]) / 2, (e0[1] + e1[1]) / 2 + 4];
    pxPoly(g, [
      [hm[0] - 3, hm[1] + 4], [hm[0] + 3, hm[1] + 5], [hm[0] + 2, hm[1] - 3], [hm[0] - 2, hm[1] - 3],
    ], '#12100b');
    // 拴桩 + 铁链
    const st = P(ox, oy, 0.45, 0.3, 0);
    pxLine(g, st[0], st[1], st[0], st[1] - 6, '#4d5654', 2);
    pxPolyline(g, [
      [st[0], st[1] - 5],
      [st[0] + 6, st[1] - 1],
      [st[0] + 12, st[1] + 2],
    ], '#6a7477', 1);
    // 食盆 + 水盆
    const fb = P(ox, oy, 0.2, D / 2 - 0.35, 0);
    pxEllipse(g, fb[0], fb[1] - 1, 4, 2, '#79858c');
    pxEllipse(g, fb[0], fb[1] - 1.5, 2.5, 1.2, '#4a3d27');
    const wb2 = P(ox, oy, 0.75, D / 2 - 0.5, 0);
    pxEllipse(g, wb2[0], wb2[1] - 1, 4, 2, '#5f6a70');
    pxEllipse(g, wb2[0], wb2[1] - 1.5, 2.5, 1.2, '#3c4a52');
    // 啃过的骨头
    g.fillStyle = '#c2bdae';
    g.fillRect(ox + 2, oy + 5, 4, 1);
    g.fillRect(ox + 1, oy + 4, 1, 1);
    g.fillRect(ox + 6, oy + 4, 1, 1);
  });
}

/** 木牌：立柱 + 横板，只写拉丁短字（中文说明走 DOM 提示） */
export function makeSign(seed = 985, txt = 'A1', col = '#c9c2a6') {
  const rand = mulberry32(seed);
  const H = 1.5;
  const w = Math.max(14, String(txt).length * 8 + 6);
  return makeProp(1.0, 1.0, H + 0.4, (g, ox, oy) => {
    morningShadow(g, ox, oy, 0.3, 0.3, 1.0, 0.12);
    const b = P(ox, oy, 0, 0, 0);
    const t = P(ox, oy, 0, 0, H);
    pxLine(g, b[0], b[1], t[0], t[1], '#5c4d31', 2);
    g.fillStyle = '#413723';
    g.fillRect(b[0] - 2, b[1] - 1, 5, 2);
    // 横板
    g.fillStyle = shade(col, -0.3);
    g.fillRect(t[0] - (w >> 1), t[1] - 2, w, 12);
    g.fillStyle = col;
    g.fillRect(t[0] - (w >> 1), t[1] - 3, w, 10);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(t[0] - (w >> 1), t[1] + 5, w, 2);
    pxText(g, t[0] - (String(txt).length * 4 - 1), t[1] - 1, txt, '#3a3a30', 2);
    // 钉子
    g.fillStyle = '#54452c';
    g.fillRect(t[0] - 1, t[1] - 2, 2, 1);
    void rand;
  });
}

/* ------------------------------------------------------------------ *
 * 军犬（德国牧羊犬）：每帧现画的四足精灵，跟角色一样走整数锚点。
 * o = { face(±1), moving, walk, kind('sit' 原地蹲坐), t(呼吸相位) }
 * ------------------------------------------------------------------ */

const DOG = {
  coat: '#7a5c38', // 棕黄底毛
  coatD: '#5e4527',
  saddle: '#2e2a22', // 黑背
  muzzle: '#1d1a16',
  belly: '#8a6c44',
  harness: '#3a4030',
};

export function drawDog(g, sx, sy, o = {}) {
  const face = o.face >= 0 ? 1 : -1;
  const X = Math.round(sx);
  const Y = Math.round(sy);
  const t = o.t || 0;
  const breathe = o.moving ? 0 : Math.round(Math.sin(t * 1.4 + (o.seed || 0)) * 0.8);
  // 影子
  pxEllipse(g, X, Y + 1, 9, 3, 'rgba(24,26,40,0.3)');

  const F = (dx) => X + dx * face;

  if (o.kind === 'sit') {
    // 坐姿：后臀落地，前腿撑直，头抬着
    g.fillStyle = DOG.coatD;
    pxEllipse(g, F(-3), Y - 4, 5, 4, DOG.coatD); // 后臀
    g.fillStyle = DOG.saddle;
    g.fillRect(F(-6), Y - 8, 6, 3);
    // 前腿
    g.fillStyle = DOG.coat;
    g.fillRect(F(3), Y - 6, 2, 6);
    g.fillRect(F(1) - 1, Y - 6, 2, 6);
    // 胸/颈
    g.fillStyle = DOG.coat;
    g.fillRect(F(0), Y - 10, 5 * face, 5);
    if (face < 0) g.fillRect(F(4), Y - 10, 5, 5);
    // 头
    g.fillStyle = DOG.coat;
    g.fillRect(F(2), Y - 14 + breathe, 5 * face, 4);
    if (face < 0) g.fillRect(F(6), Y - 14 + breathe, 5, 4);
    g.fillStyle = DOG.muzzle;
    g.fillRect(F(6), Y - 13 + breathe, 3 * face, 2);
    if (face < 0) g.fillRect(F(8), Y - 13 + breathe, 3, 2);
    // 立耳两只
    g.fillStyle = DOG.saddle;
    g.fillRect(F(2), Y - 16 + breathe, 2, 2);
    g.fillRect(F(5), Y - 16 + breathe, 2, 2);
    // 尾巴绕在身侧
    g.fillStyle = DOG.coatD;
    g.fillRect(F(-7), Y - 2, 4, 2);
    return;
  }

  // 站姿 / 走姿
  const step = o.moving ? (Math.floor((o.walk || 0) * 2.2) & 1 ? 1 : -1) : 0;
  // 远侧两条腿（暗）
  g.fillStyle = DOG.coatD;
  g.fillRect(F(-5 + step), Y - 5, 2, 5);
  g.fillRect(F(4 - step), Y - 5, 2, 5);
  // 躯干
  g.fillStyle = DOG.coat;
  g.fillRect(F(-7), Y - 9 + breathe, 14 * face, 5);
  if (face < 0) g.fillRect(F(7), Y - 9 + breathe, 14, 5);
  // 黑背鞍面
  g.fillStyle = DOG.saddle;
  g.fillRect(F(-6), Y - 10 + breathe, 10 * face, 3);
  if (face < 0) g.fillRect(F(4), Y - 10 + breathe, 10, 3);
  // 腹线
  g.fillStyle = DOG.belly;
  g.fillRect(F(-4), Y - 5 + breathe, 7 * face, 1);
  if (face < 0) g.fillRect(F(3), Y - 5 + breathe, 7, 1);
  // 近侧两条腿
  g.fillStyle = DOG.coat;
  g.fillRect(F(-6 - step), Y - 5, 2, 6);
  g.fillRect(F(5 + step), Y - 5, 2, 6);
  // 爪
  g.fillStyle = DOG.muzzle;
  g.fillRect(F(-6 - step), Y, 2, 1);
  g.fillRect(F(5 + step), Y, 2, 1);
  // 颈 + 头（略昂）
  g.fillStyle = DOG.coat;
  g.fillRect(F(5), Y - 12 + breathe, 4 * face, 5);
  if (face < 0) g.fillRect(F(8), Y - 12 + breathe, 4, 5);
  g.fillStyle = DOG.coat;
  g.fillRect(F(7), Y - 14 + breathe, 4 * face, 4);
  if (face < 0) g.fillRect(F(10), Y - 14 + breathe, 4, 4);
  // 口鼻
  g.fillStyle = DOG.muzzle;
  g.fillRect(F(10), Y - 13 + breathe, 3 * face, 2);
  if (face < 0) g.fillRect(F(12), Y - 13 + breathe, 3, 2);
  // 立耳
  g.fillStyle = DOG.saddle;
  g.fillRect(F(7), Y - 16 + breathe, 2, 2);
  g.fillRect(F(10), Y - 16 + breathe, 2, 2);
  // 眼
  g.fillStyle = '#0c0a08';
  g.fillRect(F(9), Y - 13 + breathe, 1, 1);
  // 胸带（军犬的鞍具）
  g.fillStyle = DOG.harness;
  g.fillRect(F(3), Y - 9 + breathe, 2, 4);
  // 尾巴：走路时甩两档
  const wag = o.moving ? step : Math.round(Math.sin(t * 2.3) * 1);
  g.fillStyle = DOG.coatD;
  pxLine(g, F(-7), Y - 8 + breathe, F(-10), Y - 5 + wag, DOG.coatD, 2);
}
