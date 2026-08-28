/**
 * 第一章 · 难民营地的两个区域。
 *
 *   camp     第一个真正的大室外场景：72×44 瓦片（v2.1.0 扩建，原 40×24
 *            的老区保持在西北角不动），显著大于视口，
 *            镜头跟随玩家（area.follow）。清晨 8 点：不跑 lighting.finish()
 *            （area.daylight），亮度与长影全部烘进静态层与道具精灵，
 *            运行期叠一层锚在世界坐标上的暖色晨光（main.js 的 drawDaylight：
 *            太阳挂在东北角天际，光柱钉在地面上，全部跟镜头平移）。
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
  W: 72,
  H: 44,
  /** 停机坪中心（直升机停在这里）。西北角的老区布点保持不动 ——
      main.js 的降落过场与护送路径都硬编码在这一带 */
  heli: { x: 9, y: 6 },
  /** 登记帐篷门口（帐篷开口朝 +x） */
  regDoor: { x: 18.4, y: 9.0 },
  /** 大门（西边界的缺口，暂时封着） */
  gate: { x: 1.0, y: 11.6 },
  /** 广场（水箱旁边的空地，路径都汇到这里） */
  plaza: { x: 21, y: 12.5 },
  /** 平民区的火塘（打饭灶与焚烧坑另算，见 buildCamp） */
  fires: [
    { x: 17.5, y: 16.5 },
    { x: 27.5, y: 15.5 },
    { x: 39.5, y: 27.5 },
    { x: 21.0, y: 31.5 },
    { x: 44.0, y: 34.0 },
  ],
  /* ---- v2.1.0 扩建：生活设施布点（npc.js 与 hints 都从这里取） ---- */
  /** 食堂打饭棚（棚下是打饭台，长桌在南边） */
  mess: { x: 32.5, y: 12.0 },
  /** 打饭灶（大锅边的明火） */
  cookFire: { x: 30.3, y: 10.9 },
  /** 净水塔（军队管控的配水点） */
  water: { x: 25.2, y: 10.6 },
  /** 洗衣区中心（水泥池一排） */
  laundry: { x: 48.2, y: 15.4 },
  /** 浴室（分时段，卫兵掐表） */
  shower: { x: 60.5, y: 12.5 },
  /** 旱厕 */
  latrine: { x: 64.5, y: 22.5 },
  /** 石灰袋（旱厕消毒用） */
  lime: { x: 62.7, y: 23.9 },
  /** 垃圾焚烧区 */
  dump: { x: 64.0, y: 37.0 },
  /** 焚烧坑（明火 + 浓烟） */
  dumpFire: { x: 63.2, y: 38.6 },
  /** 军犬围栏 */
  kennel: { x: 6.2, y: 18.6 },
  /** 军械库（钢皮集装箱） */
  armory: { x: 47.0, y: 3.6 },
  /** 发电机棚 */
  gen: { x: 39.5, y: 3.8 },
  /** 平民区里的废井 */
  well: { x: 18.5, y: 25.5 },
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
  for (let i = 0; i < 1500; i++) {
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
  const tufts = 2600;
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
  for (let i = 0; i < 760; i++) {
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
  // 广场 → 净水塔 / 食堂
  path(CAMP.plaza.x, CAMP.plaza.y, CAMP.water.x, CAMP.water.y + 1.4, 0.7);
  path(CAMP.plaza.x + 1, CAMP.plaza.y + 0.6, 30, 13.4, 0.8);
  path(30, 13.4, CAMP.mess.x + 1.2, CAMP.mess.y + 1.8, 0.8);
  // 食堂 → 洗衣区 → 浴室 → 旱厕 → 焚烧区（后勤动线，一路往东南）
  path(CAMP.mess.x + 1.4, CAMP.mess.y + 2.0, 41, 14.6, 0.7);
  path(41, 14.6, 46, 15.2, 0.7);
  path(50, 15.8, 56, 14.4, 0.65);
  path(56, 14.4, CAMP.shower.x - 0.8, CAMP.shower.y + 1.5, 0.65);
  path(CAMP.shower.x, CAMP.shower.y + 1.9, 63, 18.5, 0.55);
  path(63, 18.5, CAMP.latrine.x - 0.2, CAMP.latrine.y - 0.8, 0.55);
  path(CAMP.latrine.x, CAMP.latrine.y + 1.5, 63.8, 30, 0.5);
  path(63.8, 30, 63.5, 35.2, 0.5);
  // 帐篷区的两条横向巷子 + 两条纵向巷子
  path(12, 26.5, 44, 27.3, 0.65);
  path(14, 33.5, 46, 33.1, 0.65);
  path(21, 13.5, 20.5, 26.5, 0.6);
  path(20.5, 26.5, CAMP.fires[3].x, CAMP.fires[3].y - 1.0, 0.55);
  path(38, 17, CAMP.fires[2].x - 0.6, CAMP.fires[2].y - 0.8, 0.55);
  path(CAMP.fires[2].x, CAMP.fires[2].y + 0.8, 40.5, 33, 0.5);
  path(46, 33.1, 56, 35, 0.55);
  path(56, 35, 61.2, 36.4, 0.55);
  // 军区北路：停机坪 → 指挥帐 → 发电机棚 → 军械库 → 东端
  path(12.6, 4.8, 26, 4.6, 0.6);
  path(26, 4.6, CAMP.gen.x - 1.6, CAMP.gen.y + 1.4, 0.6);
  path(CAMP.gen.x + 1.8, CAMP.gen.y + 1.4, CAMP.armory.x - 1.8, CAMP.armory.y + 1.6, 0.6);
  path(CAMP.armory.x + 1.8, CAMP.armory.y + 1.4, 58, 5.0, 0.55);
  path(58, 5.0, 66, 5.2, 0.5);
  // 犬舍与废井的支路
  path(4, 13.8, CAMP.kennel.x - 0.5, CAMP.kennel.y - 1.4, 0.45);
  path(20.5, 25.8, CAMP.well.x + 0.6, CAMP.well.y + 0.3, 0.4);

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
  pxBlob(g, u(CAMP.cookFire.x), u(CAMP.cookFire.y), u(1.8), u(1.5), '#7c6b4e', rand);

  // 帐篷区的地皮被压得更暗一点（一片片的宿营压痕）
  for (const [tx, ty, tw, th] of [
    [25, 19.5, 9, 4.5], [31, 4.5, 6, 3],
    [16, 24, 8, 3.2], [30, 24.5, 9, 3.2], [46, 24, 8, 3.2],
    [16, 30, 8, 3.2], [30, 30.3, 9, 3.2], [46, 30.2, 8, 3.2],
    [18, 37, 9, 3.4], [32, 36.8, 9, 3.4], [47, 37, 9, 3.4],
  ]) {
    pxBlob(g, u(tx), u(ty), u(tw), u(th), 'rgba(70,60,44,0.32)', rand);
  }

  /* --- 后勤区的地面处理 --- */
  // 食堂：碎石垫层（长桌一带被踩得发白）
  pxBlob(g, u(34), u(15.2), u(6.4), u(3.6), '#8a7c62', rand);
  pxBlob(g, u(33), u(14.6), u(4.2), u(2.4), '#94866c', rand);
  // 洗衣区：水泥地坪 + 排水的湿痕
  g.fillStyle = '#8b897c';
  g.fillRect(u(44.6), u(13.0), u(7.4), u(5.2));
  g.fillStyle = '#7c7a6e';
  g.fillRect(u(44.6), u(13.0), u(7.4), 3);
  pxDither(g, u(44.6), u(52.0), u(18.2), '#8b897c');
  for (let i = 0; i < 10; i++) {
    pxBlob(g, u(45.5 + rand() * 5.6), u(13.6 + rand() * 4.2), u(0.5 + rand() * 0.7), u(0.3 + rand() * 0.4), 'rgba(58,66,66,0.4)', rand);
  }
  pxBlob(g, u(52.4), u(18.6), u(1.6), u(0.8), 'rgba(58,66,66,0.5)', rand);
  // 浴室门口：泡涨的湿泥
  pxBlob(g, u(60.5), u(14.6), u(2.6), u(1.3), 'rgba(56,60,52,0.45)', rand);
  // 旱厕四周：石灰的白 + 一圈没人踩的黄土
  pxBlob(g, u(64.5), u(24.2), u(3.4), u(1.8), 'rgba(214,214,202,0.3)', rand);
  for (let i = 0; i < 12; i++) {
    pxBlob(g, u(62.5 + rand() * 4.4), u(21.4 + rand() * 3.8), u(0.4 + rand() * 0.7), u(0.25 + rand() * 0.4), 'rgba(222,222,210,0.5)', rand);
  }
  // 焚烧区：整片灰黑的浮灰 + 油污 + 散落的碎渣
  pxBlob(g, u(64.2), u(37.6), u(5.4), u(3.6), 'rgba(40,36,30,0.5)', rand);
  pxBlob(g, u(63.4), u(38.6), u(3.0), u(2.0), 'rgba(24,22,18,0.55)', rand);
  pxBlob(g, u(66.4), u(35.8), u(2.2), u(1.4), 'rgba(70,66,58,0.4)', rand);
  for (let i = 0; i < 26; i++) {
    const bx = 60.5 + rand() * 8.4;
    const by = 34.4 + rand() * 7.6;
    g.fillStyle = ['#8d8578', '#5a5248', '#3c3830', '#6e6154'][(rand() * 4) | 0];
    g.fillRect(Math.round(u(bx)), Math.round(u(by)), 1 + ((rand() * 3) | 0), 1 + ((rand() * 2) | 0));
  }
  // 发电机棚与军械库的车压硬地
  pxBlob(g, u(CAMP.gen.x), u(CAMP.gen.y + 0.8), u(3.2), u(1.8), '#85765c', rand);
  pxBlob(g, u(CAMP.armory.x), u(CAMP.armory.y + 0.9), u(3.0), u(1.6), '#85765c', rand);
  // 军械库门前的车辙
  for (const off of [-0.5, 0.5]) {
    g.fillStyle = 'rgba(60,48,34,0.45)';
    g.fillRect(u(CAMP.armory.x - 2.4), Math.round(u(CAMP.armory.y + 1.6 + off)), Math.round(u(5.2)), 2);
  }
  // 犬舍围栏里刨秃的土
  pxBlob(g, u(CAMP.kennel.x), u(CAMP.kennel.y), u(1.6), u(1.1), '#7c6b4e', rand);

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

  /* --- 铁丝网围栏 ---
     周长翻了一倍多，精灵改成共享的三个变体轮换着贴（网面近乎透明，
     重复看不出来），别再一段一个离屏画布 —— 4K 下那是白扔显存。 */
  const fenceX = [A.makeFence(851, 4, 'x'), A.makeFence(853, 4, 'x'), A.makeFence(855, 4, 'x')];
  const fenceY = [A.makeFence(852, 4, 'y'), A.makeFence(854, 4, 'y'), A.makeFence(856, 4, 'y')];
  let fi = 0;
  const fence = (x, y, len, axis) => {
    const s = len === 4
      ? (axis === 'x' ? fenceX : fenceY)[fi % 3]
      : A.makeFence(861 + fi, len, axis);
    P('fx' + fi++, s, x, y, axis === 'x' ? [len, 0.3] : [0.3, len]);
  };
  for (let x = 2; x < CAMP.W; x += 4) fence(Math.min(x, CAMP.W - 2), 0.35, 4, 'x');
  for (let x = 2; x < CAMP.W; x += 4) fence(Math.min(x, CAMP.W - 2), CAMP.H - 0.35, 4, 'x');
  for (let y = 2; y < CAMP.H; y += 4) fence(CAMP.W - 0.35, Math.min(y, CAMP.H - 2), 4, 'y');
  // 西边：大门在 y 9.6~13.6，缺口两侧用短段补齐
  fence(0.35, 2, 4, 'y');
  fence(0.35, 6, 4, 'y');
  fence(0.35, 8.8, 1.6, 'y');
  fence(0.35, 14.8, 2.4, 'y');
  for (let y = 18; y < CAMP.H; y += 4) fence(0.35, Math.min(y, CAMP.H - 2), 4, 'y');
  // 大门：拒马沙袋封着，旁边留个哨位
  P('gateBags', A.makeSandbags(921, 3.4, 'y'), 0.9, CAMP.gate.y, [0.9, 3.6]);
  P('gateBags2', A.makeSandbags(922, 1.8, 'x'), 2.2, CAMP.gate.y - 1.9, [1.9, 0.8]);

  /* --- 内部分区围栏 --- */
  // 发电机棚 + 军械库圈进军管区，入口开在东侧（沙袋 + 岗哨）
  fence(35.6, 4.2, 6.8, 'y');
  fence(37.6, 7.6, 4, 'x');
  fence(41.6, 7.6, 4, 'x');
  fence(45.6, 7.6, 4, 'x');
  fence(49.6, 7.6, 4, 'x');
  fence(53.5, 5.8, 3.4, 'y');
  P('mgBags', A.makeSandbags(923, 2.2, 'x'), 54.6, 8.6, [2.3, 0.8]);
  // 卫生区与洗衣区之间的隔栏（路口留缺）
  fence(57.2, 11.4, 3.2, 'y');
  fence(57.2, 16.4, 3.2, 'y');
  // 焚烧区的围挡：西北角留进出口
  fence(63.0, 33.6, 4, 'x');
  fence(67.4, 33.6, 4, 'x');
  fence(59.8, 36.6, 4, 'y');
  fence(59.8, 40.6, 4, 'y');

  /* --- 军方区（北带）：登记、指挥、医务、发电、军械、瞭望 --- */
  P('regTent', A.makeArmyTent(801, { rx: 2.3, ry: 1.5, h: 1.9, open: true, sign: '#9c5b34' }), 15.6, 9.0, [4.9, 3.3]);
  P('cmdTent', A.makeArmyTent(802, { rx: 2.0, ry: 1.3, h: 1.75, open: false, sign: '#4f6a46' }), 23.5, 3.6, [4.3, 2.9]);
  P('medTent', A.makeArmyTent(803, { rx: 2.0, ry: 1.3, h: 1.75, open: true, sign: '#b3b8a9' }), 29.8, 4.4, [4.3, 2.9]);
  P('medCot', A.makeCot(898), 32.6, 6.8, [0.9, 1.8]);
  P('flag', A.makeFlagpole(895), 19.5, 6.2, [0.5, 0.5]);
  P('tower1', A.makeWatchtower(841), 60.5, 3.4, [1.8, 1.8]);
  P('tower2', A.makeWatchtower(842), 3.2, 16.2, [1.8, 1.8]);
  P('tower3', A.makeWatchtower(843), 68.4, 28.5, [1.8, 1.8]);
  P('tower4', A.makeWatchtower(844), 30.0, 42.2, [1.8, 1.8]);
  P('tower5', A.makeWatchtower(845), 68.6, 41.2, [1.8, 1.8]);
  P('bags1', A.makeSandbags(831, 2.6, 'x'), 12.4, 3.4, [2.7, 0.8]);
  P('bags2', A.makeSandbags(832, 2.2, 'y'), 34.2, 8.6, [0.8, 2.3]);
  P('gen', A.makeGenerator(967), CAMP.gen.x, CAMP.gen.y, [2.5, 1.7]);
  P('genBarrel1', A.makeBarrel(934), 41.8, 5.6, [0.88, 0.88]);
  P('genBarrel2', A.makeBarrel(935), 42.7, 4.7, [0.88, 0.88]);
  P('armory', A.makeArmoryBox(971), CAMP.armory.x, CAMP.armory.y, [2.5, 1.4]);
  P('armoryBags', A.makeSandbags(833, 2.2, 'x'), 44.6, 5.6, [2.3, 0.8]);
  const supply = [A.makeSupplyPile(907), A.makeSupplyPile(908), A.makeSupplyPile(909)];
  P('supply1', supply[0], 12.6, 12.6, [2.0, 1.6]);
  P('supply2', supply[1], 26.2, 6.8, [2.0, 1.6]);
  P('supply3', supply[2], 33.4, 19.4, [2.0, 1.6]);
  P('supply4', supply[0], 50.6, 4.4, [2.0, 1.6]);
  P('supply5', supply[1], 13.5, 27.8, [2.0, 1.6]);
  P('supply6', supply[2], 57.8, 7.0, [2.0, 1.6]);

  /* --- 广场与配水：旧水箱 + 军管净水塔 --- */
  P('tank', A.makeWaterTank(881), 20.6, 11.2, [1.5, 1.5]);
  P('wtower', A.makeWaterTower(961), CAMP.water.x, CAMP.water.y, [1.8, 1.8]);
  P('crate1', A.makeCrate(0.9, 931), 21.9, 13.4, [0.9, 0.9]);
  P('barrel1', A.makeBarrel(932), 13.4, 13.6, [0.88, 0.88]);
  P('barrel2', A.makeBarrel(933), 30.6, 6.4, [0.88, 0.88]);

  /* --- 食堂：打饭棚 + 明火灶 + 三张长桌 + 排队号牌 --- */
  P('mess', A.makeServeCanopy(943), CAMP.mess.x, CAMP.mess.y, [3.6, 2.5]);
  P('cookfire', A.makeCampfire(863), CAMP.cookFire.x, CAMP.cookFire.y, [1.1, 1.1]);
  P('mtable1', A.makeMessTable(941), 30.5, 15.8, [3.3, 2.2]);
  P('mtable2', A.makeMessTable(942), 34.5, 17.0, [3.3, 2.2]);
  P('mtable3', A.makeMessTable(944), 38.5, 15.8, [3.3, 2.2]);
  P('messSign', A.makeSign(985, 'MESS', '#c9b88a'), 29.6, 12.8, [0.4, 0.4]);
  P('messBarrel', A.makeBarrel(936), 29.4, 11.4, [0.88, 0.88]);

  /* --- 洗衣区：三个水泥池 + 晾衣绳 + 篮筐 --- */
  P('wash1', A.makeWashBasin(947), 46.0, 14.2, [1.8, 1.05]);
  P('wash2', A.makeWashBasin(948), 48.2, 15.4, [1.8, 1.05]);
  P('wash3', A.makeWashBasin(949), 50.4, 16.6, [1.8, 1.05]);
  P('line1', A.makeClothesline(951, 3.4, 'x'), 45.5, 18.2, null);
  P('line2', A.makeClothesline(952, 3.4, 'x'), 49.7, 19.4, null);
  P('line3', A.makeClothesline(953, 3.0, 'y'), 52.9, 13.8, null);
  P('washSign', A.makeSign(986, 'WASH', '#b9c0a8'), 44.4, 13.2, [0.4, 0.4]);
  P('washCrate', A.makeCrate(0.82, 937), 44.8, 16.4, [0.82, 0.82]);
  P('washBarrel', A.makeBarrel(938), 51.8, 18.4, [0.88, 0.88]);

  /* --- 卫生区：浴室（卫兵掐表）与旱厕（石灰消毒） --- */
  P('shower', A.makeShowerBlock(955), CAMP.shower.x, CAMP.shower.y, [3.0, 1.5]);
  P('showerBarrel', A.makeBarrel(939), 58.9, 11.3, [0.88, 0.88]);
  P('latrine', A.makeLatrine(957), CAMP.latrine.x, CAMP.latrine.y, [2.7, 1.4]);
  P('lime', A.makeLimeSacks(959), CAMP.lime.x, CAMP.lime.y, [1.1, 0.9]);
  P('wcSign', A.makeSign(987, 'WC', '#c9c2a6'), 62.4, 20.8, [0.4, 0.4]);

  /* --- 垃圾焚烧区：垃圾山 + 焚烧坑（火与苍蝇在运行期画） --- */
  P('trash1', A.makeTrashHeap(977, true), 62.4, 36.0, [2.4, 1.9]);
  P('trash2', A.makeTrashHeap(978, true), 66.2, 38.3, [2.4, 1.9]);
  P('trash3', A.makeTrashHeap(983), 67.9, 35.4, [1.8, 1.4]);
  P('trash4', A.makeTrashHeap(984), 61.0, 39.9, [1.8, 1.4]);
  P('burnpit', A.makeBurnPit(979), CAMP.dumpFire.x, CAMP.dumpFire.y, [1.6, 1.4]);
  P('dumpSign', A.makeSign(988, 'DUMP', '#b39a7a'), 60.9, 34.3, [0.4, 0.4]);
  P('dumpBags', A.makeSandbags(834, 1.8, 'y'), 60.2, 34.9, [0.8, 1.9]);

  /* --- 军犬围栏（大门内侧，追逃兵用的德牧住在这里） --- */
  P('kennel', A.makeKennel(981), CAMP.kennel.x, CAMP.kennel.y, [2.3, 1.8]);
  P('k9Sign', A.makeSign(989, 'K9', '#b3907a'), 7.9, 17.0, [0.4, 0.4]);

  /* --- 广播喇叭：电线杆挂喇叭，全营都听得见 --- */
  const speakers = [
    [22.8, 10.4], [33.8, 19.6], [15.8, 27.8], [40.5, 30.5], [57.5, 19.5], [4.4, 9.6],
  ];
  speakers.forEach(([x, y], i) => P('spk' + i, A.makeSpeakerPole(975 + i), x, y, [0.5, 0.5]));

  /* --- 照明杆：夜里靠发电机房供电（白天全灭） --- */
  const lampAt = [
    [14.2, 5.6], [24.6, 10.4], [8.2, 17.6], [43.0, 11.2], [56.0, 13.0],
    [28.0, 27.6], [46.5, 31.5], [62.0, 31.0], [12.0, 32.5], [66.5, 18.5],
  ];
  lampAt.forEach(([x, y], i) => P('lamp' + i, A.makeFloodlight(891 + i), x, y, [0.6, 0.6]));

  /* --- 火塘与坐处 --- */
  P('fire1', A.makeCampfire(861), CAMP.fires[0].x, CAMP.fires[0].y, [1.1, 1.1]);
  P('fire2', A.makeCampfire(862), CAMP.fires[1].x, CAMP.fires[1].y, [1.1, 1.1]);
  P('fire3', A.makeCampfire(864), CAMP.fires[2].x, CAMP.fires[2].y, [1.1, 1.1]);
  P('fire4', A.makeCampfire(865), CAMP.fires[3].x, CAMP.fires[3].y, [1.1, 1.1]);
  P('fire5', A.makeCampfire(866), CAMP.fires[4].x, CAMP.fires[4].y, [1.1, 1.1]);
  const benchX = A.makeLogBench(871, 'x');
  const benchY = A.makeLogBench(872, 'y');
  P('bench1', benchX, 16.2, 17.8, [1.6, 0.55]);
  P('bench2', benchY, 19.0, 15.9, [0.55, 1.6]);
  P('bench3', benchX, 26.3, 16.9, [1.6, 0.55]);
  P('bench4', benchY, 29.0, 14.8, [0.55, 1.6]);
  P('bench5', benchX, 38.2, 29.0, [1.6, 0.55]);
  P('bench6', benchY, 22.5, 30.2, [0.55, 1.6]);
  P('bench7', benchX, 43.0, 32.6, [1.6, 0.55]);

  /* --- 平民区里的废井 --- */
  P('well', A.makeWell(963), CAMP.well.x, CAMP.well.y, [1.2, 1.2]);

  /* --- 难民棚：老区的一片保持原位，往南再铺三排，配色轮换 ---
     精灵共享 8 个变体（4 色 × 2 随机形），四十多顶棚不再一顶一张画布 */
  const hutSprites = [];
  for (let v = 0; v < 4; v++) {
    hutSprites.push(A.makeRefugeeTent(821 + v, v), A.makeRefugeeTent(825 + v * 3, v));
  }
  const huts = [
    // 老区（y 14~22）
    [14.0, 19.6, 0], [17.2, 21.4, 1], [20.6, 18.8, 2], [23.2, 21.2, 3],
    [26.6, 19.8, 0], [30.0, 21.6, 1], [33.2, 17.6, 2], [35.8, 20.8, 3],
    [31.2, 14.6, 1], [36.2, 14.2, 0], [11.0, 21.0, 2],
    // 第一排（y 23~25）
    [10.5, 24.2, 3], [13.8, 23.4, 0], [17.2, 24.6, 1], [23.6, 23.8, 2],
    [27.0, 24.8, 3], [30.4, 23.6, 0], [34.0, 24.9, 1], [41.5, 24.0, 2],
    [45.0, 23.2, 3], [48.5, 24.4, 0], [52.0, 23.4, 1],
    // 第二排（y 29~31）
    [11.5, 30.0, 2], [15.0, 29.2, 3], [18.4, 30.4, 0], [24.0, 29.6, 1],
    [27.5, 30.6, 2], [31.0, 29.4, 3], [35.0, 30.8, 0], [42.0, 29.8, 1],
    [45.5, 30.9, 2], [49.0, 29.5, 3], [53.0, 30.6, 0],
    // 第三排（y 36~38）
    [13.0, 36.4, 1], [16.5, 37.2, 2], [20.0, 36.0, 3], [25.5, 37.0, 0],
    [29.0, 36.2, 1], [33.0, 37.4, 2], [37.0, 36.4, 3], [42.5, 36.8, 0],
    [47.0, 37.6, 1], [51.0, 36.2, 2], [54.5, 37.2, 3],
  ];
  huts.forEach(([x, y, v], i) => {
    P('hut' + i, hutSprites[(v * 2 + (i % 2)) % hutSprites.length], x, y, [2.4, 1.8]);
  });
  // 帐篷间的生活杂物：行军床、箱子、桶、私搭的晾衣绳
  P('cot1', A.makeCot(899), 24.8, 17.9, [0.9, 1.8]);
  P('cot2', A.makeCot(897), 28.6, 26.2, [0.9, 1.8]);
  P('cot3', A.makeCot(896), 49.8, 26.4, [0.9, 1.8]);
  P('hutCrate1', A.makeCrate(0.85, 926), 16.0, 28.2, [0.85, 0.85]);
  P('hutCrate2', A.makeCrate(0.8, 927), 44.5, 28.6, [0.8, 0.8]);
  P('hutBarrel1', A.makeBarrel(928), 33.5, 26.2, [0.88, 0.88]);
  P('hutBarrel2', A.makeBarrel(929), 26.5, 35.0, [0.88, 0.88]);
  P('hutLine1', A.makeClothesline(954, 3.0, 'x'), 14.5, 25.6, null);
  P('hutLine2', A.makeClothesline(956, 3.2, 'x'), 23.0, 27.9, null);
  P('hutLine3', A.makeClothesline(958, 3.0, 'x'), 36.5, 31.8, null);
  P('hutLine4', A.makeClothesline(962, 2.8, 'y'), 50.5, 33.0, null);
  // 分区号牌：军方把帐篷区划成了格子
  P('zoneA1', A.makeSign(991, 'A1', '#c9c2a6'), 12.6, 19.2, [0.4, 0.4]);
  P('zoneA2', A.makeSign(992, 'A2', '#c9c2a6'), 32.0, 22.6, [0.4, 0.4]);
  P('zoneB1', A.makeSign(993, 'B1', '#c9c2a6'), 12.8, 34.6, [0.4, 0.4]);
  P('zoneB2', A.makeSign(994, 'B2', '#c9c2a6'), 40.0, 35.0, [0.4, 0.4]);

  /* --- 区域旗标 --- */
  a.daylight = true; // 白天：不跑 lighting.finish()，晨光由 drawDaylight 按世界坐标叠加
  a.noMask = true;
  a.safe = true; // 营地里禁止开枪
  a.follow = { yOff: 12 }; // 镜头跟随玩家
  a.npcs = 'camp';
  // 火焰：五处火塘 + 打饭灶（小）+ 焚烧坑（大，浓烟）
  a.fires = [
    ...CAMP.fires.map((f) => ({ ...f })),
    { ...CAMP.cookFire, s: 0.8 },
    { ...CAMP.dumpFire, s: 1.5, smoky: true },
  ];
  // 苍蝇：垃圾山两团 + 旱厕一小团（运行期的小点，见 main.js drawFlies）
  a.flies = [
    { x: 62.4, y: 36.0, r: 1.3, n: 8 },
    { x: 66.2, y: 38.3, r: 1.3, n: 8 },
    { x: 64.5, y: 23.4, r: 0.9, n: 4 },
  ];
  // 持续冒烟的点：发电机排气管 + 打饭棚的大锅蒸汽
  a.smokes = [
    { x: 38.8, y: 3.45, z: 1.9, p: 1.6 },
    { x: 32.0, y: 12.0, z: 1.0, p: 0.55 },
  ];

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
    { x: 20.6, y: 12.4, r: 1.4, text: '旧配水点 · 停用了 · 都去净水塔排队', anchor: { x: 20.6, y: 11.2, z: 2.6 } },
    { x: 29.8, y: 6.2, r: 1.8, text: '医务帐篷 · 里面睡满了人', anchor: { x: 29.8, y: 4.4, z: 2.2 } },
    { x: CAMP.water.x + 0.6, y: CAMP.water.y + 1.8, r: 1.8, text: '净水塔 · 军管 · 每人每日两升 · 水有点发黄', anchor: { x: CAMP.water.x, y: CAMP.water.y, z: 3.4 } },
    { x: CAMP.mess.x + 1.4, y: CAMP.mess.y + 2.2, r: 2.2, text: '食堂 · 长桌铁皮碗 · 按编号排队打饭', anchor: { x: CAMP.mess.x, y: CAMP.mess.y, z: 2.6 } },
    { x: CAMP.laundry.x, y: CAMP.laundry.y + 1.6, r: 2.4, text: '洗衣区 · 水泥池加晾衣绳 · 常有人为抢位置吵起来', anchor: { x: CAMP.laundry.x, y: CAMP.laundry.y, z: 1.6 } },
    { x: CAMP.shower.x, y: CAMP.shower.y + 2.0, r: 2.0, text: '浴室 · 男女分时段 · 冷水限时三分钟 · 门口卫兵掐表', anchor: { x: CAMP.shower.x, y: CAMP.shower.y, z: 2.8 } },
    { x: CAMP.latrine.x, y: CAMP.latrine.y + 2.0, r: 2.0, text: '旱厕 · 深坑式 · 定期撒石灰 · 夜间禁止使用', anchor: { x: CAMP.latrine.x, y: CAMP.latrine.y, z: 2.5 } },
    { x: CAMP.dump.x - 1.5, y: CAMP.dump.y - 1.5, r: 2.4, text: '焚烧区 · 苍蝇嗡嗡的 · 军士守着火堆烧垃圾', anchor: { x: CAMP.dumpFire.x, y: CAMP.dumpFire.y, z: 1.8 } },
    { x: CAMP.armory.x, y: CAMP.armory.y + 2.2, r: 2.2, text: '军械库 · 上着锁 · 平民禁入', anchor: { x: CAMP.armory.x, y: CAMP.armory.y, z: 2.2 } },
    { x: CAMP.gen.x, y: CAMP.gen.y + 2.2, r: 2.0, text: '发电机房 · 供指挥部、医务帐和探照灯 · 平民区每晚断电', anchor: { x: CAMP.gen.x, y: CAMP.gen.y, z: 2.6 } },
    { x: CAMP.kennel.x, y: CAMP.kennel.y + 1.8, r: 1.8, text: '军犬围栏 · 追踪逃营的人用 · 别把手伸进去', anchor: { x: CAMP.kennel.x, y: CAMP.kennel.y, z: 1.6 } },
    { x: CAMP.well.x, y: CAMP.well.y + 1.2, r: 1.4, text: '废井 · 水浑得没法喝 · 大家都去净水塔', anchor: { x: CAMP.well.x, y: CAMP.well.y, z: 1.6 } },
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
    // 洞外的日光：上窄下宽的亮面（低角度橙阳，跟室外的天一个色温）
    pxPoly(g, [
      [u0 + 2, 8],
      [u1 - 2, 8],
      [u1 + 2, H],
      [u0 - 2, H],
    ], '#f6d69a');
    pxPoly(g, [
      [u0 + dw * 0.3, 8],
      [u1 - 2, 8],
      [u1 + 2, H],
      [u0 + dw * 0.45, H],
    ], '#fcecc0');
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

  /* 光：门口灌进来的橙金日光 + 布面透光的暖黄 + 桌上的台灯。
     全部烘焙（静态、不闪），室内比外面暗一截，登记桌是最亮的点。
     日光颜色跟营地的低角度橙阳一致（drawDaylight），别一门内外两个太阳。 */
  a.lights.push({ id: 'sun', x: 6.3, y: 0.7, z: 1.1, r: 5.8, color: [255, 212, 148], power: 0.95, seed: 0.4, mode: 5 });
  a.lights.push({ id: 'canvasGlow', x: 2.6, y: 0.8, z: 1.8, r: 4.6, color: [244, 204, 138], power: 0.42, seed: 1.1, mode: 5 });
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
