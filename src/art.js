import { HW, HH, TILE_W, TILE_Z } from './config.js';
import { makeCanvas, mulberry32, shade } from './util.js';

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
  g.setTransform(HW / TILE_W, HH / TILE_W, -HW / TILE_W, HH / TILE_W, ox, oy - z * TILE_Z);
}
/** +x 面（朝右下），u=y*TILE_W，v 向下为负 z */
export function faceRight(g, ox, oy, xr) {
  g.setTransform(-HW / TILE_W, HH / TILE_W, 0, 1, ox + xr * HW, oy + xr * HH);
}
/** +y 面（朝左下），u=x*TILE_W，v 向下为负 z */
export function faceLeft(g, ox, oy, yl) {
  g.setTransform(HW / TILE_W, HH / TILE_W, 0, 1, ox - yl * HW, oy + yl * HH);
}
export function resetT(g) {
  g.setTransform(1, 0, 0, 1, 0, 0);
}

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
export function outlineRing(img, color = '#ded8c8', r = 1) {
  const key = img;
  let cached = ringCache.get(key);
  if (cached) return cached;

  const sil = makeCanvas(img.width, img.height);
  sil.g.drawImage(img, 0, 0);
  sil.g.globalCompositeOperation = 'source-in';
  sil.g.fillStyle = color;
  sil.g.fillRect(0, 0, img.width, img.height);

  const pad = r + 1;
  const { c, g } = makeCanvas(img.width + pad * 2, img.height + pad * 2);
  for (const [dx, dy] of [
    [-r, 0], [r, 0], [0, -r], [0, r],
    [-r, -r], [r, -r], [-r, r], [r, r],
  ]) {
    g.drawImage(sil.c, pad + dx, pad + dy);
  }
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(sil.c, pad, pad);
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
 * 绘制研究员角色。
 * sx, sy = 脚底屏幕坐标
 * o = { aim:{x,y}(屏幕方向单位向量), walk, moving, leftItem, rightItem, flashOn, crouch }
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
  if (sc !== 1) g.restore();
  return r;
}

function drawCharacterBody(g, sx, sy, o) {
  const aim = o.aim || { x: 1, y: 0.5 };
  const dirRight = aim.x >= 0 ? 1 : -1;
  const back = aim.y < -0.12;
  const phase = o.walk || 0;
  const bob = o.moving ? Math.abs(Math.sin(phase * Math.PI)) * 1.2 : 0;
  const sw = o.moving ? Math.sin(phase * Math.PI * 2) : 0;
  const x = Math.round(sx);
  const y = Math.round(sy);

  // 影子
  g.save();
  g.globalAlpha = 0.5;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x, y, 6.2, 3.1, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  const baseY = y - bob;

  // 腿
  const l1 = sw * 2.2,
    l2 = -sw * 2.2;
  g.fillStyle = PAL.pants;
  g.fillRect(x - 4 + l1, baseY - 9, 3, 8);
  g.fillRect(x + 1 + l2, baseY - 9, 3, 8);
  g.fillStyle = PAL.pantsD;
  g.fillRect(x - 4 + l1, baseY - 9, 1, 8);
  g.fillRect(x + 1 + l2, baseY - 9, 1, 8);
  g.fillStyle = PAL.shoe;
  g.fillRect(x - 4 + l1 - (dirRight > 0 ? 0 : 1), baseY - 2, 4, 2);
  g.fillRect(x + 1 + l2 - (dirRight > 0 ? 0 : 1), baseY - 2, 4, 2);

  // 白大褂下摆
  g.fillStyle = PAL.coatShade;
  g.fillRect(x - 5, baseY - 13, 10, 5);
  g.fillStyle = PAL.coat;
  g.fillRect(x - 5, baseY - 13, 10, 3);

  // 躯干
  g.fillStyle = PAL.coat;
  g.fillRect(x - 5, baseY - 21, 10, 9);
  // 阴影侧
  g.fillStyle = PAL.coatShade;
  g.fillRect(x + (dirRight > 0 ? 2 : -5), baseY - 21, 3, 9);
  // 内衬 / 前襟
  g.fillStyle = '#4d565c';
  if (!back) {
    g.fillRect(x - 1 + dirRight, baseY - 20, 2, 7);
    g.fillStyle = PAL.coatDark;
    g.fillRect(x - 2 + dirRight, baseY - 20, 1, 8);
  } else {
    g.fillStyle = PAL.coatDark;
    g.fillRect(x - 5, baseY - 17, 10, 1);
  }
  // 领子
  g.fillStyle = PAL.coatDark;
  g.fillRect(x - 4, baseY - 21, 8, 1);

  // 头
  const hx = x - 3 + dirRight;
  const hy = baseY - 28;
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
    if (dirRight > 0) {
      g.fillRect(hx + 3, ey, 1, 1);
      g.fillRect(hx + 5, ey, 1, 1);
    } else {
      g.fillRect(hx, ey, 1, 1);
      g.fillRect(hx + 2, ey, 1, 1);
    }
  }
  // 脖颈阴影
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(hx + 1, hy + 7, 4, 1);

  // 手臂
  const shoulderY = baseY - 19;
  const armLen = 7;
  const drawArm = (side, item) => {
    const shx = x + side * 4.2;
    let ax, ay;
    if (item) {
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
    if (item) drawHeldItem(g, ax, ay, aim, item, o);
    return { x: ax, y: ay };
  };

  // 先画远手（背对镜头一侧）
  const farSide = dirRight > 0 ? -1 : 1;
  const nearSide = -farSide;
  const farItem = farSide < 0 ? o.leftItem : o.rightItem;
  const nearItem = nearSide < 0 ? o.leftItem : o.rightItem;
  const farPos = drawArm(farSide, farItem);
  const nearPos = drawArm(nearSide, nearItem);

  return {
    left: farSide < 0 ? farPos : nearPos,
    right: farSide < 0 ? nearPos : farPos,
  };
}

function drawHeldItem(g, ax, ay, aim, item, o) {
  const a = Math.atan2(aim.y, aim.x);
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

/** 躺在床上的姿态 */
export function drawLying(g, ox, oy, t) {
  const breathe = Math.sin(t * 1.9) * 0.6;
  // 腿
  isoBox(g, ox, oy, -0.1, -0.22, 0, 1.0, 0.44, 0.18, '#b8c0c3', '#949ea2', '#7d878b');
  // 躯干
  isoBox(g, ox, oy, -1.0, -0.28, 0, 1.05, 0.56, 0.24 + breathe * 0.02, PAL.coat, PAL.coatShade, PAL.coatDark);
  // 手臂
  isoBox(g, ox, oy, -0.85, -0.42, 0.05, 0.8, 0.16, 0.12, '#c2cbce', '#9aa4a8', '#848e92');
  isoBox(g, ox, oy, -0.85, 0.26, 0.05, 0.8, 0.16, 0.12, '#c2cbce', '#9aa4a8', '#848e92');
  // 头
  const p = P(ox, oy, -1.22, 0, 0.12);
  g.fillStyle = PAL.hair;
  g.beginPath();
  g.ellipse(p[0], p[1] - 3, 5.2, 4.2, 0, 0, 6.3);
  g.fill();
  g.fillStyle = PAL.skin;
  g.beginPath();
  g.ellipse(p[0] + 1, p[1] - 2.6, 3.6, 3.2, 0, 0, 6.3);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(p[0], p[1] - 3, 3, 1);
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
