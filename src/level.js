import { HW, HH, TILE_W, TILE_Z, ROOM_W, ROOM_H, WALL_H, RS } from './config.js';
import {
  BOUNDS, boundsFor, camFor, floorTransform, wallNorthTransform, wallWestTransform, wallNorthPt,
} from './iso.js';
import { makeCanvas, mulberry32, shade } from './util.js';
import * as A from './art.js';

const PAD = 10;

/* 门在北墙上的位置（墙面 u 坐标，像素；1 瓦片 = TILE_W） */
export const DOOR = {
  u0: 9.75 * TILE_W,
  u1: 11.45 * TILE_W,
  top: WALL_H * TILE_Z - 46,
  bottom: WALL_H * TILE_Z,
};
DOOR.cx = (DOOR.u0 + DOOR.u1) / 2;
/** 门前的互动点（世界坐标） */
export const DOOR_SPOT = { x: DOOR.cx / TILE_W, y: 1.0 };
/** 扫描仪面板中心（墙面坐标） */
export const SCANNER = { u: DOOR.u1 + 16, v: WALL_H * TILE_Z - 31 };

/** 西墙上的应急指示灯（同时为储物柜区域提供微光） */
export const EXIT_LAMP = { u: 8.1 * TILE_W, v: WALL_H * TILE_Z - 34, y: 8.1 };

export const LOCKER_POS = { x: 1.15, y: 6.35 };
export const LOCKER_SPOT = { x: 2.3, y: 6.35 };
export const BED_POS = { x: 4.8, y: 4.0 };
export const PLAYER_START = { x: 4.9, y: 5.7 };

/** 世界坐标 -> 静态图层画布坐标 */
function makeSp(sox, soy) {
  return (x, y, z = 0) => [sox + (x - y) * HW, soy + (x + y) * HH - z * TILE_Z];
}

/* ------------------------------------------------------------------ *
 * 静态图层：地板 + 两面背墙 + 门
 * ------------------------------------------------------------------ */

function paintFloor(g, sox, soy, rand) {
  const sp = makeSp(sox, soy);

  g.save();
  floorTransform(g, sox, soy);

  // 底色
  g.fillStyle = '#252b2f';
  g.fillRect(0, 0, ROOM_W * TILE_W, ROOM_H * TILE_W);

  // 瓦片
  for (let j = 0; j < ROOM_H; j++) {
    for (let i = 0; i < ROOM_W; i++) {
      const v = rand();
      let c = v > 0.72 ? '#3a4247' : v > 0.34 ? '#343b40' : '#2e353a';
      if (rand() > 0.93) c = '#282f33';
      g.fillStyle = c;
      g.fillRect(i * TILE_W + 1, j * TILE_W + 1, TILE_W - 2, TILE_W - 2);
      // 高光边
      g.fillStyle = 'rgba(255,255,255,0.035)';
      g.fillRect(i * TILE_W + 1, j * TILE_W + 1, TILE_W - 2, 2);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(i * TILE_W + 1, (j + 1) * TILE_W - 3, TILE_W - 2, 2);
    }
  }

  // 大面积污渍
  for (let i = 0; i < 46; i++) {
    const x = rand() * ROOM_W * TILE_W;
    const y = rand() * ROOM_H * TILE_W;
    const r = 10 + rand() * 46;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const col = ['20,24,20', '32,26,18', '18,26,28'][(rand() * 3) | 0];
    grd.addColorStop(0, `rgba(${col},${0.1 + rand() * 0.2})`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // 灰尘 / 碎屑颗粒
  for (let i = 0; i < 900; i++) {
    g.fillStyle = ['rgba(200,210,205,0.10)', 'rgba(0,0,0,0.22)', 'rgba(160,150,130,0.10)'][(rand() * 3) | 0];
    g.fillRect(rand() * ROOM_W * TILE_W, rand() * ROOM_H * TILE_W, 1 + rand() * 2.6, 1 + rand() * 2);
  }

  // 干涸血迹（从床边拖向门口）
  g.globalAlpha = 0.5;
  for (let i = 0; i < 26; i++) {
    const t = i / 25;
    const x = (5.6 + t * 3.4 + Math.sin(t * 5) * 0.35) * TILE_W;
    const y = (5.6 - t * 1.6 + Math.cos(t * 4) * 0.3) * TILE_W;
    g.fillStyle = '#40120f';
    g.beginPath();
    g.ellipse(x, y, 3 + rand() * 9 * (1 - t * 0.6), 2.5 + rand() * 7 * (1 - t * 0.6), rand() * 3, 0, 6.3);
    g.fill();
  }
  g.globalAlpha = 1;

  g.restore();

  // 地板裂缝（屏幕空间贝塞尔）
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  for (let i = 0; i < 7; i++) {
    const x0 = rand() * ROOM_W,
      y0 = rand() * ROOM_H;
    let px = x0,
      py = y0;
    g.lineWidth = 0.9;
    g.beginPath();
    const a = sp(px, py);
    g.moveTo(a[0], a[1]);
    for (let s = 0; s < 5; s++) {
      px += (rand() - 0.5) * 1.7;
      py += (rand() - 0.5) * 1.7;
      const b = sp(px, py);
      g.lineTo(b[0], b[1]);
    }
    g.stroke();
  }

  // 地上的电缆
  const cables = [
    [
      [0.4, 2.6],
      [3.2, 3.4],
      [6.0, 2.2],
      [8.4, 3.6],
    ],
    [
      [15.4, 5.2],
      [12.6, 6.8],
      [10.2, 6.0],
      [8.2, 7.6],
    ],
    [
      [13.6, 1.1],
      [12.4, 3.4],
      [13.8, 5.2],
    ],
  ];
  for (const path of cables) {
    for (const [w, col] of [
      [3.2, 'rgba(0,0,0,0.45)'],
      [2.2, '#191d20'],
      [0.7, 'rgba(120,130,130,0.18)'],
    ]) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      const p0 = sp(path[0][0], path[0][1]);
      g.moveTo(p0[0], p0[1]);
      for (let i = 1; i < path.length; i++) {
        const pm = sp((path[i - 1][0] + path[i][0]) / 2 + 0.5, (path[i - 1][1] + path[i][1]) / 2 - 0.4);
        const pp = sp(path[i][0], path[i][1]);
        g.quadraticCurveTo(pm[0], pm[1], pp[0], pp[1]);
      }
      g.stroke();
    }
  }

  // 散落的碎块与碎玻璃
  for (let i = 0; i < 120; i++) {
    const x = rand() * ROOM_W,
      y = rand() * ROOM_H;
    const p = sp(x, y);
    const s = 0.6 + rand() * 2.2;
    g.fillStyle = ['#4a5250', '#39403e', '#5c6462', 'rgba(180,215,210,0.35)'][(rand() * 4) | 0];
    g.beginPath();
    g.moveTo(p[0], p[1] - s * 0.5);
    g.lineTo(p[0] + s, p[1]);
    g.lineTo(p[0], p[1] + s * 0.5);
    g.lineTo(p[0] - s, p[1]);
    g.closePath();
    g.fill();
  }

  // 房间前缘（暗边）
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.lineWidth = 2;
  g.beginPath();
  let p = sp(ROOM_W, 0);
  g.moveTo(p[0], p[1]);
  p = sp(ROOM_W, ROOM_H);
  g.lineTo(p[0], p[1]);
  p = sp(0, ROOM_H);
  g.lineTo(p[0], p[1]);
  g.stroke();
}

function wallBase(g, len, rand, tint) {
  const H = WALL_H * TILE_Z;
  // 底色渐变
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, tint.top);
  grd.addColorStop(0.55, tint.mid);
  grd.addColorStop(1, tint.bottom);
  g.fillStyle = grd;
  g.fillRect(0, 0, len, H);

  // 面板分缝
  for (let u = 0; u <= len; u += TILE_W * 2) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(u, 0, 1.5, H);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(u + 1.5, 0, 1, H);
    // 铆钉
    for (let v = 5; v < H - 3; v += 9) {
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.fillRect(u + 3, v, 1.4, 1.4);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(u + 3, v + 1.4, 1.4, 0.8);
    }
  }
  // 横向分缝
  for (const v of [H * 0.34, H * 0.72]) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, v, len, 1.4);
    g.fillStyle = 'rgba(255,255,255,0.045)';
    g.fillRect(0, v + 1.4, len, 0.8);
  }
  // 踢脚
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(0, H - 4, len, 4);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.fillRect(0, H - 5, len, 1);

  // 污渍 / 水痕
  for (let i = 0; i < 30; i++) {
    const x = rand() * len;
    const w = 3 + rand() * 16;
    const h = 8 + rand() * (H - 10);
    const gr = g.createLinearGradient(0, H - h, 0, H);
    gr.addColorStop(0, 'rgba(20,16,12,0)');
    gr.addColorStop(1, `rgba(${['24,18,12', '30,22,14', '14,18,18'][(rand() * 3) | 0]},${0.12 + rand() * 0.28})`);
    g.fillStyle = gr;
    g.fillRect(x, H - h, w, h);
  }
  // 锈斑
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(${['109,74,48', '143,96,56', '60,44,30'][(rand() * 3) | 0]},${0.1 + rand() * 0.3})`;
    const x = rand() * len,
      y = rand() * H;
    g.beginPath();
    g.ellipse(x, y, 1 + rand() * 5, 1 + rand() * 4, 0, 0, 6.3);
    g.fill();
  }
  // 颗粒
  for (let i = 0; i < 500; i++) {
    g.fillStyle = ['rgba(255,255,255,0.05)', 'rgba(0,0,0,0.18)'][(rand() * 2) | 0];
    g.fillRect(rand() * len, rand() * H, 1, 1);
  }
}

function wallPipes(g, len, rand, v0) {
  // 主管道
  for (const [vv, r, c] of [
    [v0, 3.6, '#5b5346'],
    [v0 + 8, 2.6, '#41494a'],
  ]) {
    g.fillStyle = shade(c, -0.42);
    g.fillRect(0, vv, len, r * 2);
    g.fillStyle = c;
    g.fillRect(0, vv, len, r);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    g.fillRect(0, vv + 0.6, len, 1);
    // 法兰
    for (let u = 18; u < len; u += 78) {
      g.fillStyle = shade(c, -0.2);
      g.fillRect(u, vv - 1.2, 5, r * 2 + 2.4);
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.fillRect(u + 5, vv - 1.2, 1.2, r * 2 + 2.4);
    }
  }
  // 线缆束
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = ['#14181a', '#1d1a16', '#101416'][(rand() * 3) | 0];
    g.lineWidth = 1.2 + rand();
    g.beginPath();
    g.moveTo(0, v0 + 14 + i * 2.2);
    for (let u = 0; u < len; u += 40) {
      g.quadraticCurveTo(u + 20, v0 + 14 + i * 2.2 + (rand() - 0.3) * 6, u + 40, v0 + 14 + i * 2.2 + (rand() - 0.5) * 3);
    }
    g.stroke();
  }
}

function paintNorthWall(g, sox, soy, rand) {
  const H = WALL_H * TILE_Z;
  const len = ROOM_W * TILE_W;
  g.save();
  wallNorthTransform(g, sox, soy);
  wallBase(g, len, rand, { top: '#454f4c', mid: '#39413f', bottom: '#242b2a' });
  wallPipes(g, len, rand, 3);

  // 警示标牌
  g.fillStyle = '#1b1f1e';
  g.fillRect(52, 17, 96, 15);
  g.fillStyle = '#9aa5a0';
  g.fillRect(53.5, 18.5, 93, 12);
  g.fillStyle = '#8f9791';
  g.fillRect(53.5, 25, 93, 5.5);
  g.fillStyle = '#1a1e1d';
  g.font = 'bold 7px monospace';
  g.fillText('LAB 7 - RESTRICTED', 57, 27);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 14; i++) g.fillRect(53 + rand() * 92, 18 + rand() * 12, 1 + rand() * 4, 1 + rand() * 2);
  // 标牌一角脱落
  g.fillStyle = '#232827';
  g.beginPath();
  g.moveTo(148, 17);
  g.lineTo(148, 26);
  g.lineTo(133, 17);
  g.closePath();
  g.fill();

  // 设备机架（中段）
  for (let k = 0; k < 3; k++) {
    const x = 176 + k * 52;
    g.fillStyle = '#2b3230';
    g.fillRect(x, 14, 46, 30);
    g.fillStyle = '#3c4644';
    g.fillRect(x + 1.5, 15.5, 43, 27);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(x + 1.5, 15.5, 43, 1);
    // 屏幕 / 仪表
    g.fillStyle = '#101817';
    g.fillRect(x + 4, 18, 18, 11);
    g.fillStyle = k === 1 ? 'rgba(121,210,204,0.16)' : 'rgba(160,180,175,0.06)';
    g.fillRect(x + 4, 18, 18, 11);
    // 裂纹
    if (k !== 1) {
      g.strokeStyle = 'rgba(200,215,215,0.35)';
      g.lineWidth = 0.5;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        g.moveTo(x + 13, 23);
        g.lineTo(x + 13 + Math.cos(i) * (4 + rand() * 6), 23 + Math.sin(i * 1.7) * (2 + rand() * 4));
      }
      g.stroke();
    }
    // 按钮阵
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 8; c++) {
        g.fillStyle = rand() > 0.9 ? ['#c94a3a', '#e0a552', '#79c07d'][(rand() * 3) | 0] : '#232a28';
        g.fillRect(x + 25 + c * 2.4, 18 + r * 2.6, 1.8, 1.8);
      }
    for (let r = 0; r < 3; r++) {
      g.fillStyle = '#1c2220';
      g.fillRect(x + 4, 31 + r * 3.6, 38, 2.6);
      g.fillStyle = ['#4a5250', '#5d6b52', '#5a4a3a'][r];
      g.fillRect(x + 4, 31 + r * 3.6, (6 + rand() * 30) | 0, 2.6);
    }
  }

  // 通风口
  g.fillStyle = '#232a28';
  g.fillRect(455, 12, 40, 22);
  g.fillStyle = '#39413f';
  g.fillRect(456.5, 13.5, 37, 19);
  g.fillStyle = '#161b1a';
  for (let i = 0; i < 6; i++) g.fillRect(458, 15 + i * 3, 34, 1.8);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let i = 0; i < 6; i++) g.fillRect(458, 15 + i * 3 + 1.8, 34, 0.6);

  // 门
  paintDoor(g, rand);

  // 弹孔 / 抓痕
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 0.8;
  for (let i = 0; i < 3; i++) {
    const x = 150 + rand() * 26,
      y = 36 + rand() * 8;
    g.beginPath();
    for (let k = 0; k < 4; k++) {
      g.moveTo(x + k * 2, y);
      g.lineTo(x + k * 2 + 3, y + 8 + rand() * 4);
    }
    g.stroke();
  }
  g.restore();
}

function paintDoor(g, rand) {
  const { u0, u1, top, bottom } = DOOR;
  const w = u1 - u0;
  const h = bottom - top;

  // 门框凹槽
  g.fillStyle = '#0f1413';
  g.fillRect(u0 - 8, top - 8, w + 16, h + 8);
  // 门框
  g.fillStyle = '#7a857f';
  g.fillRect(u0 - 6, top - 6, w + 12, h + 6);
  g.fillStyle = '#98a49c';
  g.fillRect(u0 - 6, top - 6, w + 12, 2.5);
  g.fillStyle = '#4d5652';
  g.fillRect(u0 - 6, top + 2, 2, h - 2);
  g.fillRect(u1 + 4, top + 2, 2, h - 2);
  g.fillStyle = '#1a201f';
  g.fillRect(u0 - 2, top - 2, w + 4, h + 2);
  // 门楣标识灯带
  g.fillStyle = '#20262a';
  g.fillRect(u0 - 4, top - 5, w + 8, 3);
  g.fillStyle = 'rgba(224,165,82,0.35)';
  for (let i = 0; i < w + 8; i += 6) g.fillRect(u0 - 4 + i, top - 5, 3, 3);

  // 门扇（比墙面更亮的冷钢色，便于辨认）
  const dg = g.createLinearGradient(u0, 0, u1, 0);
  dg.addColorStop(0, '#5a6771');
  dg.addColorStop(0.32, '#75838d');
  dg.addColorStop(0.5, '#4b565e');
  dg.addColorStop(0.68, '#71808a');
  dg.addColorStop(1, '#525e67');
  g.fillStyle = dg;
  g.fillRect(u0, top, w, h);

  // 中缝
  g.fillStyle = '#121716';
  g.fillRect(u0 + w / 2 - 1, top, 2, h);

  // 门板细节
  for (const side of [0, 1]) {
    const x = u0 + side * (w / 2) + 3;
    const ww = w / 2 - 6;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 1;
    g.strokeRect(x, top + 5, ww, h - 22);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(x, top + 5, ww, 1);
    // 观察窗
    g.fillStyle = '#080d0e';
    g.fillRect(x + 2, top + 8, ww - 4, 12);
    g.fillStyle = 'rgba(120,170,170,0.12)';
    g.fillRect(x + 2, top + 8, ww - 4, 5);
    g.fillStyle = '#1d2524';
    for (let i = 1; i < 4; i++) g.fillRect(x + 2 + i * ((ww - 4) / 4), top + 8, 0.9, 12);
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.strokeRect(x + 2, top + 8, ww - 4, 12);
    // 铆钉
    g.fillStyle = 'rgba(255,255,255,0.16)';
    for (let i = 0; i < 4; i++) g.fillRect(x + 1, top + 24 + i * 5, 1.2, 1.2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(x, top + h - 24, ww, 1);
  }
  // 液压/紧急释放把手
  g.fillStyle = '#26302f';
  g.fillRect(u0 + w / 2 - 12, top + 26, 9, 3);
  g.fillRect(u0 + w / 2 + 3, top + 26, 9, 3);
  g.fillStyle = '#93a09c';
  g.fillRect(u0 + w / 2 - 12, top + 26, 9, 1.2);
  g.fillRect(u0 + w / 2 + 3, top + 26, 9, 1.2);

  // 底部危险条纹
  g.save();
  g.beginPath();
  g.rect(u0 + 2, bottom - 13, w - 4, 9);
  g.clip();
  for (let i = -10; i < w + 10; i += 8) {
    g.fillStyle = i % 16 === 0 ? '#c8a13f' : '#1e2220';
    g.beginPath();
    g.moveTo(u0 + i, bottom - 13);
    g.lineTo(u0 + i + 5, bottom - 13);
    g.lineTo(u0 + i - 4, bottom - 4);
    g.lineTo(u0 + i - 9, bottom - 4);
    g.closePath();
    g.fill();
  }
  g.globalAlpha = 0.35;
  g.fillStyle = '#20241f';
  for (let i = 0; i < 30; i++) g.fillRect(u0 + rand() * w, bottom - 13 + rand() * 9, 1 + rand() * 4, 1 + rand() * 2);
  g.globalAlpha = 1;
  g.restore();

  // 门上编号
  g.fillStyle = 'rgba(18,22,22,0.6)';
  g.font = 'bold 7px monospace';
  g.fillText('D-01', u0 + w / 2 - 10, top + 24);

  // 门顶警示灯壳
  g.fillStyle = '#202624';
  g.fillRect(DOOR.cx - 9, top - 11, 18, 6);
  g.fillStyle = '#3a1512';
  g.fillRect(DOOR.cx - 7.5, top - 9.5, 15, 3.5);

  // 侧边：人脸识别终端
  const sx = SCANNER.u - 9,
    sy = SCANNER.v - 11;
  g.fillStyle = '#171c1b';
  g.fillRect(sx - 1.5, sy - 1.5, 21, 25);
  g.fillStyle = '#495350';
  g.fillRect(sx, sy, 18, 22);
  g.fillStyle = '#5b6663';
  g.fillRect(sx, sy, 18, 1.5);
  // 摄像头窗口
  g.fillStyle = '#080c0d';
  g.fillRect(sx + 2, sy + 2, 14, 10);
  g.fillStyle = 'rgba(90,140,140,0.15)';
  g.fillRect(sx + 2, sy + 2, 14, 4);
  g.fillStyle = '#0d1414';
  g.beginPath();
  g.ellipse(sx + 9, sy + 7, 3.2, 3.2, 0, 0, 6.3);
  g.fill();
  g.fillStyle = '#1d3234';
  g.beginPath();
  g.ellipse(sx + 9, sy + 7, 2, 2, 0, 0, 6.3);
  g.fill();
  // 键盘 + 状态灯
  g.fillStyle = '#232a28';
  g.fillRect(sx + 2, sy + 14, 14, 6);
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++) {
      g.fillStyle = '#39423f';
      g.fillRect(sx + 3 + c * 3.4, sy + 15 + r * 2.6, 2.4, 1.8);
    }
  // 磨损
  g.globalAlpha = 0.3;
  for (let i = 0; i < 20; i++) {
    g.fillStyle = '#2a2018';
    g.fillRect(sx + rand() * 18, sy + rand() * 22, 1 + rand() * 3, 1);
  }
  g.globalAlpha = 1;
}

function paintWestWall(g, sox, soy, rand) {
  const H = WALL_H * TILE_Z;
  const len = ROOM_H * TILE_W;
  g.save();
  wallWestTransform(g, sox, soy);
  wallBase(g, len, rand, { top: '#414b48', mid: '#353d3b', bottom: '#212827' });
  wallPipes(g, len, rand, 2);

  // 大型控制墙（对应参考图左侧）
  g.fillStyle = '#242b29';
  g.fillRect(20, 12, 108, 34);
  g.fillStyle = '#39423f';
  g.fillRect(21.5, 13.5, 105, 31);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(21.5, 13.5, 105, 1.2);
  // 压力表
  for (let i = 0; i < 3; i++) {
    const cx = 30 + i * 15,
      cy = 22;
    g.fillStyle = '#1a201f';
    g.beginPath();
    g.arc(cx, cy, 6, 0, 6.3);
    g.fill();
    g.fillStyle = '#c3cbc4';
    g.beginPath();
    g.arc(cx, cy, 4.6, 0, 6.3);
    g.fill();
    g.strokeStyle = '#2a302e';
    g.lineWidth = 0.7;
    g.beginPath();
    g.arc(cx, cy, 3.4, 2.4, 6.6);
    g.stroke();
    g.strokeStyle = '#b03026';
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(cx, cy);
    const a = 2.6 + rand() * 3.4;
    g.lineTo(cx + Math.cos(a) * 3.4, cy + Math.sin(a) * 3.4);
    g.stroke();
  }
  // 管路阀门
  for (let i = 0; i < 4; i++) {
    const x = 26 + i * 13;
    g.fillStyle = '#4d5754';
    g.fillRect(x, 32, 4, 11);
    g.fillStyle = '#7d5a3a';
    g.beginPath();
    g.arc(x + 2, 32, 3.4, 0, 6.3);
    g.fill();
    g.fillStyle = '#2b211a';
    g.beginPath();
    g.arc(x + 2, 32, 1.4, 0, 6.3);
    g.fill();
  }
  // 开关阵列
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 10; c++) {
      g.fillStyle = rand() > 0.82 ? ['#c94a3a', '#79c07d', '#e0a552'][(rand() * 3) | 0] : '#222827';
      g.fillRect(82 + c * 4.2, 18 + r * 4, 3, 3);
    }
  g.fillStyle = '#1a201f';
  g.fillRect(82, 32, 42, 10);
  g.fillStyle = 'rgba(121,210,204,0.1)';
  g.fillRect(82, 32, 42, 10);

  // 破损面板 + 裸露线束（火花源）
  g.fillStyle = '#0d1111';
  g.fillRect(132, 16, 30, 26);
  g.fillStyle = '#2b3230';
  g.beginPath();
  g.moveTo(132, 16);
  g.lineTo(162, 16);
  g.lineTo(158, 22);
  g.lineTo(136, 20);
  g.closePath();
  g.fill();
  // 扭曲的金属边
  g.strokeStyle = '#6d7a77';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(132, 16);
  g.lineTo(137, 21);
  g.lineTo(143, 17);
  g.lineTo(150, 23);
  g.lineTo(157, 18);
  g.lineTo(162, 24);
  g.stroke();
  // 内部线束
  for (let i = 0; i < 9; i++) {
    g.strokeStyle = ['#7a2a22', '#8a6a20', '#1f4f4a', '#2a2a2a'][(rand() * 4) | 0];
    g.lineWidth = 0.9;
    g.beginPath();
    g.moveTo(134 + rand() * 26, 20 + rand() * 4);
    g.quadraticCurveTo(140 + rand() * 20, 30 + rand() * 8, 136 + rand() * 24, 40 + rand() * 4);
    g.stroke();
  }
  // 焦痕
  const bg = g.createRadialGradient(147, 26, 1, 147, 26, 26);
  bg.addColorStop(0, 'rgba(0,0,0,0.6)');
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bg;
  g.fillRect(120, 2, 56, 50);

  // 配电箱
  g.fillStyle = '#1c2221';
  g.fillRect(176, 14, 40, 30);
  g.fillStyle = '#4d5651';
  g.fillRect(177.5, 15.5, 37, 27);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(177.5, 15.5, 37, 1.2);
  g.fillStyle = '#39423f';
  g.fillRect(180, 18, 16, 22);
  for (let i = 0; i < 6; i++) {
    g.fillStyle = rand() > 0.5 ? '#2b322f' : '#6a736e';
    g.fillRect(181, 19 + i * 3.4, 14, 2.4);
  }
  g.fillStyle = 'rgba(224,165,82,0.6)';
  g.fillRect(199, 18, 13, 8);
  g.fillStyle = '#1a1c18';
  g.fillRect(200.5, 20, 2, 4);
  g.fillRect(204, 20, 2, 4);
  g.fillRect(207.5, 20, 2, 4);
  g.fillStyle = '#151a19';
  g.fillRect(199, 29, 13, 11);
  g.fillStyle = 'rgba(201,74,58,0.55)';
  g.fillRect(201, 31, 4, 4);
  g.fillStyle = 'rgba(121,192,125,0.2)';
  g.fillRect(206.5, 31, 4, 4);

  // 墙面喷涂编号
  g.fillStyle = 'rgba(180,190,182,0.22)';
  g.font = 'bold 13px monospace';
  g.fillText('S-07', 228, 40);

  // 悬挂的线缆
  g.strokeStyle = '#121618';
  for (let i = 0; i < 4; i++) {
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(226 + i * 26, 6);
    g.quadraticCurveTo(238 + i * 26, 24 + i * 5, 230 + i * 26, 46);
    g.stroke();
  }

  // 墙上小屏
  g.fillStyle = '#1b2120';
  g.fillRect(250, 18, 34, 20);
  g.fillStyle = '#0e1516';
  g.fillRect(251.5, 19.5, 31, 17);
  g.fillStyle = 'rgba(121,210,204,0.1)';
  for (let i = 0; i < 5; i++) g.fillRect(253, 21 + i * 3, 8 + rand() * 20, 1.2);

  // 应急指示灯（绿色）
  {
    const u = EXIT_LAMP.u;
    const v = EXIT_LAMP.v;
    g.fillStyle = '#161b19';
    g.fillRect(u - 13, v - 9, 26, 18);
    g.fillStyle = '#39423e';
    g.fillRect(u - 12, v - 8, 24, 16);
    g.fillStyle = 'rgba(120,225,155,0.55)';
    g.fillRect(u - 10, v - 6, 20, 12);
    g.fillStyle = 'rgba(190,255,215,0.85)';
    g.fillRect(u - 10, v - 6, 20, 3);
    g.fillStyle = 'rgba(10,30,18,0.8)';
    g.fillRect(u - 6, v - 2, 5, 6);
    g.fillRect(u + 1, v - 2, 3, 2);
    g.fillRect(u + 1, v + 2, 3, 2);
    g.fillStyle = '#20262a';
    g.fillRect(u - 13, v + 7, 26, 3);
    // 灯罩裂痕
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(u - 8, v - 6);
    g.lineTo(u - 2, v + 3);
    g.lineTo(u + 6, v - 1);
    g.stroke();
  }

  // 生化警示贴
  g.save();
  g.translate(320, 26);
  g.fillStyle = 'rgba(210,160,60,0.5)';
  g.beginPath();
  g.moveTo(0, -9);
  g.lineTo(9, 7);
  g.lineTo(-9, 7);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(20,20,18,0.75)';
  g.fillRect(-1, -4, 2, 7);
  g.fillRect(-1, 4, 2, 2);
  g.restore();

  g.restore();
}

export function buildStatic() {
  const rand = mulberry32(20260824);
  const sox = -BOUNDS.x0 + PAD;
  const soy = -BOUNDS.y0 + PAD;
  const { c, g } = makeCanvas(BOUNDS.w + PAD * 2, BOUNDS.h + PAD * 2, RS);
  paintFloor(g, sox, soy, rand);
  paintNorthWall(g, sox, soy, rand);
  paintWestWall(g, sox, soy, rand);
  return { img: c, ox: sox, oy: soy };
}

/* ------------------------------------------------------------------ *
 * 关卡内容
 * ------------------------------------------------------------------ */

export function buildLevel() {
  const statics = buildStatic();

  const sprites = {
    bed: A.makeBed(),
    lockerClosed: A.makeLocker(false),
    lockerOpen: A.makeLocker(true),
    lockerEmpty: A.makeLocker(true, 3, true),
    consoleA: A.makeConsole(1.5, 1.0, 1.5, 101, { dead: true }),
    consoleB: A.makeConsole(1.3, 1.4, 1.45, 202, { color: 'rgba(121,210,204,0.45)' }),
    consoleC: A.makeConsole(1.4, 1.0, 1.4, 303, { dead: true }),
    table: A.makeTable(),
    crateA: A.makeCrate(0.92, 55),
    crateB: A.makeCrate(0.78, 56),
    crateC: A.makeCrate(0.85, 57),
    barrel: A.makeBarrel(),
    cart: A.makeMonitorCart(),
    shelf: A.makeShelf(),
    chair: A.makeChair(),
    rubbleA: A.makeRubble(71),
    rubbleB: A.makeRubble(72),
    pipes: A.makePipeStack(),
  };

  /** occ: [w,d,h] 视线/光线遮挡体；col: [w,d] 碰撞体 */
  const props = [
    { id: 'bed', s: sprites.bed, x: BED_POS.x, y: BED_POS.y, col: [3.0, 1.5], occ: null },
    { id: 'cart', s: sprites.cart, x: 7.0, y: 2.3, col: [0.85, 0.75], occ: [0.85, 0.75, 1.5] },
    { id: 'shelf', s: sprites.shelf, x: 0.75, y: 2.2, col: [0.9, 1.7], occ: [0.9, 1.7, 2.05] },
    { id: 'locker', s: sprites.lockerClosed, x: LOCKER_POS.x, y: LOCKER_POS.y, col: [1.1, 1.55], occ: [1.1, 1.55, 2.3] },
    { id: 'table', s: sprites.table, x: 2.5, y: 8.7, col: [2.3, 1.05], occ: [2.3, 1.05, 0.9] },
    { id: 'consoleA', s: sprites.consoleA, x: 6.5, y: 0.75, col: [1.5, 1.0], occ: [1.5, 1.0, 1.6] },
    { id: 'consoleB', s: sprites.consoleB, x: 12.85, y: 4.1, col: [1.3, 1.4], occ: [1.3, 1.4, 1.6] },
    { id: 'consoleC', s: sprites.consoleC, x: 12.75, y: 6.2, col: [1.4, 1.0], occ: [1.4, 1.0, 1.5] },
    { id: 'pipes', s: sprites.pipes, x: 13.4, y: 0.85, col: [0.6, 1.4], occ: [0.6, 1.4, 2.6] },
    { id: 'crateA', s: sprites.crateA, x: 8.0, y: 8.0, col: [0.92, 0.92], occ: [0.92, 0.92, 0.88] },
    { id: 'crateB', s: sprites.crateB, x: 8.95, y: 8.7, col: [0.78, 0.78], occ: [0.78, 0.78, 0.74] },
    { id: 'crateC', s: sprites.crateC, x: 7.9, y: 9.1, col: [0.85, 0.85], occ: [0.85, 0.85, 0.8] },
    { id: 'barrel', s: sprites.barrel, x: 12.5, y: 8.4, col: [0.88, 0.88], occ: [0.88, 0.88, 1.12] },
    { id: 'chair', s: sprites.chair, x: 6.2, y: 7.0, col: null, occ: null },
    { id: 'rubbleA', s: sprites.rubbleA, x: 3.5, y: 6.8, col: null, occ: null },
    { id: 'rubbleB', s: sprites.rubbleB, x: 9.8, y: 3.6, col: null, occ: null },
  ];

  // 碰撞矩形
  const colliders = [];
  for (const p of props) {
    if (!p.col) continue;
    const [w, d] = p.col;
    colliders.push({ x0: p.x - w / 2, y0: p.y - d / 2, x1: p.x + w / 2, y1: p.y + d / 2, id: p.id });
  }

  // 遮挡线段
  const segments = [];
  const addRect = (x0, y0, x1, y1, h, id) => {
    segments.push(
      { x1: x0, y1: y0, x2: x1, y2: y0, h, id },
      { x1: x1, y1: y0, x2: x1, y2: y1, h, id },
      { x1: x1, y1: y1, x2: x0, y2: y1, h, id },
      { x1: x0, y1: y1, x2: x0, y2: y0, h, id },
    );
  };
  addRect(0, 0, ROOM_W, ROOM_H, WALL_H, 'wall');
  const wallSegs = { n: segments[0], e: segments[1], s: segments[2], w: segments[3] };
  for (const p of props) {
    if (!p.occ) continue;
    const [w, d, h] = p.occ;
    addRect(p.x - w / 2, p.y - d / 2, p.x + w / 2, p.y + d / 2, h, p.id);
  }

  // 静态光源
  const lights = [
    { id: 'tube1', x: 4.9, y: 2.6, z: WALL_H - 0.3, r: 6.8, color: [216, 238, 242], power: 1.0, seed: 1.3 },
    { id: 'tube2', x: 10.2, y: 6.8, z: WALL_H - 0.3, r: 5.4, color: [206, 228, 236], power: 0.55, seed: 4.7 },
    { id: 'emg', x: DOOR_SPOT.x, y: 0.35, z: 2.4, r: 4.4, color: [255, 92, 66], power: 0.6, seed: 2.2 },
    { id: 'emg2', x: 0.42, y: EXIT_LAMP.y, z: 2.2, r: 4.0, color: [116, 220, 150], power: 0.42, seed: 3.9 },
    { id: 'spark', x: 0.2, y: 4.05, z: 2.0, r: 4.2, color: [160, 205, 255], power: 0, seed: 8.1 },
    { id: 'screen', x: 12.85, y: 3.15, z: 1.6, r: 2.6, color: [110, 220, 214], power: 0.4, seed: 6.4 },
  ];

  // 天花板灯具（绘制在最上层）
  const fixtures = [
    { x: 4.9, y: 2.6, z: WALL_H - 0.26, len: 2.4, light: 'tube1', tilt: 0 },
    { x: 10.2, y: 6.8, z: WALL_H - 0.26, len: 2.0, light: 'tube2', tilt: 0.3 },
  ];

  /**
   * 关闭"视线遮挡"时使用的遮罩：整个房间地面 + 墙面竖直拉伸。
   * 结构与 computeVisibility 的返回值一致，所以可以直接喂给 Lighting._shape。
   * 相邻两点 seg 相同的边才会被向上拉伸成墙面。
   */
  const roomVis = [
    { x: 0, y: 0, seg: wallSegs.n },
    { x: ROOM_W, y: 0, seg: wallSegs.n },
    { x: ROOM_W, y: 0, seg: wallSegs.e },
    { x: ROOM_W, y: ROOM_H, seg: wallSegs.e },
    { x: ROOM_W, y: ROOM_H, seg: wallSegs.s },
    { x: 0, y: ROOM_H, seg: wallSegs.s },
    { x: 0, y: ROOM_H, seg: wallSegs.w },
    { x: 0, y: 0, seg: wallSegs.w },
  ];

  const bounds = boundsFor(ROOM_W, ROOM_H);
  return {
    id: 'lab',
    name: '七号实验室',
    w: ROOM_W,
    h: ROOM_H,
    wallH: WALL_H,
    bounds,
    cam: camFor(bounds),
    statics,
    sprites,
    props,
    colliders,
    segments,
    lights,
    fixtures,
    roomVis,
    fg: null,
    spawns: {
      start: { x: PLAYER_START.x, y: PLAYER_START.y },
      fromCorr: { x: DOOR_SPOT.x, y: 1.5 },
    },
    // 门被打穿后才通往走廊，链接由 main.js 按 doorBroken 状态启用
    links: [
      {
        x: DOOR_SPOT.x,
        y: DOOR_SPOT.y,
        r: 1.9,
        to: 'corr2',
        spawn: 'fromLab',
        text: '走出实验室',
        short: '出去',
        anchor: { x: DOOR_SPOT.x, y: 0.1, z: 2.55 },
        needsDoorOpen: true,
      },
    ],
  };
}

/** 火花发射点（世界坐标） */
export const SPARK_SRC = { x: 0.16, y: 4.05, z: 2.0 };
/** 仍在运行的控制台屏幕（发光点） */
export const SCREEN_SRC = { x: 12.85, y: 3.28, z: 1.62 };
