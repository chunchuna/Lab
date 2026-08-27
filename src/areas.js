import { TILE_W, TILE_Z, WALL_H, VIEW_W, VIEW_H } from './config.js';
import { buildLevel } from './level.js';
import * as A from './art.js';
import {
  newArea, closeArea, paintFloor, wallBase, wallPipes, doorBay,
  floorT, northT, northPt, westT, eastT, southT, resetT, pt, THEMES, PAD, mulberry32,
} from './areakit.js';
import {
  makeCanvas, makeArtCanvas, finishArt, shade,
  pxDither, pxText, pxBlob, pxPoly,
} from './util.js';

/** 横向色带填充 + 相邻带交界棋盘抖动：代替竖直线性渐变 */
function bandFillV(g, x, w, stops) {
  for (let i = 0; i < stops.length - 1; i++) {
    const [y0, c] = stops[i];
    const y1 = stops[i + 1][0];
    g.fillStyle = c;
    g.fillRect(x, Math.round(y0), w, Math.round(y1) - Math.round(y0));
  }
  for (let i = 1; i < stops.length - 1; i++) {
    const yb = Math.round(stops[i][0]);
    pxDither(g, x, x + w, yb - 1, stops[i - 1][1]);
    pxDither(g, x, x + w, yb, stops[i][1]);
  }
}

/** 每个敞开的门洞给一盏弱光，让"能看进房间"在暗处也成立 */
function bayLights(a, bays) {
  bays.forEach((b, i) => {
    if (b.state === 'sealed') return;
    const cx = (b.u0 + b.u1) / 2;
    const open = b.state === 'open';
    a.lights.push({
      id: 'bay' + i,
      x: cx,
      y: 0.45,
      z: 1.4,
      r: open ? 4.2 : 2.4,
      color: b.burning ? [255, 160, 70] : [190, 205, 214],
      power: b.burning ? 0 : open ? 0.5 : 0.24,
      seed: i * 1.7 + 0.6,
      mode: open ? 1 : 5,
    });
  });
}

/* ------------------------------------------------------------------ *
 * 走廊：远侧长墙开门（能看进房间），近侧只做矮护墙 + 门框
 *
 * 等距投影下"走廊两侧都能看进房间"在几何上做不到：能看进一个空间的
 * 前提是它的远墙高、近墙无。走廊的近墙同时是对侧房间的远墙，两者要求
 * 相反。所以远侧房间做成真的能看进去，近侧只给门框暗示"这边也有房间"。
 * ------------------------------------------------------------------ */

const CORR_W = 24;
const CORR_H = 5;

function corridorFloorAndWalls(a, rand, th, bays, opts = {}) {
  const g = a.g;
  paintFloor(g, a.sox, a.soy, a.w, a.h, rand, th);

  // 远侧长墙
  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.w * TILE_W, rand, th, a.wallH);
  wallPipes(g, a.w * TILE_W, rand, 2, th);
  for (const b of bays) {
    doorBay(g, b.u0 * TILE_W, b.u1 * TILE_W, rand, th, b, a.wallH);
  }
  // 楼层号喷涂（3×5 字模放大 4 倍）
  if (opts.floorMark) {
    pxText(g, 26, 14, opts.floorMark, 'rgba(200,200,190,0.2)', 4);
  }
  g.restore();

  // 左端墙（走廊尽头，通楼梯间）
  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.h * TILE_W, rand, th, a.wallH);
  if (opts.endDoor) {
    doorBay(g, 1.1 * TILE_W, 3.4 * TILE_W, rand, th, { state: 'closed', kind: 'office', label: 'EXIT' }, a.wallH);
  }
  g.restore();
  resetT(g);
}

/**
 * 矮护墙的立面。调用前先把墙面变换设好，v0 传护墙顶在该平面里的 v
 * （northT / westT / eastT 是 (wallH - h) * TILE_Z，southT 是 -h * TILE_Z）。
 * 上面留空，露出后面的东西或夜空。
 */
function parapetFace(g, len, hTiles, v0, th, rand) {
  const H = Math.round(hTiles * TILE_Z);
  const V0 = Math.round(v0);
  // 上下两带 + 交界抖动，代替线性渐变
  bandFillV(g, 0, len, [
    [V0, th.wallMid],
    [V0 + Math.round(H * 0.55), th.wallLow],
    [V0 + H, ''],
  ]);
  // 压顶画亮一点，暗处才能看出这里有一道墙
  g.fillStyle = shade(th.wallTop, 0.3);
  g.fillRect(0, V0, len, 3);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, V0, len, 1);
  for (let u = 0; u <= len; u += TILE_W * 2) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(Math.round(u), V0, 1, H);
  }
  for (let i = 0; i < len / 26; i++) {
    g.globalAlpha = 0.24 + rand() * 0.24;
    g.fillStyle = rand() > 0.5 ? '#3f1210' : '#0a0a0a';
    g.fillRect(Math.round(rand() * len), V0 + Math.round(rand() * H * 0.7), 2 + ((rand() * 8) | 0), 3 + ((rand() * 8) | 0));
    g.globalAlpha = 1;
  }
}

/** 近侧矮护墙 + 门框，画在道具之后（前景层） */
function corridorParapet(a, rand, th, doors, opts = {}) {
  const ph = 0.82; // 高度（瓦片）：够读出"这边也是一排门"，又不挡住走廊地面
  const { c, g } = makeArtCanvas(a.bounds.w + PAD * 2, a.bounds.h + PAD * 2);
  g.save();
  southT(g, a.sox, a.soy, a.h);
  const H = Math.round(ph * TILE_Z);
  const len = a.w * TILE_W;
  // 墙体：两带 + 抖动，代替线性渐变
  bandFillV(g, 0, len, [
    [-H, th.wallMid],
    [-Math.round(H * 0.45), th.wallLow],
    [0, ''],
  ]);
  // 压顶画亮一点，暗处才能看出这里有一道墙
  g.fillStyle = shade(th.wallTop, 0.3);
  g.fillRect(0, -H, len, 3);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, -H, len, 1);
  for (let u = 0; u <= len; u += TILE_W * 2) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(Math.round(u), -H, 1, H);
  }
  // 门框：只到护墙高度，暗示这一侧也有房间
  for (const d of doors) {
    const u0 = Math.round(d[0] * TILE_W);
    const u1 = Math.round(d[1] * TILE_W);
    g.fillStyle = '#0f1211';
    g.fillRect(u0 - 4, -H, u1 - u0 + 8, H);
    g.fillStyle = '#1b1f20';
    g.fillRect(u0, -H + 2, u1 - u0, H - 2);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(u0 - 4, -H, u1 - u0 + 8, 2);
    // 门缝透出的一点光
    g.fillStyle = 'rgba(210,200,170,0.12)';
    g.fillRect(u0 + Math.round((u1 - u0) / 2) - 1, -H + 3, 2, H - 5);
  }
  // 血迹与焦痕
  for (let i = 0; i < 10; i++) {
    g.globalAlpha = 0.28 + rand() * 0.24;
    g.fillStyle = rand() > 0.5 ? '#3f1210' : '#0a0a0a';
    g.fillRect(Math.round(rand() * len), -H + Math.round(rand() * H * 0.6), 2 + ((rand() * 8) | 0), 3 + ((rand() * 8) | 0));
    g.globalAlpha = 1;
  }
  g.restore();

  /* 东端封口。x=w 是**近侧**墙，画满高会把走廊内部盖掉（跟南墙同理），
     所以只做一道齐腰的封口，并且和南护墙一样放前景层。 */
  if (opts.eastCap) {
    g.save();
    eastT(g, a.sox, a.soy, a.w, a.wallH);
    parapetFace(g, a.h * TILE_W, 0.86, (a.wallH - 0.86) * TILE_Z, th, rand);
    g.restore();
  }

  resetT(g);
  finishArt({ c, g });
  return { img: c, ox: a.sox, oy: a.soy };
}

/* ------------------------------------------------------------------ *
 * 二层走廊
 * ------------------------------------------------------------------ */

export const LAB_DOOR_X = 17.2;

function buildCorr2() {
  const a = newArea('corr2', '二层走廊', CORR_W, CORR_H);
  const rand = mulberry32(0x2f1a);
  const th = THEMES.lab2;

  const bays = [
    { u0: 2.4, u1: 4.6, state: 'closed', kind: 'office', label: '204' },
    { u0: 6.2, u1: 8.4, state: 'open', kind: 'storage' },
    { u0: 10.0, u1: 12.2, state: 'open', kind: 'lab', burning: true },
    { u0: 13.6, u1: 15.8, state: 'closed', kind: 'lab', label: '208' },
    // 实验室的门（被玩家打穿的那扇），敞开
    { u0: LAB_DOOR_X - 1.1, u1: LAB_DOOR_X + 1.1, state: 'open', kind: 'lab' },
    { u0: 20.4, u1: 22.6, state: 'sealed', kind: 'storage' },
  ];
  corridorFloorAndWalls(a, rand, th, bays, { endDoor: true, floorMark: '2F' });
  bayLights(a, bays);

  const S = A.makeShelf(91);
  const props = [
    ['crate', A.makeCrate(0.9, 201), 5.6, 3.6, [0.9, 0.9], [0.9, 0.9, 0.86]],
    ['crate2', A.makeCrate(0.78, 202), 6.5, 4.2, [0.78, 0.78], [0.78, 0.78, 0.74]],
    ['barrel', A.makeBarrel(203), 9.2, 4.1, [0.88, 0.88], [0.88, 0.88, 1.12]],
    ['shelf', S, 12.8, 1.0, [0.9, 1.7], [0.9, 1.7, 2.05]],
    ['cart', A.makeMonitorCart(204), 15.0, 3.4, [0.85, 0.75], [0.85, 0.75, 1.5]],
    ['chair', A.makeChair(205), 8.0, 2.2, null, null],
    ['chair2', A.makeChair(206), 18.6, 4.0, null, null],
    ['rub1', A.makeRubble(207), 4.2, 2.6, null, null],
    ['rub2', A.makeRubble(208), 11.4, 3.2, null, null],
    ['rub3', A.makeRubble(209), 16.6, 2.0, null, null],
    ['rub4', A.makeRubble(210), 21.0, 3.8, null, null],
    ['pipes', A.makePipeStack(211), 22.8, 1.1, [0.6, 1.4], [0.6, 1.4, 2.6]],
    ['table', A.makeTable(212), 19.4, 2.6, [2.3, 1.05], [2.3, 1.05, 0.9]],
  ];
  for (const [id, s, x, y, col, occ] of props) a.props.push({ id, s, x, y, col, occ });

  // 吊灯：一半坏掉
  const tubes = [
    [3.5, 2.4, 1, 0.0],
    [7.5, 2.4, 0, 0.3],
    [11.5, 2.4, 2, 0.0],
    [15.5, 2.4, 1, -0.26],
    [19.5, 2.4, 3, 0.0],
    [22.8, 2.4, 0, 0.34],
  ];
  tubes.forEach(([x, y, mode, tilt], i) => {
    const id = 'ct' + i;
    a.fixtures.push({ x, y, z: WALL_H - 0.28, len: 2.0, light: id, tilt, mode });
    a.lights.push({
      id,
      x,
      y,
      z: WALL_H - 0.3,
      r: mode === 3 ? 3.4 : 5.6,
      color: [206, 226, 234],
      power: mode === 3 ? 0 : mode === 2 ? 0.42 : 0.78,
      seed: i * 2.7 + 1.1,
      mode,
    });
  });

  // 着火房间：光 + 每帧火焰
  const fireX = 11.1;
  a.lights.push({ id: 'fire', x: fireX, y: 0.5, z: 1.2, r: 7.2, color: [255, 150, 60], power: 1, seed: 5.5, mode: 4 });
  a.fire = { x: fireX, y: 0.15, z: 0 };

  // 走廊尽头（楼梯间）与实验室之间的通道
  a.spawns.fromLab = { x: LAB_DOOR_X, y: 1.5 };
  a.spawns.fromStair = { x: 1.9, y: 2.5 };
  a.links.push({
    x: 1.0,
    y: 2.4,
    r: 1.9,
    to: 'stair',
    spawn: 'fromCorr2',
    text: '进入楼梯间',
    short: '楼梯',
    anchor: { x: 0.2, y: 2.4, z: 2.4 },
    target: null,
  });
  a.links.push({
    x: LAB_DOOR_X,
    y: 0.55,
    r: 1.5,
    to: 'lab',
    spawn: 'fromCorr',
    text: '回到实验室',
    short: '返回',
    anchor: { x: LAB_DOOR_X, y: 0.1, z: 2.4 },
    target: null,
  });

  // 丧尸从右端涌入
  a.horde = { x: CORR_W - 0.8, y: CORR_H / 2, count: 20, delay: 10 };
  a.fg = corridorParapet(a, rand, th, [
    [3.0, 5.0],
    [7.0, 9.0],
    [12.0, 14.0],
    [16.4, 18.4],
    [20.6, 22.6],
  ]);
  return closeArea(a);
}

/* ------------------------------------------------------------------ *
 * 三层：宿舍走廊
 * ------------------------------------------------------------------ */

export const DORM_DOOR_X = 13.4;
/** 走廊东端通天台楼梯的那扇门 */
export const ROOF_DOOR_X = 22.1;

function buildCorr3() {
  const a = newArea('corr3', '三层宿舍走廊', CORR_W, CORR_H);
  const rand = mulberry32(0x3c07);
  const th = THEMES.dorm3;

  const bays = [
    { u0: 2.4, u1: 4.6, state: 'open', kind: 'dorm' },
    { u0: 6.2, u1: 8.4, state: 'sealed', kind: 'dorm' },
    { u0: 10.0, u1: 12.2, state: 'open', kind: 'dorm' },
    // 唯一完好、可进入的房间
    { u0: DORM_DOOR_X - 1.1, u1: DORM_DOOR_X + 1.1, state: 'closed', kind: 'dorm', label: '312', intact: true },
    { u0: 17.2, u1: 19.4, state: 'open', kind: 'dorm' },
    // 走廊东端：通天台楼梯的防火门
    { u0: ROOF_DOOR_X - 1.1, u1: ROOF_DOOR_X + 1.1, state: 'closed', kind: 'office', label: 'ROOF' },
  ];
  corridorFloorAndWalls(a, rand, th, bays, { endDoor: true, floorMark: '3F' });
  bayLights(a, bays);

  const props = [
    ['rub1', A.makeRubble(301), 3.6, 3.2, null, null],
    ['rub2', A.makeRubble(302), 9.0, 2.4, null, null],
    ['rub3', A.makeRubble(303), 18.2, 3.6, null, null],
    ['crate', A.makeCrate(0.85, 304), 7.4, 3.9, [0.85, 0.85], [0.85, 0.85, 0.8]],
    ['chair', A.makeChair(305), 11.0, 3.4, null, null],
    ['chair2', A.makeChair(306), 20.0, 2.2, null, null],
    ['table', A.makeTable(307), 5.2, 2.2, [2.3, 1.05], [2.3, 1.05, 0.9]],
    ['barrel', A.makeBarrel(308), 22.9, 3.9, [0.88, 0.88], [0.88, 0.88, 1.12]],
    ['shelf', A.makeShelf(309), 16.0, 1.0, [0.9, 1.7], [0.9, 1.7, 2.05]],
  ];
  for (const [id, s, x, y, col, occ] of props) a.props.push({ id, s, x, y, col, occ });

  const tubes = [
    [4.0, 2.4, 2, 0.0],
    [8.5, 2.4, 3, 0.28],
    [13.4, 2.4, 1, 0.0],
    [18.0, 2.4, 0, -0.3],
    [22.4, 2.4, 3, 0.0],
  ];
  tubes.forEach(([x, y, mode, tilt], i) => {
    const id = 'dt' + i;
    a.fixtures.push({ x, y, z: WALL_H - 0.28, len: 2.0, light: id, tilt, mode });
    a.lights.push({
      id,
      x,
      y,
      z: WALL_H - 0.3,
      r: mode === 3 ? 3.0 : 5.2,
      color: [222, 214, 190],
      power: mode === 3 ? 0 : mode === 2 ? 0.4 : 0.7,
      seed: i * 3.1 + 2.4,
      mode,
    });
  });

  a.spawns.fromStair = { x: 1.9, y: 2.5 };
  // 从 312 出来时站在自己门口，不要落到走廊正中央
  a.spawns.fromDorm = { x: DORM_DOOR_X, y: 1.5 };
  a.spawns.fromRoofStair = { x: ROOF_DOOR_X, y: 1.6 };
  a.links.push({
    x: 1.0,
    y: 2.4,
    r: 1.9,
    to: 'stair',
    spawn: 'fromCorr3',
    text: '返回楼梯间',
    short: '楼梯',
    anchor: { x: 0.2, y: 2.4, z: 2.4 },
  });
  // 312 房间：唯一能开的门，触发对讲机
  a.links.push({
    x: DORM_DOOR_X,
    y: 0.9,
    r: 1.7,
    to: 'dorm312',
    spawn: 'enter',
    text: '推开 312 的房门',
    short: '进入',
    anchor: { x: DORM_DOOR_X, y: 0.1, z: 2.4 },
  });
  // 天台楼梯：对讲机剧情走完之前锁着，不让玩家没头没脑地上天台
  a.links.push({
    x: ROOF_DOOR_X,
    y: 0.9,
    r: 1.7,
    to: 'stairRoof',
    spawn: 'fromCorr3',
    text: '推开通往天台的防火门',
    short: '天台',
    needsRadio: true,
    lockedText: '门锁着 · 先弄清对讲机在说什么',
    anchor: { x: ROOF_DOOR_X, y: 0.1, z: 2.4 },
  });
  a.fg = corridorParapet(
    a,
    rand,
    th,
    [
      [3.2, 5.2],
      [8.0, 10.0],
      [12.6, 14.6],
      [17.4, 19.4],
    ],
    { eastCap: true },
  );
  return closeArea(a);
}

/* ------------------------------------------------------------------ *
 * 一层：堵死的走廊，进来就是剧情杀
 * ------------------------------------------------------------------ */

function buildCorr1() {
  const a = newArea('corr1', '一层走廊', 14, CORR_H);
  const rand = mulberry32(0x1b44);
  const th = THEMES.ruin1;

  const bays = [
    { u0: 2.4, u1: 4.6, state: 'sealed', kind: 'storage' },
    { u0: 6.2, u1: 8.4, state: 'open', kind: 'lab', burning: true },
    { u0: 10.4, u1: 12.6, state: 'sealed', kind: 'office' },
  ];
  corridorFloorAndWalls(a, rand, th, bays, { endDoor: true, floorMark: '1F' });
  bayLights(a, bays);

  // 塌落的杂物把走廊堵死
  const props = [
    ['blk1', A.makeCrate(0.95, 401), 6.4, 1.2, [0.95, 0.95], [0.95, 0.95, 0.9]],
    ['blk2', A.makeCrate(0.9, 402), 6.5, 2.2, [0.9, 0.9], [0.9, 0.9, 0.86]],
    ['blk3', A.makeCrate(0.88, 403), 6.3, 3.2, [0.88, 0.88], [0.88, 0.88, 0.84]],
    ['blk4', A.makeBarrel(404), 6.6, 4.1, [0.88, 0.88], [0.88, 0.88, 1.12]],
    ['blk5', A.makePipeStack(405), 7.3, 2.0, [0.6, 1.4], [0.6, 1.4, 2.6]],
    ['blk6', A.makeShelf(406), 7.4, 3.6, [0.9, 1.7], [0.9, 1.7, 2.05]],
    ['rub1', A.makeRubble(407), 3.4, 2.4, null, null],
    ['rub2', A.makeRubble(408), 4.6, 3.6, null, null],
    ['rub3', A.makeRubble(409), 2.6, 4.0, null, null],
    ['chair', A.makeChair(410), 5.0, 1.4, null, null],
  ];
  for (const [id, s, x, y, col, occ] of props) a.props.push({ id, s, x, y, col, occ });

  const tubes = [
    [3.2, 2.4, 3, 0.4],
    [7.6, 2.4, 2, 0.0],
    [11.4, 2.4, 3, -0.3],
  ];
  tubes.forEach(([x, y, mode, tilt], i) => {
    const id = 'rt' + i;
    a.fixtures.push({ x, y, z: WALL_H - 0.28, len: 2.0, light: id, tilt, mode });
    a.lights.push({
      id, x, y, z: WALL_H - 0.3, r: mode === 3 ? 2.8 : 4.6,
      color: [200, 210, 214], power: mode === 3 ? 0 : 0.34, seed: i * 4.3 + 1.7, mode,
    });
  });
  const fireX = 7.3;
  a.lights.push({ id: 'fire', x: fireX, y: 0.5, z: 1.2, r: 6.4, color: [255, 140, 55], power: 1, seed: 2.2, mode: 4 });
  a.fire = { x: fireX, y: 0.15, z: 0 };

  a.spawns.fromStair = { x: 1.9, y: 2.5 };
  a.links.push({
    x: 1.0, y: 2.4, r: 1.9, to: 'stair', spawn: 'fromCorr1',
    text: '返回楼梯间', short: '楼梯', anchor: { x: 0.2, y: 2.4, z: 2.4 },
  });
  a.doom = { delay: 5, from: { x: 13.2, y: 2.5 } };
  a.fg = corridorParapet(a, rand, th, [
    [3.2, 5.2],
    [9.0, 11.0],
  ]);
  return closeArea(a);
}

/* ------------------------------------------------------------------ *
 * 楼梯间
 * ------------------------------------------------------------------ */

export const EXIT_SIGN = { x: 4.6, y: 0.12, z: 2.5 };

function buildStair() {
  const a = newArea('stair', '楼梯间', 9, 8);
  const rand = mulberry32(0x57a1);
  const th = THEMES.stair;
  const g = a.g;

  paintFloor(g, a.sox, a.soy, a.w, a.h, rand, th);

  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.w * TILE_W, rand, th, a.wallH);
  // 通走廊的门
  doorBay(g, 1.0 * TILE_W, 3.2 * TILE_W, rand, th, { state: 'closed', kind: 'office', label: '' }, a.wallH);
  // 安全出口标志底座
  const sx = EXIT_SIGN.x * TILE_W;
  g.fillStyle = '#14180f';
  g.fillRect(sx - 15, 14, 30, 13);
  g.fillStyle = '#1f2a18';
  g.fillRect(sx - 13, 16, 26, 9);

  // 上行梯段顶端的黑色开口：暗示楼梯继续往上
  const upU = Math.round(6.9 * TILE_W);
  g.fillStyle = '#07090a';
  g.fillRect(upU - 30, 6, 60, 42);
  g.fillStyle = '#2b3134';
  g.fillRect(upU - 32, 4, 64, 4);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(upU - 32, 4, 64, 1);
  // 楼层指示：上 3F / 下 1F（3×5 字模）
  pxText(g, upU - 34, 33, '3F', 'rgba(215,215,205,0.62)', 2);
  pxText(g, upU - 34, 48, 'UP', 'rgba(215,215,205,0.62)', 1);
  pxText(g, upU + 10, 33, '1F', 'rgba(215,215,205,0.42)', 2);
  pxText(g, upU + 10, 48, 'DN', 'rgba(215,215,205,0.42)', 1);
  // 当前楼层
  pxText(g, 22, 16, '2F', 'rgba(210,210,200,0.22)', 4);
  g.restore();

  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.h * TILE_W, rand, th, a.wallH);
  g.restore();
  resetT(g);

  /* 布局：左半边是可走的平台，右半边上半是上行梯段、下半是下行井口。
     出生点和梯段落脚点都必须留在碰撞体外面，否则一传送进来就卡死。 */
  const down = A.makeStairsDown(2.3, 2.6, 12);
  /* 上行梯段拆成一级一级独立道具，各自参与深度排序，玩家走到上半段
     才不会被整段楼梯挡住。 */
  const STEPS = 6;
  const RISE = 0.3;
  const RUN = 0.44;
  const Y_BOTTOM = 3.62;
  const stepSprite = A.makeStep(2.3, RUN, RISE, 11);
  for (let i = 0; i < STEPS; i++) {
    a.props.push({
      id: 'step' + i,
      s: stepSprite,
      x: 6.9,
      y: Y_BOTTOM - i * RUN,
      zOff: i * RISE,
      col: null,
      occ: null,
    });
  }
  a.props.push({
    id: 'landing',
    s: A.makeLanding(2.3, 0.8, 13),
    x: 6.9,
    y: Y_BOTTOM - STEPS * RUN - 0.2,
    zOff: STEPS * RISE,
    col: null,
    occ: null,
  });
  a.props.push({ id: 'stairDown', s: down, x: 6.9, y: 5.9, col: null, occ: null });
  a.ramps = [
    // 上行：越靠 -y 越高
    { x0: 5.75, y0: 0.7, x1: 8.05, y1: 3.9, hi: { y: 1.0, z: STEPS * RISE }, lo: { y: 3.9, z: 0 } },
    // 下行井：越靠 +y 越低
    { x0: 5.75, y0: 4.6, x1: 8.05, y1: 7.2, hi: { y: 4.6, z: 0 }, lo: { y: 7.2, z: -1.2 } },
  ];
  /* 走到梯段两端自动换层。按"到达高度"判定而不是画一个方框：WASD 在等距
     下是斜向移动，玩家沿梯段往上走时 x 也在变，用方框很容易走偏而触发不了。 */
  a.triggers = [
    { zAbove: 1.55, to: 'corr3', spawn: 'fromStair' },
    { zBelow: -0.95, to: 'corr1', spawn: 'fromStair' },
  ];
  a.props.push({ id: 'rub1', s: A.makeRubble(501), x: 2.4, y: 6.2, col: null, occ: null });
  a.props.push({ id: 'rub2', s: A.makeRubble(502), x: 3.4, y: 2.6, col: null, occ: null });
  a.props.push({ id: 'crate', s: A.makeCrate(0.85, 503), x: 1.1, y: 7.0, col: [0.85, 0.85], occ: [0.85, 0.85, 0.8] });

  a.fixtures.push({ x: 3.2, y: 3.6, z: WALL_H - 0.28, len: 1.8, light: 'sl0', tilt: 0.22, mode: 2 });
  a.lights.push({ id: 'sl0', x: 3.2, y: 3.6, z: WALL_H - 0.3, r: 5.6, color: [208, 220, 226], power: 0.52, seed: 1.9, mode: 2 });
  // 安全出口绿灯
  a.lights.push({ id: 'exit', x: EXIT_SIGN.x, y: 0.5, z: 2.3, r: 4.4, color: [110, 235, 140], power: 0.62, seed: 4.4, mode: 5 });
  // 上行开口透出的一点光，让"上面还有路"看得出来
  a.lights.push({ id: 'upglow', x: 6.9, y: 0.5, z: 2.2, r: 3.6, color: [180, 196, 206], power: 0.3, seed: 2.6, mode: 5 });
  a.exitSign = EXIT_SIGN.x;

  a.spawns.fromCorr2 = { x: 2.1, y: 1.6 };
  a.spawns.fromCorr3 = { x: 4.9, y: 2.3 }; // 上行梯段脚下，碰撞体左侧
  a.spawns.fromCorr1 = { x: 4.9, y: 5.9 }; // 下行井口旁
  a.spawns.respawn = { x: 2.6, y: 4.2 };

  a.links.push({
    x: 2.1, y: 0.6, r: 1.6, to: 'corr2', spawn: 'fromStair',
    text: '回到二层走廊', short: '二层', anchor: { x: 2.1, y: 0.1, z: 2.4 },
  });
  // 楼梯改成走上去就换层，所以这里只留一个纯提示（不可交互）
  a.hints = [
    { x: 6.9, y: 3.2, r: 2.0, text: '往上走 · 三层', anchor: { x: 6.9, y: 2.6, z: 1.9 } },
    { x: 6.9, y: 5.2, r: 1.8, text: '往下走 · 一层', anchor: { x: 6.9, y: 5.2, z: 0.9 } },
  ];
  return closeArea(a);
}

/* ------------------------------------------------------------------ *
 * 天台楼梯间：只往上，没有下行井
 * ------------------------------------------------------------------ */

function buildStairRoof() {
  const a = newArea('stairRoof', '天台楼梯', 9, 8);
  const rand = mulberry32(0x4f0f);
  const th = THEMES.stair;
  const g = a.g;

  paintFloor(g, a.sox, a.soy, a.w, a.h, rand, th);

  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.w * TILE_W, rand, th, a.wallH);
  // 回三层走廊的门
  doorBay(g, 1.0 * TILE_W, 3.2 * TILE_W, rand, th, { state: 'closed', kind: 'office', label: '3F' }, a.wallH);
  // 安全出口标志底座
  const sx = EXIT_SIGN.x * TILE_W;
  g.fillStyle = '#14180f';
  g.fillRect(sx - 15, 14, 30, 13);
  g.fillStyle = '#1f2a18';
  g.fillRect(sx - 13, 16, 26, 9);

  // 上行梯段顶端的开口：这一段通到天台，没有继续往下的井
  const upU = Math.round(6.9 * TILE_W);
  g.fillStyle = '#07090a';
  g.fillRect(upU - 30, 6, 60, 42);
  g.fillStyle = '#2b3134';
  g.fillRect(upU - 32, 4, 64, 4);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(upU - 32, 4, 64, 1);
  pxText(g, upU - 34, 33, '4F', 'rgba(215,215,205,0.62)', 2);
  pxText(g, upU - 34, 48, 'ROOF', 'rgba(215,215,205,0.62)', 1);
  pxText(g, 22, 16, '3F', 'rgba(210,210,200,0.22)', 4);
  // 有人用喷漆在墙上留过话
  pxText(g, 118, 52, 'UP = OUT', 'rgba(196,72,54,0.5)', 2);
  g.restore();

  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.h * TILE_W, rand, th, a.wallH);
  g.restore();
  resetT(g);

  /* 只有上行梯段。出生点与落脚点都留在碰撞体外面。 */
  const STEPS = 6;
  const RISE = 0.3;
  const RUN = 0.44;
  const Y_BOTTOM = 3.62;
  const stepSprite = A.makeStep(2.3, RUN, RISE, 17);
  for (let i = 0; i < STEPS; i++) {
    a.props.push({ id: 'step' + i, s: stepSprite, x: 6.9, y: Y_BOTTOM - i * RUN, zOff: i * RISE, col: null, occ: null });
  }
  a.props.push({
    id: 'landing',
    s: A.makeLanding(2.3, 0.8, 19),
    x: 6.9,
    y: Y_BOTTOM - STEPS * RUN - 0.2,
    zOff: STEPS * RISE,
    col: null,
    occ: null,
  });
  a.ramps = [{ x0: 5.75, y0: 0.7, x1: 8.05, y1: 3.9, hi: { y: 1.0, z: STEPS * RISE }, lo: { y: 3.9, z: 0 } }];
  // 到达高度就换层，不用容易走偏的方框
  a.triggers = [{ zAbove: 1.55, to: 'roof', spawn: 'fromStair' }];

  // 下半场堆着被人推过来堵门的杂物：这条楼梯只通天台
  a.props.push({ id: 'crate', s: A.makeCrate(0.9, 521), x: 6.6, y: 6.4, col: [0.9, 0.9], occ: [0.9, 0.9, 0.86] });
  a.props.push({ id: 'crate2', s: A.makeCrate(0.78, 522), x: 7.6, y: 5.6, col: [0.78, 0.78], occ: [0.78, 0.78, 0.74] });
  a.props.push({ id: 'barrel', s: A.makeBarrel(523), x: 1.2, y: 6.6, col: [0.88, 0.88], occ: [0.88, 0.88, 1.12] });
  a.props.push({ id: 'rub1', s: A.makeRubble(524), x: 3.0, y: 5.2, col: null, occ: null });
  a.props.push({ id: 'rub2', s: A.makeRubble(525), x: 4.4, y: 7.0, col: null, occ: null });

  a.fixtures.push({ x: 3.2, y: 3.6, z: WALL_H - 0.28, len: 1.8, light: 'rs0', tilt: -0.3, mode: 0 });
  a.lights.push({ id: 'rs0', x: 3.2, y: 3.6, z: WALL_H - 0.3, r: 5.4, color: [204, 216, 224], power: 0.46, seed: 2.3, mode: 0 });
  a.lights.push({ id: 'exit', x: EXIT_SIGN.x, y: 0.5, z: 2.3, r: 4.4, color: [110, 235, 140], power: 0.62, seed: 4.4, mode: 5 });
  // 天台开口透进来的一点雨夜天光
  a.lights.push({ id: 'skyglow', x: 6.9, y: 0.5, z: 2.2, r: 4.4, color: [140, 170, 200], power: 0.34, seed: 1.4, mode: 5 });
  a.exitSign = EXIT_SIGN.x;

  a.spawns.fromCorr3 = { x: 2.1, y: 1.6 };
  a.spawns.fromRoof = { x: 4.9, y: 2.3 }; // 上行梯段脚下，碰撞体左侧
  a.links.push({
    x: 2.1,
    y: 0.6,
    r: 1.6,
    to: 'corr3',
    spawn: 'fromRoofStair',
    text: '回到三层走廊',
    short: '三层',
    anchor: { x: 2.1, y: 0.1, z: 2.4 },
  });
  a.hints = [{ x: 6.9, y: 3.2, r: 2.0, text: '往上走 · 天台', anchor: { x: 6.9, y: 2.6, z: 1.9 } }];
  return closeArea(a);
}

/* ------------------------------------------------------------------ *
 * 天台：暴雨、帐篷、直升机
 * ------------------------------------------------------------------ */

/** 天台上各个剧情点的位置，main.js 用它驱动流程 */
export const ROOF = {
  door: { x: 1.0, y: 2.5 }, // 楼道门
  tent: { x: 9.6, y: 6.1 },
  edge: { x0: 8.4, x1: 13.6, y1: 2.0 }, // 直升机段落的天台边缘
  rope: { x: 11.0, y: 0.7 }, // 绳索落点
};

/* ------------------------------------------------------------------ *
 * 天台的远景背景层
 *
 * 这一层是**屏幕空间**的独立图层（640×360），跟室内那套"墙面平面 + 烘焙
 * 遮罩"完全无关。之前天际线是用 northT/westT 画进墙面平面的，等距下那就
 * 是一张贴在竖直墙上的纸，而且会被墙面光照打亮 —— 所以四个方向看过去都像
 * 室内。现在：城市画在世界之外的背景层，天台四周只留矮女儿墙。
 *
 * 纵深靠三件事做出来：远层更矮更淡更贴地平线、近层更高更黑更靠画面下缘、
 * 每层之间压一道雨雾。
 * ------------------------------------------------------------------ */

/** 一层城市剪影。base 是这一层楼脚所在的画布 y，越大表示离得越近 */
function cityBand(g, rand, o) {
  const { base, hMin, hMax, wMin, wMax, cols, winA, winP, beaconP, gap } = o;
  let u = -30;
  while (u < VIEW_W + 30) {
    const w = Math.round(wMin + rand() * (wMax - wMin));
    const h = Math.round(hMin + rand() * (hMax - hMin));
    const U = Math.round(u);
    const top = base - h;
    g.fillStyle = cols[(rand() * cols.length) | 0];
    g.fillRect(U, top, w, base - top + 4);
    // 楼顶的机房 / 水箱，剪影才不是一排光秃秃的方块
    if (rand() > 0.45) {
      const cw = Math.max(2, Math.round(w * (0.18 + rand() * 0.3)));
      g.fillRect(U + Math.round(rand() * (w - cw)), top - 3 - ((rand() * 5) | 0), cw, 6);
    }
    // 楼顶障碍灯
    if (rand() < beaconP) {
      g.fillStyle = 'rgba(255,96,74,0.5)';
      g.fillRect(U + ((w / 2) | 0) - 1, top - 4, 2, 2);
    }
    // 还亮着的窗：这座城市并没有全黑，但也剩不下几户
    if (rand() < winP) {
      const rows = Math.max(1, (h / 7) | 0);
      const colsN = Math.max(1, (w / 6) | 0);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < colsN; c++) {
          if (rand() > 0.12) continue;
          g.fillStyle = rand() > 0.45
            ? `rgba(226,196,124,${winA})`
            : `rgba(150,178,200,${winA * 0.7})`;
          g.fillRect(U + 2 + c * 6, top + 3 + r * 7, 2, 3);
        }
      }
    }
    u += w + gap * (0.4 + rand());
  }
}

/**
 * 烘焙天台的远景。horizon 是地平线所在的画布 y。
 * 只在建区时跑一次，运行期每帧只是一次 drawImage。
 */
function paintRoofBackdrop(g, horizon, rand) {
  // 夜空：顶上近黑，越靠地平线越被城市的光污染染亮一点（硬分带 + 抖动）
  const skyH = horizon + 14;
  bandFillV(g, 0, VIEW_W, [
    [0, '#03050a'],
    [Math.round(skyH * 0.42), '#070c14'],
    [Math.round(skyH * 0.62), '#0a1219'],
    [Math.round(skyH * 0.78), '#0e1824'],
    [Math.round(skyH * 0.9), '#17242f'],
    [skyH, ''],
  ]);

  // 云：被下方城市照亮的低云底（同心像素摊代替径向渐变）
  for (let i = 0; i < 11; i++) {
    const cx = rand() * VIEW_W;
    const cy = 8 + rand() * (horizon - 24);
    const rx = 60 + rand() * 130;
    const ry = 10 + rand() * 22;
    const k = 0.05 + rand() * 0.08;
    pxBlob(g, cx, cy, rx, ry, `rgba(50,66,90,${(k * 0.5).toFixed(3)})`, rand);
    pxBlob(g, cx, cy, rx * 0.6, ry * 0.6, `rgba(74,96,126,${k.toFixed(3)})`, rand);
  }

  // 楼下：街区的深渊。天台之所以是天台，是因为下面什么都看不到底
  bandFillV(g, 0, VIEW_W, [
    [horizon, '#0a1017'],
    [horizon + Math.round((VIEW_H - horizon) * 0.35), '#05080d'],
    [horizon + Math.round((VIEW_H - horizon) * 0.68), '#010203'],
    [VIEW_H, ''],
  ]);

  /* --- 三层城市剪影：越远越矮、越淡、越贴地平线 --- */
  cityBand(g, rand, {
    base: horizon + 2, hMin: 6, hMax: 26, wMin: 8, wMax: 26, gap: 5,
    cols: ['#121b25', '#0f1822', '#141d27'], winA: 0.1, winP: 0.5, beaconP: 0.12,
  });
  // 远层之间压一道雨雾，这是纵深真正的来源
  g.fillStyle = 'rgba(96,120,150,0.075)';
  g.fillRect(0, horizon - 46, VIEW_W, 70);

  cityBand(g, rand, {
    base: horizon + 16, hMin: 16, hMax: 58, wMin: 12, wMax: 38, gap: 7,
    cols: ['#0b131b', '#091019', '#0d151d'], winA: 0.17, winP: 0.7, beaconP: 0.3,
  });
  g.fillStyle = 'rgba(84,108,138,0.055)';
  g.fillRect(0, horizon - 70, VIEW_W, 110);

  cityBand(g, rand, {
    base: horizon + 52, hMin: 34, hMax: 96, wMin: 20, wMax: 46, gap: 12,
    cols: ['#050a0f', '#040810', '#060b11'], winA: 0.24, winP: 0.8, beaconP: 0.45,
  });

  /* --- 贴着画面两侧的近邻高楼：把镜头框起来，纵深一下就出来了 --- */
  for (const [bx, bw] of [[-26, 96], [VIEW_W - 74, 104]]) {
    g.fillStyle = '#020507';
    g.fillRect(bx, horizon + 4, bw, VIEW_H);
    g.fillStyle = '#04080c';
    g.fillRect(bx + bw - 14, horizon + 4, 14, VIEW_H);
    // 女儿墙压顶
    g.fillStyle = '#0a1016';
    g.fillRect(bx - 3, horizon + 1, bw + 6, 5);
    // 竖向的窗带，只剩零星几户还亮着
    for (let r = 0; r < 26; r++) {
      for (let c = 0; c < 5; c++) {
        if (rand() > 0.1) continue;
        g.fillStyle = rand() > 0.5 ? 'rgba(226,190,116,0.22)' : 'rgba(140,170,196,0.14)';
        g.fillRect(bx + 8 + c * 17, horizon + 14 + r * 12, 6, 4);
      }
    }
  }

  /* --- 城里几处还在烧的火：同心像素摊代替径向渐变 --- */
  for (const [fx0, fy0, fr] of [[128, horizon + 30, 46], [392, horizon + 12, 34], [534, horizon + 58, 30]]) {
    pxBlob(g, fx0, fy0, fr * 0.9, fr * 0.65, 'rgba(180,84,36,0.09)', rand);
    pxBlob(g, fx0, fy0, fr * 0.5, fr * 0.36, 'rgba(226,124,52,0.14)', rand);
    pxBlob(g, fx0, fy0, fr * 0.24, fr * 0.18, 'rgba(226,124,52,0.2)', rand);
  }

  // 街面上残存的路灯：小到只是一点点，但让"下面很深"变得可信
  for (let i = 0; i < 42; i++) {
    const px = Math.round(rand() * VIEW_W);
    const py = Math.round(horizon + 40 + rand() * (VIEW_H - horizon - 40));
    const k = 0.05 + rand() * 0.1;
    g.fillStyle = `rgba(232,186,110,${k})`;
    g.fillRect(px, py, 1, 1);
  }

  // 整层再压一道雨幕：远景该是被雨糊住的，不能像贴纸一样锐（硬分带 + 抖动）
  bandFillV(g, 0, VIEW_W, [
    [0, 'rgba(70,92,120,0.03)'],
    [Math.round(VIEW_H * 0.3), 'rgba(88,112,142,0.07)'],
    [Math.round(VIEW_H * 0.62), 'rgba(52,70,94,0.05)'],
    [Math.round(VIEW_H * 0.85), 'rgba(10,16,24,0.1)'],
    [VIEW_H, ''],
  ]);
}

/** 天台女儿墙高度（瓦片）。四周都是这个高度，露天场景不画满高室内墙 */
const ROOF_PH = 1.15;

/** 天台近侧（x=w / y=h）的女儿墙，放前景层，压在角色之上 */
function roofParapetFg(a, rand, th) {
  const { c, g } = makeArtCanvas(a.bounds.w + PAD * 2, a.bounds.h + PAD * 2);
  const ph = 0.98;
  g.save();
  eastT(g, a.sox, a.soy, a.w, a.wallH);
  parapetFace(g, a.h * TILE_W, ph, (a.wallH - ph) * TILE_Z, th, rand);
  g.restore();
  g.save();
  southT(g, a.sox, a.soy, a.h);
  parapetFace(g, a.w * TILE_W, ph, -ph * TILE_Z, th, rand);
  g.restore();
  resetT(g);
  finishArt({ c, g });
  return { img: c, ox: a.sox, oy: a.soy };
}

/** 女儿墙压顶：屋面这一侧能看见压顶板的顶面，一条亮边把"墙很矮"说清楚 */
function parapetCoping(g, sox, soy, w, h) {
  const cap = (x0, y0, x1, y1) => {
    const a0 = pt(sox, soy, x0, y0, ROOF_PH);
    const a1 = pt(sox, soy, x1, y1, ROOF_PH);
    const b1 = pt(sox, soy, x1, y1, ROOF_PH + 0.06);
    const b0 = pt(sox, soy, x0, y0, ROOF_PH + 0.06);
    pxPoly(g, [
      [a0.x, a0.y],
      [a1.x, a1.y],
      [b1.x, b1.y],
      [b0.x, b0.y],
    ], 'rgba(126,142,140,0.35)');
  };
  cap(0, 0, w, 0);
  cap(0, 0, 0, h);
}

function buildRoof() {
  /* wallH 在这里不再代表"墙有多高"——天台四周只有 ROOF_PH 高的女儿墙。
     它只用来把相机往下压，在画面顶上让出一整条天空给远景层。 */
  const a = newArea('roof', '天台', 16, 10, 4.6);
  const rand = mulberry32(0x40f0);
  const th = THEMES.roof;
  const g = a.g;

  paintFloor(g, a.sox, a.soy, a.w, a.h, rand, th, { puddles: 13 });

  const topV = (a.wallH - ROOF_PH) * TILE_Z;

  /* 远侧的两道边：只有矮女儿墙，墙上不再画任何"远景"。
     天际线搬去了 a.backdrop（屏幕空间背景层）。 */
  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  parapetFace(g, a.w * TILE_W, ROOF_PH, topV, th, rand);
  g.restore();
  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  parapetFace(g, a.h * TILE_W, ROOF_PH, topV, th, rand);
  g.restore();
  resetT(g);
  parapetCoping(g, a.sox, a.soy, a.w, a.h);

  const props = [
    // 楼梯出口小屋：立在屋面上的独立体块，不是一面墙
    ['bulk', A.makeRoofBulkhead(731), 0.62, 2.5, [1.2, 3.9], [1.2, 3.9, 2.55]],
    ['tent', A.makeTent(701), ROOF.tent.x, ROOF.tent.y, [1.9, 1.5], [1.9, 1.5, 1.1]],
    ['vent1', A.makeRoofVent(711), 4.4, 7.6, [0.95, 0.95], [0.95, 0.95, 0.9]],
    ['vent2', A.makeRoofVent(712), 13.6, 3.4, [0.95, 0.95], [0.95, 0.95, 0.9]],
    ['mast', A.makePipeStack(715), 2.6, 6.6, [0.6, 1.4], [0.6, 1.4, 2.6]],
    ['crate', A.makeCrate(0.9, 713), 6.2, 8.7, [0.9, 0.9], [0.9, 0.9, 0.86]],
    ['barrel', A.makeBarrel(714), 12.8, 7.4, [0.88, 0.88], [0.88, 0.88, 1.12]],
    ['chair', A.makeChair(718), 8.0, 7.8, null, null],
    ['rub1', A.makeRubble(716), 6.8, 3.2, null, null],
    ['rub2', A.makeRubble(717), 14.4, 6.6, null, null],
    ['rub3', A.makeRubble(719), 4.0, 4.4, null, null],
  ];
  for (const [id, s, x, y, col, occ] of props) a.props.push({ id, s, x, y, col, occ });

  /* 静态光：少而冷。全部走烘焙（ensureAreaLights），别每帧 add()。
     注意灯位都压在地面附近 —— 露天场景不该出现"某一面竖墙被打亮"的纸片感，
     光只落在屋面、女儿墙压顶和小屋的门脸上。 */
  a.lights.push({ id: 'plamp', x: 1.45, y: ROOF.door.y, z: 2.1, r: 5.2, color: [156, 190, 214], power: 0.5, seed: 1.2, mode: 5 });
  a.lights.push({ id: 'obst', x: 2.6, y: 6.6, z: 2.7, r: 3.6, color: [255, 92, 70], power: 0.46, seed: 3.1, mode: 5 });
  // 城市余光：把天台压到"看得清脚下但看不清远处"的程度
  a.lights.push({ id: 'city1', x: 7.5, y: 1.2, z: 0, r: 11, color: [86, 112, 142], power: 0.17, seed: 5.2, mode: 5 });
  a.lights.push({ id: 'city2', x: 12.5, y: 8.0, z: 0, r: 10, color: [70, 94, 122], power: 0.14, seed: 6.4, mode: 5 });

  a.spawns.fromStair = { x: 2.2, y: ROOF.door.y };
  /* 这里**故意不放 link**：楼道门上的互动只有"锁死"一个动作（见 main.js 的
     roofInteract）。同一个位置既能锁门又能下楼的话，E 会变成两义的 —— 而且
     对讲机刚交代过"上去以后先把楼道门锁死"，天台本来就是单向的。 */

  a.fg = roofParapetFg(a, rand, th);
  a.storm = true;

  /* --- 露天：远景背景层 + 天空光 --- */
  const horizon = 84;
  const bd = makeCanvas(VIEW_W, VIEW_H);
  paintRoofBackdrop(bd.g, horizon, mulberry32(0x51c1));
  finishArt(bd); // 夜空的大渐变正是有序抖动最出效果的地方
  a.backdrop = bd.c;

  /* 天空不能被"房间遮罩"裁掉，否则屋面以外一律是纯黑，远景等于没画。
     天台改成不裁剪（noMask），改用一张只覆盖屋面之外的天空光贴图，
     让背景层按高度露出不同亮度：地平线最亮，越往上越暗。
     房间那块由 main.js 的 ensureAreaLights 用房间遮罩抠掉。 */
  a.noMask = true;
  a.skyPaint = (sg) => {
    /* 亮度集中在地平线那一条：往上是夜空，往下迅速掉进楼下的黑。
       下半段压得狠一点 —— 天台之所以看起来"很高"，靠的就是边缘之外那一片
       什么都看不清的深黑，而不是一层均匀的蓝雾。
       只烘焙一次，硬分带 + 抖动，跟背景层同一套像素语言。 */
    bandFillV(sg, 0, VIEW_W, [
      [0, 'rgba(52,74,106,0.24)'],
      [Math.round(horizon - VIEW_H * 0.07), 'rgba(92,120,158,0.56)'],
      [Math.round(horizon + VIEW_H * 0.04), 'rgba(78,102,134,0.62)'],
      [Math.round(VIEW_H * 0.42), 'rgba(44,62,88,0.3)'],
      [Math.round(VIEW_H * 0.6), 'rgba(28,42,62,0.13)'],
      [Math.round(VIEW_H * 0.8), 'rgba(16,26,40,0.05)'],
      [Math.round(VIEW_H * 0.92), 'rgba(8,12,20,0.025)'],
      [VIEW_H, ''],
    ]);
  };
  /* 远处楼顶的障碍灯：每帧几个小加色点，比整张背景重画便宜得多。
     坐标是画布坐标，跟背景层同一套空间。 */
  a.beacons = [
    { x: 62, y: horizon - 41, s: 1.7, p: 0.0, c: '255,96,74' },
    { x: 196, y: horizon - 26, s: 1.1, p: 2.1, c: '255,96,74' },
    { x: 318, y: horizon - 52, s: 1.9, p: 4.0, c: '255,96,74' },
    { x: 452, y: horizon - 18, s: 1.35, p: 1.2, c: '255,120,80' },
    { x: 588, y: horizon - 36, s: 0.9, p: 3.4, c: '255,96,74' },
  ];

  // 露天但没有月亮：比室内更冷、更暗，又不能暗到找不到帐篷（玩家有手电）
  a.ambient = 'rgba(34,52,72,0.07)';
  a.dark = 'rgba(2,4,7,1)';
  a.roof = ROOF;
  // 四周只有女儿墙：边界遮挡体按护墙高度给，不要按满高墙
  return closeArea(a, { edgeH: ROOF_PH });
}

/* ------------------------------------------------------------------ *
 * 312 宿舍：对讲机
 * ------------------------------------------------------------------ */

export const RADIO_POS = { x: 3.4, y: 2.0 };

function buildDorm312() {
  const a = newArea('dorm312', '312 宿舍', 8, 6);
  const rand = mulberry32(0x312);
  const th = THEMES.dorm3;
  const g = a.g;

  paintFloor(g, a.sox, a.soy, a.w, a.h, rand, { ...th, blood: 0.15, scorch: 0.1 });

  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.w * TILE_W, rand, th, a.wallH);
  // 门（回走廊）
  doorBay(g, 5.4 * TILE_W, 7.0 * TILE_W, rand, th, { state: 'closed', kind: 'dorm', label: '312' }, a.wallH);
  // 墙上的照片与便签，暗示这里有人住到最后
  for (let i = 0; i < 7; i++) {
    const x = Math.round(30 + i * 22 + rand() * 8);
    const y = Math.round(18 + rand() * 10);
    g.fillStyle = 'rgba(220,214,196,0.5)';
    g.fillRect(x, y, 12, 9);
    g.fillStyle = 'rgba(60,70,72,0.55)';
    g.fillRect(x + 2, y + 2, 9, 6);
  }
  g.restore();

  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.h * TILE_W, rand, th, a.wallH);
  g.restore();
  resetT(g);

  a.props.push({ id: 'bed', s: A.makeBed(613), x: 5.4, y: 4.0, col: [3.0, 1.5], occ: null });
  a.props.push({ id: 'desk', s: A.makeTable(614), x: 3.0, y: 2.0, col: [2.3, 1.05], occ: [2.3, 1.05, 0.9] });
  a.props.push({ id: 'shelf', s: A.makeShelf(615), x: 0.8, y: 4.2, col: [0.9, 1.7], occ: [0.9, 1.7, 2.05] });
  a.props.push({ id: 'chair', s: A.makeChair(616), x: 2.4, y: 3.4, col: null, occ: null });

  a.fixtures.push({ x: 4.0, y: 3.0, z: WALL_H - 0.28, len: 1.8, light: 'rl0', tilt: 0, mode: 1 });
  a.lights.push({ id: 'rl0', x: 4.0, y: 3.0, z: WALL_H - 0.3, r: 6.4, color: [230, 218, 190], power: 0.82, seed: 0.7, mode: 1 });
  a.lights.push({ id: 'radio', x: RADIO_POS.x, y: RADIO_POS.y + 0.4, z: 1.0, r: 2.2, color: [120, 220, 160], power: 0.4, seed: 3.3, mode: 5 });

  a.spawns.enter = { x: 6.0, y: 1.6 };
  a.links.push({
    x: 6.2, y: 0.8, r: 1.5, to: 'corr3', spawn: 'fromDorm',
    text: '离开房间', short: '离开', anchor: { x: 6.2, y: 0.1, z: 2.4 },
  });
  a.radio = { ...RADIO_POS };
  return closeArea(a);
}

/* ------------------------------------------------------------------ *
 * 注册表：首次进入时才构建，之后缓存
 * ------------------------------------------------------------------ */

const BUILDERS = {
  lab: buildLevel,
  corr2: buildCorr2,
  corr3: buildCorr3,
  corr1: buildCorr1,
  stair: buildStair,
  stairRoof: buildStairRoof,
  roof: buildRoof,
  dorm312: buildDorm312,
};

const cache = {};

export function getArea(id) {
  if (!cache[id]) {
    cache[id] = BUILDERS[id]();
    cache[id].id = id;
  }
  return cache[id];
}

export function resetArea(id) {
  delete cache[id];
}

/** 倍率变了：丢掉缓存的区域，下次 getArea 会按新的 N 重画精灵和静态层。 */
export function dropAreaCache() {
  for (const id of Object.keys(cache)) delete cache[id];
}

/** 只作废光照贴图，几何与道具精灵留着。 */
export function invalidateAreaLights() {
  for (const a of Object.values(cache)) {
    a.lit = false;
    a.mask = null;
    a.skyLight = null;
    for (const L of a.lights) L.tex = null;
  }
}
