/**
 * 第一章的营地 NPC：巡逻士兵 + 难民生活百态。
 *
 * 刻意保持轻量 —— 没有寻路、没有感知，每个 NPC 只有一个小状态机：
 *   patrol  沿路径点巡逻，端点停一拍
 *   wander  在小半径里随机溜达，走两步歇一会
 *   sit / squat / talk / cradle / stand  原地 idle，姿势由时间推出来
 *
 * 姿势全部复用 drawCharacter 的 pose 字段（像素偏移 + 量化），
 * 所以 NPC 和玩家/机组是同一套人形，只是衣服和动作不同。
 * 绘制由 main.js 塞进等距深度排序（k = x + y），会被帐篷正常遮挡。
 */

import { HW, HH } from './config.js';
import { REFUGEE_OUTFITS, HAIR_STYLES, HAIR_COLORS, SKIN_TONES } from './art.js';
import { mulberry32 } from './util.js';
import { CAMP } from './campareas.js';

/** 世界方向 -> 屏幕单位向量（drawCharacter 的 aim 吃屏幕方向） */
function dirScreen(dx, dy) {
  const sx = (dx - dy) * HW;
  const sy = (dx + dy) * HH;
  const l = Math.hypot(sx, sy) || 1;
  return { x: sx / l, y: sy / l };
}

const qz = (v, s) => Math.round(v / s) * s;

function lookFor(rand) {
  return {
    skin: SKIN_TONES[(rand() * SKIN_TONES.length) | 0],
    hair: HAIR_STYLES[(rand() * HAIR_STYLES.length) | 0],
    hairCol: HAIR_COLORS[(rand() * HAIR_COLORS.length) | 0],
  };
}

/**
 * o: { kind, x, y, outfit(键名), look, scale, slung, aim, pts, cx/cy/r, face, sink }
 * outfit 存**键名**而不是色表对象：art.js 存在带 ?v= 与不带两份模块实例，
 * 键名在绘制端（main.js 自己的 art 实例）再解析，怎么都不会拿错。
 */
function npc(rand, o) {
  return {
    kind: o.kind,
    x: o.x,
    y: o.y,
    seed: rand() * 100,
    outfit: o.outfit || 'refugee',
    refIdx: o.refIdx === undefined ? (rand() * REFUGEE_OUTFITS.length) | 0 : o.refIdx,
    look: o.look || lookFor(rand),
    scale: o.scale || 0.98 + rand() * 0.06,
    slung: !!o.slung,
    aim: o.aim || dirScreen(1, 0.4),
    face: o.face === undefined ? (rand() > 0.5 ? 1 : -1) : o.face,
    sink: o.sink || 0,
    walk: rand() * 2,
    moving: false,
    // patrol
    pts: o.pts || null,
    i: 0,
    waitT: 0,
    speed: o.speed || 1.15,
    // wander
    cx: o.cx,
    cy: o.cy,
    r: o.r,
    tx: null,
    ty: null,
    idleT: 1 + rand() * 3,
  };
}

/* ------------------------------------------------------------------ *
 * 名册
 * ------------------------------------------------------------------ */

function campRoster() {
  const rand = mulberry32(0x50c1);
  const list = [];

  /* --- 巡逻士兵 ---
     路径点都靠人肉对过 campareas 的碰撞盒：NPC 不吃碰撞，
     线路穿过帐篷/沙袋不会被拦住，只会看起来像穿模。 */
  const soldier = (o) => list.push(npc(rand, { outfit: 'soldier', slung: true, scale: 1.04, ...o }));
  soldier({ kind: 'patrol', x: 4, y: 3.5, pts: [[4, 3.5], [12.6, 4.2], [12.6, 7.0], [4.6, 7.0]], speed: 1.1 });
  // 军区北路：从旗杆一直巡到军械库
  soldier({ kind: 'patrol', x: 21, y: 1.6, pts: [[21, 1.6], [34, 1.5], [44, 1.7], [56, 1.6]], speed: 1.2 });
  // 南围栏一条长线
  soldier({ kind: 'patrol', x: 6, y: 42.9, pts: [[6, 42.9], [26, 42.6], [46, 42.9], [66, 42.5]], speed: 1.0 });
  // 东围栏
  soldier({ kind: 'patrol', x: 70.6, y: 10, pts: [[70.6, 10], [70.4, 24], [70.6, 32]], speed: 0.95 });
  // 帐篷区中巷：压着两条横巷来回
  soldier({ kind: 'patrol', x: 14, y: 26.6, pts: [[14, 26.6], [42, 27.3], [44, 33.1], [16, 33.4]], speed: 0.9 });
  // 大门双岗：站着不动，面朝营外
  soldier({ kind: 'stand', x: 2.5, y: 10.4, aim: dirScreen(-1, 0.15), face: -1 });
  soldier({ kind: 'stand', x: 2.5, y: 12.9, aim: dirScreen(-1, -0.15), face: -1 });
  // 停机坪警戒
  soldier({ kind: 'stand', x: 11.8, y: 4.2, aim: dirScreen(-0.8, 0.6), face: -1 });
  // 军械库门口的固定岗 + 军管区入口
  soldier({ kind: 'stand', x: CAMP.armory.x + 0.2, y: CAMP.armory.y + 1.9, aim: dirScreen(0.4, 0.9), face: 1 });
  soldier({ kind: 'stand', x: 54.6, y: 9.6, aim: dirScreen(0.6, 0.8), face: 1 });
  // 发电机边蹲着修油路的兵
  soldier({ kind: 'squat', x: CAMP.gen.x + 1.5, y: CAMP.gen.y + 1.1, aim: dirScreen(-0.8, -0.5), face: -1 });
  // 净水塔配给岗：面朝排队的人
  soldier({ kind: 'stand', x: 24.0, y: 12.2, aim: dirScreen(0.6, 0.7), face: 1 });
  // 食堂维持秩序的
  soldier({ kind: 'stand', x: 35.8, y: 11.6, aim: dirScreen(0.5, 0.9), face: 1 });
  // 浴室门口掐表的卫兵（限时三分钟）
  soldier({ kind: 'officer', x: 59.4, y: 13.9, aim: dirScreen(0.7, -0.5), face: 1 });
  // 焚烧区：一个守着火堆，一个拿棍子拨垃圾
  soldier({ kind: 'stand', x: 62.0, y: 37.9, aim: dirScreen(0.7, 0.5), face: 1 });
  soldier({ kind: 'squat', x: 64.4, y: 39.4, aim: dirScreen(-0.6, -0.6), face: -1 });

  /* --- 军犬（德国牧羊犬）：outfit 'dog' 走 drawDog，不吃人形姿势 --- */
  const dog = (o) => list.push(npc(rand, { outfit: 'dog', scale: 1, ...o }));
  // 犬舍里趴着一只
  dog({ kind: 'sit', x: CAMP.kennel.x + 0.4, y: CAMP.kennel.y + 0.3, face: 1 });
  // 牵犬员带着一只沿西/南边巡（狗吊在人身后半步）
  soldier({ kind: 'patrol', x: 4.5, y: 22, pts: [[4.5, 22], [4.2, 34], [9, 40.5], [4.2, 34]], speed: 1.05 });
  dog({ kind: 'patrol', x: 4.5, y: 23.2, pts: [[4.5, 23.2], [4.9, 34.8], [9.6, 41.3], [4.9, 34.8]], speed: 1.05 });
  // 第二只在大门岗边上坐着
  dog({ kind: 'sit', x: 3.6, y: 13.9, face: -1 });

  /* --- 难民 --- */
  const ref = (o) => list.push(npc(rand, o));
  // 火塘一：长凳上坐两个，旁边蹲一个，站着抱孩子的一个
  ref({ kind: 'sit', x: 15.7, y: 17.7, sink: -5, aim: dirScreen(0.9, -0.6), face: 1 });
  ref({ kind: 'sit', x: 16.7, y: 17.8, sink: -5, aim: dirScreen(0.7, -0.7), face: 1 });
  ref({ kind: 'sit', x: 19.0, y: 15.5, sink: -5, aim: dirScreen(-0.7, 0.7), face: -1 });
  ref({ kind: 'squat', x: 18.4, y: 17.2, aim: dirScreen(-0.6, -0.8), face: -1 });
  ref({ kind: 'cradle', x: 16.6, y: 15.5, aim: dirScreen(0.8, 0.5), face: 1 });
  // 火塘二：坐两个 + 站着聊天的一对
  ref({ kind: 'sit', x: 25.9, y: 16.8, sink: -5, aim: dirScreen(0.8, -0.6), face: 1 });
  ref({ kind: 'sit', x: 26.9, y: 17.0, sink: -5, aim: dirScreen(0.6, -0.8), face: 1 });
  ref({ kind: 'talk', x: 28.6, y: 14.3, aim: dirScreen(0.5, 0.9), face: 1 });
  ref({ kind: 'talk', x: 29.3, y: 15.0, aim: dirScreen(-0.5, -0.9), face: -1 });
  // 广场与旧水箱边
  ref({ kind: 'stand', x: 21.3, y: 12.1, aim: dirScreen(-0.4, -0.9) });
  // 医务帐外
  ref({ kind: 'squat', x: 29.0, y: 6.4, aim: dirScreen(0.7, -0.7) });
  ref({ kind: 'stand', x: 31.2, y: 6.2, aim: dirScreen(-0.5, -0.8), face: -1 });

  /* 净水塔：一列排队领水的（面朝塔），一个蹲着接水 */
  ref({ kind: 'squat', x: 25.4, y: 12.0, aim: dirScreen(-0.4, -0.9), face: -1 });
  for (let i = 0; i < 4; i++) {
    ref({
      kind: 'stand', x: 25.9 + i * 0.55, y: 12.9 + i * 0.72,
      aim: dirScreen(-0.5, -0.8), face: -1,
    });
  }

  /* 食堂：打饭口排一列（人手一只碗排到东南），桌边坐着吃的，掌勺的 */
  ref({ kind: 'officer', x: 31.6, y: 11.6, aim: dirScreen(0.8, 0.5), face: 1 }); // 掌勺：手一直在锅台上
  for (let i = 0; i < 6; i++) {
    ref({
      kind: 'stand', x: 34.9 + i * 0.72, y: 12.9 + i * 0.55,
      aim: dirScreen(-0.8, -0.55), face: -1,
    });
  }
  ref({ kind: 'sit', x: 30.0, y: 15.05, sink: -5, aim: dirScreen(0.5, 0.85), face: 1 });
  ref({ kind: 'sit', x: 31.1, y: 16.55, sink: -5, aim: dirScreen(-0.5, -0.85), face: -1 });
  ref({ kind: 'sit', x: 34.0, y: 16.25, sink: -5, aim: dirScreen(0.5, 0.85), face: 1 });
  ref({ kind: 'sit', x: 38.9, y: 15.05, sink: -5, aim: dirScreen(0.5, 0.85), face: 1, scale: 0.8, look: { skin: SKIN_TONES[1], hair: 'short', hairCol: HAIR_COLORS[0] } });

  /* 洗衣区：两个蹲着搓，一对为抢池子吵起来了，一个抱着盆看热闹 */
  ref({ kind: 'squat', x: 45.6, y: 13.6, aim: dirScreen(0.5, 0.8), face: 1 });
  ref({ kind: 'squat', x: 48.0, y: 14.8, aim: dirScreen(0.5, 0.8), face: 1 });
  ref({ kind: 'talk', x: 50.0, y: 15.9, aim: dirScreen(0.6, 0.7), face: 1 });
  ref({ kind: 'talk', x: 50.8, y: 16.5, aim: dirScreen(-0.6, -0.7), face: -1 });
  ref({ kind: 'cradle', x: 47.0, y: 17.4, aim: dirScreen(0.7, -0.6), face: 1 });

  /* 浴室与旱厕：等位的、捂着鼻子路过的 */
  ref({ kind: 'stand', x: 61.6, y: 14.5, aim: dirScreen(-0.6, -0.7), face: -1 });
  ref({ kind: 'squat', x: 62.5, y: 15.2, aim: dirScreen(-0.6, -0.7), face: -1 });
  ref({ kind: 'wander', x: 63.5, y: 25.5, cx: 63.5, cy: 25.5, r: 1.4, speed: 0.8 });

  /* 帐篷区：蹲着的、坐地上的、抱孩子来回走的、聊天的 */
  ref({ kind: 'squat', x: 33.6, y: 18.7, aim: dirScreen(-0.8, 0.5), face: -1 });
  ref({ kind: 'sit', x: 11.7, y: 20.3, sink: 0, aim: dirScreen(0.9, -0.4), face: 1 });
  ref({ kind: 'cradle', x: 20.8, y: 19.8, aim: dirScreen(-0.7, 0.6), face: -1 });
  // 火塘三：新棚区的火
  ref({ kind: 'sit', x: 38.6, y: 28.7, sink: -5, aim: dirScreen(0.4, -0.9), face: 1 });
  ref({ kind: 'sit', x: 39.8, y: 28.9, sink: -5, aim: dirScreen(-0.4, -0.9), face: -1 });
  ref({ kind: 'squat', x: 40.8, y: 26.9, aim: dirScreen(-0.7, 0.6), face: -1 });
  // 火塘四
  ref({ kind: 'sit', x: 22.3, y: 30.6, sink: -5, aim: dirScreen(-0.6, 0.7), face: -1 });
  ref({ kind: 'cradle', x: 20.0, y: 32.4, aim: dirScreen(0.8, -0.5), face: 1 });
  ref({ kind: 'talk', x: 22.0, y: 32.8, aim: dirScreen(-0.3, -0.9), face: -1 });
  // 火塘五
  ref({ kind: 'sit', x: 43.2, y: 32.75, sink: -5, aim: dirScreen(0.4, 0.9), face: 1 });
  ref({ kind: 'sit', x: 44.9, y: 35.1, sink: 0, aim: dirScreen(-0.6, -0.7), face: -1 });
  // 废井边发呆的
  ref({ kind: 'squat', x: 19.1, y: 26.2, aim: dirScreen(-0.5, -0.8), face: -1 });
  // 晾衣绳下收衣服的
  ref({ kind: 'stand', x: 23.2, y: 28.3, aim: dirScreen(-0.3, -0.9), face: -1 });
  ref({ kind: 'stand', x: 36.2, y: 32.2, aim: dirScreen(0.3, -0.9), face: 1 });
  // 大门口往外望的老人
  ref({ kind: 'stand', x: 3.6, y: 11.7, aim: dirScreen(-1, 0.1), face: -1, look: { skin: SKIN_TONES[2], hair: 'bald', hairCol: HAIR_COLORS[3] } });
  // 溜达的（活动半径都收在棚子之间的空地里，别晃进帐篷）
  ref({ kind: 'wander', x: 30, y: 19.4, cx: 30, cy: 19.4, r: 1.8, speed: 0.7 });
  ref({ kind: 'wander', x: 12.4, y: 16.8, cx: 12.4, cy: 16.8, r: 1.6, speed: 0.6 });
  ref({ kind: 'wander', x: 9.5, y: 14.5, cx: 9.5, cy: 14.5, r: 2.0, speed: 0.75 });
  ref({ kind: 'wander', x: 26.5, y: 27.5, cx: 26.5, cy: 27.5, r: 1.7, speed: 0.65 });
  ref({ kind: 'wander', x: 47.5, y: 27.6, cx: 47.5, cy: 27.6, r: 1.8, speed: 0.7 });
  ref({ kind: 'wander', x: 33.0, y: 34.0, cx: 33.0, cy: 34.0, r: 1.6, speed: 0.6 });
  ref({ kind: 'wander', x: 16.5, y: 34.6, cx: 16.5, cy: 34.6, r: 1.5, speed: 0.7 });
  // 追着跑的小孩：广场南边一个，帐篷区两个
  ref({ kind: 'wander', x: 22.6, y: 15.4, cx: 22.6, cy: 15.4, r: 1.8, speed: 1.9, scale: 0.78, look: { skin: SKIN_TONES[1], hair: 'short', hairCol: HAIR_COLORS[0] } });
  ref({ kind: 'wander', x: 28.8, y: 33.2, cx: 28.8, cy: 33.2, r: 2.0, speed: 2.0, scale: 0.76, look: { skin: SKIN_TONES[0], hair: 'messy', hairCol: HAIR_COLORS[2] } });
  ref({ kind: 'wander', x: 44.0, y: 26.6, cx: 44.0, cy: 26.6, r: 1.7, speed: 1.8, scale: 0.79, look: { skin: SKIN_TONES[2], hair: 'buzz', hairCol: HAIR_COLORS[1] } });

  return list;
}

function campRegRoster() {
  const rand = mulberry32(0x0ff1);
  return [
    // 登记官：站在桌后，低头翻着纸
    npc(rand, {
      kind: 'officer', x: 2.45, y: 2.7, outfit: 'officer', scale: 1.05,
      aim: dirScreen(1, 0.25), face: 1,
      look: { skin: SKIN_TONES[0], hair: 'buzz', hairCol: HAIR_COLORS[1] },
    }),
    // 门口的卫兵
    npc(rand, {
      kind: 'stand', x: 7.6, y: 1.4, outfit: 'soldier', slung: true, scale: 1.04,
      aim: dirScreen(-0.7, -0.6), face: -1,
    }),
  ];
}

const ROSTERS = { camp: campRoster, campReg: campRegRoster };

export function makeNPCs(key) {
  const f = ROSTERS[key];
  return f ? f() : [];
}

/* ------------------------------------------------------------------ *
 * 更新
 * ------------------------------------------------------------------ */

/** 也给 main.js 的护送士兵用：朝目标走一步，顺带把朝向/步态填好 */
export function stepToward(n, tx, ty, dt) {
  const dx = tx - n.x;
  const dy = ty - n.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.08) return true;
  const s = Math.min(d, n.speed * dt);
  n.x += (dx / d) * s;
  n.y += (dy / d) * s;
  n.aim = dirScreen(dx / d, dy / d);
  n.face = n.aim.x >= 0 ? 1 : -1;
  n.moving = true;
  n.walk += dt * 4.6 * (n.speed / 1.1);
  return false;
}

export function updateNPCs(list, dt) {
  for (const n of list) {
    n.moving = false;
    if (n.kind === 'patrol') {
      if (n.waitT > 0) {
        n.waitT -= dt;
        continue;
      }
      const p = n.pts[n.i];
      if (stepToward(n, p[0], p[1], dt)) {
        n.i = (n.i + 1) % n.pts.length;
        n.waitT = 0.9 + ((n.seed * 7) % 1.6);
      }
    } else if (n.kind === 'wander') {
      if (n.tx === null) {
        n.idleT -= dt;
        if (n.idleT <= 0) {
          const a = Math.random() * Math.PI * 2;
          n.tx = n.cx + Math.cos(a) * n.r * (0.4 + Math.random() * 0.6);
          n.ty = n.cy + Math.sin(a) * n.r * (0.4 + Math.random() * 0.6) * 0.7;
        }
      } else if (stepToward(n, n.tx, n.ty, dt)) {
        n.tx = null;
        n.idleT = 1.2 + Math.random() * 3.5;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * 姿势与绘制参数
 * ------------------------------------------------------------------ */

/** idle 呼吸/小动作全部量化成整像素档，跟角色的定格动画一个语言 */
function poseFor(n, t) {
  const s = n.seed;
  if (n.kind === 'sit') {
    const bob = qz(Math.sin(t * 0.9 + s) * 0.8, 1);
    return {
      face: n.face, crouch: 7, sink: n.sink,
      legs: { a: -2, b: 2, la: 0, lb: 0 },
      arms: { far: { x: 2, y: -2 + bob }, near: { x: -2, y: -1 + bob } },
      headTilt: { x: 0, y: bob * 0.5 },
    };
  }
  if (n.kind === 'squat') {
    return {
      face: n.face, crouch: 9, sink: 1,
      legs: { a: -3, b: 3, la: 1, lb: 1 },
      arms: { far: { x: 3, y: 1 }, near: { x: -3, y: 2 } },
      headTilt: { x: 0, y: qz(Math.sin(t * 0.7 + s), 1) },
    };
  }
  if (n.kind === 'talk') {
    // 比划的手：三档跳，像在一顿一顿地说
    const gs = qz(Math.sin(t * 1.7 + s) * 2, 1);
    return {
      face: n.face,
      arms: { far: { x: 3 + gs, y: -8 - gs }, near: { x: -2, y: 6 } },
      headTilt: { x: n.face, y: qz(Math.sin(t * 1.1 + s) * 0.7, 1) },
    };
  }
  if (n.kind === 'cradle') {
    // 双臂环在胸前 + 轻轻摇：哄怀里的孩子
    return {
      face: n.face,
      lean: Math.sin(t * 0.8 + s) * 0.07,
      arms: { far: { x: 3, y: -4 }, near: { x: -3, y: -3 } },
      headTilt: { x: 0, y: 1 },
    };
  }
  if (n.kind === 'officer') {
    // 翻纸：手在桌面高度小幅挪动
    const sh = qz(Math.sin(t * 1.3 + s) * 1.5, 1);
    return {
      face: n.face,
      lean: 0.06,
      arms: { far: { x: 5 + sh, y: 2 }, near: { x: 3 - sh, y: 3 } },
      headTilt: { x: 1, y: 1 },
    };
  }
  if (n.kind === 'stand') {
    return {
      face: n.face,
      headTilt: { x: 0, y: qz(Math.sin(t * 0.5 + s) * 0.6, 1) },
    };
  }
  return null; // patrol / wander：普通走姿
}

/**
 * 组一份 drawCharacter 的参数。OUTFITS 由调用方传进来（main.js 用自己的
 * art 模块实例解析键名），这里只负责挑键与难民色表。
 */
export function npcDrawOpts(n, t, OUTFITS) {
  const fit = n.outfit === 'refugee' ? REFUGEE_OUTFITS[n.refIdx % REFUGEE_OUTFITS.length] : OUTFITS[n.outfit];
  return {
    aim: n.aim,
    walk: n.walk,
    moving: n.moving,
    outfit: fit,
    look: n.look,
    scale: n.scale,
    slung: n.slung,
    pose: poseFor(n, t + n.seed),
  };
}
