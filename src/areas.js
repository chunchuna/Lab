import { TILE_W, TILE_Z, WALL_H } from './config.js';
import { buildLevel } from './level.js';
import * as A from './art.js';
import {
  newArea, closeArea, paintFloor, wallBase, wallPipes, doorBay,
  floorT, northT, northPt, westT, eastT, southT, resetT, pt, THEMES, PAD, mulberry32,
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

/**
 * 矮护墙的立面。调用前先把墙面变换设好，v0 传护墙顶在该平面里的 v
 * （northT / westT / eastT 是 (wallH - h) * TILE_Z，southT 是 -h * TILE_Z）。
 * 上面留空，露出后面的东西或夜空。
 */
function parapetFace(g, len, hTiles, v0, th, rand) {
  const H = hTiles * TILE_Z;
  const grd = g.createLinearGradient(0, v0, 0, v0 + H);
  grd.addColorStop(0, th.wallMid);
  grd.addColorStop(1, th.wallLow);
  g.fillStyle = grd;
  g.fillRect(0, v0, len, H);
  // 压顶画亮一点，暗处才能看出这里有一道墙
  g.fillStyle = shade(th.wallTop, 0.3);
  g.fillRect(0, v0, len, 3);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, v0, len, 1.2);
  for (let u = 0; u <= len; u += TILE_W * 2) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(u, v0, 1.4, H);
  }
  for (let i = 0; i < len / 26; i++) {
    g.globalAlpha = 0.24 + rand() * 0.24;
    g.fillStyle = rand() > 0.5 ? '#3f1210' : '#0a0a0a';
    g.fillRect(rand() * len, v0 + rand() * H * 0.7, 2 + rand() * 8, 3 + rand() * 8);
    g.globalAlpha = 1;
  }
}

/** 近侧矮护墙 + 门框，画在道具之后（前景层） */
function corridorParapet(a, rand, th, doors, opts = {}) {
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

  /* 东端封口。x=w 是**近侧**墙，画满高会把走廊内部盖掉（跟南墙同理），
     所以只做一道齐腰的封口，并且和南护墙一样放前景层。 */
  if (opts.eastCap) {
    g.save();
    eastT(g, a.sox, a.soy, a.w, a.wallH);
    parapetFace(g, a.h * TILE_W, 0.86, (a.wallH - 0.86) * TILE_Z, th, rand);
    g.restore();
  }

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
  const upU = 6.9 * TILE_W;
  g.fillStyle = '#07090a';
  g.fillRect(upU - 30, 6, 60, 42);
  g.fillStyle = '#2b3134';
  g.fillRect(upU - 32, 4, 64, 4);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(upU - 32, 4, 64, 1.4);
  // 楼层指示：上 3F / 下 1F
  g.fillStyle = 'rgba(215,215,205,0.62)';
  g.font = 'bold 15px monospace';
  g.fillText('3F', upU - 34, 44);
  g.font = 'bold 11px monospace';
  g.fillText('UP', upU - 34, 55);
  g.fillStyle = 'rgba(215,215,205,0.42)';
  g.font = 'bold 15px monospace';
  g.fillText('1F', upU + 10, 44);
  g.font = 'bold 11px monospace';
  g.fillText('DN', upU + 10, 55);
  // 当前楼层
  g.fillStyle = 'rgba(210,210,200,0.22)';
  g.font = 'bold 26px monospace';
  g.fillText('2F', 22, 36);
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
  const upU = 6.9 * TILE_W;
  g.fillStyle = '#07090a';
  g.fillRect(upU - 30, 6, 60, 42);
  g.fillStyle = '#2b3134';
  g.fillRect(upU - 32, 4, 64, 4);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(upU - 32, 4, 64, 1.4);
  g.fillStyle = 'rgba(215,215,205,0.62)';
  g.font = 'bold 15px monospace';
  g.fillText('4F', upU - 34, 44);
  g.font = 'bold 11px monospace';
  g.fillText('ROOF', upU - 34, 55);
  g.fillStyle = 'rgba(210,210,200,0.22)';
  g.font = 'bold 26px monospace';
  g.fillText('3F', 22, 36);
  // 有人用喷漆在墙上留过话
  g.fillStyle = 'rgba(196,72,54,0.5)';
  g.font = 'bold 13px monospace';
  g.fillText('UP = OUT', 118, 62);
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

/** 远处的城市剪影：画在墙面平面里，位于矮女儿墙之后 */
function skyline(g, len, topV, rand) {
  let u = -24;
  while (u < len + 24) {
    const w = 13 + rand() * 42;
    const h = 10 + rand() * 44;
    g.fillStyle = ['#0c1216', '#101820', '#090e11'][(rand() * 3) | 0];
    g.fillRect(u, topV - h, w, h + 6);
    // 楼顶的红色障碍灯
    if (rand() > 0.5) {
      g.fillStyle = 'rgba(255,90,70,0.45)';
      g.fillRect(u + w / 2 - 1, topV - h - 3, 2, 2);
    }
    // 还亮着的窗：整座城市并没有全黑
    const win = (rand() * 6) | 0;
    for (let i = 0; i < win; i++) {
      g.fillStyle = rand() > 0.5 ? 'rgba(224,196,120,0.28)' : 'rgba(150,178,196,0.18)';
      g.fillRect(u + 3 + rand() * Math.max(1, w - 6), topV - h + 4 + rand() * Math.max(1, h - 8), 2, 2.4);
    }
    u += w + 2 + rand() * 12;
  }
}

/** 天台近侧（x=w / y=h）的女儿墙，放前景层，压在角色之上 */
function roofParapetFg(a, rand, th) {
  const { c, g } = makeCanvas(a.bounds.w + PAD * 2, a.bounds.h + PAD * 2);
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
  return { img: c, ox: a.sox, oy: a.soy };
}

function buildRoof() {
  // 墙高给得比室内高：露天场景要留出画天际线的空间
  const a = newArea('roof', '天台', 16, 10, 4.6);
  const rand = mulberry32(0x40f0);
  const th = THEMES.roof;
  const g = a.g;

  paintFloor(g, a.sox, a.soy, a.w, a.h, rand, th, { puddles: 13 });

  const PH = 1.15; // 女儿墙高度（瓦片）
  const topV = (a.wallH - PH) * TILE_Z;

  // 远侧（y=0）：天际线 + 矮女儿墙。这一侧不封高墙，直升机从这边进画。
  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  skyline(g, a.w * TILE_W, topV, rand);
  parapetFace(g, a.w * TILE_W, PH, topV, th, rand);
  g.restore();

  // 左侧（x=0）：楼梯出口房（满高）+ 其余段落矮女儿墙
  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  skyline(g, a.h * TILE_W, topV, rand);
  parapetFace(g, a.h * TILE_W, PH, topV, th, rand);
  g.save();
  g.translate(0.9 * TILE_W, 0);
  wallBase(g, 3.4 * TILE_W, rand, th, a.wallH);
  doorBay(g, 0.5 * TILE_W, 2.9 * TILE_W, rand, th, { state: 'closed', kind: 'office', label: 'R' }, a.wallH);
  // 门头的应急灯壳（灯光本身由烘焙光源给）
  g.fillStyle = '#232a2b';
  g.fillRect(1.4 * TILE_W, a.wallH * TILE_Z - 50, 22, 9);
  g.fillStyle = '#39423f';
  g.fillRect(1.4 * TILE_W, a.wallH * TILE_Z - 50, 22, 3);
  g.fillStyle = 'rgba(198,224,238,0.5)';
  g.fillRect(1.4 * TILE_W + 2, a.wallH * TILE_Z - 47, 18, 4);
  g.restore();
  g.restore();
  resetT(g);

  const props = [
    ['tent', A.makeTent(701), ROOF.tent.x, ROOF.tent.y, [1.9, 1.5], [1.9, 1.5, 1.1]],
    ['vent1', A.makeRoofVent(711), 4.4, 7.6, [0.95, 0.95], [0.95, 0.95, 0.9]],
    ['vent2', A.makeRoofVent(712), 13.6, 3.4, [0.95, 0.95], [0.95, 0.95, 0.9]],
    ['mast', A.makePipeStack(715), 2.4, 6.2, [0.6, 1.4], [0.6, 1.4, 2.6]],
    ['crate', A.makeCrate(0.9, 713), 6.2, 8.7, [0.9, 0.9], [0.9, 0.9, 0.86]],
    ['barrel', A.makeBarrel(714), 12.8, 7.4, [0.88, 0.88], [0.88, 0.88, 1.12]],
    ['chair', A.makeChair(718), 8.0, 7.8, null, null],
    ['rub1', A.makeRubble(716), 6.8, 3.2, null, null],
    ['rub2', A.makeRubble(717), 14.4, 6.6, null, null],
    ['rub3', A.makeRubble(719), 4.0, 4.4, null, null],
  ];
  for (const [id, s, x, y, col, occ] of props) a.props.push({ id, s, x, y, col, occ });

  /* 静态光：少而冷。全部走烘焙（ensureAreaLights），别每帧 add()。 */
  a.lights.push({ id: 'plamp', x: 1.1, y: ROOF.door.y, z: 2.3, r: 5.8, color: [156, 190, 214], power: 0.52, seed: 1.2, mode: 5 });
  a.lights.push({ id: 'obst', x: 2.4, y: 6.2, z: 2.7, r: 3.8, color: [255, 92, 70], power: 0.5, seed: 3.1, mode: 5 });
  // 城市余光：把天台压到"看得清脚下但看不清远处"的程度
  a.lights.push({ id: 'city1', x: 7.5, y: 1.2, z: 0, r: 11, color: [86, 112, 142], power: 0.17, seed: 5.2, mode: 5 });
  a.lights.push({ id: 'city2', x: 12.5, y: 8.0, z: 0, r: 10, color: [70, 94, 122], power: 0.14, seed: 6.4, mode: 5 });

  a.spawns.fromStair = { x: 1.9, y: ROOF.door.y };
  a.links.push({
    x: ROOF.door.x,
    y: ROOF.door.y,
    r: 1.5,
    to: 'stairRoof',
    spawn: 'fromRoof',
    text: '回到楼梯间',
    short: '下楼',
    roofDoor: true,
    anchor: { x: 0.15, y: ROOF.door.y, z: 2.4 },
  });

  a.fg = roofParapetFg(a, rand, th);
  a.storm = true;
  a.ambient = 'rgba(30,46,64,0.045)';
  a.dark = 'rgba(2,4,7,1)';
  a.roof = ROOF;
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
