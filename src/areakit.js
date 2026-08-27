import { HW, HH, TILE_W, TILE_Z, WALL_H } from './config.js';
import { boundsFor, camFor } from './iso.js';
import {
  makeArtCanvas, finishArt, mulberry32, shade, baseT, localT,
  pxLine, pxPolyline, pxDither, pxDitherV, pxPoly, pxEllipseRing, pxBlob, pxText,
} from './util.js';

export const PAD = 10;

/* ------------------------------------------------------------------ *
 * 绘制空间变换
 * ------------------------------------------------------------------ */

/** 地面：1 瓦片 = TILE_W 像素的正方形 */
export function floorT(g, ox, oy) {
  localT(g, HW / TILE_W, HH / TILE_W, -HW / TILE_W, HH / TILE_W, ox, oy);
}
/** 远侧长墙（y=0），u 沿 +x，v 自墙顶向下 */
export function northT(g, ox, oy, wallH = WALL_H) {
  localT(g, HW / TILE_W, HH / TILE_W, 0, 1, ox, oy - wallH * TILE_Z);
}
export function northPt(u, v, ox, oy, wallH = WALL_H) {
  return { x: ox + (u * HW) / TILE_W, y: oy - wallH * TILE_Z + (u * HH) / TILE_W + v };
}
/** 左端墙（x=0），u 沿 +y */
export function westT(g, ox, oy, wallH = WALL_H) {
  localT(g, -HW / TILE_W, HH / TILE_W, 0, 1, ox, oy - wallH * TILE_Z);
}
/**
 * 右端墙（x=w），u 沿 +y，v 自墙顶向下。
 * 注意这是**近侧**墙：画满高会把走廊内部盖住，只适合当矮护墙 / 端头封口用，
 * 而且要画进前景层（a.fg）或明确接受被角色压住。
 */
export function eastT(g, ox, oy, roomW, wallH = WALL_H) {
  localT(g, -HW / TILE_W, HH / TILE_W, 0, 1, ox + roomW * HW, oy + roomW * HH - wallH * TILE_Z);
}
export function eastPt(u, v, ox, oy, roomW, wallH = WALL_H) {
  return {
    x: ox + roomW * HW - (u * HW) / TILE_W,
    y: oy + roomW * HH - wallH * TILE_Z + (u * HH) / TILE_W + v,
  };
}
/** 近侧矮墙（y=H）的内表面，v=0 在地面，向上为负 */
export function southT(g, ox, oy, roomH) {
  localT(g, HW / TILE_W, HH / TILE_W, 0, 1, ox - roomH * HW, oy + roomH * HH);
}
export const resetT = baseT;
export function pt(ox, oy, x, y, z = 0) {
  return { x: ox + (x - y) * HW, y: oy + (x + y) * HH - z * TILE_Z };
}

/* ------------------------------------------------------------------ *
 * 主题
 * ------------------------------------------------------------------ */

export const THEMES = {
  lab2: {
    floor: ['#343b40', '#2e353a', '#3a4247', '#282f33'],
    grout: '#1b2024',
    wallTop: '#454f4c',
    wallMid: '#39413f',
    wallLow: '#242b2a',
    trim: '#5b5346',
    scorch: 0.5,
    blood: 0.7,
  },
  dorm3: {
    floor: ['#3c3730', '#342f29', '#443d35', '#2c2822'],
    grout: '#1e1b17',
    wallTop: '#4c463c',
    wallMid: '#3f3a32',
    wallLow: '#282420',
    trim: '#5c4c38',
    scorch: 0.35,
    blood: 0.55,
  },
  ruin1: {
    floor: ['#2b2b2e', '#232326', '#323236', '#1d1d20'],
    grout: '#141416',
    wallTop: '#3a3a3e',
    wallMid: '#2e2e32',
    wallLow: '#1c1c1f',
    trim: '#4a4038',
    scorch: 1,
    blood: 1,
  },
  stair: {
    floor: ['#33363b', '#2c2f33', '#3b3e44', '#26282c'],
    grout: '#191b1e',
    wallTop: '#41454a',
    wallMid: '#35383d',
    wallLow: '#232629',
    trim: '#4d5257',
    scorch: 0.4,
    blood: 1.1,
  },
  // 天台：雨夜的沥青防水层，偏青黑；墙面冷灰
  roof: {
    floor: ['#22292b', '#1d2426', '#272f31', '#191f21'],
    grout: '#12181a',
    wallTop: '#39423f',
    wallMid: '#2c3432',
    wallLow: '#1c2221',
    trim: '#414b4d',
    scorch: 0.3,
    blood: 1.4,
  },
};

/* ------------------------------------------------------------------ *
 * 地面
 * ------------------------------------------------------------------ */

export function paintFloor(g, sox, soy, w, h, rand, th, opts = {}) {
  g.save();
  floorT(g, sox, soy);

  g.fillStyle = th.grout;
  g.fillRect(0, 0, w * TILE_W, h * TILE_W);

  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      g.fillStyle = th.floor[(rand() * th.floor.length) | 0];
      g.fillRect(i * TILE_W + 1, j * TILE_W + 1, TILE_W - 2, TILE_W - 2);
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.fillRect(i * TILE_W + 1, j * TILE_W + 1, TILE_W - 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.fillRect(i * TILE_W + 1, (j + 1) * TILE_W - 3, TILE_W - 2, 2);
    }
  }

  // 大面积污渍与焦痕：两档同心的像素摊，代替径向渐变
  const stains = Math.round(30 + w * 2);
  for (let i = 0; i < stains; i++) {
    const x = rand() * w * TILE_W;
    const y = rand() * h * TILE_W;
    const r = 10 + rand() * 48;
    const dark = rand() < th.scorch * 0.5;
    const rgb = dark ? '8,8,8' : '26,22,16';
    const a = 0.08 + rand() * 0.14;
    pxBlob(g, x, y, r, r * (0.5 + rand() * 0.4), `rgba(${rgb},${a.toFixed(3)})`, rand);
    pxBlob(g, x, y, r * 0.55, r * 0.32, `rgba(${rgb},${a.toFixed(3)})`, rand);
  }

  // 血迹：像素摊
  const bloods = Math.round(14 * th.blood);
  for (let i = 0; i < bloods; i++) {
    const cx = rand() * w * TILE_W;
    const cy = rand() * h * TILE_W;
    g.globalAlpha = 0.3 + rand() * 0.3;
    const n = 3 + ((rand() * 6) | 0);
    for (let k = 0; k < n; k++) {
      pxBlob(g, cx + (rand() - 0.5) * 60, cy + (rand() - 0.5) * 40, 3 + rand() * 14, 3 + rand() * 10, '#3f1210', rand);
    }
    g.globalAlpha = 1;
  }

  // 灰尘颗粒
  for (let i = 0; i < w * 60; i++) {
    g.fillStyle = ['rgba(200,210,205,0.09)', 'rgba(0,0,0,0.2)', 'rgba(160,150,130,0.09)'][(rand() * 3) | 0];
    g.fillRect(Math.round(rand() * w * TILE_W), Math.round(rand() * h * TILE_W), 1 + ((rand() * 2) | 0), 1 + ((rand() * 2) | 0));
  }
  g.restore();

  // 碎块（屏幕空间小菱形，逐行扫描）
  for (let i = 0; i < w * 8; i++) {
    const p = pt(sox, soy, rand() * w, rand() * h);
    const s = Math.max(1, Math.round(0.6 + rand() * 2.4));
    pxPoly(g, [
      [p.x, p.y - s * 0.5],
      [p.x + s, p.y],
      [p.x, p.y + s * 0.5],
      [p.x - s, p.y],
    ], ['#4a5250', '#39403e', '#5c6462', 'rgba(180,215,210,0.3)'][(rand() * 4) | 0]);
  }

  // 地面裂缝：像素折线
  for (let i = 0; i < Math.round(w / 3); i++) {
    let px = rand() * w;
    let py = rand() * h;
    const ptsArr = [];
    const a = pt(sox, soy, px, py);
    ptsArr.push([a.x, a.y]);
    for (let s = 0; s < 5; s++) {
      px += (rand() - 0.5) * 2;
      py += (rand() - 0.5) * 1.4;
      const b = pt(sox, soy, px, py);
      ptsArr.push([b.x, b.y]);
    }
    pxPolyline(g, ptsArr, 'rgba(0,0,0,0.4)', 1);
  }

  // 积水：雨夜的天台用。画在地面空间里，才会跟着透视压扁成菱形方向
  if (opts.puddles) {
    g.save();
    floorT(g, sox, soy);
    for (let i = 0; i < opts.puddles; i++) {
      const cx = rand() * w * TILE_W;
      const cy = rand() * h * TILE_W;
      const rx = 14 + rand() * 44;
      const ry = rx * (0.5 + rand() * 0.4);
      // 两档同心的像素水面 + 1px 环形反光边
      pxBlob(g, cx, cy, rx, ry, 'rgba(90,118,128,0.1)', rand);
      pxBlob(g, cx, cy, rx * 0.62, ry * 0.62, 'rgba(120,150,160,0.12)', rand);
      pxEllipseRing(g, cx, cy, rx * 0.82, ry * 0.82, 'rgba(160,190,200,0.1)', 1);
    }
    g.restore();
  }

  // 房间前缘暗边：像素直线
  if (opts.edge !== false) {
    const p0 = pt(sox, soy, w, 0);
    const p1 = pt(sox, soy, w, h);
    const p2 = pt(sox, soy, 0, h);
    pxLine(g, p0.x, p0.y, p1.x, p1.y, 'rgba(0,0,0,0.85)', 2);
    pxLine(g, p1.x, p1.y, p2.x, p2.y, 'rgba(0,0,0,0.85)', 2);
  }
}

/* ------------------------------------------------------------------ *
 * 墙面底子
 * ------------------------------------------------------------------ */

export function wallBase(g, len, rand, th, wallH = WALL_H) {
  const H = Math.round(wallH * TILE_Z);
  const L = Math.round(len);
  // 三档硬分带（顶亮 / 中 / 底暗）+ 交界行棋盘抖动，代替竖向渐变
  const cutA = Math.round(H * 0.34);
  const cutB = Math.round(H * 0.72);
  g.fillStyle = th.wallTop;
  g.fillRect(0, 0, L, cutA);
  g.fillStyle = th.wallMid;
  g.fillRect(0, cutA, L, cutB - cutA);
  g.fillStyle = th.wallLow;
  g.fillRect(0, cutB, L, H - cutB);
  pxDither(g, 0, L, cutA, th.wallTop);
  pxDither(g, 0, L, cutA + 1, th.wallMid);
  pxDither(g, 0, L, cutB, th.wallMid);
  pxDither(g, 0, L, cutB + 1, th.wallLow);

  // 面板分缝 + 受光边
  for (let u = 0; u <= L; u += TILE_W * 2) {
    g.fillStyle = 'rgba(0,0,0,0.32)';
    g.fillRect(u, 0, 2, H);
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.fillRect(u + 2, 0, 1, H);
  }
  for (const v of [Math.round(H * 0.32), Math.round(H * 0.7)]) {
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(0, v, L, 1);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, v + 1, L, 1);
  }
  // 踢脚
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(0, H - 4, L, 4);

  // 水痕：两段平涂（下重上轻）+ 顶端抖动行，代替竖向渐变
  for (let i = 0; i < L / 12; i++) {
    const x = Math.round(rand() * L);
    const hh = Math.round(8 + rand() * (H - 10));
    const ww = Math.round(3 + rand() * 16);
    const rgb = ['24,18,12', '30,22,14', '12,12,12'][(rand() * 3) | 0];
    const a = 0.12 + rand() * 0.26;
    g.fillStyle = `rgba(${rgb},${(a * 0.45).toFixed(3)})`;
    g.fillRect(x, H - hh, ww, hh);
    g.fillStyle = `rgba(${rgb},${(a * 0.55).toFixed(3)})`;
    g.fillRect(x, H - Math.round(hh * 0.55), ww, Math.round(hh * 0.55));
    pxDither(g, x, x + ww, H - hh - 1, `rgba(${rgb},${(a * 0.45).toFixed(3)})`);
  }
  // 锈斑：像素摊
  for (let i = 0; i < L / 8; i++) {
    pxBlob(g, rand() * L, rand() * H, 1 + rand() * 5, 1 + rand() * 4, `rgba(${['109,74,48', '143,96,56', '50,44,40'][(rand() * 3) | 0]},${(0.1 + rand() * 0.26).toFixed(3)})`, rand);
  }
  // 爆炸焦痕：两档同心的像素摊
  for (let i = 0; i < Math.round((L / 90) * th.scorch * 3); i++) {
    const x = rand() * L;
    const y = H * (0.3 + rand() * 0.5);
    const r = 18 + rand() * 30;
    pxBlob(g, x, y, r, r * 0.66, 'rgba(0,0,0,0.22)', rand);
    pxBlob(g, x, y, r * 0.5, r * 0.34, 'rgba(0,0,0,0.35)', rand);
  }
  // 血手印 / 拖痕
  for (let i = 0; i < Math.round(th.blood * 3); i++) {
    g.globalAlpha = 0.3 + rand() * 0.25;
    g.fillStyle = '#3f1210';
    const x = rand() * L;
    const y = H * (0.35 + rand() * 0.4);
    for (let k = 0; k < 5; k++) {
      g.fillRect(Math.round(x + k * 2.2), Math.round(y + rand() * 10), 2, Math.round(5 + rand() * 12));
    }
    g.globalAlpha = 1;
  }
  // 颗粒
  for (let i = 0; i < L * 1.4; i++) {
    g.fillStyle = ['rgba(255,255,255,0.045)', 'rgba(0,0,0,0.16)'][(rand() * 2) | 0];
    g.fillRect(Math.round(rand() * L), Math.round(rand() * H), 1, 1);
  }
}

/** 墙顶的管线与线缆 */
export function wallPipes(g, len, rand, v0, th) {
  for (const [vv, r, c] of [
    [v0, 3, th.trim],
    [v0 + 8, 2, '#41494a'],
  ]) {
    g.fillStyle = shade(c, -0.42);
    g.fillRect(0, Math.round(vv), Math.round(len), r * 2);
    g.fillStyle = c;
    g.fillRect(0, Math.round(vv), Math.round(len), r);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, Math.round(vv) + 1, Math.round(len), 1);
    for (let u = 18; u < len; u += 78) {
      g.fillStyle = shade(c, -0.2);
      g.fillRect(u, Math.round(vv) - 1, 5, r * 2 + 2);
    }
  }
  // 松垂的电缆：每 40px 一段的像素折线
  for (let i = 0; i < 4; i++) {
    const col = ['#14181a', '#1d1a16', '#101416'][(rand() * 3) | 0];
    const base = v0 + 13 + i * 2.1;
    const ptsArr = [[0, base]];
    for (let u = 0; u < len; u += 40) {
      ptsArr.push([u + 20, base + (rand() - 0.3) * 6]);
      ptsArr.push([u + 40, base + (rand() - 0.5) * 3]);
    }
    pxPolyline(g, ptsArr, col, 1 + (rand() > 0.5 ? 1 : 0));
  }
  // 断落的线缆：像素折线下垂
  for (let i = 0; i < len / 130; i++) {
    const x = rand() * len;
    pxPolyline(g, [
      [x, v0 + 16],
      [x + 6, v0 + 30],
      [x + 3, v0 + 42],
      [x - 4, v0 + 52],
    ], '#101416', 1);
  }
}

/* ------------------------------------------------------------------ *
 * 门洞：关着的门（带观察窗）/ 敞开的门洞（能看见房间内景）
 * ------------------------------------------------------------------ */

const ROOM_KINDS = {
  lab: { name: '实验室', wall: '#2a3436', floor: '#242c2e' },
  storage: { name: '储藏室', wall: '#332e26', floor: '#2a251f' },
  office: { name: '办公室', wall: '#2e3134', floor: '#26282b' },
  dorm: { name: '宿舍', wall: '#332b24', floor: '#2a231d' },
};

/** 在墙面空间画一间"能看进去"的房间内景 */
function roomInterior(g, u0, u1, top, bottom, kind, rand, burning) {
  const k = ROOM_KINDS[kind] || ROOM_KINDS.lab;
  const w = u1 - u0;
  const h = bottom - top;

  // 内腔。底色画得比走廊亮一些：房间里还有应急照明，否则在暗处
  // 门洞会变成一个纯黑的洞，玩家根本看不出"能看进去"。
  g.fillStyle = shade(k.wall, 0.26);
  g.fillRect(u0, top, w, h);
  g.fillStyle = shade(k.floor, 0.22);
  g.fillRect(u0, top + h * 0.62, w, h * 0.38);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(u0, top + h * 0.6, w, 2);
  // 只在顶部压一点阴影，保留纵深又不至于全黑：两条硬带 + 抖动行
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(Math.round(u0), Math.round(top), Math.round(w), Math.round(h * 0.22));
  pxDither(g, u0, u0 + w, top + h * 0.22, 'rgba(0,0,0,0.4)');
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(Math.round(u0), Math.round(bottom - h * 0.14), Math.round(w), Math.round(h * 0.14));
  pxDither(g, u0, u0 + w, bottom - h * 0.14 - 1, 'rgba(0,0,0,0.22)');

  const fx = (t) => u0 + w * t;
  const fy = (t) => top + h * t;

  if (kind === 'lab') {
    // 实验台 + 器皿 + 翻倒的架子
    g.fillStyle = '#3d4a4c';
    g.fillRect(fx(0.1), fy(0.66), w * 0.5, 4);
    g.fillRect(fx(0.12), fy(0.7), 3, h * 0.24);
    g.fillRect(fx(0.55), fy(0.7), 3, h * 0.24);
    for (let i = 0; i < 5; i++) {
      g.fillStyle = ['rgba(150,190,185,0.4)', 'rgba(120,190,140,0.45)'][(rand() * 2) | 0];
      g.fillRect(fx(0.14 + i * 0.08), fy(0.58), 3, 8);
    }
    g.fillStyle = '#2b3335';
    g.fillRect(fx(0.68), fy(0.3), w * 0.24, h * 0.36);
    g.fillStyle = 'rgba(121,210,204,0.12)';
    g.fillRect(fx(0.7), fy(0.33), w * 0.2, h * 0.14);
  } else if (kind === 'storage') {
    // 货架与箱子
    for (let i = 0; i < 3; i++) {
      g.fillStyle = '#443a2c';
      g.fillRect(fx(0.08 + i * 0.3), fy(0.24), w * 0.24, h * 0.42);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      for (let s = 0; s < 3; s++) g.fillRect(fx(0.08 + i * 0.3), fy(0.3 + s * 0.12), w * 0.24, 2);
    }
    g.fillStyle = '#5a5344';
    g.fillRect(fx(0.2), fy(0.72), w * 0.2, h * 0.2);
    g.fillRect(fx(0.5), fy(0.78), w * 0.16, h * 0.14);
  } else if (kind === 'office') {
    // 书桌 + 椅子 + 文件散落
    g.fillStyle = '#3b3229';
    g.fillRect(fx(0.14), fy(0.62), w * 0.42, 5);
    g.fillRect(fx(0.16), fy(0.67), 3, h * 0.26);
    g.fillRect(fx(0.52), fy(0.67), 3, h * 0.26);
    g.fillStyle = '#2a2f33';
    g.fillRect(fx(0.62), fy(0.66), w * 0.16, h * 0.2);
    g.fillStyle = 'rgba(220,215,200,0.35)';
    for (let i = 0; i < 8; i++) g.fillRect(fx(0.1 + rand() * 0.8), fy(0.82 + rand() * 0.14), 4, 3);
  } else {
    // 宿舍：床 + 柜
    g.fillStyle = '#4a3f34';
    g.fillRect(fx(0.1), fy(0.66), w * 0.44, 6);
    g.fillStyle = '#6d6459';
    g.fillRect(fx(0.1), fy(0.62), w * 0.44, 5);
    g.fillStyle = '#382f27';
    g.fillRect(fx(0.62), fy(0.42), w * 0.22, h * 0.26);
  }

  // 狼藉：碎片与血（像素摊）
  g.globalAlpha = 0.5;
  for (let i = 0; i < 4; i++) {
    pxBlob(g, fx(0.15 + rand() * 0.7), fy(0.78 + rand() * 0.16), 3 + rand() * 8, 2 + rand() * 5, '#3f1210', rand);
  }
  g.globalAlpha = 1;

  if (burning) {
    // 火光把整间照亮（真实火焰由动态层每帧绘制）：三档同心的硬边像素摊
    pxBlob(g, fx(0.5), fy(0.7), w * 0.7, h * 0.55, 'rgba(220,110,40,0.2)', rand);
    pxBlob(g, fx(0.5), fy(0.7), w * 0.44, h * 0.36, 'rgba(255,150,55,0.28)', rand);
    pxBlob(g, fx(0.5), fy(0.7), w * 0.2, h * 0.18, 'rgba(255,190,80,0.4)', rand);
  }
}

/**
 * 一个门位。opts:
 *  kind    房间类型
 *  state   'open' 敞开能看进去 / 'closed' 关着带观察窗 / 'sealed' 完全封死
 *  burning 是否着火
 */
export function doorBay(g, u0, u1, rand, th, opts = {}, wallH = WALL_H) {
  const H = wallH * TILE_Z;
  const bottom = H;
  const top = H - 44;
  const w = u1 - u0;

  // 门框凹槽
  g.fillStyle = '#0f1211';
  g.fillRect(u0 - 6, top - 6, w + 12, bottom - top + 6);
  g.fillStyle = shade(th.wallTop, 0.14);
  g.fillRect(u0 - 5, top - 5, w + 10, bottom - top + 5);
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.fillRect(u0 - 5, top - 5, w + 10, 2);
  g.fillStyle = '#15191a';
  g.fillRect(u0 - 2, top - 2, w + 4, bottom - top + 2);

  if (opts.state === 'open') {
    roomInterior(g, u0, u1, top, bottom, opts.kind, rand, opts.burning);
    // 歪斜的门板挂在一侧：台阶斜边的平行四边形，不做旋转
    const dw = Math.round(w * 0.32);
    const dh = bottom - top - 8;
    const skew = Math.round(dh * 0.12);
    pxPoly(g, [
      [u0 + 2, top + 4],
      [u0 + 2 + dw, top + 4],
      [u0 + 2 + dw - skew, top + 4 + dh],
      [u0 + 2 - skew, top + 4 + dh],
    ], shade(th.wallMid, 0.1));
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fillRect(u0, top, 3, bottom - top);
  } else if (opts.state === 'sealed') {
    // 被杂物封死：一根根台阶斜置的木板（像素粗线）
    g.fillStyle = '#1a1c1a';
    g.fillRect(u0, top, w, bottom - top);
    const cx = u0 + w / 2;
    const cy = top + (bottom - top) / 2;
    for (let i = 0; i < 6; i++) {
      const ang = -0.6 + i * 0.24;
      const dx = Math.cos(ang) * w * 0.6;
      const dy = Math.sin(ang) * w * 0.6;
      const off = -2 + i * 1.5;
      pxLine(g, cx - dx, cy + off - dy, cx + dx, cy + off + dy, th.trim, 4);
    }
  } else {
    // 关着的门：两扇，硬分带明暗 + 抖动列，观察窗里透出房间的一点内容
    const dh2 = bottom - top;
    for (const [f0, f1, dc] of [
      [0, 0.2, '#4d565a'],
      [0.2, 0.5, '#626c71'],
      [0.5, 0.68, '#414a4e'],
      [0.68, 0.86, '#5e686d'],
      [0.86, 1, '#475054'],
    ]) {
      g.fillStyle = dc;
      g.fillRect(Math.round(u0 + w * f0), top, Math.round(u0 + w * f1) - Math.round(u0 + w * f0), dh2);
    }
    for (const f of [0.2, 0.5, 0.68, 0.86]) {
      pxDitherV(g, u0 + w * f, top, bottom, '#525c60');
    }
    g.fillStyle = '#121616';
    g.fillRect(u0 + w / 2 - 1, top, 2, dh2);
    for (const side of [0, 1]) {
      const x = u0 + side * (w / 2) + 3;
      const ww = w / 2 - 6;
      // 观察窗：能看见里面
      g.save();
      g.beginPath();
      g.rect(x + 2, top + 7, ww - 4, 13);
      g.clip();
      roomInterior(g, u0, u1, top - 6, bottom, opts.kind, rand, opts.burning);
      g.restore();
      {
        const bx = Math.round(x + 2);
        const by = top + 7;
        const bw = Math.round(ww - 4);
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(bx, by, bw, 1);
        g.fillRect(bx, by + 12, bw, 1);
        g.fillRect(bx, by, 1, 13);
        g.fillRect(bx + bw - 1, by, 1, 13);
      }
      // 玻璃裂纹：像素放射线
      if (rand() > 0.45) {
        const cx = x + ww / 2;
        const cy = top + 13;
        for (let i = 0; i < 5; i++) {
          pxLine(g, cx, cy, cx + Math.cos(i * 1.3) * (3 + rand() * 7), cy + Math.sin(i * 1.7) * (2 + rand() * 5), 'rgba(210,225,225,0.35)', 1);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(x, bottom - 18, ww, 1);
    }
    // 下部危险条纹：逐行扫描，行内按斜移后的 8px 周期分色
    {
      const sy0 = bottom - 12;
      const sh2 = 8;
      const sx0 = Math.round(u0 + 2);
      const sw2 = Math.round(w - 4);
      for (let yy = 0; yy < sh2; yy++) {
        const shift = Math.round(yy * 1.1);
        for (let x = 0; x < sw2; ) {
          const idx = Math.floor((x + shift) / 8);
          const runEnd = Math.min(sw2, (idx + 1) * 8 - shift);
          g.fillStyle = ((idx % 2) + 2) % 2 === 0 ? '#8a7433' : '#1e2220';
          g.fillRect(sx0 + x, sy0 + yy, Math.max(1, runEnd - x), 1);
          x = runEnd;
        }
      }
    }
    // 门牌：像素字
    g.fillStyle = 'rgba(200,200,190,0.3)';
    g.fillRect(u0 + w / 2 - 12, top + 25, 24, 7);
    if (opts.label) pxText(g, u0 + w / 2 - (String(opts.label).length * 4 - 1) / 2, top + 26, opts.label, '#1a1c1a', 1);
  }
}

/* ------------------------------------------------------------------ *
 * 区域骨架
 * ------------------------------------------------------------------ */

export function newArea(id, name, w, h, wallH = WALL_H) {
  const bounds = boundsFor(w, h, wallH);
  const cam = camFor(bounds);
  const { c, g } = makeArtCanvas(bounds.w + PAD * 2, bounds.h + PAD * 2);
  const sox = -bounds.x0 + PAD;
  const soy = -bounds.y0 + PAD;
  return {
    id,
    name,
    w,
    h,
    wallH,
    bounds,
    cam,
    statics: { img: c, ox: sox, oy: soy },
    g,
    sox,
    soy,
    props: [],
    colliders: [],
    segments: [],
    lights: [],
    fixtures: [],
    emissive: [],
    links: [],
    spawns: {},
    fg: null,
  };
}

/**
 * 房间四壁的遮挡线段 + 关闭视线遮挡时用的房间轮廓。
 *
 * opts.edgeH：边界遮挡体的高度（默认就是 a.wallH，即室内的满高墙）。
 * 露天场景（天台）四周只有矮女儿墙，传护墙高度进来 —— 否则光照会把边界
 * 当成一圈满高实墙向上拉伸，天台就被裁成一个封闭的室内盒子。
 */
export function closeArea(a, opts = {}) {
  const edgeH = opts.edgeH === undefined ? a.wallH : opts.edgeH;
  const addRect = (x0, y0, x1, y1, hh, id) => {
    a.segments.push(
      { x1: x0, y1: y0, x2: x1, y2: y0, h: hh, id },
      { x1: x1, y1: y0, x2: x1, y2: y1, h: hh, id },
      { x1: x1, y1: y1, x2: x0, y2: y1, h: hh, id },
      { x1: x0, y1: y1, x2: x0, y2: y0, h: hh, id },
    );
  };
  const base = a.segments.length;
  addRect(0, 0, a.w, a.h, edgeH, 'wall');
  const S = {
    n: a.segments[base],
    e: a.segments[base + 1],
    s: a.segments[base + 2],
    w: a.segments[base + 3],
  };
  for (const p of a.props) {
    if (!p.occ) continue;
    const [pw, pd, ph] = p.occ;
    addRect(p.x - pw / 2, p.y - pd / 2, p.x + pw / 2, p.y + pd / 2, ph, p.id);
  }
  for (const p of a.props) {
    if (!p.col) continue;
    const [pw, pd] = p.col;
    a.colliders.push({ x0: p.x - pw / 2, y0: p.y - pd / 2, x1: p.x + pw / 2, y1: p.y + pd / 2, id: p.id });
  }
  a.roomVis = [
    { x: 0, y: 0, seg: S.n },
    { x: a.w, y: 0, seg: S.n },
    { x: a.w, y: 0, seg: S.e },
    { x: a.w, y: a.h, seg: S.e },
    { x: a.w, y: a.h, seg: S.s },
    { x: 0, y: a.h, seg: S.s },
    { x: 0, y: a.h, seg: S.w },
    { x: 0, y: 0, seg: S.w },
  ];
  resetT(a.g);
  // 静态层收口时统一过一遍像素语言（调色板 + 有序抖动）
  finishArt({ c: a.statics.img, g: a.g });
  delete a.g;
  return a;
}

export { mulberry32 };
