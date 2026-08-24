import { TILE_W, TILE_Z, WALL_H } from './config.js';
import { buildLevel } from './level.js';
import * as A from './art.js';
import {
  newArea, closeArea, paintFloor, wallBase, wallPipes, doorBay,
  floorT, northT, northPt, westT, southT, resetT, pt, THEMES, PAD, mulberry32,
} from './areakit.js';
import { makeCanvas, shade } from './util.js';

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
  // 楼层号喷涂
  if (opts.floorMark) {
    g.fillStyle = 'rgba(200,200,190,0.2)';
    g.font = 'bold 26px monospace';
    g.fillText(opts.floorMark, 26, 34);
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

/** 近侧矮护墙 + 门框，画在道具之后（前景层） */
function corridorParapet(a, rand, th, doors) {
  const ph = 0.82; // 高度（瓦片）：够读出"这边也是一排门"，又不挡住走廊地面
  const { c, g } = makeCanvas(a.bounds.w + PAD * 2, a.bounds.h + PAD * 2);
  g.save();
  southT(g, a.sox, a.soy, a.h);
  const H = ph * TILE_Z;
  const len = a.w * TILE_W;
  // 墙体
  const grd = g.createLinearGradient(0, -H, 0, 0);
  grd.addColorStop(0, th.wallMid);
  grd.addColorStop(1, th.wallLow);
  g.fillStyle = grd;
  g.fillRect(0, -H, len, H);
  // 压顶画亮一点，暗处才能看出这里有一道墙
  g.fillStyle = shade(th.wallTop, 0.3);
  g.fillRect(0, -H, len, 3);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, -H, len, 1.2);
  for (let u = 0; u <= len; u += TILE_W * 2) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(u, -H, 1.4, H);
  }
  // 门框：只到护墙高度，暗示这一侧也有房间
  for (const d of doors) {
    const u0 = d[0] * TILE_W;
    const u1 = d[1] * TILE_W;
    g.fillStyle = '#0f1211';
    g.fillRect(u0 - 4, -H, u1 - u0 + 8, H);
    g.fillStyle = '#1b1f20';
    g.fillRect(u0, -H + 2, u1 - u0, H - 2);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(u0 - 4, -H, u1 - u0 + 8, 1.6);
    // 门缝透出的一点光
    g.fillStyle = 'rgba(210,200,170,0.12)';
    g.fillRect(u0 + (u1 - u0) / 2 - 0.8, -H + 3, 1.6, H - 5);
  }
  // 血迹与焦痕
  for (let i = 0; i < 10; i++) {
    g.globalAlpha = 0.28 + rand() * 0.24;
    g.fillStyle = rand() > 0.5 ? '#3f1210' : '#0a0a0a';
    g.fillRect(rand() * len, -H + rand() * H * 0.6, 2 + rand() * 8, 3 + rand() * 8);
    g.globalAlpha = 1;
  }
  g.restore();
  resetT(g);
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
    { u0: 21.0, u1: 23.2, state: 'sealed', kind: 'dorm' },
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
    ['barrel', A.makeBarrel(308), 22.4, 3.4, [0.88, 0.88], [0.88, 0.88, 1.12]],
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
  a.fg = corridorParapet(a, rand, th, [
    [3.2, 5.2],
    [8.0, 10.0],
    [12.6, 14.6],
    [17.4, 19.4],
  ]);
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
  // 楼层数字
  g.fillStyle = 'rgba(210,210,200,0.28)';
  g.font = 'bold 30px monospace';
  g.fillText('2', a.w * TILE_W - 60, 40);
  g.restore();

  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.h * TILE_W, rand, th, a.wallH);
  g.restore();
  resetT(g);

  // 上下两段楼梯
  const up = A.makeStairs(7, 2.4, 1, 11);
  const down = A.makeStairs(7, 2.4, -1, 12);
  a.props.push({ id: 'stairUp', s: up, x: 6.6, y: 2.4, col: [2.6, 3.2], occ: null });
  a.props.push({ id: 'stairDown', s: down, x: 6.6, y: 6.0, col: [2.6, 3.2], occ: null });
  a.props.push({ id: 'rub1', s: A.makeRubble(501), x: 2.6, y: 5.4, col: null, occ: null });
  a.props.push({ id: 'rub2', s: A.makeRubble(502), x: 3.8, y: 3.0, col: null, occ: null });
  a.props.push({ id: 'crate', s: A.makeCrate(0.85, 503), x: 1.4, y: 6.6, col: [0.85, 0.85], occ: [0.85, 0.85, 0.8] });

  // 栏杆（视觉 + 遮挡）
  a.props.push({ id: 'rail', s: A.makePipeStack(504), x: 4.7, y: 4.3, col: [0.5, 1.2], occ: [0.5, 1.2, 2.2] });

  a.fixtures.push({ x: 3.4, y: 3.2, z: WALL_H - 0.28, len: 1.8, light: 'sl0', tilt: 0.22, mode: 2 });
  a.lights.push({ id: 'sl0', x: 3.4, y: 3.2, z: WALL_H - 0.3, r: 5.4, color: [208, 220, 226], power: 0.5, seed: 1.9, mode: 2 });
  // 安全出口绿灯
  a.lights.push({ id: 'exit', x: EXIT_SIGN.x, y: 0.5, z: 2.3, r: 4.4, color: [110, 235, 140], power: 0.62, seed: 4.4, mode: 5 });

  a.spawns.fromCorr2 = { x: 2.1, y: 1.5 };
  a.spawns.fromCorr3 = { x: 6.6, y: 1.4 };
  a.spawns.fromCorr1 = { x: 6.6, y: 7.0 };
  a.spawns.respawn = { x: 3.0, y: 4.2 };

  a.links.push({
    x: 2.1, y: 0.6, r: 1.6, to: 'corr2', spawn: 'fromStair',
    text: '回到二层走廊', short: '二层', anchor: { x: 2.1, y: 0.1, z: 2.4 },
  });
  a.links.push({
    x: 6.6, y: 1.1, r: 1.7, to: 'corr3', spawn: 'fromStair',
    text: '上楼 · 三层', short: '上楼', anchor: { x: 6.6, y: 1.0, z: 2.6 },
  });
  a.links.push({
    x: 6.6, y: 7.3, r: 1.7, to: 'corr1', spawn: 'fromStair',
    text: '下楼 · 一层', short: '下楼', anchor: { x: 6.6, y: 7.3, z: 1.4 },
  });
  return closeArea(a);
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
    const x = 30 + i * 22 + rand() * 8;
    g.fillStyle = 'rgba(220,214,196,0.5)';
    g.fillRect(x, 18 + rand() * 10, 12, 9);
    g.fillStyle = 'rgba(60,70,72,0.55)';
    g.fillRect(x + 1.5, 19.5 + rand() * 10, 9, 6);
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
