/**
 * 主菜单的画面：一间收容观察室 —— 玻璃舱里关着个体，舱外站着做记录的人。
 *
 * 世界画在 canvas 上，菜单文字一律走 DOM（见 index.html 的 #menu）。
 *
 * 这一幕不是游戏区域，不进 areas.js 的注册表：它没有玩家、没有碰撞、
 * 也不参与换区。但几何、光照与美术全部沿用同一套等距管线，
 * 免得菜单看起来像另一个游戏。
 *
 * 尺度：房间按 2 倍放大（整帧一起缩放，几何与光照才不会错开），
 * 所以整幕在一个 320×180 的"场景空间"里搭，最后整帧一起放大 SCALE 倍铺满
 * 640×360 的逻辑视口。静态光源与裁剪遮罩照例烘焙，每帧只做一次 drawImage。
 *
 * 像素网格：世界跟游戏里一样落在 640N×360N 上（4K 时 N=6）。因为这一幕还额外
 * 放大 SCALE 倍，屏幕上一个场景单位占 SCALE×N 个设备像素，离屏缓冲也必须按
 * SCALE×N 生成 —— 所以搭景整段包在 withPixelBoost(SCALE) 里。少了这一步，
 * 静态层与光照贴图就要再被放大一轮，等于退回低分辨率再吹大。
 */

import { VIEW_W, VIEW_H, HW, HH, TILE_W, TILE_Z, pixelScale, withPixelBoost } from './config.js';
import * as A from './art.js';
import {
  newArea, closeArea, paintFloor, wallBase, wallPipes, doorBay,
  floorT, northT, westT, resetT, THEMES, mulberry32,
} from './areakit.js';
import { computeVisibility } from './visibility.js';
import { Lighting } from './lighting.js';
import {
  clamp, flicker, setBase, blit, pixelSprite,
  pxLine, pxPolyline, pxDither, pxPoly, pxEllipse, pxText, pxGlow,
} from './util.js';

const SCALE = 2;
const SW = VIEW_W / SCALE;
const SH = VIEW_H / SCALE;

/*
 * 房间要比取景大一圈：左、右、近三条边都推出画面外，等距菱形才不会在
 * 半空中被裁成一座孤岛。取景 320×180，菱形对角覆盖 (W+H)*18 ≥ 320 且
 * (W+H)*9 ≥ 180，所以 W+H 至少 21。
 *
 * 墙也要高：远墙顶边是一条斜线，墙越矮，右上角露出的黑三角越大。
 */
const ROOM_W = 13;
const ROOM_H = 8;
const WALL = 5.0;

/** 灯管吊在这个高度，剩下的一段是吊杆 */
const LAMP_Z = 3.9;

/** 相机：远角落在画面左上，房间朝右下铺开，左下角留给菜单按钮 */
const CAM = { x: 120, y: 44 };

/** 收容舱的位置 */
const CHAMBER = { x: 6.6, y: 1.3 };

/** 舱外的人。kind 见 art.js 的 drawStaff */
const CAST = [
  { kind: 'note', x: 4.3, y: 2.3, dir: 1, seed: 0.4, mask: true },
  { kind: 'note', x: 2.9, y: 3.3, dir: 1, seed: 2.2, mask: true, cap: true },
  { kind: 'camera', x: 3.9, y: 4.7, dir: 1, seed: 1.1, mask: true },
  { kind: 'boss', x: 8.8, y: 3.7, dir: -1, seed: 3.7, tone: 'suit', mask: false },
  { kind: 'boss', x: 10.1, y: 2.5, dir: -1, seed: 5.1, tone: 'suit', mask: false },
  { kind: 'tech', x: 9.4, y: 0.9, dir: -1, seed: 4.3, tone: 'scrub', mask: true, cap: true },
];

const RIG = { x: 4.4, y: 4.5 };

/** 每隔这么久，舱里的东西会扑一次玻璃 */
const PRESS_CYCLE = 9.4;

let scene = null;

/* ------------------------------------------------------------------ *
 * 搭景
 * ------------------------------------------------------------------ */

/** 监控墙：几块屏，跳动的波形（静态烘焙，辉光每帧另画） */
function monitorBank(g, u0, v0, rand) {
  const V0 = Math.round(v0);
  g.fillStyle = '#14191b';
  g.fillRect(u0 - 4, V0 - 4, 96, 34);
  g.fillStyle = '#2b3336';
  g.fillRect(u0 - 4, V0 - 4, 96, 2);
  for (let i = 0; i < 4; i++) {
    const sx = u0 + (i % 2) * 45;
    const sy = V0 + ((i / 2) | 0) * 14;
    g.fillStyle = '#08171a';
    g.fillRect(sx, sy, 41, 12);
    // 波形：逐列 1px 像素点，列间用竖线补连续
    g.fillStyle = 'rgba(121,210,204,0.55)';
    let pv = null;
    for (let u = 0; u < 41; u++) {
      const v = Math.round(sy + 6 + Math.sin(u * (0.4 + i * 0.13) + i) * (i === 3 ? 0.6 : 3.4) * (rand() * 0.4 + 0.8));
      if (pv === null) g.fillRect(sx + u, v, 1, 1);
      else g.fillRect(sx + u, Math.min(v, pv), 1, Math.abs(v - pv) + 1);
      pv = v;
    }
    g.fillStyle = 'rgba(121,210,204,0.22)';
    g.fillRect(sx, sy, 41, 1);
  }
}

/**
 * 二层观察廊：高处一长条玻璃，后面是站着看的人影。
 * 把加高后空出来的上半墙填满，顺便再点一次"被观察"这件事。
 *
 * 廊里自己有灯，所以只有窗洞与外框烘进静态层；发亮的内景由
 * galleryLit 在光照之后画，否则整条会被房间的暗压成一片黑。
 */
const GAL = { u0: 40, u1: 442, v0: 9.9, h: 27.9 };

function galleryFrame(g) {
  const { u0, u1, v0, h } = GAL;
  const w = u1 - u0;
  const V0 = Math.round(v0);
  const H = Math.round(h);
  g.fillStyle = '#0d1113';
  g.fillRect(u0 - 4, V0 - 4, w + 8, H + 8);
  g.fillStyle = '#39423f';
  g.fillRect(u0 - 4, V0 - 4, w + 8, 2);
  g.fillStyle = 'rgba(255,255,255,0.06)';
  g.fillRect(u0 - 4, V0 - 4, w + 8, 1);
  g.fillStyle = '#2a3134';
  g.fillRect(u0 - 4, V0 + H + 1, w + 8, 3);
}

/** 观察廊的内景。画在远墙平面上，所以要先叠上 northT 的斜切 */
function galleryLit(ctx, cam, t) {
  const { u0, u1, v0, h } = GAL;
  const w = u1 - u0;
  ctx.save();
  ctx.transform(HW / TILE_W, HH / TILE_W, 0, 1, cam.x, cam.y - WALL * TILE_Z);
  ctx.beginPath();
  ctx.rect(u0, v0, w, h);
  ctx.clip();

  // 廊内：顶灯打下来的一层冷灰，越往下越暗（三档硬分带 + 抖动行）
  const V0 = Math.round(v0);
  const H = Math.round(h);
  const bands = [
    [V0, 'rgba(104,120,128,0.9)'],
    [V0 + Math.round(H * 0.36), 'rgba(60,71,77,0.9)'],
    [V0 + Math.round(H * 0.72), 'rgba(24,31,35,0.9)'],
    [V0 + H, ''],
  ];
  for (let b = 0; b < 3; b++) {
    ctx.fillStyle = bands[b][1];
    ctx.fillRect(u0, bands[b][0], w, bands[b + 1][0] - bands[b][0]);
  }
  pxDither(ctx, u0, u0 + w, bands[1][0], bands[0][1]);
  pxDither(ctx, u0, u0 + w, bands[2][0], bands[1][1]);

  // 后墙上的一排指示灯
  for (let i = 0; u0 + 10 + i * 27 < u1; i++) {
    const u = u0 + 10 + i * 27;
    const on = ((t * 0.7 + i * 0.37) % 1) < 0.62;
    ctx.fillStyle = i % 4 === 3 ? 'rgba(224,165,82,0.75)' : `rgba(121,210,204,${on ? 0.7 : 0.2})`;
    ctx.fillRect(u, V0 + 3, 3, 2);
  }

  // 人影：站着的、抱臂的、俯身撑在栏杆上的。重心按 1px 步进极慢地挪
  const poses = [0.1, 0.23, 0.4, 0.55, 0.72, 0.88];
  for (let i = 0; i < poses.length; i++) {
    const lean = i % 3 === 2;
    const cx = Math.round(u0 + w * poses[i] + Math.sin(t * 0.23 + i * 1.9) * 1.6);
    const bh = Math.round(h * (lean ? 0.6 : 0.76));
    const by = V0 + H - bh;
    ctx.fillStyle = 'rgba(9,13,15,0.88)';
    ctx.fillRect(cx - 4, by + 4, 7, bh - 4);
    // 头：像素方块拼的圆头
    ctx.fillRect(cx - 3, by + 1, 6, 4);
    ctx.fillRect(cx - 2, by, 4, 1);
    if (lean) ctx.fillRect(cx - 8, by + 6, 15, 3);
  }
  // 栏杆
  ctx.fillStyle = 'rgba(28,36,40,0.9)';
  ctx.fillRect(u0, V0 + H - 6, w, 2);

  // 玻璃：斜向高光（像素扫描平行四边形）
  for (let u = u0 - H; u < u1; u += 19) {
    pxPoly(ctx, [
      [u, V0 + H],
      [u + H * 0.5, V0],
      [u + H * 0.5 + 6, V0],
      [u + 6, V0 + H],
    ], 'rgba(178,214,218,0.09)');
  }
  ctx.restore();

  // 分格竖框：压在玻璃外面
  ctx.save();
  ctx.transform(HW / TILE_W, HH / TILE_W, 0, 1, cam.x, cam.y - WALL * TILE_Z);
  ctx.fillStyle = 'rgba(20,26,28,0.9)';
  for (let u = u0 + 42; u < u1 - 4; u += 42) ctx.fillRect(u, V0, 3, H);
  ctx.restore();
}

function paintWalls(a, rand, th) {
  const g = a.g;
  const WH = a.wallH * TILE_Z;

  // 远侧长墙
  g.save();
  northT(g, a.sox, a.soy, a.wallH);
  const len = a.w * TILE_W;
  wallBase(g, len, rand, th, a.wallH);
  wallPipes(g, len, rand, 4, th);
  doorBay(g, 0.55 * TILE_W, 1.95 * TILE_W, rand, th, { state: 'closed', kind: 'office', label: 'OBS' }, a.wallH);

  galleryFrame(g);
  monitorBank(g, 78, WH * 0.53, rand);

  // 舱位编号与警示牌：摆在收容舱右边，别被舱体挡住（3×5 字模）
  const wy = Math.round(WH * 0.62);
  pxText(g, 274, wy - 8, 'CONTAINMENT-07', 'rgba(210,210,198,0.26)', 1);
  pxText(g, 274, wy + 1, 'OBSERVATION LOG D-1042', 'rgba(210,210,198,0.2)', 1);
  pxText(g, 274, wy + 9, 'SPECIMEN CLASS III / NO ENTRY', 'rgba(210,210,198,0.2)', 1);
  // 危险三角（像素描线）
  const ty = Math.round(WH * 0.56);
  pxLine(g, 262, ty - 14, 270, ty, 'rgba(224,165,82,0.5)', 1);
  pxLine(g, 270, ty, 254, ty, 'rgba(224,165,82,0.5)', 1);
  pxLine(g, 254, ty, 262, ty - 14, 'rgba(224,165,82,0.5)', 1);
  g.fillStyle = 'rgba(224,165,82,0.5)';
  g.fillRect(261, ty - 10, 2, 5);
  g.fillRect(261, ty - 4, 2, 2);
  g.restore();

  // 左端墙：药品柜、挂钩、一根落地立管
  g.save();
  westT(g, a.sox, a.soy, a.wallH);
  wallBase(g, a.h * TILE_W, rand, th, a.wallH);
  const cy0 = Math.round(WH * 0.36);
  const gy0 = Math.round(WH * 0.4);
  const gh = Math.round(WH * 0.4);
  g.fillStyle = '#333c3d';
  g.fillRect(132, cy0, 46, Math.round(WH * 0.5));
  g.fillStyle = '#3f4a4b';
  g.fillRect(132, cy0, 46, 2);
  g.fillStyle = 'rgba(150,200,200,0.16)';
  g.fillRect(136, gy0, 18, gh);
  g.fillRect(157, gy0, 18, gh);
  // 玻璃门 1px 描边
  g.fillStyle = 'rgba(0,0,0,0.5)';
  for (const gx of [136, 157]) {
    g.fillRect(gx, gy0, 18, 1);
    g.fillRect(gx, gy0 + gh - 1, 18, 1);
    g.fillRect(gx, gy0, 1, gh);
    g.fillRect(gx + 17, gy0, 1, gh);
  }
  for (let i = 0; i < 8; i++) {
    g.fillStyle = ['rgba(190,205,190,0.5)', 'rgba(224,165,82,0.4)'][i % 2];
    g.fillRect(139 + (i % 2) * 21, Math.round(WH * 0.44) + ((i / 2) | 0) * 8, 11, 4);
  }
  // 挂着的防护服
  for (const [hx, hw] of [[74, 13], [92, 11]]) {
    const sy0 = Math.round(WH * 0.5);
    const sh = Math.round(WH * 0.3);
    g.fillStyle = '#c3ccc9';
    g.fillRect(hx, sy0, hw, sh);
    g.fillStyle = '#9aa5a2';
    g.fillRect(hx, sy0, Math.round(hw * 0.36), sh);
    g.fillStyle = '#2d3436';
    g.fillRect(hx - 2, sy0 - 2, hw + 4, 2);
  }
  // 立管：从墙顶落到地面，把这面高墙的竖向撑住
  for (const [px, pw, pc] of [[206, 5, '#4a5350'], [214, 3, '#39413f']]) {
    g.fillStyle = pc;
    g.fillRect(px, 0, pw, WH);
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.fillRect(px, 0, 1, WH);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let v = 14; v < WH; v += 30) g.fillRect(px - 1, v, pw + 2, 3);
  }
  g.restore();

  resetT(g);
}

function paintFloorMarks(a, th) {
  const g = a.g;
  g.save();
  floorT(g, a.sox, a.soy);

  // 收容舱周围的隔离圈：地面空间里的虚线圆改成一圈像素短段
  const cx = CHAMBER.x * TILE_W;
  const cy = CHAMBER.y * TILE_W;
  {
    const r1 = 2.0 * TILE_W;
    const n1 = 26;
    g.fillStyle = 'rgba(224,165,82,0.32)';
    for (let i = 0; i < n1; i++) {
      if (i % 2) continue; // 虚线：隔一段留一段
      const a0 = (i / n1) * Math.PI * 2;
      const a1 = ((i + 0.9) / n1) * Math.PI * 2;
      pxLine(g, cx + Math.cos(a0) * r1, cy + Math.sin(a0) * r1, cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, 'rgba(224,165,82,0.32)', 3);
    }
    // 外圈细环：稀疏像素点
    const r2 = 2.28 * TILE_W;
    g.fillStyle = 'rgba(224,165,82,0.16)';
    for (let i = 0; i < 72; i++) {
      const a0 = (i / 72) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(a0) * r2), Math.round(cy + Math.sin(a0) * r2), 1, 1);
    }
  }

  // 地面标线与编号（3×5 字模）
  pxText(g, cx - 76, cy + 85, '07', 'rgba(214,210,190,0.16)', 4);
  pxText(g, cx - 76, cy + 108, 'KEEP CLEAR', 'rgba(214,210,190,0.16)', 2);

  // 近端地面的导向灯带：画面最前一条亮线，把空荡荡的前景收住
  for (let i = 0; i < 34; i++) {
    const u = Math.round((1.6 + i * 0.32) * TILE_W);
    g.fillStyle = i % 4 === 0 ? 'rgba(214,226,232,0.5)' : 'rgba(150,170,180,0.22)';
    g.fillRect(u, Math.round(6.3 * TILE_W), 7, 2);
  }

  // 从舱底拉出去的线缆（像素折线：起点-垂点-终点）
  for (const [ex, ey] of [
    [11.4 * TILE_W, 0.7 * TILE_W],
    [1.2 * TILE_W, 0.6 * TILE_W],
    [8.2 * TILE_W, 5.6 * TILE_W],
  ]) {
    pxPolyline(g, [
      [cx, cy + 8],
      [(cx + ex) / 2, cy + 26],
      [ex, ey],
    ], 'rgba(12,16,17,0.85)', 3);
  }
  g.restore();
  resetT(g);
  void th;
}

function build() {
  return withPixelBoost(SCALE, buildScene);
}

function buildScene() {
  const a = newArea('menu', '收容观察间', ROOM_W, ROOM_H, WALL);
  // camFor 是按 640×360 算的，这一幕在 320×180 的场景空间里搭，自己定相机
  a.cam = { x: CAM.x, y: CAM.y };
  a.dark = 'rgba(4,7,10,1)';
  a.ambient = 'rgba(68,90,106,0.1)';

  const rand = mulberry32(0x7107);
  const th = { ...THEMES.lab2, blood: 0.35, scorch: 0.25 };

  paintFloor(a.g, a.sox, a.soy, a.w, a.h, rand, th);
  paintFloorMarks(a, th);
  paintWalls(a, rand, th);

  // 观察室里的家什
  a.props.push({ id: 'cart', s: A.makeMonitorCart(0x211), x: 2.0, y: 0.5, occ: [0.9, 0.9, 1.5] });
  a.props.push({ id: 'shelf', s: A.makeShelf(0x212), x: 0.45, y: 1.5, occ: [0.9, 1.7, 2.05] });
  a.props.push({ id: 'table', s: A.makeTable(0x213), x: 0.9, y: 3.1, occ: [2.3, 1.05, 0.9] });
  a.props.push({ id: 'pipes', s: A.makePipeStack(0x21b), x: 0.6, y: 5.4, occ: [1.1, 1.9, 0.9] });
  a.props.push({ id: 'console', s: A.makeConsole(1.8, 0.9, 1.1, 0x214, { color: 'rgba(224,165,82,0.55)' }), x: 11.2, y: 0.7, occ: [1.8, 0.9, 1.1] });
  a.props.push({ id: 'crate', s: A.makeCrate(0.86, 0x215), x: 12.3, y: 2.4, occ: [0.86, 0.86, 0.82] });
  a.props.push({ id: 'crate2', s: A.makeCrate(0.7, 0x216), x: 8.7, y: 0.35, occ: [0.7, 0.7, 0.66] });
  a.props.push({ id: 'barrel', s: A.makeBarrel(0x219), x: 11.6, y: 1.7, occ: [0.88, 0.88, 1.12] });
  a.props.push({ id: 'chair', s: A.makeChair(0x217), x: 10.4, y: 1.6 });
  // 压在画面下缘的两块暗色前景，用来框住构图
  a.props.push({ id: 'front', s: A.makeConsole(2.4, 1.0, 1.05, 0x21a, { dead: true }), x: 11.9, y: 5.5, occ: [2.4, 1.0, 1.05] });
  a.props.push({ id: 'crate3', s: A.makeCrate(1.0, 0x21c), x: 8.0, y: 6.9, occ: [1.0, 1.0, 0.95] });
  a.props.push({ id: 'rig', s: A.makeCameraRig(0x218), x: RIG.x, y: RIG.y });

  // 收容舱：不是普通道具（个体要夹在两层玻璃中间画），但要参与遮挡
  const chamber = A.makeChamber(0x907);
  a.props.push({ id: 'chamber', x: CHAMBER.x, y: CHAMBER.y, chamber, occ: [1.9, 1.9, 3.1] });

  /* 灯。三根灯管都躲开收容舱在屏幕上的位置 —— 灯具画在光照之后，
     压在玻璃前面会把舱里那位整个挡掉。舱正上方交给舱内冷光。 */
  a.lights.push({ id: 'tubeA', x: 3.0, y: 1.6, z: LAMP_Z, r: 6.4, color: [204, 216, 224], power: 0.52, seed: 1.1, kind: 'tube' });
  a.lights.push({ id: 'tubeB', x: 2.2, y: 4.6, z: LAMP_Z, r: 6.0, color: [204, 216, 224], power: 0.44, seed: 3.4, kind: 'tube' });
  a.lights.push({ id: 'tubeC', x: 12.2, y: 3.2, z: LAMP_Z, r: 6.4, color: [200, 212, 222], power: 0.48, seed: 5.7, kind: 'tube' });
  /* 光源在自己的遮挡体**里面**时（舱内冷光在舱里、台灯在控制台上），
     可见性必须忽略那个遮挡体：否则可见多边形被压缩成遮挡体自身的轮廓，
     连同墙面竖直拉伸，烘出来是一个罩在道具上的发光棱柱 —— 主菜单里
     收容舱曾被这样一个巨大的发光菱形整个罩住。 */
  a.lights.push({ id: 'tank', x: CHAMBER.x, y: CHAMBER.y, z: 1.5, r: 6.2, color: [116, 214, 208], power: 0.86, seed: 0.5, kind: 'tank', ignore: ['chamber'] });
  a.lights.push({ id: 'wallmon', x: 3.0, y: 0.1, z: 1.55, r: 3.2, color: [120, 200, 210], power: 0.3, seed: 2.7, kind: 'screen' });
  a.lights.push({ id: 'gallery', x: 8.4, y: 0.1, z: 3.6, r: 6.8, color: [176, 196, 206], power: 0.34, seed: 1.9, kind: 'gallery' });
  a.lights.push({ id: 'desk', x: 11.2, y: 0.7, z: 1.3, r: 3.6, color: [224, 176, 108], power: 0.4, seed: 4.6, kind: 'screen', ignore: ['console'] });
  a.lights.push({ id: 'strip', x: 7.0, y: 6.3, z: 0.06, r: 6.4, color: [186, 202, 214], power: 0.24, seed: 6.2, kind: 'strip' });
  a.lights.push({ id: 'rec', x: RIG.x, y: RIG.y, z: 1.6, r: 1.1, color: [214, 96, 74], power: 0.5, seed: 0, kind: 'rec' });

  // 天花板灯具：画在光照之后，跟游戏里的灯一样
  a.fixtures = [
    { light: 'tubeA', x: 3.0, y: 1.6, z: LAMP_Z, len: 1.8 },
    { light: 'tubeB', x: 2.2, y: 4.6, z: LAMP_Z, len: 1.6 },
    { light: 'tubeC', x: 12.2, y: 3.2, z: LAMP_Z, len: 1.6 },
  ];

  closeArea(a);

  // 静态光烘焙：位置与遮挡整幕不变，每帧只剩一次 drawImage
  const lighting = new Lighting(SW, SH);
  lighting.ambient = a.ambient;
  for (const L of a.lights) {
    const segs = L.ignore ? a.segments.filter((s) => !L.ignore.includes(s.id)) : a.segments;
    L.vis = computeVisibility(L.x, L.y, segs);
    L.tex = lighting.bakeLight({ x: L.x, y: L.y, r: L.r, color: L.color, vis: L.vis, cam: a.cam, zOff: L.z * TILE_Z });
  }
  a.mask = lighting.bakeMask(a.roomVis, a.cam);

  // 尘埃：慢慢飘的小颗粒，纯屏幕空间
  const motes = [];
  const mr = mulberry32(0x5a17);
  for (let i = 0; i < 26; i++) {
    motes.push({ x: mr() * SW, y: mr() * SH, s: 0.2 + mr() * 0.5, ph: mr() * 6.3, a: 0.1 + mr() * 0.22 });
  }

  // 记下搭景时的网格倍率：窗口换档后整幕要重搭，否则缓冲的分辨率就对不上了
  return { a, lighting, motes, n: pixelScale() / SCALE };
}

/* ------------------------------------------------------------------ *
 * 每帧
 * ------------------------------------------------------------------ */

/** 人物的包围框：脚底是锚点，上方留够站姿与举起来的手 */
const CHAR_BOX = { w: 96, h: 112, ax: 48, ay: 88 };

function sc(cam, x, y, z = 0) {
  return { x: cam.x + (x - y) * HW, y: cam.y + (x + y) * HH - z * TILE_Z };
}

/** 灯的当前亮度系数 */
function level(L, t, press) {
  if (L.kind === 'tube') return flicker(t, L.seed, 0.86);
  if (L.kind === 'tank') return 0.82 + Math.sin(t * 0.9 + L.seed) * 0.1 + press * 0.5;
  if (L.kind === 'screen') return 0.85 + Math.sin(t * 2.4 + L.seed) * 0.12;
  if (L.kind === 'gallery') return 0.9 + Math.sin(t * 0.6 + L.seed) * 0.07;
  if (L.kind === 'rec') return (t % 1.6) < 0.55 ? 1 : 0.06;
  return 1;
}

/** 舱内个体扑玻璃的节律：猛地上去，再慢慢退回去 */
function pressAt(t) {
  const k = t % PRESS_CYCLE;
  if (k > 2.0) return 0;
  return k < 0.22 ? k / 0.22 : clamp(1 - (k - 0.22) / 1.6, 0, 1);
}

/** 天花板灯具：外壳 + 亮着的灯管 */
function drawFixture(g, cam, f, i) {
  const p = sc(cam, f.x, f.y, f.z);
  const X = Math.round(p.x);
  const Y = Math.round(p.y);
  const w = Math.round(f.len * TILE_W * 0.5);
  g.fillStyle = '#2b3134';
  g.fillRect(X - (w >> 1) - 2, Y - 3, w + 4, 4);
  g.fillStyle = '#434c50';
  g.fillRect(X - (w >> 1) - 2, Y - 3, w + 4, 1);
  g.fillStyle = `rgba(236,240,232,${0.25 + i * 0.7})`;
  g.fillRect(X - (w >> 1), Y + 1, w, 2);
  if (i > 0.05) {
    // 三档同心方块辉光，跟直升机航行灯同一读法
    g.save();
    g.globalCompositeOperation = 'lighter';
    pxGlow(g, X, Y + 1, w * 0.9, '226,236,240', 0.38 * i);
    g.restore();
  }
  // 吊杆：一直吊到天花板
  const rod = Math.round((WALL - f.z) * TILE_Z);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(X - 4, Y - 3 - rod, 1, rod);
  g.fillRect(X + 3, Y - 3 - rod, 1, rod);
}

/** 舱体的自发光：玻璃里透出来的冷光，画在光照之后才压不黑 */
function drawTankGlow(g, cam, k) {
  const p = sc(cam, CHAMBER.x, CHAMBER.y);
  const cy = p.y - (A.CHAMBER_FLOOR_Z + 1.3) * TILE_Z;
  // 三档同心像素椭圆代替径向渐变
  g.save();
  g.globalCompositeOperation = 'lighter';
  pxEllipse(g, p.x, cy, 40, 42, `rgba(96,190,190,${(0.05 * k).toFixed(3)})`);
  pxEllipse(g, p.x, cy, 26, 28, `rgba(96,190,190,${(0.08 * k).toFixed(3)})`);
  pxEllipse(g, p.x, cy, 13, 14, `rgba(126,220,214,${(0.16 * k).toFixed(3)})`);
  g.restore();
}

/** 摄像机的 REC 红点 */
function drawRec(g, cam, on) {
  const p = sc(cam, RIG.x, RIG.y);
  const x = p.x + A.CAMERA_REC.dx;
  const y = p.y + A.CAMERA_REC.dy;
  g.fillStyle = on ? '#e8604a' : '#3a2320';
  g.fillRect(Math.round(x), Math.round(y), 2, 2);
  if (!on) return;
  g.save();
  g.globalCompositeOperation = 'lighter';
  pxGlow(g, x + 1, y + 1, 6, '232,96,74', 0.5);
  g.restore();
}

/** 监控墙与控制台屏幕的辉光 */
function drawScreenGlow(g, cam, t) {
  for (const [x, y, z, r, col, ph] of [
    [3.0, 0.06, 1.55, 28, '126,204,214', 0],
    [8.4, 0.06, 3.5, 34, '150,180,192', 1.2],
    [10.6, 0.7, 1.35, 17, '224,176,108', 2.1],
  ]) {
    const p = sc(cam, x, y, z);
    const k = 0.7 + Math.sin(t * 2.6 + ph) * 0.16;
    g.save();
    g.globalCompositeOperation = 'lighter';
    pxGlow(g, p.x, p.y, r, col, 0.22 * k);
    g.restore();
  }
}

/**
 * 画一帧主菜单。t 是真实秒（菜单不吃游戏内的慢动作）。
 * 调用方负责在此之后把变换恢复成单位阵。
 */
export function drawMenuScene(ctx, t) {
  const n = pixelScale();
  if (scene && scene.n !== n) scene = null; // 窗口换了整数档，缓冲要按新倍率重做
  if (!scene) scene = build();
  const { a, lighting, motes } = scene;
  const press = pressAt(t);

  // 极慢的呼吸式漂移，让定格画面不至于像一张图片。取整，几层才不会互相错开
  const dx = Math.round(Math.sin(t * 0.17) * 2 + press * Math.sin(t * 42) * 0.9);
  const dy = Math.round(Math.sin(t * 0.13 + 1.3) * 1.2);
  const cam = { x: a.cam.x + dx, y: a.cam.y + dy };

  /* 整帧一起放大：SCALE 是取景倍率，N 是像素网格倍率。跟游戏里的 applyView
     同一套写法，所以几何、光照、精灵都落在同一张 640N×360N 的网格上。 */
  const S = SCALE * n;
  setBase(ctx, S, 0, 0, S, 0, 0);
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, SW, SH);

  // 静态层。缓冲是 N 倍网格上的位图，按**逻辑**尺寸贴回去才是 1:1
  blit(ctx, a.statics.img, Math.round(cam.x - a.statics.ox), Math.round(cam.y - a.statics.oy));

  // 深度排序：道具、人、收容舱一起排
  const items = [];
  for (const p of a.props) items.push({ k: p.x + p.y, p });
  for (const c of CAST) items.push({ k: c.x + c.y, c });
  items.sort((m, n) => m.k - n.k);

  for (const it of items) {
    // 人物走 pixelSprite 的整数锚点吸附，跟静态层的像素网格对齐
    if (it.c) {
      const p = sc(cam, it.c.x, it.c.y);
      pixelSprite(ctx, p.x, p.y, CHAR_BOX, (g2, ax, ay) => A.drawStaff(g2, ax, ay, { ...it.c, t }));
      continue;
    }
    const p = it.p;
    if (p.chamber) {
      const s = sc(cam, p.x, p.y);
      const cx = Math.round(s.x);
      const cy = Math.round(s.y);
      blit(ctx, p.chamber.back.img, cx - p.chamber.back.ox, cy - p.chamber.back.oy);
      pixelSprite(ctx, cx + 1, cy - A.CHAMBER_FLOOR_Z * TILE_Z, CHAR_BOX, (g2, ax, ay) =>
        A.drawSpecimen(g2, ax, ay, { t, press }),
      );
      blit(ctx, p.chamber.front.img, cx - p.chamber.front.ox, cy - p.chamber.front.oy);
      continue;
    }
    const s = sc(cam, p.x, p.y);
    blit(ctx, p.s.img, Math.round(s.x - p.s.ox), Math.round(s.y - p.s.oy));
  }

  /* --- 光照 --- */
  lighting.ambient = a.ambient;
  lighting.begin();
  for (const L of a.lights) {
    lighting.addBaked(L.tex, L.power * level(L, t, L.kind === 'tank' ? press : 0), dx, dy);
  }
  lighting.finish(ctx, { tex: a.mask, dx, dy }, cam, a.dark);

  /* --- 光照之后：灯具、自发光、辉光 --- */
  for (const f of a.fixtures) {
    const L = a.lights.find((l) => l.id === f.light);
    drawFixture(ctx, cam, f, L ? L.power * level(L, t, 0) * 1.6 : 0);
  }
  galleryLit(ctx, cam, t);
  drawTankGlow(ctx, cam, 0.85 + Math.sin(t * 0.9) * 0.12 + press * 0.5);
  drawScreenGlow(ctx, cam, t);
  drawRec(ctx, cam, t % 1.6 < 0.55);

  // 扑玻璃那一下的白闪
  if (press > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(150,220,214,${0.07 * press})`;
    ctx.fillRect(0, 0, SW, SH);
    ctx.restore();
  }

  // 尘埃：整数像素小点
  ctx.save();
  for (const m of motes) {
    const x = Math.round((m.x + Math.sin(t * 0.12 + m.ph) * 9 + t * 1.6) % SW);
    const y = Math.round(m.y + Math.sin(t * 0.31 + m.ph * 2) * 5);
    ctx.fillStyle = `rgba(214,226,224,${m.a})`;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.restore();

  /* 上缘的雾：远墙顶边是一条斜线，直接切进纯黑会露出很硬的边。
     压几档自上而下的雾带，斜边就化在暗处，视线也被压回下半幅。 */
  for (const [f0, f1, aH] of [
    [0, 0.1, 0.88],
    [0.1, 0.2, 0.6],
    [0.2, 0.3, 0.34],
    [0.3, 0.42, 0.14],
  ]) {
    ctx.fillStyle = `rgba(5,8,12,${aH})`;
    ctx.fillRect(0, Math.round(SH * f0), SW, Math.round(SH * f1) - Math.round(SH * f0));
  }

  // 右缘同理，轻一点：那边还有台灯和主管，压太狠就全糊了
  for (const [f0, f1, aR] of [
    [0.84, 0.9, 0.1],
    [0.9, 0.95, 0.22],
    [0.95, 1, 0.4],
  ]) {
    ctx.fillStyle = `rgba(5,8,12,${aR})`;
    ctx.fillRect(Math.round(SW * f0), 0, Math.round(SW * f1) - Math.round(SW * f0), SH);
  }

  // 左下压暗：菜单文字压在上面要读得清（三层嵌套三角，代替斜向渐变）
  for (const [fw, fh, aS] of [
    [0.62, 0.7, 0.3],
    [0.46, 0.52, 0.34],
    [0.3, 0.34, 0.44],
  ]) {
    pxPoly(ctx, [
      [0, SH - SH * fh],
      [SW * fw, SH],
      [0, SH],
    ], `rgba(4,6,9,${aS})`);
  }

  setBase(ctx, 1, 0, 0, 1, 0, 0);
}

/** 供调试：把搭好的景丢掉，下一帧重新生成 */
export function resetMenuScene() {
  scene = null;
}
