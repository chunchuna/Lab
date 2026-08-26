import { HW, HH, TILE_W, TILE_Z } from './config.js';
import { makeCanvas, mulberry32, shade, baseT, localT, blit } from './util.js';

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
 * 基础绘制助手
 * ------------------------------------------------------------------ */

export function poly(g, pts, fill, stroke, lw = 1) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  if (stroke) {
    g.strokeStyle = stroke;
    g.lineWidth = lw;
    g.stroke();
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

/** 足迹阴影 */
export function aoShadow(g, ox, oy, w, d, a = 0.45) {
  g.save();
  g.translate(ox, oy);
  g.scale(1, HH / HW);
  const r = ((w + d) / 2) * HW * 0.78;
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, r);
  grd.addColorStop(0, `rgba(0,0,0,${a})`);
  grd.addColorStop(0.6, `rgba(0,0,0,${a * 0.55})`);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
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
  const sil = makeCanvas(lw, lh);
  blit(sil.g, img, 0, 0);
  sil.g.globalCompositeOperation = 'source-in';
  sil.g.fillStyle = color;
  sil.g.fillRect(0, 0, lw, lh);

  const pad = r + 1;
  const { c, g } = makeCanvas(lw + pad * 2, lh + pad * 2);
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
  const { c, g } = makeCanvas(cw, ch);
  draw(g, ox, oy);
  resetT(g);
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
      g.fillStyle = '#15191c';
      g.beginPath();
      g.ellipse(p[0], p[1] + 1, 2.4, 1.4, 0, 0, Math.PI * 2);
      g.fill();
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
    g.fillStyle = PAL.blood;
    for (let i = 0; i < 7; i++) {
      const bx = 0.15 + rand() * 0.7,
        by = -0.35 + rand() * 0.7;
      g.beginPath();
      g.ellipse(bx * TILE_W, by * TILE_W, (0.06 + rand() * 0.16) * TILE_W, (0.05 + rand() * 0.13) * TILE_W, 0, 0, Math.PI * 2);
      g.fill();
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
    // 门缝 + 面板
    g.fillStyle = '#2a312f';
    g.fillRect(-0.02 * TILE_W, -h + 2, 0.04 * TILE_W, h - 4);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 1;
    g.strokeRect(-(D / 2 - 0.06) * TILE_W, -h + 4, (D - 0.12) * TILE_W, h - 8);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(-(D / 2 - 0.06) * TILE_W, -h + 4, (D - 0.12) * TILE_W, 2);
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
    // 标签
    g.fillStyle = 'rgba(224,165,82,0.75)';
    g.fillRect(-(D / 2 - 0.16) * TILE_W, -h + 6, 0.5 * TILE_W, 5);
    g.fillStyle = '#1a1c18';
    g.font = '4px monospace';
    g.fillText('EMG-04', -(D / 2 - 0.14) * TILE_W, -h + 10.4);
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
        // 裂纹
        g.strokeStyle = 'rgba(190,205,205,0.4)';
        g.lineWidth = 0.6;
        g.beginPath();
        const cx = 0,
          cy = zb - 0.36 * TILE_Z;
        for (let i = 0; i < 7; i++) {
          g.moveTo(cx, cy);
          g.lineTo(cx + Math.cos((i / 7) * 6.28) * (4 + rand() * 8), cy + Math.sin((i / 7) * 6.28) * (3 + rand() * 5));
        }
        g.stroke();
      }
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 1;
      g.strokeRect((-sw / 2) * TILE_W, zb - 0.66 * TILE_Z, sw * TILE_W, 0.6 * TILE_Z);
      resetT(g);
    }
    // 线缆
    g.strokeStyle = '#191d1f';
    g.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const a = P(ox, oy, w / 2 - 0.1, -d / 2 + 0.2 + i * 0.2, h * 0.2);
      const b = P(ox, oy, w / 2 + 0.5 + rand() * 0.5, d / 2 + rand() * 0.4, 0);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.quadraticCurveTo(a[0] + 6, a[1] + 12, b[0], b[1]);
      g.stroke();
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
      g.fillStyle = ['#4b5b4a', '#5c5340', '#3f4a4c'][(rand() * 3) | 0];
      g.beginPath();
      g.ellipse((-W / 2 + rand() * W) * TILE_W, (-D / 2 + rand() * D) * TILE_W, 2 + rand() * 5, 1.5 + rand() * 3, 0, 0, 6.3);
      g.fill();
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
      g.fillStyle = 'rgba(150,190,185,0.28)';
      g.beginPath();
      g.moveTo(p[0] - gw / 2, p[1]);
      g.lineTo(p[0] - gw / 4, p[1] - gh);
      g.lineTo(p[0] + gw / 4, p[1] - gh);
      g.lineTo(p[0] + gw / 2, p[1]);
      g.closePath();
      g.fill();
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
    const rx = R * HW * 2 * 0.72,
      ry = R * HH * 2 * 0.72;
    const top = oy - H * TILE_Z;
    // 桶身
    const grd = g.createLinearGradient(ox - rx, 0, ox + rx, 0);
    grd.addColorStop(0, '#2f3a33');
    grd.addColorStop(0.35, '#4e5c4f');
    grd.addColorStop(0.7, '#3c473e');
    grd.addColorStop(1, '#232b26');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(ox - rx, oy);
    g.lineTo(ox - rx, top);
    g.lineTo(ox + rx, top);
    g.lineTo(ox + rx, oy);
    g.ellipse(ox, oy, rx, ry, 0, 0, Math.PI);
    g.closePath();
    g.fill();
    // 箍
    g.fillStyle = 'rgba(0,0,0,0.32)';
    for (const t of [0.22, 0.5, 0.78]) {
      g.beginPath();
      g.ellipse(ox, top + H * TILE_Z * t, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(ox - rx, top + H * TILE_Z * t - 1.5, rx * 2, 3);
    }
    // 顶盖
    g.fillStyle = '#5b6a5c';
    g.beginPath();
    g.ellipse(ox, top, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#39443b';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#48544a';
    g.beginPath();
    g.ellipse(ox, top, rx * 0.6, ry * 0.6, 0, 0, Math.PI * 2);
    g.fill();
    // 生化标
    g.fillStyle = 'rgba(224,165,82,0.7)';
    g.beginPath();
    g.arc(ox - 2, top + H * TILE_Z * 0.42, 4.2, 0, 6.3);
    g.fill();
    g.fillStyle = '#1d211d';
    g.beginPath();
    g.arc(ox - 2, top + H * TILE_Z * 0.42, 1.4, 0, 6.3);
    g.fill();
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      g.moveTo(ox - 2, top + H * TILE_Z * 0.42);
      g.arc(ox - 2, top + H * TILE_Z * 0.42, 4.2, i * 2.09 + 0.3, i * 2.09 + 1.4);
      g.closePath();
      g.fill();
    }
    g.globalAlpha = 0.3;
    speckle(g, ox - rx, top, rx * 2, H * TILE_Z, rand, 40, [PAL.rust, '#20261f'], 1.5, 1.2);
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
    // 破裂屏
    g.strokeStyle = 'rgba(190,210,210,0.45)';
    g.lineWidth = 0.7;
    const cx = 1,
      cy = -1.25 * TILE_Z;
    g.beginPath();
    for (let i = 0; i < 9; i++) {
      g.moveTo(cx, cy);
      const a = (i / 9) * 6.28 + rand();
      g.lineTo(cx + Math.cos(a) * (4 + rand() * 7), cy + Math.sin(a) * (2 + rand() * 4));
    }
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.beginPath();
    g.arc(cx, cy, 3.2, 0, 6.3);
    g.fill();
    resetT(g);
    // 线缆垂落
    g.strokeStyle = '#171b1d';
    g.lineWidth = 1.3;
    const a0 = P(ox, oy, 0.3, 0.1, 0.72);
    g.beginPath();
    g.moveTo(a0[0], a0[1]);
    g.quadraticCurveTo(a0[0] + 8, a0[1] + 14, a0[0] + 2, oy + 4);
    g.stroke();
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
    // 阀门
    const p = P(ox, oy, 0, -0.2, H * 0.42);
    g.strokeStyle = '#7a6b4a';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(p[0] + 4, p[1], 4, 0, 6.3);
    g.stroke();
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
 * o = { aim:{x,y}(屏幕方向单位向量), walk, moving, leftItem, rightItem, flashOn, pose }
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

  const crouch = po.crouch || 0;
  const sink = po.sink || 0;
  const lean = po.lean || 0;
  const legs = po.legs || null;

  // 影子：屈身/趴下时人更贴地，影子更实
  g.save();
  g.globalAlpha = 0.5 + Math.min(0.25, (crouch + sink) * 0.02);
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x, y, 6.2 + crouch * 0.14, 3.1, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  const baseY = y - bob + sink;
  // 髋部：上半身绕它旋转，屈身时它整个下沉
  const hipY = baseY - 11 + crouch;

  // 腿
  const l1 = legs ? legs.a : sw * 2.2;
  const l2 = legs ? legs.b : -sw * 2.2;
  const la = legs && legs.la ? legs.la : 0;
  const lb = legs && legs.lb ? legs.lb : 0;
  const legTop = baseY - 9 + crouch;
  const legH = Math.max(2, 8 - crouch);
  g.fillStyle = PAL.pants;
  g.fillRect(x - 4 + l1, legTop - la, 3, legH);
  g.fillRect(x + 1 + l2, legTop - lb, 3, legH);
  g.fillStyle = PAL.pantsD;
  g.fillRect(x - 4 + l1, legTop - la, 1, legH);
  g.fillRect(x + 1 + l2, legTop - lb, 1, legH);
  g.fillStyle = PAL.shoe;
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

  // 白大褂下摆
  g.fillStyle = PAL.coatShade;
  g.fillRect(x - 5, baseY - 13 + upY, 10, 5);
  g.fillStyle = PAL.coat;
  g.fillRect(x - 5, baseY - 13 + upY, 10, 3);

  // 躯干
  g.fillStyle = PAL.coat;
  g.fillRect(x - 5, baseY - 21 + upY, 10, 9);
  // 阴影侧
  g.fillStyle = PAL.coatShade;
  g.fillRect(x + (dirRight > 0 ? 2 : -5), baseY - 21 + upY, 3, 9);
  // 内衬 / 前襟
  g.fillStyle = '#4d565c';
  if (!back) {
    g.fillRect(x - 1 + dirRight, baseY - 20 + upY, 2, 7);
    g.fillStyle = PAL.coatDark;
    g.fillRect(x - 2 + dirRight, baseY - 20 + upY, 1, 8);
  } else {
    g.fillStyle = PAL.coatDark;
    g.fillRect(x - 5, baseY - 17 + upY, 10, 1);
  }
  // 领子
  g.fillStyle = PAL.coatDark;
  g.fillRect(x - 4, baseY - 21 + upY, 8, 1);

  // 腰侧的枪套：拔枪那一拍之前枪在这里，"手去摸枪"才有东西可摸
  if (po.holster) {
    const gx = x + dirRight * 3.4 - 1;
    g.fillStyle = '#2a2f33';
    g.fillRect(gx, baseY - 13 + upY, 3, 5);
    g.fillStyle = '#3d444a';
    g.fillRect(gx, baseY - 13 + upY, 3, 1.4);
  }

  // 头
  const htx = po.headTilt ? po.headTilt.x : 0;
  const hty = po.headTilt ? po.headTilt.y : 0;
  const hx = x - 3 + dirRight + htx;
  const hy = baseY - 28 + upY + hty;
  g.fillStyle = PAL.skin;
  g.fillRect(hx, hy + 1, 6, 6);
  g.fillStyle = PAL.skinD;
  g.fillRect(hx + (dirRight > 0 ? 4 : 0), hy + 1, 2, 6);
  // 头发
  g.fillStyle = PAL.hair;
  g.fillRect(hx - 1, hy, 8, 3);
  g.fillRect(hx - 1, hy, 2, 5);
  g.fillRect(hx + 6, hy, 1, 5);
  if (back) {
    g.fillRect(hx - 1, hy, 8, 7);
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
      g.fillRect(hx + (dirRight > 0 ? 3 : 1), hy + 6, 3, 1.4);
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
    const shx = x + side * 4.2;
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
    g.strokeStyle = PAL.coat;
    g.lineWidth = 2.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(shx, shoulderY);
    g.lineTo(ax, ay);
    g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(shx, shoulderY + 1);
    g.lineTo(ax, ay + 1);
    g.stroke();
    g.fillStyle = PAL.skin;
    g.fillRect(ax - 1, ay - 1, 2.4, 2.4);
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

function drawHeldItem(g, ax, ay, a, item, o) {
  g.save();
  g.translate(ax + 0.5, ay + 0.5);
  g.rotate(a);
  if (item === 'pistol') {
    g.fillStyle = '#20262a';
    g.fillRect(-1, -1.6, 8, 3);
    g.fillStyle = '#39434a';
    g.fillRect(-1, -1.6, 8, 1);
    g.fillStyle = '#171b1e';
    g.fillRect(0, 1.4, 2.6, 3.2);
  } else if (item === 'flashlight') {
    g.fillStyle = '#2f373c';
    g.fillRect(-2, -1.5, 7, 3);
    g.fillStyle = '#4c565c';
    g.fillRect(-2, -1.5, 7, 1);
    g.fillStyle = o.flashOn ? '#fff6d8' : '#8d9490';
    g.fillRect(5, -1.8, 2, 3.6);
  }
  g.restore();
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
      g.fillStyle = 'rgba(63,18,16,0.5)';
      g.beginPath();
      g.ellipse(p[0] + 5 + rand() * 12, p[1] + 3 + rand() * 3, 3 + rand() * 5, 2 + rand() * 3, 0, 0, 6.3);
      g.fill();
    }
    // 扶手立柱
    const hx = -w2 - 0.04;
    isoBox(g, ox, oy, hx, -run / 2, rise, 0.1, 0.1, railH, '#7d8589', '#4a5155', '#383e42');
    // 斜扶手：本级柱顶连到下一级（+y 更低一级）柱顶
    const a = P(ox, oy, hx + 0.05, -run / 2 + 0.05, rise + railH);
    const b = P(ox, oy, hx + 0.05, run / 2 + 0.05, rise - rise + railH);
    g.strokeStyle = '#8b9296';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
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
    g.strokeStyle = '#8b9296';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
    if (rand() > 0.4) {
      const p = P(ox, oy, 0, 0, 0.16);
      g.fillStyle = 'rgba(63,18,16,0.4)';
      g.beginPath();
      g.ellipse(p[0], p[1], 9, 5, 0, 0, 6.3);
      g.fill();
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
    g.strokeStyle = '#6d757a';
    g.lineWidth = 1.6;
    poly(g, [P(ox, oy, -w2, -d2, 0), P(ox, oy, w2, -d2, 0), P(ox, oy, w2, d2, 0), P(ox, oy, -w2, d2, 0)], null, '#6d757a', 1.6);
    // 洞口边的扶手
    const hx = w2 - 0.06;
    for (let i = 0; i < 3; i++) {
      isoBox(g, ox, oy, hx, -d2 + i * (dTiles / 2.6), 0, 0.1, 0.1, 0.74, '#7d8589', '#4a5155', '#383e42');
    }
    const a = P(ox, oy, hx + 0.05, -d2, 0.74);
    const b = P(ox, oy, hx + 0.05, d2, 0.74);
    g.strokeStyle = '#8b9296';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.stroke();
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
    // 近侧坡面：主要的受光面
    const nf = [ridgeA, ridgeB, P(ox, oy, RX, RY, 0), P(ox, oy, -RX, RY, 0)];
    const grd = g.createLinearGradient(ridgeA[0], ridgeA[1], nf[3][0], nf[3][1]);
    grd.addColorStop(0, '#5c6a4c');
    grd.addColorStop(0.55, '#47533c');
    grd.addColorStop(1, '#333d2d');
    poly(g, nf, grd);
    // 布面褶皱：沿脊线往下摆拉几条暗纹
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 1;
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const a = P(ox, oy, -RX + t * RX * 2, 0.02, H - 0.03);
      const b = P(ox, oy, -RX + t * RX * 2 + 0.06, RY, 0);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
    }
    // 脊线与压条
    g.strokeStyle = '#7d8a68';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(ridgeA[0], ridgeA[1]);
    g.lineTo(ridgeB[0], ridgeB[1]);
    g.stroke();

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
    g.fillStyle = '#4e5a40';
    g.beginPath();
    g.moveTo(ridgeB[0], ridgeB[1] + 2);
    g.lineTo(ridgeB[0] + 9, ridgeB[1] + 12);
    g.lineTo(ridgeB[0] + 3, ridgeB[1] + 22);
    g.lineTo(ridgeB[0] - 2, ridgeB[1] + 10);
    g.closePath();
    g.fill();
    g.strokeStyle = '#1b2018';
    g.lineWidth = 0.8;
    g.stroke();

    // 撕裂口：从入口往近侧坡面撕开一道
    g.fillStyle = '#0a0d0b';
    g.beginPath();
    const tr = P(ox, oy, 0.42, 0.3, 0.6);
    g.moveTo(tr[0], tr[1]);
    g.lineTo(tr[0] + 7, tr[1] - 5);
    g.lineTo(tr[0] + 13, tr[1] + 3);
    g.lineTo(tr[0] + 6, tr[1] + 9);
    g.closePath();
    g.fill();

    // 地钉与拉绳
    g.strokeStyle = 'rgba(190,196,178,0.5)';
    g.lineWidth = 0.9;
    for (const [gx, gy] of [
      [-RX - 0.35, RY + 0.3],
      [RX + 0.3, RY + 0.32],
      [-RX - 0.3, -RY - 0.28],
    ]) {
      const a = P(ox, oy, gx > 0 ? RX : -RX, 0, H - 0.06);
      const b = P(ox, oy, gx, gy, 0);
      g.beginPath();
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
      g.fillStyle = '#6b736e';
      g.fillRect(b[0] - 1, b[1] - 2, 2, 3);
    }

    // 血：帐篷上的喷溅 + 从入口拖出来的一道
    g.globalAlpha = 0.62;
    g.fillStyle = '#3f1210';
    for (let i = 0; i < 16; i++) {
      const ty = rand() * RY; // 0 在脊线，RY 在下摆
      const zz = (1 - ty / RY) * H * (0.15 + rand() * 0.75);
      const p = P(ox, oy, -RX + rand() * RX * 2, ty, zz);
      g.beginPath();
      g.ellipse(p[0], p[1], 1 + rand() * 4.5, 1 + rand() * 3, rand() * 3, 0, 6.3);
      g.fill();
    }
    for (let i = 0; i < 9; i++) {
      const p = P(ox, oy, RX + rand() * 0.8, -RY * 0.4 + rand() * RY * 1.4, 0);
      g.beginPath();
      g.ellipse(p[0], p[1], 2 + rand() * 6, 1.4 + rand() * 3, 0, 0, 6.3);
      g.fill();
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
    // 钢门：两扇，中缝 + 下部危险条纹
    const dg = g.createLinearGradient(uw(-0.8), 0, uw(0.8), 0);
    dg.addColorStop(0, '#465052');
    dg.addColorStop(0.4, '#5b6568');
    dg.addColorStop(0.55, '#3e4749');
    dg.addColorStop(1, '#4a5355');
    g.fillStyle = dg;
    g.fillRect(uw(-0.8), vz(1.98), uw(1.6), 1.98 * TILE_Z);
    g.fillStyle = '#161a1a';
    g.fillRect(uw(-0.03), vz(1.98), 1.6, 1.98 * TILE_Z);
    // 推杠与门牌
    g.fillStyle = '#8d968f';
    g.fillRect(uw(-0.62), vz(1.05), uw(1.24), 2.2);
    g.fillStyle = 'rgba(200,200,190,0.32)';
    g.fillRect(uw(-0.26), vz(1.66), uw(0.52), 6);
    g.fillStyle = '#1a1c1a';
    g.font = '5px monospace';
    g.fillText('R', uw(-0.06), vz(1.66) + 5);
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
    // 天线杆 + 拉线
    const top = P(ox, oy, 0.1, -0.2, H + 1.5);
    const foot = P(ox, oy, 0.1, -0.2, H + 0.14);
    g.strokeStyle = '#59635e';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(foot[0], foot[1]);
    g.lineTo(top[0], top[1]);
    g.stroke();
    g.strokeStyle = 'rgba(120,132,128,0.5)';
    g.lineWidth = 0.7;
    for (const [gx, gy] of [[-0.4, -1.1], [0.4, 0.7], [-0.4, 0.7]]) {
      const b = P(ox, oy, gx, gy, H + 0.16);
      g.beginPath();
      g.moveTo(top[0], top[1]);
      g.lineTo(b[0], b[1]);
      g.stroke();
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
 * 屏幕空间绘制（它在天上，不参与等距深度排序）。机体尺寸由 HELI_S 统一
 * 控制：原来那架只有 32px 宽，在 640×360 里连舱门都读不出来，现在整体
 * 放大到接近两倍并补齐结构细节（发动机舱、绞盘吊臂、机组人员、滑橇支柱、
 * 尾桨护环、机腹探照灯）。绳索挂点与探照灯位置一并由这里导出，
 * main.js 直接用，避免两边各写一套偏移量。
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

/* ------------------------------------------------------------------ *
 * 机组人员
 *
 * 画在直升机的**局部单位**里（1 单位 ≈ HELI_S 逻辑像素），所以跟着机体一起
 * 缩放、镜像，不用在外面再算一遍偏移。
 *
 * 以前舱门口只有一团黑椭圆，夜里跟舱内的黑完全糊在一起 —— 现在按跟玩家同一
 * 套等距人物的做法拆件：靴子 / 作战裤 / 战术背心（含弹匣袋与肩带）/ 袖子与
 * 手套 / 露出来的脸 / 头盔（盔沿、夜视仪座、耳机、下巴带）/ 卡宾枪剪影。
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
 * 一名机组人员。(x, y) 是髋部，+x 是机尾/舱门更外的那一侧。
 *
 * o = {
 *   t,                      // 秒，用来做呼吸与机身颠簸
 *   pose: 'sit' | 'stand',  // 坐在舱门槛上（腿垂在外面）/ 站在舱内
 *   reach: 0..1,            // 近侧那条手臂往 aim 伸出去多少
 *   aim: {x, y},            // 伸手的目标（局部单位）
 *   gun: true,              // 挎着卡宾枪
 *   seed,
 * }
 */
export function drawCrew(g, x, y, o = {}) {
  const t = o.t || 0;
  const seed = o.seed || 0;
  const sit = o.pose === 'sit';
  const reach = c01(o.reach || 0);
  // 悬停中的机身一直在抖，人跟着抖一点点，否则像贴纸
  const bob = Math.sin(t * 2.1 + seed) * 0.16 + Math.sin(t * 9.7 + seed * 2) * 0.06;
  const lean = reach * 1.9; // 伸手时整个人往舱外探

  g.save();
  g.translate(x + lean, y + bob);
  g.lineJoin = 'round';
  g.lineCap = 'round';

  /* --- 远侧手臂：先画，会被躯干压住一半 --- */
  g.strokeStyle = CREW.pantD;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-1.9, -6.2);
  g.lineTo(-3.0 - reach * 0.6, -3.4);
  g.lineTo(-2.4, -0.8 + reach * 0.6);
  g.stroke();

  /* --- 腿 --- */
  if (sit) {
    // 坐在门槛上：大腿朝舱外伸，小腿垂在机外
    poly(g, [[-1.9, -1.4], [2.6, -1.0], [2.9, 1.4], [-1.9, 1.3]], CREW.pant);
    poly(g, [[-1.9, -1.4], [2.6, -1.0], [2.6, -0.3], [-1.9, -0.6]], '#464e3b');
    poly(g, [[1.1, 0.7], [2.3, 0.8], [2.7, 5.0], [1.5, 5.1]], CREW.pantD);
    poly(g, [[1.9, 0.9], [3.2, 1.0], [3.7, 5.4], [2.4, 5.5]], CREW.pant);
    g.fillStyle = CREW.boot;
    poly(g, [[1.4, 4.8], [2.7, 4.9], [2.9, 6.2], [1.2, 6.1]], CREW.boot);
    poly(g, [[2.3, 5.2], [3.7, 5.3], [4.2, 6.7], [2.1, 6.6]], CREW.boot);
    poly(g, [[2.3, 6.1], [4.2, 6.2], [4.2, 6.7], [2.1, 6.6]], '#0f120d');
  } else {
    poly(g, [[-2.1, -1.2], [-0.4, -1.2], [-0.3, 4.3], [-2.0, 4.3]], CREW.pantD);
    poly(g, [[0.3, -1.2], [2.1, -1.2], [2.2, 4.3], [0.4, 4.3]], CREW.pant);
    poly(g, [[-2.2, 4.1], [-0.1, 4.1], [0.1, 5.5], [-2.4, 5.5]], CREW.boot);
    poly(g, [[0.3, 4.1], [2.3, 4.1], [2.6, 5.5], [0.2, 5.5]], CREW.boot);
  }

  /* --- 躯干：作战服在里，战术背心叠在外 --- */
  poly(g, [[-2.5, -7.0], [2.5, -7.0], [2.9, -0.7], [-2.7, -0.7]], CREW.sleeve);
  poly(g, [[-2.2, -6.5], [2.2, -6.5], [2.5, -1.2], [-2.4, -1.2]], CREW.vest);
  poly(g, [[-2.2, -6.5], [2.2, -6.5], [2.2, -5.6], [-2.2, -5.6]], CREW.vestHi);
  // 弹匣袋：三个方块，一眼能读出"这是战术背心"而不是一件外套
  for (let i = 0; i < 3; i++) {
    const px = -1.9 + i * 1.4;
    g.fillStyle = CREW.vestDark;
    g.fillRect(px, -4.6, 1.1, 2.1);
    g.fillStyle = 'rgba(214,224,204,0.16)';
    g.fillRect(px, -4.6, 1.1, 0.38);
  }
  // 肩带
  g.strokeStyle = CREW.vestDark;
  g.lineWidth = 0.5;
  g.beginPath();
  g.moveTo(-1.5, -6.6);
  g.lineTo(-0.9, -1.6);
  g.moveTo(1.5, -6.6);
  g.lineTo(0.9, -1.6);
  g.stroke();

  /* --- 挎在胸前的卡宾枪 --- */
  if (o.gun) {
    g.save();
    g.translate(0.9, -3.1);
    g.rotate(-0.46);
    g.fillStyle = CREW.gun;
    g.fillRect(-3.6, -0.42, 7.2, 0.9);
    g.fillStyle = CREW.gunHi;
    g.fillRect(-3.6, -0.42, 7.2, 0.26);
    g.fillStyle = CREW.gun;
    g.fillRect(-0.7, 0.35, 1.0, 2.0); // 弹匣
    g.fillRect(-3.5, -0.15, 1.6, 1.3); // 枪托
    g.fillStyle = CREW.gunHi;
    g.fillRect(2.5, -0.95, 0.42, 0.6); // 准星
    g.restore();
  }

  /* --- 头：先脸后盔，脸要露出来才不是一团黑 --- */
  const hy = -8.5;
  g.fillStyle = CREW.skinD;
  g.fillRect(-0.7, -7.7, 1.5, 1.1);
  g.fillStyle = CREW.skin;
  g.beginPath();
  g.ellipse(0.45, hy + 0.1, 1.3, 1.55, 0, 0, 6.3);
  g.fill();
  g.fillStyle = CREW.skinD;
  g.beginPath();
  g.ellipse(-0.35, hy + 0.2, 1.0, 1.45, 0, 0, 6.3);
  g.fill();
  // 眼睛那一道阴影，脸才有方向
  g.fillStyle = 'rgba(24,26,20,0.75)';
  g.fillRect(-0.2, hy - 0.35, 1.9, 0.5);
  // 头盔
  g.fillStyle = CREW.helm;
  g.beginPath();
  g.ellipse(0, hy - 0.4, 2.15, 2.0, 0, Math.PI, 0);
  g.fill();
  g.fillRect(-2.15, hy - 0.4, 4.3, 0.95);
  g.fillStyle = CREW.helmHi;
  g.beginPath();
  g.ellipse(-0.4, hy - 1.05, 1.35, 0.9, -0.22, Math.PI, 0);
  g.fill();
  g.fillStyle = CREW.helmDark;
  g.fillRect(-2.15, hy + 0.28, 4.3, 0.44); // 盔沿
  // 夜视仪座
  g.fillStyle = CREW.helmDark;
  g.fillRect(0.7, hy - 2.7, 0.95, 1.4);
  g.fillStyle = CREW.helmHi;
  g.fillRect(0.7, hy - 2.7, 0.95, 0.36);
  // 耳机 + 送话器 + 下巴带
  g.fillStyle = CREW.helmDark;
  g.beginPath();
  g.ellipse(-1.55, hy + 0.15, 0.72, 0.85, 0, 0, 6.3);
  g.fill();
  g.strokeStyle = CREW.helmDark;
  g.lineWidth = 0.3;
  g.beginPath();
  g.moveTo(-1.3, hy + 0.5);
  g.quadraticCurveTo(-0.2, hy + 1.6, 0.85, hy + 1.15);
  g.moveTo(-1.6, hy + 0.7);
  g.lineTo(0.1, hy + 1.7);
  g.lineTo(1.7, hy + 0.6);
  g.stroke();

  /* --- 近侧手臂：伸手抓人的就是这一条，画在最上面 --- *
   * aim 是**相对 (x, y) 原点**的目标，而整个人已经被 lean/bob 挪过了，
   * 所以这里要把那两个偏移减掉，reach=1 时手套才正好落在目标上（拉人那段
   * 靠这个跟玩家的手腕对齐；身体照样跟着机身抖，只有手是钉住的）。 */
  const aim = o.aim || { x: 3.6, y: 1.4 };
  const rx = 2.4 + (aim.x - lean - 2.4) * reach;
  const ry = -1.8 + (aim.y - bob + 1.8) * reach;
  const ex = 1.0 + (rx - 1.0) * 0.55 + (1 - reach) * 0.9;
  const ey = -6.2 + (ry + 6.2) * 0.45 + (1 - reach) * 1.6;
  g.strokeStyle = CREW.sleeve;
  g.lineWidth = 1.75;
  g.beginPath();
  g.moveTo(1.9, -6.2);
  g.lineTo(ex, ey);
  g.stroke();
  /* 小臂用肤色（袖子挽起来）。整条都画成橄榄绿的话，它跟垂在门外的小腿
     一模一样，"伸手去抓"就读成了"又一条腿"。 */
  g.strokeStyle = CREW.skinD;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(ex, ey);
  g.lineTo(rx, ry);
  g.stroke();
  g.strokeStyle = CREW.skin;
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(ex, ey - 0.2);
  g.lineTo(rx, ry - 0.2);
  g.stroke();
  g.fillStyle = CREW.glove;
  g.beginPath();
  g.arc(rx, ry, 1.05, 0, 6.3);
  g.fill();

  // 肩上的红色识别灯：一闪一闪，暗处能看出舱里确实有人
  const bl = Math.sin(t * 3.4 + seed * 3) > 0.55;
  if (bl) {
    g.fillStyle = 'rgba(255,90,70,0.9)';
    g.fillRect(-2.3, -6.5, 0.7, 0.7);
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
  const s = (o.scale === undefined ? 1 : o.scale) * HELI_S;
  const dir = o.dir === undefined ? -1 : o.dir;
  g.save();
  g.translate(x, y);
  g.scale(s * dir, s);
  g.lineJoin = 'round';

  /* --- 尾段 --- */
  // 尾梁：上缘亮、下缘暗，做出圆管的体积
  poly(g, [[7, -4.2], [42, -3.2], [42, 1.2], [7, 5]], '#2f3739');
  poly(g, [[7, -4.2], [42, -3.2], [42, -1.6], [7, -1.8]], '#414b4c');
  poly(g, [[7, 3.4], [42, 0.4], [42, 1.2], [7, 5]], '#1b2123');
  // 尾梁上的加强环
  g.fillStyle = 'rgba(0,0,0,0.32)';
  for (let i = 0; i < 5; i++) g.fillRect(13 + i * 6, -3.9 + i * 0.16, 1.1, 8 - i * 0.7);
  // 平尾
  poly(g, [[30, -1.4], [38, -3.6], [40, -2.6], [32, 0.2]], '#333c3d');
  // 垂尾 + 尾桨护环
  poly(g, [[36, -2.6], [45, -16], [49.5, -15], [43.5, -0.6]], '#262e30');
  poly(g, [[38, -3], [45, -14.4], [46.6, -14], [40.6, -3.6]], '#3a4445');
  g.strokeStyle = '#39433f';
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(45, -9.5, 8.4, 0, 6.3);
  g.stroke();
  // 尾桨（转起来是个模糊的圆 + 一片能看清的桨）
  g.strokeStyle = 'rgba(180,190,195,0.32)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.arc(45, -9.5, 7.2, 0, 6.3);
  g.stroke();
  g.strokeStyle = 'rgba(214,224,228,0.6)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 2; i++) {
    const a = t * 40 + i * 1.57;
    g.beginPath();
    g.moveTo(45 - Math.cos(a) * 7.2, -9.5 - Math.sin(a) * 7.2);
    g.lineTo(45 + Math.cos(a) * 7.2, -9.5 + Math.sin(a) * 7.2);
    g.stroke();
  }

  /* --- 机身 --- */
  // 主体：上半亮、下半暗的双椭圆，再补一个机头下垂的下颌
  g.fillStyle = '#3e4844';
  g.beginPath();
  g.ellipse(0, -0.5, 18.5, 9.6, 0, 0, 6.3);
  g.fill();
  g.fillStyle = '#2c3431';
  g.beginPath();
  g.ellipse(0, 3.6, 18, 6.4, 0, 0, 6.3);
  g.fill();
  g.fillStyle = '#232a28';
  g.beginPath();
  g.ellipse(-11, 4.2, 8.6, 4.6, 0.16, 0, 6.3);
  g.fill();
  // 机背高光
  g.fillStyle = 'rgba(190,206,204,0.16)';
  g.beginPath();
  g.ellipse(-1, -6.4, 13.5, 2.6, -0.04, 0, 6.3);
  g.fill();
  // 蒙皮分块线与铆钉
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 0.8;
  for (const px of [-6, 2, 8]) {
    g.beginPath();
    g.moveTo(px, -8.4);
    g.lineTo(px + 1.4, 7.6);
    g.stroke();
  }
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let i = 0; i < 12; i++) g.fillRect(-16 + i * 2.8, -7.6 + Math.abs(i - 6) * 0.25, 0.8, 0.8);

  /* --- 发动机舱与排气 --- */
  poly(g, [[-5, -8.6], [9, -8.6], [10.5, -12.4], [-4, -12.4]], '#4a5450');
  poly(g, [[-4, -12.4], [10.5, -12.4], [10.5, -11], [-4, -11]], '#5d6864');
  g.fillStyle = 'rgba(0,0,0,0.4)';
  for (let i = 0; i < 5; i++) g.fillRect(-2.5 + i * 2.6, -12.2, 1.2, 3.4);
  // 排气口：热气把边缘烧成暗红
  poly(g, [[9.4, -11.6], [13.6, -10.2], [13.2, -7.6], [9.2, -8.6]], '#1a1c1a');
  g.fillStyle = 'rgba(190,90,50,0.28)';
  g.beginPath();
  g.ellipse(12.6, -9.2, 1.8, 1.6, 0, 0, 6.3);
  g.fill();

  /* --- 座舱 --- */
  g.fillStyle = '#122026';
  g.beginPath();
  g.ellipse(-10.5, -1.6, 9.2, 6.4, -0.06, 0, 6.3);
  g.fill();
  // 玻璃反光
  g.fillStyle = 'rgba(146,196,214,0.26)';
  g.beginPath();
  g.ellipse(-12.4, -3.4, 5.2, 3.0, -0.32, 0, 6.3);
  g.fill();
  // 飞行员剪影 + 仪表盘的一点绿光
  g.fillStyle = 'rgba(10,14,16,0.85)';
  g.beginPath();
  g.ellipse(-8.8, -2.2, 2.0, 2.6, 0, 0, 6.3);
  g.fill();
  g.beginPath();
  g.ellipse(-8.6, -5.0, 1.5, 1.4, 0, 0, 6.3);
  g.fill();
  g.fillStyle = 'rgba(120,220,160,0.45)';
  g.fillRect(-13.6, -1.2, 2.6, 0.9);
  // 窗框
  g.strokeStyle = '#4c5652';
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(-6.2, -7.2);
  g.lineTo(-4.4, 4.2);
  g.moveTo(-14.6, -6.4);
  g.lineTo(-16.4, 2.4);
  g.stroke();

  /* --- 敞开的侧舱门 + 探身的机组 --- */
  const doorShut = c01(o.doorShut || 0);
  const { x0: cx0, x1: cx1, y0: cy0, y1: cy1 } = CABIN;
  const cw = cx1 - cx0;
  const ch = cy1 - cy0;
  /* 门洞：整块压到比蒙皮更暗，再在四边描一圈门框。不这么做的话它跟机身
     是同一个明度，机组看起来就像贴在机壳外面，而不是站在一个洞里。 */
  g.fillStyle = '#070b0b';
  g.fillRect(cx0, cy0, cw, ch);
  /* 舱内的顶灯。人物脚下要有一片被照亮的地板，才读得出"里面是个空间"。 */
  const cab = g.createLinearGradient(0, cy0, 0, cy1);
  cab.addColorStop(0, 'rgba(214,202,160,0.34)');
  cab.addColorStop(0.5, 'rgba(150,152,128,0.10)');
  cab.addColorStop(1, 'rgba(120,150,150,0.04)');
  g.fillStyle = cab;
  g.fillRect(cx0, cy0, cw, ch);
  // 舱内地板的一点反光
  g.fillStyle = 'rgba(150,170,160,0.16)';
  g.fillRect(cx0, cy1 - 1.9, cw, 1.9);
  // 舱壁上的固定件，给背景一点层次，人才不是浮在黑洞前面
  g.fillStyle = 'rgba(18,24,22,0.6)';
  g.fillRect(cx0 + 0.5, cy0 + 0.9, 1.4, 3.2);
  g.fillRect(cx1 - 1.8, cy0 + 1.3, 1.4, 4.6);
  // 门框：上沿受光、下沿（门槛）最亮，人踩上去那条边要看得见
  g.fillStyle = 'rgba(126,138,132,0.55)';
  g.fillRect(cx0, cy0, cw, 0.6);
  g.fillStyle = '#7b857f';
  g.fillRect(cx0, cy1 - 0.7, cw, 0.7);
  g.fillStyle = 'rgba(96,106,101,0.5)';
  g.fillRect(cx0, cy0, 0.6, ch);
  g.fillRect(cx1 - 0.6, cy0, 0.6, ch);

  /* 机组两名：里面那个站着待命，门口那个坐在门槛上接应。
     drawCrew 画在机体局部单位里，所以跟着 scale/dir 一起走。 */
  drawCrew(g, 3.9, 3.4, { t, pose: 'stand', gun: true, seed: 1.7, aim: { x: 3.1, y: -3.4 }, reach: 0.55 });

  /* 玩家：夹在两名机组之间。见函数头的 inCabin 说明 */
  if (o.inCabin) {
    g.save();
    g.scale(1 / (s * dir), 1 / s);
    g.translate(-x, -y);
    o.inCabin(g);
    g.restore();
  }

  /* 门口那名：手要伸到 grabTo（画布坐标）。局部单位 = (画布 - 机心) / 缩放，
     x 还要再除一次 dir，因为机体是镜像画的。 */
  const gsit = { x: 9.6, y: 2.4 };
  let gaim = { x: 4.4, y: 5.2 };
  if (o.grabTo) {
    gaim = {
      x: (o.grabTo.x - x) / (s * dir) - gsit.x,
      y: (o.grabTo.y - y) / s - gsit.y,
    };
  }
  drawCrew(g, gsit.x, gsit.y, {
    t, pose: 'sit', gun: false, seed: 4.1,
    reach: o.reach === undefined ? 0.26 : c01(o.reach),
    aim: gaim,
  });

  // 滑开的门板收在后面；拽人进舱之后会滑回来把舱口封上
  const dx0 = 13 - doorShut * 11.4;
  poly(g, [[dx0, -6], [dx0 + 2.6, -6], [dx0 + 2.6, 5.6], [dx0, 5.6]], '#4c5652');
  poly(g, [[dx0, -6], [dx0 + 2.6, -6], [dx0 + 2.6, -4.6], [dx0, -4.6]], '#68736e');
  if (doorShut > 0.02) {
    // 关上的那一段门板：一整块，中间一个小舷窗
    poly(g, [[dx0 + 2.4, -5.6], [13.2, -5.6], [13.2, 5.4], [dx0 + 2.4, 5.4]], '#414a47');
    poly(g, [[dx0 + 2.4, -5.6], [13.2, -5.6], [13.2, -4.4], [dx0 + 2.4, -4.4]], '#5b6661');
    g.fillStyle = 'rgba(150,190,200,0.22)';
    g.beginPath();
    g.ellipse(dx0 + 4.6, -1.4, 1.9, 1.6, 0, 0, 6.3);
    g.fill();
  }

  /* --- 绞盘吊臂：绳子就是从这里出去的 --- */
  g.strokeStyle = '#59635e';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(4.4, -6.4);
  g.lineTo(11.6, -8.4);
  g.stroke();
  g.fillStyle = '#6a7570';
  g.fillRect(2.6, -8.4, 3.6, 2.6);
  g.fillStyle = '#8b968f';
  g.beginPath();
  g.arc(11.4, -8.2, 1.5, 0, 6.3);
  g.fill();
  g.fillStyle = '#2a3230';
  g.beginPath();
  g.arc(11.4, -8.2, 0.6, 0, 6.3);
  g.fill();

  /* --- 起落滑橇 --- */
  g.strokeStyle = '#1e2528';
  g.lineWidth = 2.0;
  g.beginPath();
  g.moveTo(-14.5, 13.6);
  g.lineTo(14.5, 13.2);
  g.stroke();
  g.strokeStyle = '#39423f';
  g.lineWidth = 1.5;
  g.beginPath();
  // 前后各一对支柱，中间一根斜撑
  g.moveTo(-8.4, 7.2);
  g.lineTo(-10.4, 13.5);
  g.moveTo(8.4, 7.4);
  g.lineTo(10.2, 13.3);
  g.moveTo(-8.4, 7.2);
  g.lineTo(-4.2, 13.5);
  g.moveTo(8.4, 7.4);
  g.lineTo(4.6, 13.4);
  g.stroke();
  // 滑橇前端上翘
  g.strokeStyle = '#1e2528';
  g.lineWidth = 1.8;
  g.beginPath();
  g.moveTo(-14.5, 13.6);
  g.lineTo(-17.6, 11.4);
  g.stroke();

  /* --- 机腹探照灯 --- */
  g.fillStyle = '#39423f';
  g.beginPath();
  g.ellipse(-13, 6.4, 3.0, 2.4, 0, 0, 6.3);
  g.fill();
  g.fillStyle = 'rgba(226,238,244,0.75)';
  g.beginPath();
  g.ellipse(-13.2, 7.6, 1.9, 1.2, 0, 0, 6.3);
  g.fill();

  /* --- 机身编号 --- */
  g.save();
  g.scale(dir, 1); // 文字不跟着机身镜像
  g.fillStyle = 'rgba(206,214,206,0.42)';
  g.font = 'bold 4px monospace';
  g.fillText('L7-R', dir < 0 ? -4 : -4, 1.6);
  g.restore();

  /* --- 主旋翼：盘面 + 桨毂 + 四片扫过的桨 --- */
  const mastY = -14.6;
  g.fillStyle = '#4c5652';
  g.fillRect(-2.6, -14.4, 4.4, 3.4);
  g.strokeStyle = 'rgba(190,205,210,0.16)';
  g.lineWidth = 3.6;
  g.beginPath();
  g.ellipse(-0.5, mastY, 40, 5.6, 0, 0, 6.3);
  g.stroke();
  g.strokeStyle = 'rgba(215,228,232,0.62)';
  g.lineWidth = 1.7;
  for (let i = 0; i < 4; i++) {
    const a = t * 26 + (i * Math.PI) / 2;
    g.beginPath();
    g.moveTo(-0.5, mastY);
    g.lineTo(-0.5 + Math.cos(a) * 40, mastY + Math.sin(a) * 5.6);
    g.stroke();
  }
  g.fillStyle = '#67726d';
  g.beginPath();
  g.ellipse(-0.5, mastY, 3.4, 1.8, 0, 0, 6.3);
  g.fill();
  g.fillStyle = '#98a3a0';
  g.fillRect(-1.4, mastY - 2.6, 2.0, 2.4);

  g.restore();

  // 航行灯：红绿交替闪 + 机背的防撞频闪
  const blink = Math.sin(t * 7) > 0;
  const strobe = Math.sin(t * 11) > 0.86;
  const lamps = [
    [x - 18 * s * dir, y + 2 * s, '255,70,60', blink ? 0.85 : 0.12, 11],
    [x + 47 * s * dir, y - 14 * s, '120,255,140', blink ? 0.12 : 0.85, 11],
    [x - 1 * s * dir, y - 12.6 * s, '255,250,235', strobe ? 0.9 : 0.05, 16],
  ];
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const [lx, ly, rgb, k, rr] of lamps) {
    if (k < 0.06) continue;
    const r = rr * s * 0.6;
    const grd = g.createRadialGradient(lx, ly, 0, lx, ly, r);
    grd.addColorStop(0, `rgba(${rgb},${k})`);
    grd.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grd;
    g.fillRect(lx - r, ly - r, r * 2, r * 2);
  }
  g.restore();
}

/** 直升机的探照灯锥：直接画渐变多边形，不用 filter: blur() */
export function drawHeliBeam(g, x, y, tx, ty, w, k) {
  if (k <= 0.01) return;
  const dx = tx - x;
  const dy = ty - y;
  const l = Math.hypot(dx, dy) || 1;
  const nx = -dy / l;
  const ny = dx / l;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const grd = g.createLinearGradient(x, y, tx, ty);
  grd.addColorStop(0, `rgba(214,228,236,${0.3 * k})`);
  grd.addColorStop(0.6, `rgba(200,218,228,${0.13 * k})`);
  grd.addColorStop(1, 'rgba(190,210,222,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(x - nx * 3, y - ny * 3);
  g.lineTo(x + nx * 3, y + ny * 3);
  g.lineTo(tx + nx * w, ty + ny * w);
  g.lineTo(tx - nx * w, ty - ny * w);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * 垂下的绳索：一条带摆动的线 + 末端的救援套环。
 * 粗细与套环大小跟着 HELI_S 走，机体放大后绳子不能还是一根发丝。
 */
export function drawRope(g, x0, y0, x1, y1, t, sway = 1, loop = true) {
  const s = HELI_S;
  g.save();
  g.lineCap = 'round';
  // 先描一遍暗色做外廓，雨夜里绳子才不会糊进背景
  for (const [col, lw] of [['rgba(24,20,14,0.7)', 3.2 * s * 0.6], ['#8a7f63', 2.0 * s * 0.6]]) {
    g.strokeStyle = col;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(x0, y0);
    const N = 12;
    for (let i = 1; i <= N; i++) {
      const k = i / N;
      const wob = Math.sin(t * 2.3 + k * 3.2) * 5.2 * sway * Math.sin(k * Math.PI);
      g.lineTo(x0 + (x1 - x0) * k + wob, y0 + (y1 - y0) * k);
    }
    g.stroke();
  }
  // 绳股的斜纹
  g.strokeStyle = 'rgba(216,204,168,0.28)';
  g.lineWidth = 0.8;
  g.beginPath();
  for (let i = 1; i < 12; i++) {
    const k = i / 12;
    const wob = Math.sin(t * 2.3 + k * 3.2) * 5.2 * sway * Math.sin(k * Math.PI);
    const px = x0 + (x1 - x0) * k + wob;
    const py = y0 + (y1 - y0) * k;
    g.moveTo(px - 1.6 * s * 0.6, py - 0.8);
    g.lineTo(px + 1.6 * s * 0.6, py + 0.8);
  }
  g.stroke();
  // 末端救援套环。人抓住绳子之后不画：那时末端就在他手里，再挂一个圈很怪
  if (loop) {
    const rx = 5.6 * s * 0.62;
    const ry = 6.6 * s * 0.62;
    g.strokeStyle = 'rgba(24,20,14,0.7)';
    g.lineWidth = 3.0 * s * 0.6;
    g.beginPath();
    g.ellipse(x1, y1 + ry * 0.8, rx, ry, 0, 0, 6.3);
    g.stroke();
    g.strokeStyle = '#a99b78';
    g.lineWidth = 1.8 * s * 0.6;
    g.stroke();
    // 套环上的锁扣
    g.fillStyle = '#b9c2bc';
    g.fillRect(x1 - 1.4, y1 - 1.6, 2.8, 3.4);
  }
  g.restore();
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

  // 背景：一块纯色，不加网格和光斑
  g.fillStyle = '#1b1b20';
  g.fillRect(0, 0, 120, 200);
  // 地面阴影
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.beginPath();
  g.ellipse(60, 192, 30, 6, 0, 0, 6.3);
  g.fill();

  const R = (x, y, w, h, c) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };

  // 腿
  R(47, 130, 11, 54, PAL.pants);
  R(62, 130, 11, 54, PAL.pants);
  R(47, 130, 3, 54, PAL.pantsD);
  R(62, 130, 3, 54, PAL.pantsD);
  R(55, 130, 3, 54, 'rgba(0,0,0,0.18)');
  R(70, 130, 3, 54, 'rgba(0,0,0,0.18)');
  // 鞋
  R(44, 183, 15, 9, PAL.shoe);
  R(61, 183, 15, 9, PAL.shoe);
  R(44, 183, 15, 2, '#2f363b');
  R(44, 190, 15, 2, '#12161a');
  R(61, 190, 15, 2, '#12161a');

  // 白大褂主体
  R(40, 62, 40, 80, PAL.coat);
  // 下摆（略微展开）
  g.fillStyle = PAL.coat;
  g.beginPath();
  g.moveTo(40, 120);
  g.lineTo(80, 120);
  g.lineTo(83, 144);
  g.lineTo(37, 144);
  g.closePath();
  g.fill();
  // 侧面阴影
  R(72, 62, 11, 82, PAL.coatShade);
  R(37, 62, 4, 82, 'rgba(0,0,0,0.12)');

  // 内衬衬衫 + 领口
  g.fillStyle = '#39464d';
  g.beginPath();
  g.moveTo(52, 60);
  g.lineTo(68, 60);
  g.lineTo(60, 86);
  g.closePath();
  g.fill();
  // 衣襟
  g.fillStyle = PAL.coat;
  g.beginPath();
  g.moveTo(40, 62);
  g.lineTo(58, 62);
  g.lineTo(61, 90);
  g.lineTo(58, 144);
  g.lineTo(37, 144);
  g.lineTo(40, 120);
  g.closePath();
  g.fill();
  g.strokeStyle = PAL.coatDark;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(58, 62);
  g.lineTo(61, 90);
  g.lineTo(59, 144);
  g.stroke();
  // 领子
  g.fillStyle = '#e2e8ea';
  g.beginPath();
  g.moveTo(50, 58);
  g.lineTo(60, 74);
  g.lineTo(56, 58);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(70, 58);
  g.lineTo(60, 74);
  g.lineTo(64, 58);
  g.closePath();
  g.fill();
  // 纽扣
  g.fillStyle = PAL.coatDark;
  for (let i = 0; i < 4; i++) g.fillRect(62, 96 + i * 11, 2, 2);

  // 口袋 + 笔
  R(43, 100, 13, 14, 'rgba(0,0,0,0.10)');
  g.strokeStyle = PAL.coatDark;
  g.strokeRect(43.5, 100.5, 12, 13);
  R(46, 96, 2, 9, '#3f6f8a');
  R(50, 96, 2, 9, '#8a3f3f');

  // 工牌
  R(66, 84, 12, 15, '#c8d0d3');
  R(66, 84, 12, 4, '#8e989c');
  R(68, 90, 4, 5, '#4c585e');
  R(73, 90, 4, 1.5, '#7c868a');
  R(73, 93, 4, 1.5, '#7c868a');
  g.strokeStyle = '#6d7679';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(72, 84);
  g.lineTo(70, 78);
  g.stroke();

  // 污渍 / 血迹
  g.fillStyle = 'rgba(74,26,22,0.5)';
  g.beginPath();
  g.ellipse(50, 128, 7, 5, 0.5, 0, 6.3);
  g.fill();
  g.beginPath();
  g.ellipse(45, 137, 4, 3, 0.2, 0, 6.3);
  g.fill();
  g.fillStyle = 'rgba(60,58,44,0.28)';
  g.beginPath();
  g.ellipse(70, 116, 9, 7, -0.3, 0, 6.3);
  g.fill();

  // 手臂
  for (const side of [-1, 1]) {
    const ax = side < 0 ? 33 : 77;
    R(ax, 64, 10, 66, PAL.coat);
    R(ax + (side < 0 ? 0 : 7), 64, 3, 66, side < 0 ? 'rgba(0,0,0,0.14)' : PAL.coatShade);
    // 袖口
    R(ax - 0.5, 124, 11, 5, '#b9c2c6');
    // 手
    R(ax + 0.5, 129, 9, 11, PAL.skin);
    R(ax + (side < 0 ? 0.5 : 6.5), 129, 3, 11, PAL.skinD);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.fillRect(ax + 0.5, 138, 9, 1);
  }

  // 肩线
  R(38, 60, 44, 4, '#e0e6e8');
  R(38, 60, 44, 1.5, '#f0f4f5');

  // 脖子
  R(55, 50, 10, 12, PAL.skin);
  R(55, 50, 10, 12, 'rgba(0,0,0,0)');
  R(55, 56, 10, 6, 'rgba(0,0,0,0.22)');

  // 头
  R(50, 26, 20, 28, PAL.skin);
  R(64, 26, 6, 28, PAL.skinD);
  R(48, 36, 2, 8, PAL.skin); // 耳
  R(70, 36, 2, 8, PAL.skinD);
  // 头发
  g.fillStyle = PAL.hair;
  g.beginPath();
  g.moveTo(48, 34);
  g.quadraticCurveTo(48, 18, 60, 18);
  g.quadraticCurveTo(72, 18, 72, 34);
  g.lineTo(72, 40);
  g.lineTo(69, 40);
  g.lineTo(69, 30);
  g.lineTo(51, 31);
  g.lineTo(51, 42);
  g.lineTo(48, 42);
  g.closePath();
  g.fill();
  g.fillStyle = '#5c452f';
  g.fillRect(52, 20, 12, 3);
  // 乱发
  g.fillStyle = PAL.hair;
  g.fillRect(56, 16, 3, 3);
  g.fillRect(64, 17, 2, 3);
  // 眉
  R(53, 37, 6, 1.6, '#3a2a1e');
  R(62, 37, 6, 1.6, '#3a2a1e');
  // 眼
  R(53, 40, 6, 4, '#e6ecec');
  R(62, 40, 6, 4, '#cdd4d4');
  R(55, 40.5, 2.6, 3, '#2a3b42');
  R(64, 40.5, 2.6, 3, '#22323a');
  R(55, 40.5, 1, 1, '#dff0f2');
  R(64, 40.5, 1, 1, '#c9dcdf');
  // 黑眼圈
  g.fillStyle = 'rgba(60,40,40,0.22)';
  g.fillRect(53, 44.5, 6, 2);
  g.fillRect(62, 44.5, 6, 2);
  // 鼻 / 嘴
  R(59, 45, 2, 3, PAL.skinD);
  R(56, 50, 8, 1.6, '#8a5a4c');
  // 额头伤口
  R(52, 32, 5, 1.4, 'rgba(120,36,30,0.75)');
  R(53, 33.4, 3, 1, 'rgba(90,26,22,0.6)');
  // 胡茬
  g.fillStyle = 'rgba(50,40,32,0.16)';
  g.fillRect(53, 47, 14, 6);

  // 手中的装备
  if (o.left) drawPortraitItem(g, 38, 141, o.left, o);
  if (o.right) drawPortraitItem(g, 82, 141, o.right, o);

  g.restore();
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
    g.fillRect(-3.5, -2, 7, 15);
    g.fillStyle = '#4c565c';
    g.fillRect(-3.5, -2, 2.4, 15);
    g.fillStyle = o.flashOn ? '#fff6d8' : '#8d9490';
    g.fillRect(-4.5, 13, 9, 3);
    if (o.flashOn) {
      const grd = g.createLinearGradient(0, 16, 0, 34);
      grd.addColorStop(0, 'rgba(255,244,206,0.55)');
      grd.addColorStop(1, 'rgba(255,244,206,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(-4.5, 16);
      g.lineTo(4.5, 16);
      g.lineTo(11, 36);
      g.lineTo(-11, 36);
      g.closePath();
      g.fill();
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
  g.fillStyle = '#39464d';
  g.beginPath();
  g.moveTo(31, 56);
  g.lineTo(45, 56);
  g.lineTo(38, 78);
  g.closePath();
  g.fill();
  // 大褂翻领
  g.fillStyle = '#e2e8ea';
  g.beginPath();
  g.moveTo(27, 56);
  g.lineTo(38, 76);
  g.lineTo(34, 56);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(49, 56);
  g.lineTo(38, 76);
  g.lineTo(42, 56);
  g.closePath();
  g.fill();
  g.strokeStyle = PAL.coatDark;
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(34, 57);
  g.lineTo(38, 77);
  g.lineTo(38, 96);
  g.stroke();
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
  g.fillRect(-6, -20, 12, 1.6);
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
  g.fillStyle = '#8d979b';
  g.beginPath();
  g.arc(-5, -1, 2.6, 0, 6.3);
  g.fill();
  g.fillStyle = '#7b868a';
  for (let i = 0; i < 3; i++) g.fillRect(2, -4 + i * 3.4, 9, 1.6);
  g.fillStyle = '#2a3034';
  g.fillRect(-13, 8, 26, 3);
  g.fillStyle = 'rgba(74,26,22,0.7)';
  g.beginPath();
  g.ellipse(4, 6, 7, 5, 0.4, 0, 6.3);
  g.fill();
  g.restore();
}

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
  g.fillStyle = '#404a50';
  g.beginPath();
  g.moveTo(6, -7);
  g.lineTo(13, -9);
  g.lineTo(13, 9);
  g.lineTo(6, 7);
  g.closePath();
  g.fill();
  g.fillStyle = on ? '#fff3cf' : '#7b837f';
  g.fillRect(11, -8, 3, 16);
  if (on) {
    const grd = g.createLinearGradient(14, 0, 30, 0);
    grd.addColorStop(0, 'rgba(255,240,200,0.75)');
    grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(14, -8);
    g.lineTo(30, -16);
    g.lineTo(30, 16);
    g.lineTo(14, 8);
    g.closePath();
    g.fill();
  }
  g.restore();
}
