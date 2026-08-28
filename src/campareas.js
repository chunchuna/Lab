/**
 * 第一章 · 难民营地的两个区域。
 *
 *   camp     第一个真正的大室外场景：40×24 瓦片，显著大于视口，
 *            镜头跟随玩家（area.follow）。清晨 8 点：不跑 lighting.finish()
 *            （area.daylight），亮度与长影全部烘进静态层与道具精灵，
 *            运行期只叠一层屏幕空间的暖色晨光（main.js 的 drawDaylight）。
 *   campReg  登记帐篷内景：小房间，走常规烘焙光照 —— 布面透光的暖黄
 *            和门口灌进来的白亮日光，跟室外全亮形成对比。
 *
 * 室外没有"房间四壁"：地形一直画到静态层画布的每个角落（视口反投影
 * 出去的世界范围全部有地皮），镜头夹在 bounds 里就永远看不到画布外。
 * 边界靠铁丝网道具 + 常规的边界碰撞。
 */

import { TILE_W, TILE_Z } from './config.js';
import * as A from './art.js';
import {
  newArea, closeArea, floorT, northT, westT, resetT, pt, mulberry32,
} from './areakit.js';
import {
  shade, pxDither, pxLine, pxPoly, pxBlob, pxEllipse, pxEllipseRing, pxText,
} from './util.js';

/* ------------------------------------------------------------------ *
 * 营地布点：main.js 的过场与 npc.js 的站位都从这里取
 * ------------------------------------------------------------------ */

export const CAMP = {
  W: 40,
  H: 24,
  /** 停机坪中心（直升机停在这里） */
  heli: { x: 9, y: 6 },
  /** 登记帐篷门口（帐篷开口朝 +x） */
  regDoor: { x: 18.4, y: 9.0 },
  /** 大门（西边界的缺口，暂时封着） */
  gate: { x: 1.0, y: 11.6 },
  /** 广场（水箱旁边的空地，路径都汇到这里） */
  plaza: { x: 21, y: 12.5 },
  /** 两处火塘 */
  fires: [
    { x: 17.5, y: 16.5 },
    { x: 27.5, y: 15.5 },
  ],
};

/** 登记帐篷内景里，登记桌前玩家站的位置（桌子的 +x 侧） */
export const REG_DESK = { x: 4.9, y: 2.7 };

/* ------------------------------------------------------------------ *
 * 室外地皮
 * ------------------------------------------------------------------ */

/**
 * 把地形铺满整张静态层画布。视口是矩形、世界是菱形：矩形四角反投影
 * 出去落在菱形之外，所以要往外多画约半个对边宽度的瓦片，镜头贴边时
 * 四角才不会露出黑底。
 */
function paintCampGround(a, rand) {
  const g = a.g;
  const W = a.w;
  const H = a.h;
  const mx = Math.ceil(H / 2) + 4;
  const my = Math.ceil(W / 2) + 4;
  const x0 = -mx;
  const x1 = W + mx;
  const y0 = -my;
  const y1 = H + my;
  const u = (t) => t * TILE_W;

  g.save();
  floorT(g, a.sox, a.soy);

  // 底色：晨光里的干土（受光暖棕）
  g.fillStyle = '#6f5f45';
  g.fillRect(u(x0), u(y0), u(x1 - x0), u(y1 - y0));

  // 大块色斑：干草皮 / 浅沙土 / 深一点的湿泥。营地外草更多，营地里被踩秃了
  for (let i = 0; i < 520; i++) {
    const bx = x0 + rand() * (x1 - x0);
    const by = y0 + rand() * (y1 - y0);
    const inside = bx > 0 && bx < W && by > 0 && by < H;
    const r = 0.5 + rand() * (inside ? 1.6 : 2.6);
    let c;
    const roll = rand();
    if (roll < (inside ? 0.24 : 0.55)) c = ['#5d6b42', '#556339', '#66744a'][(rand() * 3) | 0];
    else if (roll < 0.7) c = ['#7a6a4e', '#83745a', '#71614a'][(rand() * 3) | 0];
    else c = ['#5f5240', '#57493a'][(rand() * 2) | 0];
    pxBlob(g, u(bx), u(by), u(r), u(r * (0.5 + rand() * 0.5)), c, rand);
  }

  // 草丛：短竖线三五根一簇，顶端受光。营地外密，营地里稀
  const tufts = 900;
  for (let i = 0; i < tufts; i++) {
    const bx = x0 + rand() * (x1 - x0);
    const by = y0 + rand() * (y1 - y0);
    const inside = bx > 0 && bx < W && by > 0 && by < H;
    if (inside && rand() > 0.28) continue;
    const px = Math.round(u(bx));
    const py = Math.round(u(by));
    const n = 2 + ((rand() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const hh = 3 + ((rand() * 4) | 0);
      g.fillStyle = ['#4c5a34', '#55643c', '#3f4c2c'][(rand() * 3) | 0];
      g.fillRect(px + k * 2 - n, py - hh, 1, hh);
      g.fillStyle = '#778750';
      g.fillRect(px + k * 2 - n, py - hh, 1, 1);
    }
  }

  // 石块与碎砾
  for (let i = 0; i < 260; i++) {
    const bx = x0 + rand() * (x1 - x0);
    const by = y0 + rand() * (y1 - y0);
    const s = 1 + ((rand() * 3) | 0);
    const c = ['#847d6e', '#6e685b', '#948d7c'][(rand() * 3) | 0];
    g.fillStyle = shade(c, -0.3);
    g.fillRect(Math.round(u(bx)), Math.round(u(by)), s + 1, s);
    g.fillStyle = c;
    g.fillRect(Math.round(u(bx)), Math.round(u(by)) - 1, s + 1, s);
  }

  /* 踩出来的土路：一段段圆摊连成带，颜色比底色浅（踩实了返碱）。
     从停机坪 → 登记帐篷 → 广场，再从广场分去大门、火塘和难民区。 */
  const path = (ax, ay, bx, by, w0) => {
    const L = Math.hypot(bx - ax, by - ay);
    const n = Math.ceil(L * 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const jx = (rand() - 0.5) * 0.5;
      const jy = (rand() - 0.5) * 0.5;
      const cx = ax + (bx - ax) * t + jx;
      const cy = ay + (by - ay) * t + jy;
      pxBlob(g, u(cx), u(cy), u(w0 * (0.75 + rand() * 0.5)), u(w0 * 0.55), '#8a7757', rand);
      if (rand() < 0.4) pxBlob(g, u(cx), u(cy), u(w0 * 0.4), u(w0 * 0.28), '#94805e', rand);
    }
  };
  path(CAMP.heli.x + 2.4, CAMP.heli.y + 1.2, CAMP.regDoor.x + 0.6, CAMP.regDoor.y, 0.85);
  path(CAMP.regDoor.x + 0.6, CAMP.regDoor.y, CAMP.plaza.x, CAMP.plaza.y, 0.9);
  path(CAMP.plaza.x, CAMP.plaza.y, CAMP.gate.x + 1.5, CAMP.gate.y, 0.8);
  path(CAMP.plaza.x, CAMP.plaza.y, CAMP.fires[0].x, CAMP.fires[0].y - 1.2, 0.7);
  path(CAMP.plaza.x, CAMP.plaza.y, CAMP.fires[1].x, CAMP.fires[1].y - 1.4, 0.7);
  path(CAMP.fires[1].x, CAMP.fires[1].y, 33, 19.5, 0.6);
  path(CAMP.fires[0].x, CAMP.fires[0].y, 15, 20.5, 0.6);

  // 大门外的车辙路：一直铺出画布，暗示营地外还有世界
  g.fillStyle = '#83704f';
  g.fillRect(u(x0), u(CAMP.gate.y - 1.6), u(2.2 - x0), u(3.2));
  pxDither(g, u(x0), u(2.2), u(CAMP.gate.y - 1.6), '#6f5f45');
  pxDither(g, u(x0), u(2.2), u(CAMP.gate.y + 1.6), '#83704f');
  for (const off of [-0.7, 0.7]) {
    g.fillStyle = 'rgba(60,48,34,0.55)';
    g.fillRect(u(x0), Math.round(u(CAMP.gate.y + off)), Math.round(u(2.0 - x0)), 2);
    g.fillStyle = 'rgba(150,128,94,0.4)';
    g.fillRect(u(x0), Math.round(u(CAMP.gate.y + off)) - 1, Math.round(u(2.0 - x0)), 1);
  }

  /* 停机坪：压实的混凝土圆盘 + 白圈 + H。破旧但制式，是营地里唯一的硬化地面 */
  const hp = CAMP.heli;
  pxEllipse(g, u(hp.x), u(hp.y), u(3.6), u(3.6), '#79766c');
  pxEllipse(g, u(hp.x), u(hp.y), u(3.3), u(3.3), '#838075');
  pxEllipseRing(g, u(hp.x), u(hp.y), u(2.9), u(2.9), '#c4c0ae', 3);
  // H 字：两竖一横，画在地面空间里跟着透视压扁
  g.fillStyle = '#c4c0ae';
  g.fillRect(u(hp.x - 0.9), u(hp.y - 1.1), 6, Math.round(u(2.2)));
  g.fillRect(u(hp.x + 0.75), u(hp.y - 1.1), 6, Math.round(u(2.2)));
  g.fillRect(u(hp.x - 0.9), u(hp.y) - 3, Math.round(u(1.8)), 6);
  // 混凝土裂缝与油渍
  for (let i = 0; i < 7; i++) {
    const sx = hp.x - 2.5 + rand() * 5;
    const sy = hp.y - 2.5 + rand() * 5;
    g.fillStyle = 'rgba(40,40,38,0.4)';
    let cx = u(sx);
    let cy = u(sy);
    for (let s = 0; s < 6; s++) {
      const nx = cx + (rand() - 0.5) * 16;
      const ny = cy + (rand() - 0.5) * 16;
      pxLine(g, cx, cy, nx, ny, 'rgba(44,44,40,0.45)', 1);
      cx = nx;
      cy = ny;
    }
  }
  pxBlob(g, u(hp.x + 0.8), u(hp.y + 0.9), 14, 10, 'rgba(34,32,26,0.35)', rand);
  pxBlob(g, u(hp.x - 1.4), u(hp.y - 0.6), 9, 7, 'rgba(34,32,26,0.28)', rand);

  // 火塘周围踩秃的一圈土
  for (const f of CAMP.fires) {
    pxBlob(g, u(f.x), u(f.y), u(2.2), u(1.9), '#7c6b4e', rand);
  }

  // 帐篷区的地皮被压得更暗一点
  pxBlob(g, u(25), u(19.5), u(9), u(4.5), 'rgba(70,60,44,0.35)', rand);
  pxBlob(g, u(31), u(4.5), u(6), u(3), 'rgba(70,60,44,0.28)', rand);

  g.restore();

  /* 屏幕空间的最后一遍：远角压一点冷调，晨雾还没散透。
     画在 floorT 之外，finishArt 会把渐变抖成色带。 */
  const b = a.bounds;
  const mist = g.createLinearGradient(0, 0, 0, b.h);
  mist.addColorStop(0, 'rgba(255,196,128,0.14)');
  mist.addColorStop(0.25, 'rgba(255,180,100,0.06)');
  mist.addColorStop(0.55, 'rgba(220,200,160,0.02)');
  mist.addColorStop(1, 'rgba(36,42,58,0.06)');
  g.fillStyle = mist;
  g.fillRect(0, 0, b.w + 20, b.h + 20);
}

/* ------------------------------------------------------------------ *
 * 室外营地
 * ------------------------------------------------------------------ */

export function buildCamp() {
  const a = newArea('camp', '难民营地', CAMP.W, CAMP.H, 2.2);
  const rand = mulberry32(0xca3f);

  paintCampGround(a, rand);
  resetT(a.g);

  const P = (id, s, x, y, col, occ) => a.props.push({ id, s, x, y, col: col || null, occ: occ || null });

  /* --- 铁丝网围栏：四边各切成 4 瓦一段，西边给大门留缺口 --- */
  let fi = 0;
  const fence = (x, y, len, axis) => {
    P('fx' + fi++, A.makeFence(851 + fi, len, axis), x, y, axis === 'x' ? [len, 0.3] : [0.3, len]);
  };
  for (let x = 2; x < CAMP.W; x += 4) fence(Math.min(x, CAMP.W - 2), 0.35, 4, 'x');
  for (let x = 2; x < CAMP.W; x += 4) fence(Math.min(x, CAMP.W - 2), CAMP.H - 0.35, 4, 'x');
  for (let y = 2; y < CAMP.H; y += 4) fence(CAMP.W - 0.35, Math.min(y, CAMP.H - 2), 4, 'y');
  // 西边：大门在 y 9.6~13.6，缺口两侧用短段补齐
  fence(0.35, 2, 4, 'y');
  fence(0.35, 6, 4, 'y');
  fence(0.35, 8.8, 1.6, 'y');
  fence(0.35, 14.8, 2.4, 'y');
  fence(0.35, 18, 4, 'y');
  fence(0.35, 22, 4, 'y');
  // 大门：拒马沙袋封着，旁边留个哨位
  P('gateBags', A.makeSandbags(921, 3.4, 'y'), 0.9, CAMP.gate.y, [0.9, 3.6]);
  P('gateBags2', A.makeSandbags(922, 1.8, 'x'), 2.2, CAMP.gate.y - 1.9, [1.9, 0.8]);

  /* --- 军方区（西北）：登记帐篷、指挥帐、医务帐、旗杆、瞭望塔 --- */
  P('regTent', A.makeArmyTent(801, { rx: 2.3, ry: 1.5, h: 1.9, open: true, sign: '#9c5b34' }), 15.6, 9.0, [4.9, 3.3]);
  P('cmdTent', A.makeArmyTent(802, { rx: 2.0, ry: 1.3, h: 1.75, open: false, sign: '#4f6a46' }), 23.5, 3.6, [4.3, 2.9]);
  P('medTent', A.makeArmyTent(803, { rx: 2.0, ry: 1.3, h: 1.75, open: true, sign: '#b3b8a9' }), 29.8, 4.4, [4.3, 2.9]);
  P('flag', A.makeFlagpole(895), 19.5, 6.2, [0.5, 0.5]);
  P('tower1', A.makeWatchtower(841), 36.6, 3.4, [1.8, 1.8]);
  P('tower2', A.makeWatchtower(842), 3.2, 16.2, [1.8, 1.8]);
  P('bags1', A.makeSandbags(831, 2.6, 'x'), 12.4, 3.4, [2.7, 0.8]);
  P('bags2', A.makeSandbags(832, 2.2, 'y'), 34.2, 8.2, [0.8, 2.3]);
  P('supply1', A.makeSupplyPile(907), 12.6, 12.6, [2.0, 1.6]);
  P('supply2', A.makeSupplyPile(908), 26.2, 6.8, [2.0, 1.6]);
  P('supply3', A.makeSupplyPile(909), 33.4, 19.4, [2.0, 1.6]);

  /* --- 公共设施：水箱、照明杆、火塘、长凳 --- */
  P('tank', A.makeWaterTank(881), 20.6, 11.2, [1.5, 1.5]);
  P('lamp1', A.makeFloodlight(891), 14.2, 5.6, [0.6, 0.6]);
  P('lamp2', A.makeFloodlight(892), 24.6, 10.4, [0.6, 0.6]);
  P('lamp3', A.makeFloodlight(893), 8.2, 17.6, [0.6, 0.6]);
  P('lamp4', A.makeFloodlight(894), 33.0, 12.2, [0.6, 0.6]);
  P('fire1', A.makeCampfire(861), CAMP.fires[0].x, CAMP.fires[0].y, [1.1, 1.1]);
  P('fire2', A.makeCampfire(862), CAMP.fires[1].x, CAMP.fires[1].y, [1.1, 1.1]);
  P('bench1', A.makeLogBench(871, 'x'), 16.2, 17.8, [1.6, 0.55]);
  P('bench2', A.makeLogBench(872, 'y'), 19.0, 15.9, [0.55, 1.6]);
  P('bench3', A.makeLogBench(873, 'x'), 26.3, 16.9, [1.6, 0.55]);
  P('bench4', A.makeLogBench(874, 'y'), 29.0, 14.8, [0.55, 1.6]);
  P('crate1', A.makeCrate(0.9, 931), 21.9, 13.4, [0.9, 0.9]);
  P('barrel1', A.makeBarrel(932), 13.4, 13.6, [0.88, 0.88]);
  P('barrel2', A.makeBarrel(933), 30.6, 6.4, [0.88, 0.88]);

  /* --- 难民区（南半）：简易棚一片，配色轮换 --- */
  const huts = [
    [14.0, 19.6, 0], [17.2, 21.4, 1], [20.6, 18.8, 2], [23.2, 21.2, 3],
    [26.6, 19.8, 0], [30.0, 21.6, 1], [33.2, 17.6, 2], [35.8, 20.8, 3],
    [31.2, 14.6, 1], [36.2, 14.2, 0], [11.0, 21.0, 2],
  ];
  huts.forEach(([x, y, v], i) => {
    P('hut' + i, A.makeRefugeeTent(821 + i, v), x, y, [2.4, 1.8]);
  });
  P('cot1', A.makeCot(899), 24.8, 17.9, [0.9, 1.8]);

  /* --- 区域旗标 --- */
  a.daylight = true; // 白天：不跑 lighting.finish()，晨光由屏幕空间叠加
  a.noMask = true;
  a.safe = true; // 营地里禁止开枪
  a.follow = { yOff: 12 }; // 镜头跟随玩家
  a.npcs = 'camp';
  a.fires = CAMP.fires.map((f) => ({ ...f }));

  a.spawns.heli = { x: CAMP.heli.x + 1.6, y: CAMP.heli.y + 2.2 };
  a.spawns.fromReg = { x: CAMP.regDoor.x + 0.9, y: CAMP.regDoor.y + 0.3 };
  a.spawns.start = { x: CAMP.plaza.x, y: CAMP.plaza.y };

  a.links.push({
    x: CAMP.regDoor.x + 0.4,
    y: CAMP.regDoor.y,
    r: 1.6,
    to: 'campReg',
    spawn: 'enter',
    text: '进入登记帐篷',
    short: '登记处',
    anchor: { x: CAMP.regDoor.x - 1.4, y: CAMP.regDoor.y, z: 2.1 },
  });
  a.hints = [
    { x: CAMP.gate.x + 1.2, y: CAMP.gate.y, r: 2.0, text: '大门封锁中 · 士兵不许任何人出营', anchor: { x: 1.2, y: CAMP.gate.y, z: 1.8 } },
    { x: 20.6, y: 12.4, r: 1.6, text: '配水点 · 每天上午放水', anchor: { x: 20.6, y: 11.2, z: 2.6 } },
    { x: 29.8, y: 6.2, r: 1.8, text: '医务帐篷 · 里面睡满了人', anchor: { x: 29.8, y: 4.4, z: 2.2 } },
  ];

  return closeArea(a, { edgeH: 1.3 });
}

/* ------------------------------------------------------------------ *
 * 登记帐篷内景
 * ------------------------------------------------------------------ */

/** 帐篷布墙：分带的帆布 + 支杆 + 布面透进来的晨光斑 */
function tentWall(g, len, rand, wallH, opts = {}) {
  const H = Math.round(wallH * TILE_Z);
  const L = Math.round(len);
  // 三档帆布分带：上面被外面的太阳照透，越往下越暗
  const cutA = Math.round(H * 0.3);
  const cutB = Math.round(H * 0.68);
  g.fillStyle = '#8a8f63';
  g.fillRect(0, 0, L, cutA);
  g.fillStyle = '#6d7450';
  g.fillRect(0, cutA, L, cutB - cutA);
  g.fillStyle = '#53593d';
  g.fillRect(0, cutB, L, H - cutB);
  pxDither(g, 0, L, cutA, '#8a8f63');
  pxDither(g, 0, L, cutA + 1, '#6d7450');
  pxDither(g, 0, L, cutB, '#6d7450');
  pxDither(g, 0, L, cutB + 1, '#53593d');

  // 布幅接缝 + 竖向支杆
  for (let x = 0; x <= L; x += TILE_W * 1.5) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(Math.round(x), 0, 1, H);
  }
  for (let x = TILE_W * 0.75; x <= L; x += TILE_W * 3) {
    g.fillStyle = '#3c412e';
    g.fillRect(Math.round(x), 0, 3, H);
    g.fillStyle = '#5c6245';
    g.fillRect(Math.round(x), 0, 1, H);
  }
  // 布面褶皱：斜向短线
  for (let i = 0; i < L / 9; i++) {
    const x = rand() * L;
    const y = rand() * H * 0.8;
    pxLine(g, x, y, x + 3 + rand() * 8, y + 4 + rand() * 9, 'rgba(0,0,0,0.14)', 1);
  }
  // 外面太阳透过布面的亮斑：集中在上半
  for (let i = 0; i < L / 26; i++) {
    const x = rand() * L;
    const y = rand() * H * 0.42;
    pxBlob(g, x, y, 6 + rand() * 16, 4 + rand() * 8, 'rgba(255,232,170,0.10)', rand);
  }
  // 帐底压暗 + 泥点
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(0, H - 5, L, 5);
  for (let i = 0; i < L / 10; i++) {
    g.fillStyle = 'rgba(48,40,28,0.4)';
    g.fillRect(Math.round(rand() * L), H - 4 - ((rand() * 6) | 0), 2, 2 + ((rand() * 3) | 0));
  }
  // 门帘（掀开一角，外面是白亮的日光）
  if (opts.door) {
    const [u0, u1] = opts.door;
    const dw = u1 - u0;
    g.fillStyle = '#2c3122';
    g.fillRect(u0 - 3, 6, dw + 6, H - 6);
    // 洞外的日光：上窄下宽的亮面
    pxPoly(g, [
      [u0 + 2, 8],
      [u1 - 2, 8],
      [u1 + 2, H],
      [u0 - 2, H],
    ], '#f4e6b6');
    pxPoly(g, [
      [u0 + dw * 0.3, 8],
      [u1 - 2, 8],
      [u1 + 2, H],
      [u0 + dw * 0.45, H],
    ], '#fdf4d2');
    // 卷起系住的门帘
    pxLine(g, u0 - 2, 8, u0 + 4, H - 4, '#5c6245', 4);
    pxLine(g, u1 + 2, 8, u1 - 3, H * 0.55, '#4a5038', 3);
    g.fillStyle = '#3c412e';
    g.fillRect(u0 - 4, 4, dw + 8, 5);
  }
}

/** 帐篷地面：铺的旧防潮布 + 踩进来的泥 */
function paintRegFloor(a, rand) {
  const g = a.g;
  const u = (t) => t * TILE_W;
  g.save();
  floorT(g, a.sox, a.soy);
  g.fillStyle = '#5e5844';
  g.fillRect(0, 0, u(a.w), u(a.h));
  // 布幅拼接线
  for (let x = 0; x <= a.w; x += 2) {
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(u(x), 0, 2, u(a.h));
  }
  for (let y = 0; y <= a.h; y += 3) {
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.fillRect(0, u(y), u(a.w), 1);
  }
  // 磨白与泥渍
  for (let i = 0; i < 90; i++) {
    const c = rand() > 0.5 ? 'rgba(150,142,112,0.16)' : 'rgba(40,34,24,0.2)';
    pxBlob(g, rand() * u(a.w), rand() * u(a.h), 4 + rand() * 16, 3 + rand() * 9, c, rand);
  }
  // 门口一片踩进来的泥脚印
  for (let i = 0; i < 26; i++) {
    pxBlob(g, u(6.2 + (rand() - 0.5) * 2.2), u(0.6 + rand() * 1.8), 2 + rand() * 4, 2 + rand() * 3, 'rgba(52,42,28,0.5)', rand);
  }
  // 桌前一块旧地毯：办公的地界
  g.fillStyle = '#5a4a3a';
  g.fillRect(u(2.4), u(1.6), u(3.4), u(2.4));
  g.fillStyle = '#6a5846';
  g.fillRect(u(2.5), u(1.7), u(3.2), 2);
  for (let i = 0; i < 12; i++) {
    pxBlob(g, u(2.6 + rand() * 3), u(1.8 + rand() * 2), 2 + rand() * 5, 2 + rand() * 3, 'rgba(0,0,0,0.14)', rand);
  }
  g.restore();

  // 房间前缘暗边
  const p0 = pt(a.sox, a.soy, a.w, 0);
  const p1 = pt(a.sox, a.soy, a.w, a.h);
  const p2 = pt(a.sox, a.soy, 0, a.h);
  pxLine(g, p0.x, p0.y, p1.x, p1.y, 'rgba(0,0,0,0.8)', 2);
  pxLine(g, p1.x, p1.y, p2.x, p2.y, 'rgba(0,0,0,0.8)', 2);
}

export function buildCampReg() {
  const a = newArea('campReg', '登记帐篷', 9, 6, 2.6);
  const rand = mulberry32(0x9e60);
  const g = a.g;

  paintRegFloor(a, rand);

  // 远墙（北）：开门帘，回营地
  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  tentWall(g, a.w * TILE_W, rand, a.wallH, { door: [5.6 * TILE_W, 7.0 * TILE_W] });
  // 门边钉着的登记牌
  g.fillStyle = '#c9c2a6';
  g.fillRect(4.6 * TILE_W, 12, 26, 16);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(4.6 * TILE_W, 12, 26, 2);
  pxText(g, 4.6 * TILE_W + 3, 17, 'REG', '#3a3a30', 2);
  g.restore();

  // 左墙（西）
  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  tentWall(g, a.h * TILE_W, rand, a.wallH);
  g.restore();
  resetT(g);

  a.props.push({ id: 'desk', s: A.makeFieldDesk(903), x: 3.5, y: 2.7, col: [1.9, 1.0], occ: [1.9, 1.0, 0.85] });
  a.props.push({ id: 'chair', s: A.makeChair(904), x: 2.4, y: 2.7, col: null, occ: null });
  a.props.push({ id: 'cot', s: A.makeCot(905), x: 7.6, y: 4.6, col: [0.95, 1.9], occ: null });
  a.props.push({ id: 'supply', s: A.makeSupplyPile(906), x: 1.3, y: 4.7, col: [1.9, 1.5], occ: [1.9, 1.5, 1.0] });
  a.props.push({ id: 'crate', s: A.makeCrate(0.8, 911), x: 5.4, y: 4.9, col: [0.8, 0.8], occ: [0.8, 0.8, 0.75] });

  /* 光：门口灌进来的白亮日光 + 布面透光的暖黄 + 桌上的台灯。
     全部烘焙（静态、不闪），室内比外面暗一截，登记桌是最亮的点。 */
  a.lights.push({ id: 'sun', x: 6.3, y: 0.7, z: 1.1, r: 5.8, color: [255, 236, 186], power: 0.95, seed: 0.4, mode: 5 });
  a.lights.push({ id: 'canvasGlow', x: 2.6, y: 0.8, z: 1.8, r: 4.6, color: [240, 216, 158], power: 0.42, seed: 1.1, mode: 5 });
  a.lights.push({ id: 'deskLamp', x: 3.9, y: 2.4, z: 1.0, r: 3.0, color: [244, 220, 156], power: 0.6, seed: 2.2, mode: 1 });
  a.ambient = 'rgba(140,118,80,0.10)';
  a.dark = 'rgba(10,8,5,1)';

  a.regDesk = { ...REG_DESK };
  a.safe = true;
  a.npcs = 'campReg';

  a.spawns.enter = { x: 6.3, y: 1.5 };
  a.links.push({
    x: 6.3,
    y: 0.8,
    r: 1.5,
    to: 'camp',
    spawn: 'fromReg',
    needsReg: true,
    lockedText: '先在登记桌办完手续',
    text: '出帐篷 · 去营地',
    short: '出去',
    anchor: { x: 6.3, y: 0.1, z: 2.2 },
  });

  return closeArea(a);
}
