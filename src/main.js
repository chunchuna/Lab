import {
  VIEW_W, VIEW_H, HW, HH, TILE_W, TILE_Z, WALL_H, pixelScale, snap,
  PLAYER_R, PLAYER_SPEED, MAG_SIZE, START_SPARE_MAGS, RELOAD_TIME, FIRE_COOLDOWN,
} from './config.js';
import { toWorld, wallNorthPt, wallNorthTransform } from './iso.js';
import {
  DOOR, DOOR_SPOT, LOCKER_POS, LOCKER_SPOT, BED_POS, PLAYER_START, SCANNER,
  SPARK_SRC, SCREEN_SRC,
} from './level.js';
import { getArea, EXIT_SIGN, dropAreaCache } from './areas.js';
import { Horde, drawZombie } from './zombies.js';
import { computeVisibility, computeVisibilityCone, raycast, lineOfSight } from './visibility.js';
import { Lighting } from './lighting.js';
import { FX, Rain } from './fx.js';
import * as A from './art.js';
import * as UI from './ui.js';
import * as SFX from './audio.js';
import * as INV from './inventory.js';
import { inv } from './inventory.js';
import { initInput, keys, mouse, justPressed, endFrame, view } from './input.js';
import { initDevcon, toggleDevcon, closeDevcon, isDevconOpen } from './devcon.js';
import {
  pad, initControls, setButton, setPadVisible, endFrameControls, screenDirToWorld,
} from './controls.js';
import { clamp, flicker, lerp, makeCanvas, smoothstep, setBase, blit } from './util.js';

/* 世界直接画在 640N×360N 的像素网格上（4K 时 N=6 → 3840×2160）。
   逻辑坐标仍是 640×360，倍率折进基础变换。#game 的 backing store 就是这张
   网格，和设备像素 1:1，不再先画 640×360 再最近邻吹大。 */
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

let renderN = 0;
let gridReady = false;

function sizeCanvas() {
  const n = pixelScale();
  const w = VIEW_W * n;
  const h = VIEW_H * n;
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  ctx.imageSmoothingEnabled = false;
  return true;
}

function restoreAreaRuntime(a) {
  if (a.id !== 'lab' || !a.sprites) return;
  const p = a.props.find((q) => q.id === 'locker');
  if (!p) return;
  if (game.locker.looted) p.s = a.sprites.lockerEmpty;
  else if (game.locker.open) p.s = a.sprites.lockerOpen;
}

/** 窗口整数倍率变了：重做工作缓冲，按新 N 重画当前区域的精灵/静态层/光照。 */
function syncPixelGrid() {
  const n = pixelScale();
  sizeCanvas();
  if (n === renderN) return;
  const prev = renderN;
  renderN = n;
  if (!gridReady || prev === 0) return;
  lighting.rebuild();
  A.clearRingCache();
  const id = area.id;
  dropAreaCache();
  area = getArea(id);
  restoreAreaRuntime(area);
  ensureAreaLights(area);
}
sizeCanvas();
renderN = pixelScale();
window.addEventListener('resize', () => {
  syncPixelGrid();
});

function present() {
  /* 已经画在 #game 上，和设备像素 1:1，没有第二级放大。 */
}

const stage = document.getElementById('stage');

const lighting = new Lighting();
const AMBIENT_DEFAULT = lighting.ambient;
const fx = new FX();
const rain = new Rain();
const horde = new Horde();

const BED_TOP = 0.86;
const PLAYER_HP = 4;

let area = getArea('lab');

const game = {
  t: 0,
  state: 'title', // title | wake | play | scan | dead | cine | end
  phase: 0,
  shake: 0,
  flash: 0,
  fade: 1,
  hurtFlash: 0,
  player: { x: BED_POS.x, y: BED_POS.y, aim: 0.9, walk: 0, moving: false, stepT: 0, hp: PLAYER_HP, invuln: 0 },
  /** 真实视线遮挡（看不到视野外/被遮挡的区域）。代码保留，默认关闭，V 键切换 */
  losOcclusion: false,
  bagOpen: false,
  gun: { mag: MAG_SIZE, reload: 0, cool: 0, recoil: 0, clicks: 0 },
  locker: { open: false, looted: false },
  door: { tried: false, hits: 0, broken: false },
  nextSpark: 1.2,
  sparkPower: 0,
  lastPrompt: '',
  areaT: 0, // 进入当前区域后的时间，用来驱动定时事件
  hordeReleased: false,
  doomed: 0,
  /** 对讲机剧情：进 312 自动呼叫，玩家应答后才播完整段 */
  radio: { phase: 'idle', step: 0, t: 0, done: false },
  /** 死了从哪重来：一层剧情杀回楼梯间，天台 QTE 失败回 312 重听对讲机 */
  checkpoint: 'stair',
  /** 天台流程：arrive → fight → clear → heli → rope → cine → done */
  roofPhase: 'arrive',
  roofT: 0,
  roofDoorLocked: false,
  tentZ: null,
  rope: null,
  heli: null,
  storm: null,
  qte: null,
  // 近景 QTE 用的整帧变焦。1 = 正常
  zoom: 1,
  zoomTarget: 1,
  zoomSpeed: 3.4,
  /** 变焦焦点（世界坐标）。zoomAt 是目标，zoomAtCur 是缓动后的实际焦点 —— 摇移靠它 */
  zoomAt: null,
  zoomAtCur: null,
  panSpeed: 2.4,
  /**
   * 时间缩放。QTE 的慢动作靠它：世界按 dt * timescale 推进，
   * 而镜头、UI 与 QTE 的反应窗口一律按真实秒（game.rdt）走 ——
   * 否则慢动作会顺带把限时窗口也拉长，难度变成随机的。
   */
  timescale: 1,
  tsTarget: 1,
  rdt: 0, // 本帧的真实秒
  rt: 0, // 累计真实秒，只给镜头漂移这类"不该被慢动作拖慢"的东西用
};

/**
 * 每个区域的静态光源与裁剪遮罩在首次进入时烘焙，之后缓存在区域上。
 * 贴图是按区域包围盒生成的，画的时候按相机偏移。
 */
function ensureAreaLights(a) {
  if (a.lit) return;
  for (const L of a.lights) {
    L.vis = computeVisibility(L.x, L.y, a.segments);
    L.tex = lighting.bakeLight({ x: L.x, y: L.y, r: L.r, color: L.color, vis: L.vis, cam: a.cam });
  }
  a.mask = lighting.bakeMask(a.roomVis, a.cam);
  /* 露天区域（天台）的天空光：一张只覆盖"房间轮廓以外"的光照贴图。
     没有它的话，屋面以外一律被 area.dark 压成纯黑，远景层等于白画。
     跟静态灯一样是烘焙的，每帧只做一次 drawImage。 */
  if (a.skyPaint) {
    const t = makeCanvas(VIEW_W, VIEW_H);
    a.skyPaint(t.g);
    t.g.globalCompositeOperation = 'destination-out';
    blit(t.g, a.mask, 0, 0); // 抠掉屋面，天空光不该打亮脚下的地
    t.g.globalCompositeOperation = 'source-over';
    a.skyLight = t.c;
  }
  a.lit = true;
}
ensureAreaLights(area);
gridReady = true;

/* ------------------------------------------------------------------ *
 * 输入
 * ------------------------------------------------------------------ */

initInput(stage, (k) => {
  SFX.initAudio();
  SFX.resume();

  if (k === '`') {
    toggleDevcon();
    keys.clear();
    return;
  }
  if (isDevconOpen()) {
    if (k === 'escape') closeDevcon();
    return;
  }

  if (game.state === 'title') {
    startWake();
    return;
  }
  if (game.state !== 'play') return;

  // QTE 期间键盘只喂给 QTE，别顺手开背包 / 换弹把节奏打断
  if (game.qte) {
    qteKey(k);
    return;
  }

  if (k === 'i' || k === 'b' || k === 'tab') toggleBag();
  else if (k === 'escape' && game.bagOpen) toggleBag();
  else if (k === 'v') toggleLOS();
  else if (k === 'h') UI.toggleHelp();
  else if (game.bagOpen) {
    if (k === '1') equipToggle('flashlight');
    else if (k === '2') equipToggle('pistol');
    else if (k === 'f') doToggleFlash();
  } else if (k === 'e') tryInteract();
  else if (k === '1') equipToggle('flashlight');
  else if (k === '2') equipToggle('pistol');
  else if (k === 'f') doToggleFlash();
  else if (k === 'r') startReload();
});

/** 触屏按钮与键盘走同一套逻辑 */
function doAction(act) {
  SFX.initAudio();
  SFX.resume();
  if (game.state === 'title') {
    startWake();
    return;
  }
  if (game.state !== 'play') return;
  if (game.qte) return;
  if (act === 'bag') toggleBag();
  else if (game.bagOpen) return;
  else if (act === 'interact') tryInteract();
  else if (act === 'reload') startReload();
  else if (act === 'flash') doToggleFlash();
}

/* 左右手互换的快捷键已移除：实际用处不大，背包里把物品拖到另一只手即可。 */

/* ------------------------------------------------------------------ *
 * 区域切换
 * ------------------------------------------------------------------ */

/**
 * 换区域走一次淡入淡出：先黑下去，全黑那一刻才真正切换，再亮起来。
 * 直接硬切会让玩家分不清自己是否真的换了地方。
 */
const TRANS_OUT = 0.3;
const TRANS_IN = 0.42;

function startTransition(to, spawn) {
  if (game.trans) return;
  game.trans = { to, spawn, t: 0, phase: 'out' };
  UI.setPrompt(null);
  game.lastPrompt = '';
  SFX.sfxClick();
}

function updateTransition(dt) {
  const tr = game.trans;
  if (!tr) return;
  tr.t += dt;
  if (tr.phase === 'out' && tr.t >= TRANS_OUT) {
    enterArea(tr.to, tr.spawn);
    tr.phase = 'in';
    tr.t = 0;
  } else if (tr.phase === 'in' && tr.t >= TRANS_IN) {
    game.trans = null;
  }
}

/** 过渡遮罩的不透明度 */
function transAlpha() {
  const tr = game.trans;
  if (!tr) return 0;
  return tr.phase === 'out'
    ? Math.min(1, tr.t / TRANS_OUT)
    : Math.max(0, 1 - tr.t / TRANS_IN);
}

function enterArea(id, spawnName) {
  area = getArea(id);
  ensureAreaLights(area);
  const sp = area.spawns[spawnName] || area.spawns.start || { x: area.w / 2, y: area.h / 2 };
  game.player.x = sp.x;
  game.player.y = sp.y;
  game.player.z = groundZ(sp.x, sp.y); // 别把上一个区域的高度带过来
  game.areaT = 0;
  game.hordeReleased = false;
  game.doomed = 0;
  game.lastPrompt = '';
  game.interact = null;
  UI.setPrompt(null);
  fx.decals.length = 0;
  fx.bullets.length = 0;
  horde.clear();
  endQTE();
  game.zoom = 1;
  game.zoomTarget = 1;
  game.zoomAt = null;
  game.zoomAtCur = null;
  game.zoomSpeed = 3.4;
  game.timescale = 1;
  game.tsTarget = 1;
  game.tentZ = null;
  game.fight = null;
  game.ropeAnim = null;
  game.rope = null;
  game.heli = null;
  game.cine = null;
  game.roofSaidHint = false;
  game.player.shrink = 0;
  game.player.nudge = null;
  game.player.hidden = false;

  // 对讲机：进 312 且剧情没走完就自动呼叫；走开就别再喊了。
  // 注意别每次进 312 都把进度打回起点，只有天台失败重生才重置（见 respawn）。
  if (id === 'dorm312') {
    if (!game.radio.done) startRadioCall();
  } else if (game.radio.phase === 'call' || game.radio.phase === 'talk') {
    game.radio.phase = 'idle';
  }

  if (id === 'roof') {
    game.checkpoint = 'radio312';
    game.roofPhase = 'arrive';
    game.roofT = 0;
    game.roofDoorLocked = false;
    startStorm();
  } else {
    if (id !== 'stairRoof') game.checkpoint = 'stair';
    stopStorm();
  }

  UI.msg(area.name, 'good');
  SFX.sfxThud();
  /* 换区不再抖屏。之前这里会 game.shake = 1.6，而抖动偏移在渲染里是浮点：
     静态层/道具各自 Math.round，烘焙光用未取整的偏移，几层各进各的整数格，
     看起来就是"某些物件在抖"。抖屏只留给枪声、受伤、门坏、闪电。 */
}

function startWake() {
  UI.hideTitle();
  game.state = 'wake';
  game.phase = 0;
  SFX.sfxBeep(180, 0.4, 0.05);
}

function toggleBag() {
  game.bagOpen = !game.bagOpen;
  INV.setOpen(game.bagOpen);
  UI.setPrompt(null);
  game.lastPrompt = '';
  setPadVisible(!game.bagOpen);
  SFX.sfxClick();
}

function toggleLOS() {
  game.losOcclusion = !game.losOcclusion;
  UI.setLosState(game.losOcclusion);
  SFX.sfxClick();
  UI.msg(game.losOcclusion ? '真实视线遮挡：开启（只能看见视野内的区域）' : '真实视线遮挡：关闭');
}

/* ------------------------------------------------------------------ *
 * 装备
 * ------------------------------------------------------------------ */

function handOf(it) {
  return INV.equipped(it);
}
function equipToggle(item) {
  if (!INV.has(item)) {
    UI.msg('你还没有找到' + INV.ITEMS[item].name + '。');
    SFX.sfxClick();
    return;
  }
  const r = INV.quickEquip(item);
  SFX.sfxClick();
  if (r === 'full') UI.msg('背包已满。', 'warn');
}
function doToggleFlash() {
  if (!INV.has('flashlight')) return;
  INV.toggleFlash();
  SFX.sfxClick();
}
function syncHUD() {
  UI.updateHands({ left: INV.handItem('left'), right: INV.handItem('right'), flashOn: inv.flashOn });
  const g = game.gun;
  UI.updateAmmo(
    {
      mag: g.mag,
      spare: INV.countItem('mag'),
      reload: g.reload,
      reloadProgress: 1 - g.reload / RELOAD_TIME,
    },
    handOf('pistol') !== null,
  );
  UI.setCursor(handOf('pistol') ? 'cross' : 'dot');
}
INV.onInvChange(syncHUD);

/* ------------------------------------------------------------------ *
 * 互动
 * ------------------------------------------------------------------ */

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

/** 按当前装备情况显示/隐藏触屏按钮，避免屏幕被无用按钮占满 */
const padState = {};
function syncPadButtons() {
  const gun = !!handOf('pistol');
  const flash = INV.has('flashlight');
  if (padState.fire !== gun) {
    padState.fire = gun;
    setButton('fire', gun);
    setButton('reload', gun);
  }
  if (padState.flash !== flash) {
    padState.flash = flash;
    setButton('flash', flash);
  }
}

function currentInteract() {
  const p = game.player;
  // 区域通道（门、楼梯）
  for (const lk of area.links) {
    if (lk.needsDoorOpen && !game.door.broken) continue;
    if (dist(p.x, p.y, lk.x, lk.y) > lk.r) continue;
    // 天台楼梯的门：对讲机剧情走完前锁着，只给提示不给按键
    if (lk.needsRadio && !game.radio.done) {
      return { id: 'locked', hint: true, text: lk.lockedText || '这扇门锁着', anchor: lk.anchor };
    }
    return { id: 'link', link: lk, text: lk.text, short: lk.short, anchor: lk.anchor, target: lk.target };
  }
  // 纯提示（楼梯这类走过去就触发的，不需要按键）
  if (area.hints) {
    for (const h of area.hints) {
      if (dist(p.x, p.y, h.x, h.y) < h.r) {
        return { id: 'hint', hint: true, text: h.text, anchor: h.anchor };
      }
    }
  }
  if (area.id !== 'lab') {
    if (area.radio && dist(p.x, p.y, area.radio.x, area.radio.y + 0.9) < 1.5 && game.radio.phase === 'call') {
      return {
        id: 'radio',
        text: '拿起对讲机回话',
        short: '回话',
        target: 'desk',
        anchor: { x: area.radio.x, y: area.radio.y, z: 1.5 },
      };
    }
    if (area.roof) return roofInteract(p);
    return null;
  }

  if (dist(p.x, p.y, DOOR_SPOT.x, DOOR_SPOT.y) < 1.9) {
    if (game.door.broken) {
      return {
        id: 'doorOpen',
        text: '走出实验室',
        short: '出去',
        target: 'door',
        anchor: { x: DOOR_SPOT.x, y: 0.1, z: 2.55 },
      };
    }
    return {
      id: 'door',
      text: game.door.tried ? '再次尝试人脸识别' : '使用人脸识别面板',
      short: '识别',
      target: 'door',
      anchor: { x: DOOR_SPOT.x, y: 0.1, z: 2.55 },
    };
  }
  if (dist(p.x, p.y, LOCKER_SPOT.x, LOCKER_SPOT.y) < 1.7) {
    const anchor = { x: LOCKER_POS.x, y: LOCKER_POS.y, z: 2.5 };
    if (!game.locker.open) return { id: 'locker', text: '打开应急储物柜', short: '开柜', target: 'locker', anchor };
    if (!game.locker.looted) return { id: 'loot', text: '取出柜内物品', short: '拿取', target: 'locker', anchor };
    return { id: 'lockerEmpty', text: '储物柜已空', short: '空柜', target: 'locker', anchor };
  }
  if (dist(p.x, p.y, BED_POS.x, BED_POS.y + 1.1) < 1.5) {
    return {
      id: 'bed',
      text: '查看实验床',
      short: '查看',
      target: 'bed',
      anchor: { x: BED_POS.x, y: BED_POS.y, z: 1.35 },
    };
  }
  return null;
}

/** 天台上的三个互动点：楼梯小屋的门、帐篷、绳索 */
function roofInteract(p) {
  const r = area.roof;
  // 门开在小屋的 +x 面上，提示挂在门头，不再挂到区域边界那条线上
  const doorAnchor = { x: 1.25, y: r.door.y, z: 2.1 };
  if (dist(p.x, p.y, r.door.x, r.door.y) < 1.9) {
    if (!game.roofDoorLocked) {
      return { id: 'lockRoofDoor', text: '把楼道门锁死', short: '锁门', anchor: doorAnchor };
    }
    return { id: 'roofDoorLocked', hint: true, text: '门已经从里面锁死了', anchor: doorAnchor };
  }
  if (game.roofPhase === 'arrive' && dist(p.x, p.y, r.tent.x + 0.5, r.tent.y + 0.4) < 1.8) {
    return {
      id: 'tent',
      text: '掀开帐篷',
      short: '帐篷',
      target: 'tent',
      anchor: { x: r.tent.x, y: r.tent.y, z: 1.6 },
    };
  }
  /* 抓绳的触发范围放宽到 3.4：第一拍本来就是"助跑"，玩家不需要先精确
     站到绳子正下方；那样反而会把冲刺那一拍的空间走没了。 */
  if (game.roofPhase === 'rope' && game.rope && game.rope.down && dist(p.x, p.y, r.rope.x, r.rope.y + 1.6) < 3.4) {
    return { id: 'rope', text: '冲过去抓绳索', short: '冲刺', anchor: { x: r.rope.x, y: r.rope.y, z: 2.4 } };
  }
  return null;
}

function tryInteract() {
  const it = currentInteract();
  if (!it || it.hint) return;
  if (it.id === 'link') {
    startTransition(it.link.to, it.link.spawn);
    return;
  }
  if (it.id === 'radio') {
    answerRadio();
    return;
  }
  if (it.id === 'lockRoofDoor') {
    lockRoofDoor();
    return;
  }
  if (it.id === 'tent') {
    openTent();
    return;
  }
  if (it.id === 'rope') {
    startRopeQTE();
    return;
  }
  if (it.id === 'doorOpen') {
    startTransition('corr2', 'fromLab');
    return;
  }
  if (it.id === 'door') {
    game.state = 'scan';
    game.door.tried = true;
    SFX.sfxBeep(1400, 0.06, 0.12);
    UI.setPrompt(null);
    setPadVisible(false);
    UI.startScan(() => {
      game.state = 'play';
      setPadVisible(true);
      UI.msg('门打不开……在房间里找找别的办法。', 'warn');
      SFX.sfxThud();
      game.shake = 2.5;
    });
  } else if (it.id === 'locker') {
    game.locker.open = true;
    const p = area.props.find((q) => q.id === 'locker');
    p.s = area.sprites.lockerOpen;
    SFX.sfxServo(false);
    SFX.sfxThud();
    fx.dust(LOCKER_SPOT.x - 0.6, LOCKER_SPOT.y, 0.4, 6);
  } else if (it.id === 'loot') {
    game.locker.looted = true;
    const p = area.props.find((q) => q.id === 'locker');
    p.s = area.sprites.lockerEmpty;
    INV.addItem('flashlight');
    INV.addItem('pistol');
    INV.addItem('mag', START_SPARE_MAGS);
    SFX.sfxPickup();
    UI.msg('打开背包（I），把手电筒和手枪拖到左右手。');
    setTimeout(() => {
      if (game.state === 'play' && !game.bagOpen) toggleBag();
    }, 700);
  } else if (it.id === 'bed') {
    if (!game.gotBadge) {
      game.gotBadge = true;
      INV.addItem('badge');
      SFX.sfxPickup();
    } else {
    }
  }
}

/* ------------------------------------------------------------------ *
 * 枪械
 * ------------------------------------------------------------------ */

function startReload() {
  const g = game.gun;
  if (!handOf('pistol')) return;
  if (g.reload > 0) return;
  if (g.mag >= MAG_SIZE) {
    return;
  }
  if (INV.countItem('mag') <= 0) {
    UI.msg('背包里没有备用弹匣了。', 'warn');
    SFX.sfxDryFire();
    return;
  }
  g.reload = RELOAD_TIME;
  g.clicks = 0;
  SFX.sfxReload(0);
}

function fire() {
  const g = game.gun;
  const p = game.player;
  if (!handOf('pistol') || g.reload > 0 || g.cool > 0) return;
  if (g.mag <= 0) {
    SFX.sfxDryFire();
    g.cool = 0.3;
    return;
  }
  g.mag--;
  g.cool = FIRE_COOLDOWN;
  g.recoil = 1;
  game.shake = 3.2;
  game.flash = 0.075;
  SFX.sfxShot();

  const a = p.aim + (Math.random() - 0.5) * 0.045;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const mx = p.x + dx * 0.55;
  const my = p.y + dy * 0.55;
  const hit = raycast(mx, my, dx, dy, area.segments, 40);

  fx.smoke(mx, my, 1.05, 4);
  fx.casing(p.x, p.y, 1.0, a);

  // 先看有没有打中丧尸（比墙更近才算）
  const zh = horde.hitScan(mx, my, dx, dy, hit.dist);
  if (zh) {
    const z = zh.z;
    const zx = mx + dx * zh.t;
    const zy = my + dy * zh.t;
    fx.tracer(mx, my, 1.05, zx, zy, 1.05);
    fx.spark(zx, zy, 1.1, 5, 0.5);
    for (let i = 0; i < 8; i++) fx.debris(zx, zy, 1.0, 1, '#5a1f1c');
    SFX.sfxImpact(false);
    if (horde.damage(z, 1)) {
      SFX.sfxThud();
      fx.decal(zx, zy, 0.02, 'floor');
    }
    return;
  }

  fx.tracer(mx, my, 1.05, hit.x, hit.y, 1.05);
  const seg = hit.seg;
  const isWall = seg && seg.id === 'wall';
  fx.spark(hit.x - dx * 0.05, hit.y - dy * 0.05, 1.05, 9, 1);
  fx.debris(hit.x - dx * 0.05, hit.y - dy * 0.05, 1.05, 4, isWall ? '#6b7370' : '#8d9694');
  fx.decal(hit.x - dx * 0.02, hit.y - dy * 0.02, 1.05, 'wall');
  SFX.sfxImpact(true);

  // 打门：互动过门禁之后，三枪可以把门和门禁一起打坏
  if (area.id === 'lab' && isWall && Math.abs(hit.y) < 0.06) {
    const dxTile = hit.x * TILE_W;
    const onDoor = dxTile > DOOR.u0 - 8 && dxTile < DOOR.u1 + 24;
    if (onDoor) shootDoor();
  }
}

function shootDoor() {
  const d = game.door;
  if (d.broken) return;
  if (!d.tried) {
    // 还没试过门禁，玩家不该知道要打门
    if (!d.hinted) {
      d.hinted = true;
      }
    return;
  }
  d.hits++;
  game.shake = 5.5;
  SFX.sfxImpact(true);
  fx.spark(DOOR.cx / TILE_W, 0.05, 1.4, 16, 1.2);
  if (d.hits < 3) {
    SFX.sfxError();
  } else {
    d.broken = true;
    d.hits = 3;
    game.shake = 9;
    SFX.sfxThud();
    SFX.sfxServo(false);
    fx.spark(DOOR.cx / TILE_W, 0.05, 1.2, 34, 1.6);
    fx.dust(DOOR.cx / TILE_W, 0.6, 0.4, 12);
    UI.msg('门锁被打坏了。出去看看走廊。');
  }
}

/* ------------------------------------------------------------------ *
 * 移动与碰撞
 * ------------------------------------------------------------------ */

function blocked(x, y, r = PLAYER_R) {
  if (x - r < 0.08 || x + r > area.w - 0.08 || y - r < 0.08 || y + r > area.h - 0.08) return true;
  for (const c of area.colliders) {
    if (x + r > c.x0 && x - r < c.x1 && y + r > c.y0 && y - r < c.y1) return true;
  }
  return false;
}

/**
 * 从 (x, y) 起向外找最近的可站点。`blocked()` 是绝对判定，一旦角色被摆进
 * 碰撞体内部，任何方向的试探都会被拒绝，玩家就再也走不动了 —— 所以需要一条
 * 单向的"出去"通道。
 */
function nudgeFree(x, y) {
  if (!blocked(x, y)) return { x, y };
  for (let step = 0.1; step <= 3; step += 0.1) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const nx = x + Math.cos(a) * step;
      const ny = y + Math.sin(a) * step;
      if (!blocked(nx, ny)) return { x: nx, y: ny };
    }
  }
  return { x, y };
}

/** 沿 (dx, dy) 从 (x, y) 出发，最远能走多少而不撞上东西（上限 want） */
function freeRun(x, y, dx, dy, want) {
  let d = 0;
  for (let t = 0.08; t <= want + 1e-6; t += 0.08) {
    if (blocked(x + dx * t, y + dy * t)) return d;
    d = t;
  }
  return want;
}

/** 统一移动意图：摇杆给屏幕方向，键盘给世界轴向 */
function moveIntent() {
  if (pad.enabled && pad.move.mag > 0.1) {
    const w = screenDirToWorld(pad.move.x, pad.move.y);
    return { x: w.x, y: w.y, mag: Math.min(1, (pad.move.mag - 0.1) / 0.75) };
  }
  let ix = 0;
  let iy = 0;
  if (keys.has('w') || keys.has('arrowup')) {
    ix -= 1;
    iy -= 1;
  }
  if (keys.has('s') || keys.has('arrowdown')) {
    ix += 1;
    iy += 1;
  }
  if (keys.has('a') || keys.has('arrowleft')) {
    ix -= 1;
    iy += 1;
  }
  if (keys.has('d') || keys.has('arrowright')) {
    ix += 1;
    iy -= 1;
  }
  const len = Math.hypot(ix, iy);
  if (!len) return { x: 0, y: 0, mag: 0 };
  return { x: ix / len, y: iy / len, mag: 1 };
}

/** 玩家脚下的高度（楼梯用高度场，不用碰撞体，这样才能真的走上去） */
function groundZ(x, y) {
  if (!area.ramps) return 0;
  for (const r of area.ramps) {
    if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
    const k = clamp((y - r.hi.y) / (r.lo.y - r.hi.y), 0, 1);
    return lerp(r.hi.z, r.lo.z, k);
  }
  return 0;
}

/** 走进梯段两端就换层 */
function checkTriggers() {
  if (!area.triggers || game.trans) return;
  const p = game.player;
  const z = p.z || 0;
  for (const t of area.triggers) {
    const byZ = (t.zAbove !== undefined && z >= t.zAbove) || (t.zBelow !== undefined && z <= t.zBelow);
    const byBox =
      t.x0 !== undefined && p.x >= t.x0 && p.x <= t.x1 && p.y >= t.y0 && p.y <= t.y1;
    if (byZ || byBox) {
      startTransition(t.to, t.spawn);
      return;
    }
  }
}

function movePlayer(dt) {
  const p = game.player;
  /* 兜底解卡：QTE / 过场的动画器是直接赋值坐标的，不走碰撞。只要有一帧把人
     落在碰撞体里，下面的每一次试探都会返回 blocked，WASD 就彻底失效。发现
     嵌在几何体里就先推出去，再照常处理这一帧的移动。 */
  if (blocked(p.x, p.y)) {
    const free = nudgeFree(p.x, p.y);
    p.x = free.x;
    p.y = free.y;
  }
  const mv = moveIntent();
  p.moving = mv.mag > 0.02;
  // 高度与触发区每帧都要更新：只在移动时更新的话，站在楼梯上不动
  // 或者被传送到别处时高度会残留成上一次的值。
  p.z = groundZ(p.x, p.y);
  checkTriggers();
  if (!p.moving) {
    p.walk = lerp(p.walk, 0, Math.min(1, dt * 10));
    return;
  }
  let spd = PLAYER_SPEED * mv.mag;
  if (game.gun.reload > 0) spd *= 0.72;
  const dx = mv.x * spd * dt;
  const dy = mv.y * spd * dt;
  if (!blocked(p.x + dx, p.y)) p.x += dx;
  else if (!blocked(p.x + dx * 0.35, p.y)) p.x += dx * 0.35;
  if (!blocked(p.x, p.y + dy)) p.y += dy;
  else if (!blocked(p.x, p.y + dy * 0.35)) p.y += dy * 0.35;

  p.walk += dt * 5.4 * (0.5 + mv.mag * 0.5);
  p.stepT -= dt * mv.mag;
  if (p.stepT <= 0) {
    p.stepT = 0.42;
    SFX.sfxStep();
    if (Math.random() > 0.6) fx.dust(p.x, p.y, 0.02, 1);
  }
}

/* ------------------------------------------------------------------ *
 * 更新
 * ------------------------------------------------------------------ */

/**
 * 鼠标所指的屏幕点要反投影成世界坐标才能得到瞄准角，而反投影必须假定一个高度。
 * 假定地面（z=0）的话，玩家把准星压在丧尸身体上时，反投影出来的地面点会落到
 * 目标后方一大截 —— 实测瞄躯干偏 0.98 格、瞄头部偏 1.88 格，而命中阈值只有
 * 0.36 格，等于瞄着身体永远打不中。所以按"胸部平面"反投影。
 */
const AIM_Z = 0.85; // 高度单位，约等于角色躯干中心

function updateAim() {
  const p = game.player;
  if (pad.enabled) {
    // 右摇杆给的是屏幕方向，转成世界角度
    const w = screenDirToWorld(pad.aim.x, pad.aim.y);
    p.aim = Math.atan2(w.y, w.x);
  } else {
    const w = toWorld(mouse.x - area.cam.x, mouse.y - area.cam.y + AIM_Z * TILE_Z);
    p.aim = Math.atan2(w.y - p.y, w.x - p.x);
    // 吸附：光标压在某只丧尸的身体上时直接瞄准它。等距下屏幕纵向 1 像素
    // 对应世界里很大一段距离，只靠反投影的话瞄头或瞄脚都会打空。
    const snap = snapTarget();
    if (snap) p.aim = Math.atan2(snap.y - p.y, snap.x - p.x);
  }
  p.aimScreen = normScreenDir(p.aim);
}

/** 找光标屏幕位置附近的丧尸，返回它的世界坐标 */
function snapTarget() {
  const cam = area.cam;
  let best = null;
  let bestD = 18; // 像素：从脚底到头顶整个身体都能吸附
  for (const z of horde.list) {
    if (z.dead) continue;
    const sx = cam.x + (z.x - z.y) * HW;
    const sy = cam.y + (z.x + z.y) * HH - 15; // 躯干中心
    const d = Math.hypot(mouse.x - sx, mouse.y - sy);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}

function normScreenDir(a) {
  const x = (Math.cos(a) - Math.sin(a)) * HW;
  const y = (Math.cos(a) + Math.sin(a)) * HH;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

/**
 * 变焦与焦点缓动。全部按**真实秒**推进：慢动作时镜头照样正常速度推近、
 * 摇移，画面才像运镜，而不是整个世界一起变慢的录像回放。
 */
function updateCamera() {
  const rdt = game.rdt;
  game.zoom = lerp(game.zoom, game.zoomTarget, Math.min(1, rdt * game.zoomSpeed));
  if (!game.zoomAt) {
    game.zoomAtCur = null;
    return;
  }
  if (!game.zoomAtCur) {
    game.zoomAtCur = { x: game.zoomAt.x, y: game.zoomAt.y, z: game.zoomAt.z || 0 };
    return;
  }
  const k = Math.min(1, rdt * game.panSpeed);
  game.zoomAtCur.x = lerp(game.zoomAtCur.x, game.zoomAt.x, k);
  game.zoomAtCur.y = lerp(game.zoomAtCur.y, game.zoomAt.y, k);
  game.zoomAtCur.z = lerp(game.zoomAtCur.z, game.zoomAt.z || 0, k);
}

function update(dt) {
  game.t += dt;
  fx.update(dt);
  game.shake *= Math.pow(0.0015, dt);
  game.flash = Math.max(0, game.flash - dt);
  game.gun.recoil = Math.max(0, game.gun.recoil - dt * 6);

  game.hurtFlash = Math.max(0, game.hurtFlash - dt * 2.2);
  game.player.invuln = Math.max(0, game.player.invuln - dt);
  updateCamera();
  updateStorm(dt);

  // 实验室墙面破损处的电火花
  game.sparkPower = Math.max(0, game.sparkPower - dt * 3.4);
  if (area.id === 'lab') {
    game.nextSpark -= dt;
    if (game.nextSpark <= 0 && game.state !== 'title') {
      game.nextSpark = 0.9 + Math.random() * 3.2;
      game.sparkPower = 0.9 + Math.random() * 0.5;
      fx.spark(SPARK_SRC.x, SPARK_SRC.y, SPARK_SRC.z, 10 + Math.random() * 8, 0.7);
      SFX.sfxSpark();
    }
  }

  if (game.state === 'title') return;
  if (game.state === 'end') return;

  if (game.state === 'cine') {
    updateCine(dt);
    horde.update(dt, game.player, blocked, area);
    return;
  }

  if (game.state === 'dead') {
    game.phase += dt;
    // 死亡后丧尸继续扑上来，让"被淹没"这件事在画面上真的发生
    horde.update(dt, game.player, blocked, area);
    if (game.phase > 3.6) respawn();
    return;
  }

  // 过渡期间冻结玩家，避免在黑屏里乱走
  updateTransition(dt);
  if (game.trans) {
    game.player.moving = false;
    game.player.walk = lerp(game.player.walk, 0, Math.min(1, dt * 10));
    horde.update(dt, game.player, blocked, area);
    return;
  }

  if (game.state === 'wake') {
    game.phase += dt;
    game.fade = clamp(1 - (game.phase - 0.2) / 1.1, 0, 1);
    if (game.phase > 2.52 && game.phase < 2.58) SFX.sfxStep();
    if (game.phase > 3.05 && game.phase < 3.11) SFX.sfxStep();
    if (game.phase > WAKE.done) {
      game.state = 'play';
      game.player.x = PLAYER_START.x;
      game.player.y = PLAYER_START.y;
      UI.msg('我在这里睡了多久……');
      setTimeout(() => UI.msg('外面发生了什么……'), 2800);
    }
    return;
  }

  if (game.state === 'scan') {
    UI.updateScan(dt);
    return;
  }

  if (game.bagOpen || isDevconOpen()) {
    game.player.moving = false;
    game.player.walk = lerp(game.player.walk, 0, Math.min(1, dt * 10));
    return;
  }

  /* QTE：锁移动与开火。位置与姿态全部由分拍动画器接管（见 setFightAnim /
     setRopeAnim），所以搏斗段落不再跑 horde 的自动寻路 —— 让 AI 和运镜
     同时去改同一只丧尸的坐标，画面只会打架。 */
  if (game.qte) {
    const p = game.player;
    p.moving = false;
    if (game.qte.id === 'fight') {
      // 扭打期间被咬不掉血：胜负由 QTE 决定，不是靠 HP
      p.invuln = Math.max(p.invuln, 0.5);
    } else {
      horde.update(dt, p, blocked, area);
    }
    updateQTE();
    return;
  }

  updateAim();
  movePlayer(dt);
  updateAreaEvents(dt);
  horde.update(dt, game.player, blocked, area);

  const g = game.gun;
  g.cool = Math.max(0, g.cool - dt);
  if (g.reload > 0) {
    const before = g.reload;
    g.reload -= dt;
    const ticks = [RELOAD_TIME * 0.62, RELOAD_TIME * 0.22];
    for (let i = 0; i < ticks.length; i++) {
      if (before > ticks[i] && g.reload <= ticks[i]) SFX.sfxReload(i + 1);
    }
    if (g.reload <= 0) {
      g.reload = 0;
      g.mag = MAG_SIZE;
      INV.consumeItem('mag', 1);
      SFX.sfxReload(2);
    }
    syncHUD();
  }

  if ((mouse.down || pad.firing) && handOf('pistol')) fire();

  // 互动提示：键鼠把提示摆到物体上，触屏用上下文按钮
  const it = currentInteract();
  game.interact = it;
  const text = it ? it.text : '';
  if (text !== game.lastPrompt) {
    game.lastPrompt = text;
    if (pad.enabled) setButton('interact', !!text && !it.hint, it ? it.short || '互动' : '互动');
    else UI.setPrompt(text || null, it && it.hint);
  }
  if (pad.enabled) syncPadButtons();

  if (g.reload > 0 || game.t % 0.25 < dt) syncHUD();
}

/* ------------------------------------------------------------------ *
 * 区域定时事件：丧尸涌入、一层的剧情杀、对讲机
 * ------------------------------------------------------------------ */

horde.onBite = () => {
  const p = game.player;
  if (p.invuln > 0 || game.state !== 'play') return;
  p.hp--;
  p.invuln = 0.85;
  game.hurtFlash = 1;
  game.shake = 4.5;
  SFX.sfxImpact(false);
  fx.debris(p.x, p.y, 1.0, 6, '#5a1f1c');
  if (p.hp <= 0) die();
};

function updateAreaEvents(dt) {
  game.areaT += dt;

  // 二层：到达约 10 秒后从右端涌出丧尸
  if (area.horde && !game.hordeReleased && game.areaT > area.horde.delay) {
    game.hordeReleased = true;
    horde.release(area.horde.count, { x: area.horde.x, y: area.horde.y }, 0.38);
    UI.msg('往楼梯间退，边退边打！', 'warn');
    SFX.sfxError();
    game.shake = 3;
  }

  // 一层：尸潮翻越堵路的杂物涌过来，被围住才死，不是到点直接判死
  if (area.doom && !game.doomed && game.areaT > area.doom.delay) {
    game.doomed = 1;
    horde.release(22, area.doom.from, 0.1, { climb: true, fast: true });
    SFX.sfxError();
    game.shake = 6;
  }
  if (area.doom && game.doomed === 1) {
    const p = game.player;
    game.swarm = horde.crowdedAt(p.x, p.y, 1.15);
    if (game.swarm >= 3) {
      game.doomed = 2;
      die();
    }
  }

  updateRadio(dt);
  if (area.roof) updateRoof(dt);
}

/* ------------------------------------------------------------------ *
 * 312 的对讲机
 *
 * 三个阶段：进屋自动呼喊（循环，等玩家应答）→ 玩家按 E 回话 → 对方交代
 * 天台 / 直升机 → done。done 之后再进 312 不重播，只留一盏慢闪的指示灯。
 * ------------------------------------------------------------------ */

/** 没人应答时循环喊的那几句 */
const RADIO_CALL = [
  { t: '……沙沙……有谁在这个房间里面吗？', d: 4.4 },
  { t: '……听得见就回一声。随便说句什么都行……', d: 4.8 },
  { t: '……沙沙……还有活着的人吗……', d: 4.6 },
];

/** 玩家应答之后的完整对话 */
const RADIO_TALK = [
  { t: '（我拿起对讲机）我在。我是从二层上来的。', d: 3.4, me: true },
  { t: '……天啊，真的有人。别放下，听我说完。', d: 3.6 },
  { t: '别去一层。一层全是它们，下去就上不来了。', d: 3.8, warn: true },
  { t: '往上走。四楼天台，那是唯一还能接人的地方。', d: 4.0 },
  { t: '我们有一架直升机，它会去天台上空。', d: 3.8 },
  { t: '上去以后先把楼道门锁死，然后等绳索放下来。', d: 4.2 },
  { t: '……沙沙……（信号断了）', d: 2.8 },
  { t: '（走廊东头那道门。天台。）', d: 3.0, me: true },
];

function startRadioCall() {
  const r = game.radio;
  if (r.done) return;
  r.phase = 'call';
  r.step = 0;
  r.t = 1.3;
}

function answerRadio() {
  const r = game.radio;
  if (r.phase !== 'call') return;
  r.phase = 'talk';
  r.step = 0;
  r.t = 0.35;
  SFX.sfxClick();
  SFX.sfxStatic(0.5, 0.14);
}

function updateRadio(dt) {
  const r = game.radio;
  if (r.phase === 'call') {
    r.t -= dt;
    if (r.t > 0) return;
    const line = RADIO_CALL[r.step % RADIO_CALL.length];
    UI.msg(line.t);
    SFX.sfxStatic(0.34, 0.1);
    SFX.sfxBeep(660, 0.05, 0.05);
    r.t = line.d;
    r.step++;
  } else if (r.phase === 'talk') {
    r.t -= dt;
    if (r.t > 0) return;
    const line = RADIO_TALK[r.step];
    UI.msg(line.t, line.warn ? 'warn' : '');
    if (!line.me) {
      SFX.sfxStatic(0.3, 0.09);
      SFX.sfxBeep(line.warn ? 320 : 760, 0.05, 0.06);
    }
    r.t = line.d;
    r.step++;
    if (r.step >= RADIO_TALK.length) {
      r.phase = 'done';
      r.done = true;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 死亡与重生
 * ------------------------------------------------------------------ */

function die() {
  if (game.state === 'dead') return;
  game.state = 'dead';
  game.phase = 0;
  game.shake = 8;
  game.zoomTarget = 1;
  endQTE();
  clearQTEPose();
  game.player.hidden = false;
  SFX.sfxThud();
  UI.setPrompt(null);
  setPadVisible(false);
}

function respawn() {
  const p = game.player;
  p.hp = PLAYER_HP;
  p.invuln = 1.6;
  game.state = 'play';
  // 注意别用 game.fade：它只在起床状态里递减，play 状态下没人会把它降回去，
  // 之前这里设成 1 会让复活后整个画面永久黑屏。淡入交给过渡系统。
  game.fade = 0;
  setPadVisible(true);
  horde.clear();
  game.trans = null;
  if (game.checkpoint === 'radio312') {
    // 天台上死掉：回 312，对讲机那段从头再来（自动呼喊也会重新开始）
    game.radio = { phase: 'idle', step: 0, t: 0, done: false };
    game.roofPhase = 'arrive';
    game.roofDoorLocked = false;
    enterArea('dorm312', 'enter');
  } else {
    enterArea('stair', 'respawn');
  }
  game.trans = { to: null, spawn: null, t: 0, phase: 'in' };
  game.gun.mag = MAG_SIZE;
  if (INV.countItem('mag') < 1) INV.addItem('mag', 1);
  syncHUD();
}

/* ------------------------------------------------------------------ *
 * 暴雨与闪电
 *
 * 雨是屏幕空间粒子，画在光照之后（见 render）。闪电走 lighting.addFlat
 * 加一次短抖屏，雷声按距离延迟若干秒再响。
 * ------------------------------------------------------------------ */

function startStorm() {
  rain.setOn(true);
  game.storm = { next: 2.6 + Math.random() * 3, flash: 0, thunder: -1, near: 0.6 };
  SFX.setRain(true);
}

function stopStorm() {
  if (!game.storm) return;
  rain.setOn(false);
  game.storm = null;
  SFX.setRain(false);
  SFX.setRotor(0);
}

function updateStorm(dt) {
  const s = game.storm;
  if (!s) return;
  rain.update(dt);
  s.flash = Math.max(0, s.flash - dt * 3.1);
  s.next -= dt;
  if (s.next <= 0) {
    s.near = Math.random();
    s.next = 5.5 + Math.random() * 9;
    s.flash = 1;
    game.shake = Math.max(game.shake, 1.4 + s.near * 2.6);
    s.thunder = 0.3 + (1 - s.near) * 2.4; // 越远的雷，声音来得越晚
  }
  if (s.thunder > 0) {
    s.thunder -= dt;
    if (s.thunder <= 0) {
      SFX.sfxThunder(s.near);
      s.thunder = -1;
    }
  }
}

/* ------------------------------------------------------------------ *
 * QTE：分拍 · 慢动作 · 一拍一个键
 *
 * 上一版是"一次甩出 5 个随机键 + 0.95 秒起步还越按越短"，所以既快又难：
 * 玩家得先扫一遍整排键找到当前那一个，再在不到一秒里按下去，而且键是随机
 * 的，形不成肌肉记忆，也没有任何镜头语言告诉他"这一下要做什么"。
 *
 * 现在每一段 QTE 是一串**节拍**，每拍两段：
 *   1) 引子（lead）：镜头推近/摇移到这一拍的焦点，世界进慢动作，屏幕上
 *      只有动作名（"它扑过来了 · 侧身闪开"），**不出键**。
 *   2) 关键瞬间：时间进一步压慢，弹出**唯一**那一个大键帽，外面一圈限时
 *      环往里收。窗口 1.9~2.4 秒，按真实秒计 —— 慢动作只影响世界，不影响
 *      难度。按对 → 一下顿帧回弹（tsHit）接下一拍的运镜；按错或超时 → 失手。
 *
 * 按键固定不随机；引子期间抢按不算失败也不算命中，不鼓励连打。
 * 面板、键帽、限时环全在 DOM（见 index.html 的 #qte）；中文不上 canvas。
 * ------------------------------------------------------------------ */

/** 只有池子里的键按错才算失手，别的键（比如误碰 Shift）直接忽略 */
const QTE_POOL = ['e', 'f', 'r', 'q', 'a', 's', 'd', 'w', ' '];

/** 一拍的默认参数。beat 里没写的走这里 */
const BEAT_DEF = {
  lead: 1.0, // 运镜引子（真实秒）
  window: 2.0, // 反应窗口（真实秒）
  ts: 0.38, // 引子期间的时间缩放
  tsKey: 0.18, // 键弹出后的时间缩放（更慢）
  tsHit: 0.85, // 按对瞬间的时间回弹
  hit: 0.34, // 命中表演的时长
  zoom: 2.1,
  focus: 0.5,
  camSpeed: 2.6,
  pan: 2.4,
};

function beatOf(q) {
  return q && q.beats[q.i];
}

/** 把这一拍的镜头参数交给缓动系统。stage: 'lead' | 'key' */
function applyBeatCam(b, stage) {
  const key = stage === 'key';
  game.zoomTarget = key ? (b.zoomKey === undefined ? b.zoom + 0.3 : b.zoomKey) : b.zoom;
  game.zoomSpeed = b.camSpeed;
  game.panSpeed = b.pan;
  game.tsTarget = key ? b.tsKey : b.ts;
}

function startQTE(o) {
  game.qte = {
    id: o.id,
    beats: o.beats.map((b) => ({ ...BEAT_DEF, ...b })),
    i: -1,
    phase: 'lead',
    t: 0,
    mashK: 0,
    onWin: o.onWin,
    onFail: o.onFail,
  };
  UI.qteBegin(o.title, o.beats.length);
  UI.setPrompt(null);
  game.lastPrompt = '';
  nextBeat();
}

function nextBeat() {
  const q = game.qte;
  q.i++;
  if (q.i >= q.beats.length) {
    q.phase = 'win';
    q.t = 0.5;
    game.tsTarget = 1;
    return;
  }
  const b = q.beats[q.i];
  q.phase = 'lead';
  q.t = b.lead;
  q.mashK = 0;
  applyBeatCam(b, 'lead');
  UI.qteBeat(q.i, b.caption);
  if (b.onLead) b.onLead();
}

function endQTE() {
  if (!game.qte) return;
  game.qte = null;
  UI.hideQTE();
  game.tsTarget = 1;
  clearQTEPose();
}

/**
 * 姿势是逐帧喂的，QTE 一停就没人再喂了。不清掉的话人会保持最后一拍的造型
 * 继续走路 —— 搏斗结束定格在举枪蹲姿，抓绳失手定格在半空攀爬姿。
 * 抓绳打赢的那一路例外：过场要接着用爬绳的缩放与姿势，不能在这里清。
 */
function clearQTEPose() {
  if (game.fight) game.fight.pose = null;
  if (game.ropeAnim && !game.cine) {
    game.ropeAnim.pose = null;
    game.ropeAnim.stroke = 0;
    game.player.shrink = 0;
    game.player.nudge = null;
  }
}

/**
 * QTE 推进。**全部用真实秒**（game.rdt）：限时窗口不受慢动作影响，
 * 玩家看到的"还剩多少"跟手上的反应时间是同一把尺子。
 */
function updateQTE() {
  const q = game.qte;
  if (!q) return;
  const dt = game.rdt;

  if (q.phase === 'win' || q.phase === 'fail') {
    // 收尾这半秒也要接着演，否则最后一枪打完人物会当场定格
    const lb = q.beats[Math.min(q.i, q.beats.length - 1)];
    if (lb) runBeatAnim(lb, 1);
    q.t -= dt;
    if (q.t <= 0) {
      const cb = q.phase === 'fail' ? q.onFail : q.onWin;
      game.qte = null;
      UI.hideQTE();
      game.tsTarget = 1;
      // 先跑回调：抓绳打赢会在这里开过场，clearQTEPose 要看得到 game.cine
      if (cb) cb();
      clearQTEPose();
    }
    return;
  }

  const b = q.beats[q.i];
  if (q.phase === 'lead') {
    q.t -= dt;
    runBeatAnim(b, clamp(1 - q.t / Math.max(0.001, b.lead), 0, 1));
    if (q.t <= 0) {
      q.phase = b.mash ? 'mash' : 'key';
      q.t = b.mash ? b.time : b.window;
      applyBeatCam(b, 'key');
      UI.qteShowKey(b.key, !!b.mash);
      SFX.sfxBeep(980, 0.05, 0.1);
    }
    return;
  }

  if (q.phase === 'key') {
    runBeatAnim(b, 1);
    q.t -= dt;
    UI.qteTime(q.t / b.window);
    if (q.t <= 0) qteFail();
    return;
  }

  if (q.phase === 'mash') {
    q.t -= dt;
    // 停手会往回滑一点点：要"一直按"，但滑得很慢，不是拼手速
    q.mashK = Math.max(0, q.mashK - dt * b.decay);
    runBeatAnim(b, q.mashK);
    UI.qteTime(q.t / b.time);
    UI.qteMash(q.mashK, false);
    if (q.t <= 0) qteFail();
    return;
  }

  if (q.phase === 'hit') {
    runBeatAnim(b, b.mash ? 1 : clamp(1 - q.t / Math.max(0.001, b.hit), 0, 1));
    q.t -= dt;
    if (q.t <= 0) nextBeat();
  }
}

/**
 * 一拍的表演：把这一拍的动作按进度 k 推给对应的动画器。
 *
 * 一拍其实是**两段**动作：引子/等键那段（anim）是"对方在做什么"，
 * 按中之后那段（animHit）才是"我做了什么" —— 闪身、蹬腿、拔枪、格挡、开枪
 * 全在这一段里演，所以命中段也要有自己的进度，不能一直喂 1。
 */
function runBeatAnim(b, k) {
  const ph = game.qte.phase;
  let name = b.anim;
  // 连按段落进入 mash 之后换成爬绳动作，命中收尾那一小段也接着爬
  if (b.animMash && (ph === 'mash' || ph === 'hit')) name = b.animMash;
  else if (b.animHit && (ph === 'hit' || ph === 'win')) name = b.animHit;
  if (!name) return;
  if (game.qte.id === 'fight') setFightAnim(name, k);
  else if (game.qte.id === 'rope') setRopeAnim(name, k);
}

/** QTE 期间键盘只喂到这里 */
function qteKey(k) {
  const q = game.qte;
  const b = beatOf(q);
  if (!b) return;

  if (q.phase === 'mash') {
    if (k !== b.key) return; // 连按段落按错不惩罚，只是没进度
    q.mashK = Math.min(1, q.mashK + 1 / b.need);
    UI.qteMash(q.mashK, true);
    SFX.sfxBeep(520 + q.mashK * 420, 0.04, 0.08);
    game.shake = Math.max(game.shake, 1.6);
    if (b.onMash) b.onMash(q.mashK);
    if (q.mashK >= 1) {
      UI.qteHit();
      if (b.onHit) b.onHit();
      q.phase = 'hit';
      q.t = b.hit;
      game.tsTarget = b.tsHit;
    }
    return;
  }

  // 引子期间抢按：既不算命中也不算失手 —— QTE 不该奖励盲目连打
  if (q.phase !== 'key') return;

  if (k !== b.key) {
    if (QTE_POOL.includes(k)) qteFail();
    return;
  }

  UI.qteHit();
  SFX.sfxBeep(880, 0.05, 0.1);
  game.tsTarget = b.tsHit;
  if (b.onHit) b.onHit();
  q.phase = 'hit';
  q.t = b.hit;
}

function qteFail() {
  const q = game.qte;
  if (!q || q.phase === 'fail') return;
  q.phase = 'fail';
  q.t = 1.0;
  UI.qteFailed('失手');
  SFX.sfxError();
  game.shake = 5.5;
  // 失败也走慢动作近景：让玩家看清自己是怎么没的
  game.tsTarget = 0.22;
  game.zoomTarget = Math.max(game.zoomTarget, 2.6);
  const b = beatOf(q);
  if (b && b.onFailBeat) b.onFailBeat();
}

/* ------------------------------------------------------------------ *
 * 天台流程
 * arrive（可锁门 / 掀帐篷）→ fight（搏斗 QTE）→ clear（等 5 秒）
 * → heli（直升机进画）→ rope（走到边缘放绳、抓绳 QTE）→ cine → done
 * ------------------------------------------------------------------ */

/**
 * 直升机的悬停点（画布坐标）。天台边缘在画面右上，机身停在它斜上方。
 * 机体放大之后旋翼半展约 78px，所以悬停点要比原来更高更靠里，
 * 免得桨尖被画面右缘切掉。
 *
 * 悬停点是**相对绳索落点**定义的，所以舱口上任何一个点离落点多高都是常量 ——
 * 爬绳段落靠这一点把"手该举到哪"直接换算成玩家的 z（见 zForHandUp）。
 */
const HELI_OFF = { x: 26, y: -144 };
function heliHover() {
  const r = area.roof;
  return {
    x: area.cam.x + (r.rope.x - r.rope.y) * HW + HELI_OFF.x,
    y: area.cam.y + (r.rope.x + r.rope.y) * HH + HELI_OFF.y,
  };
}

function lockRoofDoor() {
  game.roofDoorLocked = true;
  SFX.sfxServo(false);
  SFX.sfxThud();
  game.shake = 2.4;
  UI.msg('门闩落下。这下谁也上不来了。');
}

function openTent() {
  const r = area.roof;
  game.roofPhase = 'fight';
  game.roofT = 0;
  game.shake = 3.2;
  SFX.sfxThud();
  fx.dust(r.tent.x, r.tent.y, 0.5, 8);
  UI.msg('帐篷里有东西——', 'warn');
  // 从 +x 那侧的开口爬出来，位置要落在帐篷碰撞体外面，否则它会卡住
  game.tentZ = horde.spawnOne(r.tent.x + 1.5, r.tent.y - 0.1, { emerge: 1.1, hp: 3 });
}

/* ------------------------------------------------------------------ *
 * 搏斗 QTE：五拍
 *
 * 一拍一个键，键固定不随机：A 闪 → W 蹬 → R 拔枪 → D 挡 → E 开枪。
 * 每一拍先走 1 秒左右的慢动作运镜，再弹出那一个键，给 1.9~2.4 秒反应。
 * 焦点（focus）是"这一拍镜头看谁"：0 = 玩家，1 = 丧尸 —— 拔枪那拍压到
 * 0.12 就是"镜头切到手上"。
 * ------------------------------------------------------------------ */

const FIGHT_BEATS = [
  {
    key: 'a', caption: '它从帐篷里扑出来 · 侧身闪开',
    lead: 1.15, window: 2.2, ts: 0.4, tsKey: 0.2, tsHit: 0.3, hit: 0.55,
    zoom: 2.0, zoomKey: 2.35, focus: 0.55,
    anim: 'lunge', animHit: 'dodge',
    onLead: () => {
      SFX.sfxImpact(false);
      game.shake = 3.4;
    },
    onHit: () => {
      game.fight.side0 = game.fight.dodge; // 玩家往侧面滑开，丧尸从原来那条线上扑空
      game.fight.kick = 0.5;
      fx.dust(game.player.x, game.player.y, 0.04, 7);
      SFX.sfxStep();
      UI.msg('（擦着肩膀过去了。）');
    },
  },
  {
    key: 'w', caption: '它翻身压上来 · 蹬开它',
    lead: 0.95, window: 2.1, ts: 0.36, tsKey: 0.18, tsHit: 0.32, hit: 0.6,
    zoom: 2.25, zoomKey: 2.55, focus: 0.5,
    anim: 'pin', animHit: 'kick',
    onHit: () => {
      game.fight.kick = 0.95;
      game.shake = 4.2;
      SFX.sfxThud();
      const z = game.tentZ;
      fx.debris(z.x, z.y, 0.8, 6, '#3c4a3a');
      fx.dust(z.x, z.y, 0.1, 6);
    },
  },
  {
    key: 'r', caption: '右手够到枪套 · 拔枪',
    lead: 1.0, window: 2.2, ts: 0.42, tsKey: 0.16, tsHit: 0.34, hit: 0.6,
    zoom: 2.6, zoomKey: 2.85, focus: 0.2,
    anim: 'draw', animHit: 'drawn',
    onHit: () => {
      SFX.sfxReload(1);
      game.fight.armed = true;
      UI.msg('（枪出来了。）');
    },
  },
  {
    key: 'd', caption: '它又咬下来 · 枪身横着顶住',
    lead: 0.85, window: 2.0, ts: 0.34, tsKey: 0.17, tsHit: 0.3, hit: 0.55,
    zoom: 2.35, zoomKey: 2.65, focus: 0.62,
    anim: 'bite', animHit: 'block',
    onLead: () => {
      game.shake = 2.6;
      SFX.sfxImpact(false);
    },
    onHit: () => {
      const z = game.tentZ;
      game.fight.kick = 1.35; // 顶开得够远，最后那一枪才有一段看得见的弹道
      game.shake = 3.6;
      SFX.sfxImpact(true);
      SFX.sfxThud();
      fx.spark(z.x, z.y, 1.45, 7, 0.6);
    },
  },
  {
    key: 'e', caption: '它扑回来的半路 · 抬枪打头',
    lead: 1.25, window: 2.4, ts: 0.28, tsKey: 0.12, tsHit: 0.14, hit: 1.1,
    zoom: 2.7, zoomKey: 2.9, focus: 0.7,
    anim: 'muzzle', animHit: 'fire',
    onHit: () => fireKillShot(),
  },
];

/**
 * 最后一枪。这一段整个在慢动作里：先出枪口焰与后坐，再让**弹头自己飞过去**
 * （fx.bullet 是沿弹道跑的亮点，不是一闪就没的 tracer），命中判定交给
 * setFightAnim 的 'fire'，两边看到的是同一个时间轴。
 */
function fireKillShot() {
  const f = game.fight;
  const z = game.tentZ;
  const p = game.player;
  if (!f || !z) return;
  const mx = p.x + Math.cos(p.aim) * 0.42;
  const my = p.y + Math.sin(p.aim) * 0.42;
  /* 弹头的飞行时间走**世界时间**，慢动作会把它拉长成看得清的一段。爆头
     的判定也挂在同一个计时上（见 applyFightPose 的 'fire'）—— 以前两边各
     算各的，结果头先炸开、弹头还在枪口边上飘。 */
  f.shotDur = 0.1;
  f.shotT = 0;
  f.shotHit = false;
  f.hitS = 1;
  f.recoil = 1;
  fx.bullet(mx, my, 1.32, z.x, z.y, 1.52, f.shotDur);
  fx.spark(mx, my, 1.32, 5, 0.35);
  fx.smoke(mx, my, 1.36, 3);
  fx.casing(p.x, p.y, 1.15, p.aim);
  if (game.gun.mag > 0) game.gun.mag--;
  game.flash = 0.075;
  game.shake = 5.2;
  SFX.sfxShot();
  syncHUD();
}

/**
 * 扭打的"上镜轴"。
 *
 * 等距投影下，世界方向 (1,1) 在屏幕上是**竖直**的 —— 玩家从北边走过来掀帐篷，
 * 扭打轴就正好是竖的，两个精灵完全叠在一起，动作演得再细也看不出来。
 * 所以这里把轴掰到接近屏幕水平的两个方向之一（左右各一个），两个人并排站，
 * 再让丧尸略微靠近镜头一点，压住玩家时有前后关系。
 */
const FIGHT_AXES = [
  { x: 1.22, y: -0.78 }, // 丧尸在画面右
  { x: -0.78, y: 1.22 }, // 丧尸在画面左
].map((v) => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
});

/** a -> b 的最短转角，落在 (-π, π] */
function shortAngle(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

function startFightQTE() {
  const p = game.player;
  const z = game.tentZ;
  if (!z) return;
  // 它现在实际在哪个方向：轴要从这里出发，慢慢转到上镜轴，不能瞬移
  let ux = z.x - p.x;
  let uy = z.y - p.y;
  const l = Math.hypot(ux, uy) || 1;
  ux /= l;
  uy /= l;

  /* 上镜轴挑哪一边：丧尸要退到 2 格外扑过来，那一侧得是空地，
     否则它会被帐篷/女儿墙"埋"进去。 */
  let best = FIGHT_AXES[0];
  let bestRoom = -1;
  for (const a of FIGHT_AXES) {
    const room = freeRun(p.x, p.y, a.x, a.y, 2.1) + (a.x * ux + a.y * uy) * 0.4;
    if (room > bestRoom) {
      bestRoom = room;
      best = a;
    }
  }

  /* 闪避那一拍会把玩家沿扭打轴的垂线整个平移过去，而这一段是直接赋值坐标、
     不走碰撞的。玩家多半是从楼梯间那侧（西北）走过来掀的帐篷，站位就在帐篷
     北边一点，往那个方向滑 0.66 格正好滑进帐篷的碰撞盒 —— QTE 结束后就再也
     走不出来。所以在这里先量一量两侧各有多少空地，挑宽的那边，滑不满就少滑。
     垂线按**上镜轴**算：闪避发生时轴已经转过去了。 */
  const nx = -best.y;
  const ny = best.x;
  const room = 0.66;
  const rp = freeRun(p.x, p.y, nx, ny, room);
  const rm = freeRun(p.x, p.y, -nx, -ny, room);
  const dodge = rp >= rm ? rp : -rm;
  game.fight = {
    px: p.x, py: p.y,
    ux, uy, // 当前轴，逐帧转向上镜轴
    // 按角度插值而不是按向量插值：两者接近反向时向量插值会从中间的零向量穿过去
    a0: Math.atan2(uy, ux),
    da: shortAngle(Math.atan2(uy, ux), Math.atan2(best.y, best.x)),
    axisK: 0,
    d: Math.min(2.2, l),
    side: 0, side0: 0, zside: 0, kick: 0, armed: false, dodge, recoil: 0,
  };
  startQTE({
    id: 'fight',
    title: '挣脱',
    beats: FIGHT_BEATS,
    onWin: winFight,
    onFail: () => failRoof('它把你按进了积水里。'),
  });
}

/**
 * 搏斗的每一拍摆位与**姿势**。丧尸挂在**扭打基准点**上而不是挂在玩家身上 ——
 * 挂在玩家身上的话，玩家一闪它就跟着平移，看起来像贴纸，闪避完全读不出来。
 *
 * 位置只解决"谁在哪"，读不出"谁在做什么"，所以这里同时给两边填姿势：
 * 玩家的 game.fight.pose 交给 art.js 的 drawCharacter，丧尸的 z.pose 交给
 * zombies.js 的 drawZombieBody。每个动作名都对应一拍里的一段表演。
 */
function setFightAnim(name, k) {
  const f = game.fight;
  const z = game.tentZ;
  const p = game.player;
  if (!f || !z) return;
  const rt = game.rt;
  const s = smoothstep(clamp(k, 0, 1));

  /* 扭打轴慢慢从"它现在实际在哪一侧"转到上镜轴。直接切过去的话，刚从帐篷里
     爬出来的丧尸会在第一帧凭空瞬移到画面另一边；第一拍的引子里转完正好。 */
  f.axisK = Math.min(1, f.axisK + game.rdt * 0.85);
  const ang = f.a0 + f.da * smoothstep(f.axisK);
  f.ux = Math.cos(ang);
  f.uy = Math.sin(ang);

  let d = 0.6; // 贴身距离
  let side = f.side0; // 玩家的侧移
  let zside = f.side0; // 丧尸的侧移（闪避那一拍它不跟）
  let lunge = 0.3;
  let ease = 6;

  if (name === 'lunge') {
    d = lerp(1.95, 0.5, s);
    zside = 0;
    lunge = 0.2 + s * 0.8;
  } else if (name === 'dodge') {
    // 玩家已经滑到侧面（side0 变了），丧尸沿原线继续冲过去，扑空
    d = lerp(0.5, 1.05, s);
    zside = 0;
    lunge = 1 - s * 0.5;
    ease = 11;
  } else if (name === 'pin') {
    d = 0.56 + Math.sin(rt * 5.4) * 0.05;
    lunge = 0.5;
  } else if (name === 'kick') {
    d = lerp(0.56, 1.5, s);
    lunge = 0.2 * (1 - s);
    ease = 12;
  } else if (name === 'draw') {
    d = 0.8 + Math.sin(rt * 3.2) * 0.04;
    lunge = 0.22;
  } else if (name === 'drawn') {
    d = 0.9 + s * 0.15;
    lunge = 0.15;
  } else if (name === 'bite') {
    d = lerp(0.95, 0.42, s);
    lunge = 0.3 + s * 0.7;
  } else if (name === 'block') {
    d = lerp(0.42, 1.1, s);
    lunge = 0.5 * (1 - s);
    ease = 12;
  } else if (name === 'muzzle') {
    // 顶开之后它正扑回来：留一段看得见的距离，最后那一枪才有弹道可看
    d = lerp(1.85, 1.35, s) + Math.sin(rt * 2.1) * 0.03;
    lunge = 0.3 + s * 0.35;
  } else if (name === 'fire') {
    d = 1.35 + s * 0.55; // 中弹之后被打得往后退
    lunge = 0.2 * (1 - s);
    ease = 9;
  }

  // 每次成功顶开都给一下后坐，随后缓缓被它重新逼近
  f.kick = Math.max(0, f.kick - game.rdt * 1.1);
  d += f.kick;

  const e = Math.min(1, game.rdt * ease);
  f.d = lerp(f.d, d, e);
  f.side = lerp(f.side, side, e);
  f.zside = lerp(f.zside, zside, e);

  // 垂直于扭打轴的方向，用来做侧移
  const nx = -f.uy;
  const ny = f.ux;
  p.x = f.px + nx * f.side;
  p.y = f.py + ny * f.side;
  z.x = f.px + f.ux * f.d + nx * f.zside;
  z.y = f.py + f.uy * f.d + ny * f.zside;
  z.emerge = 0;
  z.lunge = lunge;
  z.walk += game.rdt * 2.6;
  const fsx = (p.x - z.x - (p.y - z.y)) * HW;
  const fsy = (p.x - z.x + (p.y - z.y)) * HH;
  const fl = Math.hypot(fsx, fsy) || 1;
  z.face.x = fsx / fl;
  z.face.y = fsy / fl;

  p.aim = Math.atan2(z.y - p.y, z.x - p.x);
  p.aimScreen = normScreenDir(p.aim);
  p.walk = lerp(p.walk, 0, Math.min(1, game.rdt * 8));

  applyFightPose(name, s, f, z, p);

  const fo = (beatOf(game.qte) || { focus: 0.5 }).focus;
  game.zoomAt = { x: lerp(p.x, z.x, fo), y: lerp(p.y, z.y, fo), z: 0.6 };
}

/**
 * 一拍里两个人各自的身体动作。全部在**精灵空间**里给像素偏移：
 * sg = 丧尸在屏幕上的哪一侧（+1 右 / -1 左），sf = 指向丧尸的屏幕单位向量。
 */
function applyFightPose(name, s, f, z, p) {
  const sf = p.aimScreen || { x: 1, y: 0.5 };
  const sg = sf.x >= 0 ? 1 : -1;
  const zdir = z.face.x >= 0 ? 1 : -1;
  const rt = game.rt;
  const armed = f.armed;
  // 手臂长度上限：超过这个数手就脱离身体了
  const A = 8.5;

  // 默认：低架势的搏斗站姿，两手在身前护着
  const pp = {
    face: sg,
    crouch: 3,
    lean: 0,
    grit: true,
    holster: !armed,
    hideItems: !armed,
    legs: { a: -2.4 * sg, b: 2.0 * sg },
    arms: {
      far: { x: sg * 3.2, y: -3.4 },
      near: { x: sg * 5.0, y: -1.6 },
    },
  };
  const zp = { noBack: true, tilt: 0.32 * zdir, jaw: 0.4, armK: 1.1 };

  if (name === 'lunge') {
    // 它加速扑过来；玩家重心压低往后靠，两手抬起来护住
    pp.crouch = 2 + s * 2;
    pp.lean = -0.16 * sg * s;
    pp.legs = { a: -2.2 * sg - s * 1.6 * sg, b: 2.4 * sg };
    pp.arms.far = { x: sg * (2.6 + s * 1.4), y: -4.2 - s * 1.2 };
    pp.arms.near = { x: sg * (4.4 + s * 1.6), y: -2.6 - s * 1.6 };
    zp.tilt = (0.28 + s * 0.34) * zdir;
    zp.armK = 1.1 + s * 0.7;
    zp.jaw = 0.3 + s * 0.7;
    zp.sink = s * 2.2;
    zp.legA = -3 * zdir - s * 3 * zdir;
    zp.legB = 2.4 * zdir + s * 2.4 * zdir;
  } else if (name === 'dodge') {
    // 侧闪：上身整个拧开，前脚跨一大步，另一只手扫过去卸力
    pp.crouch = 4 - s * 1.5;
    pp.lean = -0.52 * sg * Math.sin(s * Math.PI * 0.9);
    pp.legs = { a: -5.5 * sg * s - 1.5 * sg, b: 3.6 * sg * s + 1.5 * sg, la: 1.5 * s };
    pp.arms.far = { x: -sg * (2 + s * 3), y: 1.5 + s * 2 };
    pp.arms.near = { x: sg * (5 - s * 7), y: -2 + s * 6 };
    pp.headTilt = { x: -sg * s * 1.5, y: s * 1.2 };
    // 它扑空：整个人还保持前扑的姿势往前栽
    zp.tilt = (0.62 - s * 0.1) * zdir;
    zp.armK = 1.8 - s * 0.3;
    zp.jaw = 0.9;
    zp.sink = 2.5 + s * 1.5;
    zp.legA = -6 * zdir;
    zp.legB = 5 * zdir;
  } else if (name === 'pin') {
    // 被压住：几乎坐倒在地，两手死死顶住它的肩膀
    const push = Math.sin(rt * 6.2) * 0.7;
    pp.crouch = 7;
    pp.sink = 1.5;
    pp.lean = 0.14 * sg;
    pp.legs = { a: -4 * sg, b: 1.2 * sg };
    pp.arms.far = { x: sg * (4.2 + push), y: -6.2 };
    pp.arms.near = { x: sg * (6.0 + push), y: -5.4 };
    zp.tilt = 0.5 * zdir;
    zp.sink = 6;
    zp.armK = 1.5;
    zp.armDrop = 5.5;
    zp.jaw = 0.85;
    zp.legA = -2 * zdir;
    zp.legB = 4 * zdir;
  } else if (name === 'kick') {
    // 蹬开：靠近它那条腿整条弹出去，两手在身后撑地
    const kick = Math.sin(Math.min(1, s * 1.4) * Math.PI * 0.7);
    pp.crouch = 8 - s * 2;
    pp.sink = 2.5;
    pp.lean = -0.3 * sg * kick;
    pp.legs = { a: sg * (2 + kick * 9), la: kick * 7, b: -sg * 2.4 };
    pp.arms.far = { x: -sg * (4 + kick * 2), y: 5.5 };
    pp.arms.near = { x: -sg * (2 + kick * 2), y: 6.5 };
    // 它被蹬得整个人往后仰、脚离地
    zp.tilt = (0.4 - s * 1.05) * zdir;
    zp.sink = 5 - s * 6;
    zp.armK = 1.4;
    zp.armDrop = 5 - s * 12;
    zp.headY = -s * 3.5;
    zp.jaw = 0.95;
    zp.legA = -3 * zdir - s * 5 * zdir;
    zp.legB = 3 * zdir + s * 6 * zdir;
    zp.liftA = s * 4;
    zp.liftB = s * 6;
  } else if (name === 'draw') {
    // 拔枪：一只手继续顶住它，另一只手往腰上摸，摸了两下才摸到
    const fumble = Math.sin(rt * 15) * 0.9;
    pp.crouch = 6;
    pp.lean = 0.1 * sg;
    pp.legs = { a: -3.4 * sg, b: 1.6 * sg };
    pp.arms.far = { x: sg * 6.2, y: -5.0 };
    pp.arms.near = { x: -sg * (2.6 + fumble * 0.5), y: 5.4 + fumble };
    pp.headTilt = { x: -sg * 1, y: 0.5 };
    zp.tilt = 0.44 * zdir;
    zp.sink = 4;
    zp.armK = 1.35;
    zp.armDrop = 3.5;
    zp.jaw = 0.6;
  } else if (name === 'drawn') {
    // 枪抽出来：手从腰侧一路甩到身前，枪跟着入画
    const up = smoothstep(clamp(s * 1.3, 0, 1));
    pp.crouch = 6 - up * 2;
    pp.holster = false;
    pp.hideItems = false;
    pp.arms.far = { x: sg * (6.2 - up * 2), y: -5.0 + up * 1.5 };
    pp.arms.near = {
      x: lerp(-sg * 2.6, sg * 5.4, up),
      y: lerp(5.4, -3.2, up),
    };
    pp.armAng = Math.atan2(sf.y, sf.x);
    zp.tilt = 0.4 * zdir;
    zp.sink = 3.5;
    zp.armK = 1.25;
    zp.jaw = 0.5;
  } else if (name === 'bite') {
    // 它咬下来：玩家双手把枪横过来举到脸前
    pp.crouch = 5 + s * 2;
    pp.lean = 0.08 * sg;
    pp.arms.far = { x: sg * (2.6 + s * 0.8), y: -7.0 - s * 0.8 };
    pp.arms.near = { x: sg * (4.8 + s * 1.0), y: -7.2 - s * 0.8 };
    pp.armAng = Math.atan2(-sf.x, sf.y); // 枪身横过来当挡杆
    pp.headTilt = { x: -sg * 1, y: 1 };
    zp.tilt = (0.4 + s * 0.22) * zdir;
    zp.sink = 3 + s * 4.5;
    zp.armK = 1.3 + s * 0.4;
    zp.armDrop = 3 + s * 3.5;
    zp.headY = s * 3.2;
    zp.jaw = 1;
  } else if (name === 'block') {
    // 顶住：双臂猛地往上一送，把它的下巴顶开
    const shove = Math.sin(Math.min(1, s * 1.5) * Math.PI * 0.8);
    pp.crouch = 6 - shove * 3;
    pp.lean = -0.14 * sg * shove;
    pp.arms.far = { x: sg * (3.0 + shove * 1.2), y: -7.6 - shove * 2.2 };
    pp.arms.near = { x: sg * (5.4 + shove * 1.4), y: -7.8 - shove * 2.4 };
    pp.armAng = Math.atan2(-sf.x, sf.y);
    zp.tilt = (0.6 - shove * 0.95) * zdir;
    zp.sink = 6 - shove * 7;
    zp.armK = 1.5;
    zp.armDrop = 4 - shove * 10;
    zp.headY = -shove * 5.5;
    zp.jaw = 1;
    zp.legA = -3 * zdir - shove * 3 * zdir;
    zp.legB = 3 * zdir + shove * 4 * zdir;
  } else if (name === 'muzzle') {
    // 举枪瞄准：持枪那只手完全伸直指向它的头，另一只手托住手腕
    const rise = smoothstep(clamp(s * 1.25, 0, 1));
    pp.crouch = 4 - rise * 2;
    pp.holster = false;
    pp.hideItems = false;
    pp.legs = { a: -2.8 * sg, b: 2.6 * sg };
    pp.arms.near = { x: sf.x * A, y: sf.y * (A * 0.7) - lerp(1, 5.6, rise) };
    pp.arms.far = { x: sf.x * (A * 0.6), y: sf.y * (A * 0.45) - lerp(0, 4.4, rise) };
    pp.armAng = Math.atan2(sf.y * 0.7 - 0.12, sf.x);
    zp.tilt = (0.34 + s * 0.2) * zdir;
    zp.armK = 1.2 + s * 0.4;
    zp.jaw = 0.6 + s * 0.35;
    zp.sink = s * 2;
  } else if (name === 'fire') {
    // 开枪：先枪口上跳（后坐），再回到瞄准线；弹头飞到之后它的头才炸开
    f.recoil = Math.max(0, (f.recoil || 0) - game.rdt * 2.4);
    const rc = f.recoil;
    pp.crouch = 2;
    pp.holster = false;
    pp.hideItems = false;
    pp.lean = -0.06 * sg * rc;
    pp.legs = { a: -3.2 * sg, b: 2.8 * sg };
    pp.arms.near = { x: sf.x * (A - rc * 1.6), y: sf.y * (A * 0.7) - 5.6 - rc * 2.6 };
    pp.arms.far = { x: sf.x * (A * 0.6 - rc), y: sf.y * (A * 0.45) - 4.4 - rc * 1.8 };
    pp.armAng = Math.atan2(sf.y * 0.7 - 0.12, sf.x) - rc * 0.42 * sg;

    // 弹头到没到？跟 fx.bullet 用同一个世界时间计时，两边永远对得上
    f.shotT = (f.shotT || 0) + game.rdt * game.timescale;
    const hit = f.shotT >= (f.shotDur || 0.1);
    if (hit && !f.shotHit) {
      f.shotHit = true;
      f.hitS = s;
      const hz = 1.52;
      fx.spark(z.x, z.y, hz, 9, 0.7);
      fx.blood(z.x, z.y, hz, 20, 1.5);
      fx.decal(z.x + 0.12, z.y + 0.1, 0.02, 'floor');
      fx.decal(z.x - 0.22, z.y + 0.26, 0.02, 'floor');
      game.shake = 6.5;
      SFX.sfxImpact(false);
      SFX.sfxThud();
      UI.msg('（一声闷响。它不动了。）');
    }
    const kb = hit ? smoothstep(clamp((s - f.hitS) / Math.max(0.12, 1 - f.hitS), 0, 1)) : 0;
    zp.headGone = hit;
    zp.tilt = (0.4 - kb * 1.25) * zdir;
    zp.sink = -kb * 2;
    zp.armK = 1.2;
    zp.armDrop = -kb * 9;
    zp.jaw = 1;
    zp.legA = -3 * zdir - kb * 4 * zdir;
    zp.legB = 3 * zdir + kb * 5 * zdir;
    zp.liftA = kb * 3;
  }

  f.pose = pp;
  z.pose = zp;
}

/**
 * 收尾。枪、弹头、爆头都在最后一拍的 'fire' 里演完了，这里只负责让它倒下、
 * 把镜头慢慢拉回全景。
 */
function winFight() {
  const z = game.tentZ;
  game.roofPhase = 'clear';
  game.roofT = 0;
  if (z) {
    z.pose = null;
    z.headGone = true; // 尸体也没有头
    horde.damage(z, 99);
    fx.debris(z.x, z.y, 0.5, 6, '#5a1f1c');
    fx.decal(z.x, z.y, 0.02, 'floor');
  }
  game.zoomTarget = 1;
  game.zoomSpeed = 1.4; // 拉回全景要慢，别把最后那一枪甩掉
  game.tsTarget = 1;
  game.zoomAt = null;
  game.fight = null;
  game.tentZ = null;
  syncHUD();
}

function failRoof(text) {
  UI.msg(text, 'warn');
  game.checkpoint = 'radio312';
  game.zoomTarget = 1;
  game.tsTarget = 1;
  die();
}

function startHeli() {
  game.roofPhase = 'heli';
  game.roofT = 0;
  game.heli = { t: 0, x: VIEW_W + 190, y: 26, k: 0 };
  SFX.setRotor(0.3);
  UI.msg('……雨里有别的声音。');
}

/* ------------------------------------------------------------------ *
 * 抓绳 QTE：三拍单键 + 一段连按爬绳
 *
 * 助跑 → 起跳 → 抓住，每一拍仍然只出一个键；抓住之后不再是"再按几个不同
 * 的键就秒过"，而是**一直按同一个空格**把自己一把一把拽上去。松手会往下
 * 滑一点（decay 很慢，不是拼手速），时间到还没爬上去才算失手。
 * ------------------------------------------------------------------ */

const ROPE_BEATS = [
  {
    key: 'w', caption: '风把绳子吹得直晃 · 助跑',
    lead: 1.3, window: 2.4, ts: 0.6, tsKey: 0.38, zoom: 1.55, zoomKey: 1.75, camSpeed: 1.6,
    anim: 'brace',
    onHit: () => SFX.sfxStep(),
  },
  {
    key: ' ', caption: '到边了 · 起跳',
    lead: 1.3, window: 2.2, ts: 0.34, tsKey: 0.17, zoom: 1.95, zoomKey: 2.2,
    anim: 'run',
    onHit: () => {
      const p = game.player;
      SFX.sfxThud();
      fx.dust(p.x, p.y, 0.03, 10);
      game.shake = 3.4;
    },
  },
  {
    key: 'e', caption: '绳索就在眼前 · 抓住它',
    lead: 1.4, window: 2.4, ts: 0.22, tsKey: 0.12, zoom: 2.2, zoomKey: 2.45,
    anim: 'air',
    onHit: () => {
      if (game.rope) game.rope.hold = true;
      SFX.sfxImpact(false);
      game.shake = 2.8;
      UI.msg('（抓住了。手心全是雨水。）', 'good');
    },
  },
  {
    mash: true, key: ' ', caption: '连按 空格 · 一把一把往上爬',
    lead: 1.0, time: 11, need: 15, decay: 0.11,
    ts: 0.6, tsKey: 0.7, tsHit: 1, zoom: 1.95, zoomKey: 1.85, camSpeed: 1.4, pan: 1.6,
    anim: 'hang', animMash: 'climb', hit: 0.5,
    onMash: (k) => {
      if (Math.random() < 0.4) fx.dust(game.player.x, game.player.y, (game.player.z || 0) + 0.2, 1);
      SFX.setRotor(0.85 + k * 0.15);
    },
  },
];

function startRopeQTE() {
  const p = game.player;
  game.ropeAnim = { x0: p.x, y0: p.y, stepT: 0 };
  startQTE({
    id: 'rope',
    title: '天台边缘',
    beats: ROPE_BEATS,
    onWin: startEscapeCine,
    onFail: () => failRoof('手一滑。风把你甩了回来。'),
  });
}

/**
 * 爬绳段落的高度标定。机身钉死在绳索落点上方 -HELI_OFF.y 像素，所以：
 *
 *   落点屏幕 y = gy          （玩家 z=0 时脚底所在）
 *   舱口抓手  = gy - GRAB_UP （门口士兵手套伸到最低的位置）
 *   舱内门槛  = gy - SILL_UP （人被拽进去之后踩在这里）
 *
 * 玩家脚底 y = gy - z*TILE_Z，举过头顶的手大约在脚底上方 30*scale 像素，
 * 反过来就能算出"手要够到某个高度时人该在什么 z"。两处的数只在 art.js 里
 * 定义一次（heliGrabAt / heliSillAt），这边只做减法。
 */
const GRAB_UP = -HELI_OFF.y - A.heliGrabAt(0, 0, -1).y;
const SILL_UP = -HELI_OFF.y - A.heliSillAt(0, 0, -1).y;
const HAND_UP = 30; // 双手举过头顶时高出脚底多少（1 倍缩放下）
/* 三个缩放档：爬到顶 / 被抓住 / 进了舱。直升机是按"在天上、离得远"的比例
   画的，人不缩小就塞不进舱门；但缩过头又什么动作都看不清，所以进舱前尽量
   留大一点，只有真的要挤进那个 21px 高的门洞时才收到最小。 */
const CLIMB_SHRINK = 0.42;
const GRAB_SHRINK = 0.6;
const IN_SHRINK = 0.94;

/** 让"举起的手"停在落点上方 up 像素时，玩家该有的 z */
function zForHandUp(up, shrink) {
  return (up - HAND_UP * lerp(PLAYER_SCALE, 0.46, clamp(shrink, 0, 1))) / TILE_Z;
}

/**
 * 攀爬循环。a 在 -1..1 之间摆，一只手往上够、另一只手拉住，腿同时交替蹬绳。
 * 手全部往身体中线（绳子）上收，两只手不能各挂一边，否则不像抓着一根绳。
 */
function climbPose(a, extra) {
  const po = {
    face: 1,
    noBack: true,
    grit: true,
    hideItems: true,
    holster: true,
    crouch: 1.5,
    lean: a * 0.07,
    // 远手肩在 x-4.2，近手肩在 x+4.2；两只手都收到中线偏右一点
    arms: {
      far: { x: 4.9, y: -10.5 + a * 4.5 },
      near: { x: -3.5, y: -10.5 - a * 4.5 },
    },
    legs: {
      a: -1.6 + a * 0.8,
      b: 1.4 + a * 0.8,
      la: 2.6 - a * 2.4,
      lb: 2.6 + a * 2.4,
    },
  };
  if (extra) Object.assign(po, extra);
  return po;
}

/** 抓绳段落的玩家动作。位置全部由拍子的进度 k 驱动，一拍走完刚好到位 */
function setRopeAnim(name, k) {
  const ra = game.ropeAnim;
  const r = area.roof;
  const p = game.player;
  if (!ra || !r) return;
  const s = smoothstep(clamp(k, 0, 1));
  const takeoff = { x: r.rope.x, y: r.rope.y + 1.3 };
  const grab = { x: r.rope.x, y: r.rope.y - 0.1 };

  if (name === 'brace') {
    p.x = ra.x0;
    p.y = ra.y0;
    p.z = 0;
    p.moving = false;
    p.walk = lerp(p.walk, 0, Math.min(1, game.rdt * 8));
    // 助跑前的下蹲蓄力
    ra.pose = {
      crouch: 2 + s * 2.5,
      grit: true,
      legs: { a: -2.6, b: 2.4 },
      arms: { far: { x: -3.2, y: 4.4 }, near: { x: 1.6, y: 3.2 } },
    };
  } else if (name === 'run') {
    p.x = lerp(ra.x0, takeoff.x, s);
    p.y = lerp(ra.y0, takeoff.y, s);
    p.z = 0;
    p.moving = s < 0.99;
    p.walk += game.rdt * 14;
    ra.stepT -= game.rdt;
    if (ra.stepT <= 0 && p.moving) {
      ra.stepT = 0.19;
      SFX.sfxStep();
      fx.dust(p.x, p.y, 0.02, 1);
    }
    ra.pose = { grit: true, lean: -0.14, hideItems: true, holster: true };
  } else if (name === 'air') {
    p.x = lerp(takeoff.x, grab.x, s);
    p.y = lerp(takeoff.y, grab.y, s);
    // 起跳的抛物线：先冲高再落到绳子那个高度
    p.z = Math.sin(s * Math.PI * 0.8) * 1.9 + s * 0.75;
    p.moving = false;
    p.walk = lerp(p.walk, 0, Math.min(1, game.rdt * 5));
    // 腾空：两手全力往前上方够绳，后腿蹬直、前腿收起
    ra.pose = {
      face: 1,
      noBack: true,
      grit: true,
      hideItems: true,
      holster: true,
      crouch: -1,
      lean: -0.2 + s * 0.24,
      arms: {
        far: { x: 4.2 + s * 1.2, y: -8 - s * 3 },
        near: { x: -2.4 + s * 1.4, y: -7 - s * 4 },
      },
      legs: { a: -5.5 + s * 3, la: 1 + s * 3, b: 3.5 - s * 1.5, lb: s * 2 },
    };
  } else if (name === 'hang' || name === 'climb') {
    if (game.rope) game.rope.hold = true;
    const climb = name === 'climb' ? clamp(k, 0, 1) : 0;
    /* 一把一把往上：每按满 1/6 就是一"把"，手脚交替的相位跟着爬升进度走
       而不是跟着时间走 —— 停手时人也就停在半途，不会自己在那划水。 */
    ra.stroke = lerp(ra.stroke || 0, climb * 6, Math.min(1, game.rdt * 9));
    const a = Math.sin(ra.stroke * Math.PI * 2);
    // 越往上离镜头越远，同时人要小到塞得进舱门（见 playerScale 的说明）
    p.shrink = climb * CLIMB_SHRINK;
    p.x = grab.x + Math.sin(game.rt * 1.7) * 0.05;
    p.y = grab.y;
    // 起点：吊在绳子下端；终点：手够到离舱口抓手还差一截的地方
    p.z = lerp(2.4, zForHandUp(GRAB_UP - 15, CLIMB_SHRINK), climb) + Math.sin(game.rt * 1.5) * 0.06;
    p.moving = false;
    p.walk = lerp(p.walk, 0, Math.min(1, game.rdt * 5));
    ra.pose = climbPose(name === 'climb' ? a : Math.sin(game.rt * 1.6) * 0.35);
  }

  p.aim = Math.atan2(r.rope.y - 2.6 - p.y, r.rope.x - p.x);
  p.aimScreen = normScreenDir(p.aim);
  game.zoomAt = { x: p.x, y: p.y, z: (p.z || 0) + 0.7 };
}

function updateRoof(dt) {
  const r = area.roof;
  const p = game.player;
  game.roofT += dt;

  if (game.roofPhase === 'arrive') {
    if (game.roofT > 1.6 && !game.roofSaidHint) {
      game.roofSaidHint = true;
      UI.msg(game.roofDoorLocked ? '天台上只有那顶帐篷。' : '先把楼道门锁死。');
    }
    return;
  }

  if (game.roofPhase === 'fight') {
    // 等它从帐篷里完全爬出来再进搏斗
    if (game.roofT > 1.35 && !game.qte) startFightQTE();
    return;
  }

  if (game.roofPhase === 'clear') {
    if (game.roofT > 5) startHeli();
    return;
  }

  if (game.roofPhase === 'heli') {
    const h = game.heli;
    const hv = heliHover();
    h.t += dt;
    h.k = Math.min(1, h.t / 4.6);
    const k = smoothstep(h.k);
    h.x = lerp(VIEW_W + 190, hv.x, k);
    h.y = lerp(26, hv.y, k) + Math.sin(h.t * 1.7) * 2.2;
    SFX.setRotor(0.25 + 0.75 * k);
    if (h.k >= 1) {
      game.roofPhase = 'rope';
      game.roofT = 0;
      UI.msg('他们看见我了。到天台边上去。', 'good');
    }
    return;
  }

  if (game.roofPhase === 'rope') {
    const h = game.heli;
    const hv = heliHover();
    h.t += dt;
    h.x = hv.x + Math.sin(h.t * 0.7) * 3;
    h.y = hv.y + Math.sin(h.t * 1.7) * 2.4;
    if (!game.rope) {
      if (p.x > r.edge.x0 && p.x < r.edge.x1 && p.y < r.edge.y1) {
        game.rope = { t: 0, down: false };
        UI.msg('舱门开了。绳索放下来了。', 'good');
      }
    } else {
      game.rope.t += dt;
      if (!game.rope.down && game.rope.t > 1.3) game.rope.down = true;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 逃脱过场：够到舱口 → 士兵抓住手腕 → 被拽进舱 → 收绳关门 → 序章结束
 *
 * 冲刺 / 起跳 / 抓绳 / 往上爬都在抓绳 QTE 里由玩家自己按出来了，这里接的是
 * 最后一小截。以前这一段只是把 p.z 一路插到 9.6 再继续往上飘 —— 9.6 换算过来
 * 是舱顶再往上 30 多像素，人整个飞过了直升机，看着就是"被丢在机外悬空"。
 *
 * 现在的时间轴（秒，全部相对过场开始）：
 *
 *   0.00 REACH  最后一把：绞盘带着人再上一点，玩家的手举到舱口抓手位置；
 *               门口的士兵同时探身把手伸下来（crewReach 0 → 1）
 *   0.95 GRAB   手套抓住手腕。一下顿挫（shake + 音效），玩家一只手离开绳子
 *               改抓士兵的小臂，另一只手扒住门槛；绳子开始松
 *   1.60 HAUL   往里拽：脚底从舱口外抬到门槛高度、身体侧过来蹭进舱门，
 *               同时缩到舱内比例。绳索这时开始回收（1.2 秒收完就没了）
 *   2.85 IN     人已经在舱内地板上，士兵收手；舱门滑上来把舱口封住
 *   3.55 AWAY   机头一压，右上方拉升离场；镜头拉回全景
 *   6.30 END    「序章 · 完」
 * ------------------------------------------------------------------ */

const CINE = { grab: 0.95, haul: 1.6, in: 2.85, away: 3.55, end: 6.3 };

function startEscapeCine() {
  const p = game.player;
  game.roofPhase = 'cine';
  game.state = 'cine';
  game.tsTarget = 1;
  /* 抓手那几拍要看得清"抓住 → 拽入"，镜头先保持近景，进舱之后再拉开。
     整段的位移只有二三十像素，不推近就什么都读不出来。 */
  game.zoomTarget = 2.1;
  game.zoomSpeed = 1.4;
  game.panSpeed = 2.2;
  game.cine = {
    t: 0,
    x0: p.x, y0: p.y, z0: p.z || 2.4,
    sh0: p.shrink || 0,
    stroke: (game.ropeAnim && game.ropeAnim.stroke) || 0,
    reach: 0,
    grabbed: false,
    retract: 0,
    door: 0,
    inCabin: false,
    pose: null,
  };
  p.hidden = false;
  UI.setPrompt(null);
  setPadVisible(false);
}

function updateCine(dt) {
  const c = game.cine;
  const p = game.player;
  const r = area.roof;
  c.t += dt;
  const T = c.t;
  if (game.rope) game.rope.hold = true;

  p.x = r.rope.x;
  p.y = r.rope.y - 0.1;
  p.moving = false;
  p.walk = lerp(p.walk, 0, Math.min(1, dt * 6));

  /* 三个关键高度（都是"举起的手离绳索落点多高"）：
     还差一截 → 够到抓手 → 站上门槛。脚底高度由 zForHandUp 反推。 */
  const zGrab = zForHandUp(GRAB_UP, GRAB_SHRINK);
  const zIn = SILL_UP / TILE_Z; // 进舱之后脚底就踩在门槛上

  // 舱口在屏幕上比绳索落点偏机内一点，人被拽进去时要横着挪这一段
  const NUDGE_GRAB = 6;
  const NUDGE_IN = 13;

  if (T < CINE.grab) {
    // --- REACH：最后一把，士兵同时把手伸下来
    const k = smoothstep(T / CINE.grab);
    c.stroke += dt * 1.4;
    p.z = lerp(c.z0, zGrab, k);
    p.shrink = lerp(c.sh0, GRAB_SHRINK, k);
    p.nudge = { x: NUDGE_GRAB * k, y: 0 };
    c.reach = smoothstep(clamp((T - 0.15) / 0.7, 0, 1));
    // 够到最后那一下：够绳的手改成朝舱口伸，另一只还挂在绳上
    c.pose = climbPose(Math.sin(c.stroke * Math.PI * 2) * (1 - k), {
      lean: -0.1 * k,
      arms: {
        far: { x: 4.9 + k * 1.6, y: -10.5 - k * 0.5 },
        near: { x: -3.5 + k * 1.0, y: -10.5 + k * 1.0 },
      },
    });
  } else if (T < CINE.haul) {
    // --- GRAB：手套扣住手腕。人还吊在舱口外，只有上半身被拽得往里歪
    if (!c.grabbed) {
      c.grabbed = true;
      game.shake = 4.6;
      SFX.sfxImpact(false);
      UI.msg('（一只戴手套的手扣住了你的手腕。）', 'good');
    }
    const k = smoothstep((T - CINE.grab) / (CINE.haul - CINE.grab));
    c.reach = 1;
    p.z = zGrab + k * 0.16;
    p.shrink = GRAB_SHRINK + k * 0.04;
    p.nudge = { x: NUDGE_GRAB + k * 1.5, y: 0 };
    c.pose = {
      face: 1, noBack: true, grit: true, hideItems: true, holster: true,
      crouch: 1 - k,
      lean: -0.12 - k * 0.2,
      // 被抓住那只手被往上提，另一只手扒上门槛
      arms: {
        far: { x: 6.5 + k * 1.2, y: -11 - k * 1.6 },
        near: { x: -2.5 + k * 4.5, y: -9.5 - k * 2.2 },
      },
      legs: { a: -2.4 - k * 2, b: 1.8 + k * 1.5, la: 1 + k * 3, lb: 0.5 + k * 1 },
    };
  } else if (T < CINE.in) {
    // --- HAUL：整个人被拖进舱门，绳索同时回收
    const k = smoothstep((T - CINE.haul) / (CINE.in - CINE.haul));
    c.reach = 1; // 手一直扣着，是这只手把人拖进去的，中途松开就白演了
    /* 上半身越过门槛的那一刻换图层：在这之前人还吊在机外（画在世界层，
       跟雨夜一起被压暗、又刚好被机腹挡住一点头顶），之后整个人在舱内。 */
    if (k > 0.35) c.inCabin = true;
    p.z = lerp(zGrab + 0.16, zIn, k);
    p.shrink = lerp(GRAB_SHRINK + 0.04, IN_SHRINK, k);
    p.nudge = { x: lerp(NUDGE_GRAB + 1.5, NUDGE_IN, k), y: 0 };
    c.retract = clamp((T - CINE.haul - 0.15) / 1.2, 0, 1);
    // 进舱瞬间从"吊着"变成"扑倒在地板上"：身体压低、腿蹬进来
    c.pose = {
      face: 1, noBack: true, grit: true, hideItems: true, holster: true,
      crouch: -1 + k * 8,
      sink: k * 1.5,
      lean: -0.32 + k * 0.5,
      // 被抓的那只手一直吊在上面，另一只手先落地撑住
      arms: {
        far: { x: 7.7 - k * 3.4, y: -15.5 + k * 4.5 },
        near: { x: 2.0 - k * 5.4, y: -13.9 + k * 15 },
      },
      legs: { a: -4.4 + k * 3, b: 3.3 - k * 2, la: 4 - k * 4, lb: 1.5 - k * 1.5 },
    };
    if (k > 0.55 && !c.thud) {
      c.thud = true;
      game.shake = 3.2;
      SFX.sfxThud();
    }
  } else {
    // --- IN / AWAY：人在舱里瘫着，绳收完、门滑上，机头一压离场
    const k = smoothstep(clamp((T - CINE.in) / 0.7, 0, 1));
    c.reach = 1 - k; // 人到地板上了，士兵这才松手坐回门槛
    c.retract = 1;
    c.inCabin = true;
    c.door = smoothstep(clamp((T - CINE.in - 0.2) / 0.9, 0, 1));
    p.z = zIn;
    p.shrink = IN_SHRINK;
    p.nudge = { x: NUDGE_IN + k * 3, y: 0 };
    c.pose = {
      face: 1, noBack: true, hideItems: true, holster: true,
      crouch: 7 + k * 1.5,
      sink: 1.5,
      lean: 0.18 - k * 0.06,
      arms: { far: { x: 2.5, y: -3.5 }, near: { x: -3.0, y: -2.0 } },
      legs: { a: 2.5, b: 4.5, la: 0.5, lb: 0 },
    };
    // 舱门一封上人就看不见了，别让精灵透过门板露出来
    if (c.door > 0.85) p.hidden = true;
    if (T > CINE.away) game.zoomTarget = 1;
  }

  p.aim = Math.atan2(r.rope.y - 2.6 - p.y, r.rope.x - p.x);
  p.aimScreen = normScreenDir(p.aim);
  game.zoomAt = { x: p.x, y: p.y, z: (p.z || 0) + 0.7 };

  // 直升机：拽人时几乎不动（有个抬升的趋势），关门之后才真正拉升右飞
  const h = game.heli;
  if (h) {
    h.t += dt;
    const hv = heliHover();
    const off = Math.max(0, T - CINE.away);
    h.x = hv.x + Math.sin(h.t * 0.7) * 3 + off * off * 13;
    h.y = hv.y + Math.sin(h.t * 1.7) * 2 - Math.min(T, CINE.away) * 2.2 - off * off * 7;
  }
  SFX.setRotor(Math.max(0.2, 1 - Math.max(0, T - CINE.away) * 0.26));

  if (T > CINE.end && game.state !== 'end') {
    game.state = 'end';
    game.roofPhase = 'done';
    stopStorm();
    UI.showEnding();
    UI.showCursor(false);
    game.curShown = false;
  }
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function playerScreen(cam, p) {
  return { x: cam.x + (p.x - p.y) * HW, y: cam.y + (p.x + p.y) * HH };
}

/**
 * 玩家精灵的缩放。地面上恒定 1.12；被吊上直升机那一段要**逐渐变小**。
 *
 * 直升机是按"在天上、离得远"的比例画的，舱门只有 21 像素高，而站姿角色有
 * 31 像素 —— 保持地面尺寸的话人根本塞不进舱门，看起来就只能是"挂在机外"。
 * 随高度缩小既解决了比例，也正好是"越升越远"的透视暗示。
 */
const PLAYER_SCALE = 1.12;
function playerScale() {
  const k = clamp(game.player.shrink || 0, 0, 1);
  return lerp(PLAYER_SCALE, 0.46, k);
}

/**
 * 玩家精灵。抽出来是因为它有两个落点：平时按等距深度排在世界层里画，
 * 被拽进机舱那几秒改挂到 drawHeli 的舱内图层（否则永远在机身背后）。
 * 两处的坐标系一样（都是世界变换下的画布坐标），所以直接复用。
 */
function drawPlayerSprite(g, cam, px, py, zOff, bodyRot) {
  const p = game.player;
  const s = playerScreen(cam, { x: px, y: py });
  const kick = game.gun.recoil * 1.6;
  const aimS = p.aimScreen || { x: 1, y: 0.5 };
  const HIP = 13 * 1.12; // 髋部离脚底的像素高度
  // 旋转是绕髋部做的，所以躺平时要把绘制原点整体下移一个髋高，
  // 否则身体会浮在床面上方一个髋高的位置。
  const hipDrop = bodyRot === 0 ? 0 : HIP * Math.min(1, Math.abs(bodyRot / LIE_ROT));
  // 过场里对齐舱口用的屏幕偏移：世界坐标是等距的，横着挪几像素没法用 x/y 表达
  const nd = p.nudge;
  const fx0 = s.x - aimS.x * kick + (nd ? nd.x : 0);
  const fy0 = s.y - zOff - aimS.y * kick + hipDrop + (nd ? nd.y : 0);
  let leftItem = game.state === 'play' ? INV.handItem('left') : null;
  let rightItem = game.state === 'play' ? INV.handItem('right') : null;
  /* 搏斗段：手电筒别在腰上不参与，枪在"拔枪"那一拍之前还在枪套里。
     而且枪固定交给**近侧**那只手 —— 不然朝向一变，持枪的手就换边，
     举枪、格挡、开枪三拍的手臂偏移全对不上。 */
  if (game.fight) {
    const gun = game.fight.armed && handOf('pistol') ? 'pistol' : null;
    const nearIsRight = aimS.x >= 0;
    leftItem = nearIsRight ? null : gun;
    rightItem = nearIsRight ? gun : null;
  }
  g.save();
  if (bodyRot !== 0) {
    g.translate(fx0, fy0 - HIP);
    g.rotate(bodyRot);
    g.translate(-fx0, -(fy0 - HIP));
  }
  // 手的屏幕坐标留给舱口士兵：它要伸手抓的就是这个点
  p.hands = A.drawCharacter(g, fx0, fy0, {
    scale: playerScale(),
    aim: aimS,
    walk: p.walk,
    moving: p.moving && game.state === 'play',
    leftItem,
    rightItem,
    flashOn: inv.flashOn,
    eyesShut: game.state === 'wake' && game.phase < 1.5,
    pose:
      (game.fight && game.fight.pose) ||
      (game.cine && game.cine.pose) ||
      (game.ropeAnim && game.ropeAnim.pose) ||
      null,
  });
  g.restore();
}

const ISO_ANG = Math.atan2(HH, HW);
const ISO_UNIT = Math.hypot(HW, HH);

/**
 * 起床动画。整段只用同一个角色精灵，靠"绕髋部旋转 + 位置/高度插值"完成，
 * 不做任何纵向缩放 —— 之前躺着用的是另一套等距盒子画的身体，比例和站姿
 * 不一致，再叠一个 scale(1, k) 的拉伸，看起来就很别扭。
 *
 * 躺平时身体沿床的长轴（世界 +x）方向，头朝 -x（枕头那头）。角色精灵默认
 * 头朝屏幕上方，所以需要转到 -x 在屏幕上的方向。
 */
const LIE_ROT = Math.atan2(-HH, -HW) + Math.PI / 2;
const WAKE = { lie: 1.5, sit: 2.5, stand: 3.15, done: 3.5 };

function wakePose(t) {
  const bedTop = BED_TOP;
  // 躺在床上（略偏枕头一侧）
  const lieX = BED_POS.x - 0.15;
  const lieY = BED_POS.y;
  // 坐在床沿
  const sitX = BED_POS.x + 0.5;
  const sitY = BED_POS.y + 0.62;

  if (t < WAKE.lie) {
    const br = Math.sin(t * 1.9) * 0.012; // 呼吸
    return { x: lieX, y: lieY, z: bedTop + br, rot: LIE_ROT };
  }
  if (t < WAKE.sit) {
    // 坐起：旋转回直立，同时挪到床沿
    const k = smoothstep((t - WAKE.lie) / (WAKE.sit - WAKE.lie));
    return {
      x: lerp(lieX, sitX, k),
      y: lerp(lieY, sitY, k),
      z: bedTop,
      rot: LIE_ROT * (1 - k),
    };
  }
  if (t < WAKE.stand) {
    // 下床：从床沿高度落到地面，同时往前踏一步
    const k = smoothstep((t - WAKE.sit) / (WAKE.stand - WAKE.sit));
    return {
      x: lerp(sitX, PLAYER_START.x, k),
      y: lerp(sitY, PLAYER_START.y, k),
      z: bedTop * (1 - k),
      rot: 0,
    };
  }
  return { x: PLAYER_START.x, y: PLAYER_START.y, z: 0, rot: 0 };
}

function fixtureXform(g, cam, f) {
  g.save();
  g.translate(cam.x + (f.x - f.y) * HW, cam.y + (f.x + f.y) * HH - f.z * TILE_Z);
  g.rotate(ISO_ANG + (f.tilt || 0));
  return (f.len * ISO_UNIT) / 2;
}

/**
 * 灯具外壳。吊在空中的物件位于地面光照遮罩之上，放在光照之前会被压黑，
 * 所以仍然画在光照之后；用整体透明度跟随亮度，坏掉的灯只是隐约可见，
 * 而不是一条纯黑的横杠割在画面上。
 */
function drawFixtureBody(g, cam, f, intensity) {
  const L = fixtureXform(g, cam, f);
  g.globalAlpha = 0.32 + 0.68 * clamp(intensity, 0, 1);
  // 吊杆（一端断裂的灯会歪着挂）
  g.strokeStyle = 'rgba(150,162,162,0.75)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-L + 5, -2);
  g.lineTo(-L + 5, -13);
  if (!f.tilt) {
    g.moveTo(L - 5, -2);
    g.lineTo(L - 5, -13);
  }
  g.stroke();
  if (f.tilt) {
    g.strokeStyle = 'rgba(40,44,46,0.9)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(L - 6, -2);
    g.quadraticCurveTo(L - 2, -9, L - 8, -14);
    g.stroke();
  }
  // 灯壳
  g.fillStyle = '#59615e';
  g.fillRect(-L - 1, -6, L * 2 + 2, 7);
  g.fillStyle = '#767f7b';
  g.fillRect(-L - 1, -6, L * 2 + 2, 2.2);
  g.fillStyle = 'rgba(255,255,255,0.2)';
  g.fillRect(-L - 1, -6, L * 2 + 2, 0.8);
  g.fillStyle = '#454d4a';
  g.fillRect(-L - 1, -6, 3, 7);
  g.fillRect(L - 2, -6, 3, 7);
  // 熄灭的灯管本体（暗，但不是全黑）
  g.fillStyle = '#8b8f86';
  g.fillRect(-L + 2, -3.4, L * 2 - 4, 3.4);
  g.globalAlpha = 1;
  g.restore();
}

/** 亮着的灯管与辉光。画在光照之后，属于自发光。 */
function drawFixtureGlow(g, cam, f, intensity) {
  const i = clamp(intensity, 0, 1);
  if (i <= 0.05) return;
  const L = fixtureXform(g, cam, f);
  const c = Math.round(120 + 135 * i);
  g.fillStyle = `rgb(${c},${Math.min(255, Math.round(c * 1.03))},${Math.round(c * 0.94)})`;
  g.fillRect(-L + 2, -3.4, L * 2 - 4, 3.4);
  g.fillStyle = `rgba(255,255,255,${0.55 * i})`;
  g.fillRect(-L + 2, -3.2, L * 2 - 4, 1.2);
  g.globalCompositeOperation = 'lighter';
  const grd = g.createLinearGradient(0, -12, 0, 14);
  grd.addColorStop(0, 'rgba(180,220,235,0)');
  grd.addColorStop(0.4, `rgba(205,235,245,${0.3 * i})`);
  grd.addColorStop(1, 'rgba(180,220,235,0)');
  g.fillStyle = grd;
  g.fillRect(-L - 10, -12, L * 2 + 20, 26);
  g.restore();
}

/**
 * 给当前可互动的物体描边。画在光照之后，所以夜里也看得清。
 * 门是烘焙在静态墙面里的，没有独立精灵，只能按墙面坐标勾门框。
 */
function drawHighlight(g, cam) {
  const it = game.interact;
  if (!it || !it.target || game.bagOpen || game.state !== 'play') return;
  const a = 0.5 + 0.32 * (0.5 + 0.5 * Math.sin(game.t * 3.4));

  if (it.target === 'door') {
    const pts = [
      wallNorthPt(DOOR.u0 - 6, DOOR.top - 6, cam.x, cam.y),
      wallNorthPt(DOOR.u1 + 6, DOOR.top - 6, cam.x, cam.y),
      wallNorthPt(DOOR.u1 + 6, DOOR.bottom, cam.x, cam.y),
      wallNorthPt(DOOR.u0 - 6, DOOR.bottom, cam.x, cam.y),
    ];
    g.save();
    g.globalAlpha = a;
    g.strokeStyle = '#ded8c8';
    g.lineWidth = 2; // 与精灵描边环（8 向偏移 r=1）的视觉粗细对齐
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    g.stroke();
    g.restore();
    return;
  }

  const pr = area.props.find((q) => q.id === it.target);
  if (!pr) return;
  const ring = A.outlineRing(pr.s.img);
  const sx = cam.x + (pr.x - pr.y) * HW;
  const sy = cam.y + (pr.x + pr.y) * HH - (pr.zOff || 0) * TILE_Z;
  g.save();
  g.globalAlpha = a;
  blit(g, ring.img, snap(sx - pr.s.ox - ring.pad), snap(sy - pr.s.oy - ring.pad));
  g.restore();
}

function drawEmissive(g, cam) {
  const p = game.player;

  // 门顶红色警示灯
  const pulse = 0.45 + 0.55 * Math.pow(Math.sin(game.t * 2.1) * 0.5 + 0.5, 2);
  const lamp = wallNorthPt(DOOR.cx, DOOR.top - 10, cam.x, cam.y);
  g.globalCompositeOperation = 'lighter';
  let grd = g.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 11);
  grd.addColorStop(0, `rgba(255,70,50,${0.45 * pulse})`);
  grd.addColorStop(1, 'rgba(255,70,50,0)');
  g.fillStyle = grd;
  g.fillRect(lamp.x - 11, lamp.y - 11, 22, 22);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = `rgba(255,${80 + 60 * pulse},64,${0.5 + 0.45 * pulse})`;
  g.fillRect(lamp.x - 5, lamp.y - 1.2, 10, 2.6);

  // 扫描仪镜头
  const cam1 = wallNorthPt(SCANNER.u, SCANNER.v - 4, cam.x, cam.y);
  const on = game.shotScanner ? 0 : 0.5 + 0.5 * Math.sin(game.t * 3.3);
  if (on > 0.02) {
    g.fillStyle = `rgba(120,230,220,${0.35 + 0.5 * on})`;
    g.fillRect(cam1.x - 1, cam1.y - 1, 2, 2);
    g.globalCompositeOperation = 'lighter';
    grd = g.createRadialGradient(cam1.x, cam1.y, 0, cam1.x, cam1.y, 9);
    grd.addColorStop(0, `rgba(110,220,215,${0.3 * on})`);
    grd.addColorStop(1, 'rgba(110,220,215,0)');
    g.fillStyle = grd;
    g.fillRect(cam1.x - 9, cam1.y - 9, 18, 18);
    g.globalCompositeOperation = 'source-over';
  }

  // 还在运转的控制台屏幕
  const scr = SCREEN_SRC;
  const sx = cam.x + (scr.x - scr.y) * HW;
  const sy = cam.y + (scr.x + scr.y) * HH - scr.z * TILE_Z;
  const fl = 0.5 + 0.5 * Math.sin(game.t * 9.1) * Math.sin(game.t * 2.3);
  g.globalCompositeOperation = 'lighter';
  grd = g.createRadialGradient(sx, sy, 0, sx, sy, 24);
  grd.addColorStop(0, `rgba(90,210,205,${0.22 + 0.12 * fl})`);
  grd.addColorStop(1, 'rgba(90,210,205,0)');
  g.fillStyle = grd;
  g.fillRect(sx - 24, sy - 24, 48, 48);
  g.globalCompositeOperation = 'source-over';
}

/** 各盏灯的亮度系数。走廊灯用 mode 分类，实验室那几盏保留手写规则。 */
function lightLevel(L) {
  if (L.mode !== undefined) {
    switch (L.mode) {
      case 0:
        return flicker(game.t, L.seed, 0.38);
      case 1:
        return flicker(game.t, L.seed, 0.84);
      case 2:
        return flicker(game.t * 1.6, L.seed, 0.3) * (Math.sin(game.t * 0.7 + L.seed) > -0.6 ? 1 : 0.1);
      case 3:
        return 0;
      case 4: // 火焰
        return 0.72 + 0.28 * Math.sin(game.t * 8.3 + L.seed) * Math.sin(game.t * 3.1 + L.seed);
      case 5: // 安全出口灯 / 对讲机指示灯
        return 0.82 + 0.18 * Math.sin(game.t * 1.4 + L.seed);
      default:
        return 1;
    }
  }
  if (L.id === 'tube1') return flicker(game.t, L.seed, 0.72);
  if (L.id === 'tube2') return flicker(game.t * 1.7, L.seed, 0.35) * (Math.sin(game.t * 0.7) > -0.6 ? 1 : 0.15);
  if (L.id === 'emg') return 0.35 + 0.65 * Math.pow(Math.sin(game.t * 2.1) * 0.5 + 0.5, 2);
  if (L.id === 'emg2') {
    let v = 0.78 + 0.22 * Math.sin(game.t * 1.3 + 2);
    if (Math.sin(game.t * 0.9 + L.seed) > 0.985) v *= 0.2;
    return v;
  }
  if (L.id === 'screen') return 0.7 + 0.3 * Math.sin(game.t * 9.1) * Math.sin(game.t * 2.3);
  if (L.id === 'spark') return game.sparkPower * 0.85;
  return 1;
}

/** 门被打出的逐级损坏。画在墙面空间里，叠在烘焙好的静态墙上。 */
function drawDoorDamage(g, cam) {
  const hits = game.door.hits;
  g.save();
  wallNorthTransform(g, cam.x, cam.y);
  const { u0, u1, top, bottom } = DOOR;
  const cx = DOOR.cx;

  const holes = [
    [cx - 14, top + 16],
    [cx + 11, top + 24],
    [cx - 4, top + 31],
  ];
  for (let i = 0; i < Math.min(hits, 3); i++) {
    const [hx, hy] = holes[i];
    // 弹孔
    g.fillStyle = '#0a0c0c';
    g.beginPath();
    g.ellipse(hx, hy, 3.4, 3, 0, 0, 6.3);
    g.fill();
    g.fillStyle = 'rgba(230,226,210,0.5)';
    g.beginPath();
    g.ellipse(hx, hy, 4.6, 4, 0, 0, 6.3);
    g.fill();
    g.fillStyle = '#0a0c0c';
    g.beginPath();
    g.ellipse(hx, hy, 3, 2.6, 0, 0, 6.3);
    g.fill();
    // 放射裂纹
    g.strokeStyle = 'rgba(20,22,22,0.8)';
    g.lineWidth = 0.9;
    g.beginPath();
    for (let k = 0; k < 7; k++) {
      const a = k * 0.9 + i;
      g.moveTo(hx, hy);
      g.lineTo(hx + Math.cos(a) * (5 + ((k * 3 + i * 5) % 9)), hy + Math.sin(a) * (4 + ((k * 2 + i) % 7)));
    }
    g.stroke();
  }

  // 第二枪起：识别终端炸掉
  if (hits >= 2) {
    const sx = SCANNER.u - 9;
    const sy = SCANNER.v - 11;
    g.fillStyle = '#0c0e0e';
    g.fillRect(sx, sy, 18, 22);
    g.fillStyle = '#2a2320';
    g.fillRect(sx + 2, sy + 3, 14, 9);
    g.strokeStyle = 'rgba(210,200,180,0.4)';
    g.lineWidth = 0.8;
    g.beginPath();
    for (let k = 0; k < 6; k++) {
      g.moveTo(sx + 9, sy + 7);
      g.lineTo(sx + 9 + Math.cos(k * 1.1) * 8, sy + 7 + Math.sin(k * 1.7) * 9);
    }
    g.stroke();
    // 挂下来的线束
    g.strokeStyle = '#1a1512';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(sx + 6, sy + 20);
    g.quadraticCurveTo(sx + 10, sy + 30, sx + 4, sy + 38);
    g.stroke();
  }

  // 打穿之后：门被顶开一道缝
  if (game.door.broken) {
    const gapW = (u1 - u0) * 0.42;
    const gx = cx - gapW / 2;
    // 黑洞洞的门缝
    g.fillStyle = '#050706';
    g.fillRect(gx, top + 3, gapW, bottom - top - 6);
    // 走廊那侧透进来的一点光
    const lg = g.createLinearGradient(gx, 0, gx + gapW, 0);
    lg.addColorStop(0, 'rgba(190,180,150,0.16)');
    lg.addColorStop(0.5, 'rgba(190,180,150,0.05)');
    lg.addColorStop(1, 'rgba(190,180,150,0.16)');
    g.fillStyle = lg;
    g.fillRect(gx, top + 3, gapW, bottom - top - 6);
    // 两扇门被挤歪
    for (const side of [-1, 1]) {
      g.save();
      g.translate(cx + side * (gapW / 2), top + (bottom - top) / 2);
      g.rotate(side * 0.06);
      g.fillStyle = side < 0 ? '#4b565b' : '#576267';
      g.fillRect(side < 0 ? -(u1 - u0) / 2 : 0, -(bottom - top) / 2 + 3, (u1 - u0) / 2, bottom - top - 6);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(side < 0 ? -2 : 0, -(bottom - top) / 2 + 3, 2, bottom - top - 6);
      g.restore();
    }
    // 变形的门框
    g.strokeStyle = 'rgba(150,150,140,0.5)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(u0 - 5, top - 4);
    g.lineTo(u0 + 2, top + 2);
    g.moveTo(u1 + 5, top - 4);
    g.lineTo(u1 - 3, top + 3);
    g.stroke();
  }
  g.restore();
  resetTransform(g);
}

/**
 * 世界层的基础变换。平时是 N 倍网格；QTE 近景时整帧一起再乘变焦 —— 烘焙光
 * 贴图与遮罩都在未变焦的高清屏幕空间里合成，只有整帧一起缩放，几何和光照
 * 才不会错开。屏幕空间的东西（雨、字幕遮罩）不吃变焦，但仍要吃 N。
 */
const viewXform = { s: 1, tx: 0, ty: 0 };

/** 世界层：逻辑坐标 -> 变焦 -> 像素网格倍率 */
function applyView(g) {
  const n = pixelScale();
  const s = viewXform.s * n;
  setBase(g, s, 0, 0, s, viewXform.tx * n, viewXform.ty * n);
}

/** 屏幕空间层（雨、黑幕、闪光）：不吃变焦，吃网格倍率 */
function applyScreen(g) {
  const n = pixelScale();
  setBase(g, n, 0, 0, n, 0, 0);
}

/** 世界层里那些临时改过变换的绘制收尾用 */
function resetTransform(g) {
  applyView(g);
}

/** 未缩放的画布坐标 -> 实际屏幕像素（跟着当前变焦） */
function viewPt(x, y) {
  return { x: x * viewXform.s + viewXform.tx, y: y * viewXform.s + viewXform.ty };
}

/** 着火房间的火焰。门洞在远墙上，火焰画在门洞位置。 */
function drawFire(g, cam) {
  const f = area.fire;
  const base = wallNorthPt(f.x * TILE_W, WALL_H * TILE_Z - 4, cam.x, cam.y);
  A.drawFlames(g, base.x, base.y, 26, 34, game.t, 1.3);
  A.drawFlames(g, base.x - 14, base.y + 2, 15, 20, game.t * 1.3, 4.7);
  A.drawFlames(g, base.x + 15, base.y + 1, 13, 17, game.t * 0.9, 8.1);
  // 火上方的热浪与烟
  g.save();
  g.globalCompositeOperation = 'lighter';
  const grd = g.createRadialGradient(base.x, base.y - 14, 2, base.x, base.y - 14, 40);
  const k = 0.32 + 0.12 * Math.sin(game.t * 7.7);
  grd.addColorStop(0, `rgba(255,170,70,${k})`);
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  g.fillRect(base.x - 40, base.y - 54, 80, 80);
  g.restore();
  if (Math.random() < 0.25) fx.smoke(f.x, 0.4, 2.2, 1);
}

/** 区域里的自发光小物件：安全出口灯、对讲机指示灯、远景楼顶的障碍灯 */
function drawAreaGlow(g, cam) {
  /* 远景障碍灯：坐标是背景层的画布坐标（跟 area.backdrop 同一套空间）。
     画在光照之后，慢慢一闪一闪 —— 静止的城市剪影一旦有几个点在动，
     "那是真的远处"这件事就成立了。 */
  if (area.beacons) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const b of area.beacons) {
      const k = 0.5 + 0.5 * Math.sin(game.t * b.s + b.p);
      const a = 0.1 + 0.55 * k * k;
      const bx = b.x + (cam.x - area.cam.x);
      const by = b.y + (cam.y - area.cam.y);
      const grd = g.createRadialGradient(bx, by, 0, bx, by, 7);
      grd.addColorStop(0, `rgba(${b.c},${a})`);
      grd.addColorStop(1, `rgba(${b.c},0)`);
      g.fillStyle = grd;
      g.fillRect(bx - 7, by - 7, 14, 14);
      g.fillStyle = `rgba(${b.c},${Math.min(1, a * 1.6)})`;
      g.fillRect(bx - 0.7, by - 0.7, 1.6, 1.6);
    }
    g.restore();
  }

  if (area.exitSign !== undefined) {
    const s = wallNorthPt(area.exitSign * TILE_W, 20, cam.x, cam.y);
    const k = 0.8 + 0.2 * Math.sin(game.t * 1.4);
    g.fillStyle = `rgba(150,255,180,${0.8 * k})`;
    g.fillRect(s.x - 12, s.y - 4, 24, 8);
    g.fillStyle = 'rgba(10,40,20,0.85)';
    g.fillRect(s.x - 6, s.y - 2, 5, 5);
    g.fillRect(s.x + 1, s.y - 2, 3, 2);
    g.fillRect(s.x + 1, s.y + 1, 3, 2);
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, 30);
    grd.addColorStop(0, `rgba(110,235,140,${0.3 * k})`);
    grd.addColorStop(1, 'rgba(110,235,140,0)');
    g.fillStyle = grd;
    g.fillRect(s.x - 30, s.y - 30, 60, 60);
    g.globalCompositeOperation = 'source-over';
  }
  if (area.radio) {
    const r = area.radio;
    const sx = cam.x + (r.x - r.y) * HW;
    const sy = cam.y + (r.x + r.y) * HH - 0.95 * TILE_Z;
    // 对讲机本体
    g.fillStyle = '#22262a';
    g.fillRect(sx - 3, sy - 6, 6, 8);
    g.fillStyle = '#33383d';
    g.fillRect(sx - 3, sy - 6, 6, 2);
    g.fillStyle = '#15181a';
    g.fillRect(sx - 1, sy - 11, 1.6, 5);
    // 呼叫/通话时急闪；剧情走完只留一下一下的慢闪
    const ph = game.radio.phase;
    const on = ph === 'call' || ph === 'talk';
    const k = on
      ? 0.5 + 0.5 * Math.sin(game.t * 14)
      : game.radio.done
        ? 0.1 + 0.16 * Math.sin(game.t * 0.9)
        : 0.35 + 0.2 * Math.sin(game.t * 1.6);
    g.fillStyle = `rgba(120,240,160,${0.5 + 0.5 * k})`;
    g.fillRect(sx + 1, sy - 4, 1.6, 1.6);
    g.globalCompositeOperation = 'lighter';
    const grd = g.createRadialGradient(sx, sy - 4, 0, sx, sy - 4, 18);
    grd.addColorStop(0, `rgba(110,235,150,${0.24 * (0.4 + k)})`);
    grd.addColorStop(1, 'rgba(110,235,150,0)');
    g.fillStyle = grd;
    g.fillRect(sx - 18, sy - 22, 36, 36);
    g.globalCompositeOperation = 'source-over';
  }
}

/**
 * 天空层：直升机、探照灯、垂下的绳索，以及**吊在绳上的玩家**。
 *
 * 它们在天上，不参与等距深度排序，也不该被地面光照压黑，所以画在光照之后。
 * 坐标是画布坐标（跟着 shx/shy 一起挪），但仍在世界变换里画 —— QTE 近景时
 * 直升机要跟着一起放大，否则天上那架和脚下的天台会各走各的。
 *
 * 抓住绳子之后玩家也归这一层管，分两个落点：
 *
 *   吊在机外  画在**整架机之上**。绞盘吊臂是伸到机身外侧的，绳子和人都在
 *             机腹与滑橇的外面。之前他跟着世界层画在机身背后，机腹那个大椭圆
 *             正好盖住舱口高度的一切 —— 屏幕上就完全看不见人，只剩一根绳。
 *   拽进舱内  交给 drawHeli 的 inCabin 回调，夹在"舱内背景 + 站姿士兵"和
 *             "门口士兵 + 舱门"之间，于是接应的人和滑上来的舱门会挡住他。
 *
 * 两个落点都在光照之后，所以中途换层不会有明暗跳变；人被探照灯打着，
 * 比周围亮本来也说得通。
 */
function drawSky(g, cam, px, py, zOff) {
  const h = game.heli;
  if (!h || !area.roof) return;
  const hx = h.x + (cam.x - area.cam.x);
  const hy = h.y + (cam.y - area.cam.y);
  const nd = game.player.nudge;
  const tx = cam.x + (px - py) * HW + (nd ? nd.x : 0);
  const ty = cam.y + (px + py) * HH - zOff + (nd ? nd.y : 0);

  const c = game.cine;
  const an = A.heliAnchor(hx, hy, -1);
  const rp = game.rope;
  const retract = c ? c.retract : 0;
  const r = area.roof;
  const gx = cam.x + (r.rope.x - r.rope.y) * HW;
  const gy = cam.y + (r.rope.x + r.rope.y) * HH;

  /* 探照灯：悬停到位之后打开，照住天台上的接应点。
     以前是照着玩家：人爬到舱口时目标离灯口只剩十几像素，锥体缩成一团，
     整架直升机被自己的灯打成一片白。改成钉在地面落点上，锥体长度恒定；
     人被拉进舱之后连灯一起收。 */
  if (h.k >= 0.5) {
    const k = Math.min(1, (h.k - 0.5) / 0.5);
    const fade = c ? 1 - smoothstep(clamp(c.t / CINE.in, 0, 1)) : 1;
    if (fade > 0.02) {
      const lp = A.heliLampAt(hx, hy, -1);
      A.drawHeliBeam(g, lp.x, lp.y, gx, gy, 30, k * fade * (0.75 + 0.25 * Math.sin(game.t * 1.3)));
    }
  }

  const drawP = skyPlayer() ? (gg) => drawPlayerSprite(gg, cam, px, py, zOff, 0) : null;
  const inCabin = c && c.inCabin ? drawP : null;

  /* 舱口的接应：手伸下来的程度、抓哪儿、舱门关到什么程度，全由过场时间轴给 */
  A.drawHeli(g, hx, hy, game.t, {
    scale: 1,
    dir: -1,
    reach: c ? c.reach : undefined,
    doorShut: c ? c.door : 0,
    // 抓哪儿：直接用玩家上一帧那只举起来的手（drawCharacter 会把姿势旋转
    // 也算进去），手套就永远扣在手腕上，不用两边各推一遍位置
    grabTo: c && game.player.hands ? game.player.hands.left : null,
    inCabin,
  });

  /* 绳索：从舱门绞盘出去，先垂到天台边缘的落点。抓住之后末端跟着人走，
     而且不再画末端那个救援套环 —— 人抓着绳子的时候还在脚下挂一个跟他一样大
     的圈，看起来像踩着一个甜甜圈。 */
  if (rp && retract < 1) {
    let ex;
    let ey;
    if (rp.hold) {
      ex = tx;
      ey = ty + 2;
    } else {
      const drop = rp.down ? 1 : smoothstep(clamp(rp.t / 1.3, 0, 1));
      ex = lerp(an.x, gx, drop);
      ey = lerp(an.y, gy, drop);
    }
    /* 人进舱之后绞盘把绳收回去：末端一路缩回挂点，最后一小段再淡掉。
       以前这根绳会一直挂到过场结束，人明明已经上去了绳子还垂在那儿。 */
    if (retract > 0) {
      const k = smoothstep(retract);
      ex = lerp(ex, an.x, k);
      ey = lerp(ey, an.y, k);
      g.globalAlpha = 1 - clamp((retract - 0.75) / 0.25, 0, 1);
    }
    A.drawRope(g, an.x, an.y, ex, ey, game.t, rp.hold ? 0.25 : 1, !rp.hold);
    g.globalAlpha = 1;
  }

  if (drawP && !inCabin) drawP(g);
}

/** 玩家该不该由天空层来画：抓住绳子那一刻起，一直到进舱被门挡住 */
function skyPlayer() {
  if (game.player.hidden) return false;
  return !!(game.cine || (game.rope && game.rope.hold));
}

function render() {
  /* 镜头抖动对**所有层**用同一套已取整的偏移。以前 shx/shy 是浮点，静态层与
     道具各自 Math.round，烘焙光贴图又按浮点画，几层各进各的整数格，相对错开
     1px —— 那就是"换场景后有些物件在抖"的真正原因。 */
  const amp = game.shake > 0.05 ? game.shake : 0;
  const shx = amp ? snap((Math.random() - 0.5) * amp) : 0;
  const shy = amp ? snap((Math.random() - 0.5) * amp) : 0;
  const cam = { x: area.cam.x + shx, y: area.cam.y + shy };
  const p = game.player;

  // 整帧变焦：QTE 近景时把世界层整体放大，光照与几何才不会错位
  const zm = game.zoom || 1;
  if (zm > 1.001) {
    const za = game.zoomAtCur || game.zoomAt;
    /* QTE 期间焦点再往下压一点，两个角色就落在画面中上部 —— 键帽面板在下面
       三分之一，两者不再叠在一起。焦点被 clamp 夹住时这一下会自动打折。 */
    const lift = game.qte ? 20 : 0;
    const f = za
      ? {
          x: area.cam.x + (za.x - za.y) * HW,
          y: area.cam.y + (za.x + za.y) * HH - 14 - (za.z || 0) * TILE_Z + lift,
        }
      : { x: VIEW_W / 2, y: VIEW_H / 2 };
    /* 围着焦点慢慢摇一点。用 game.rt（真实秒）而不是 game.t —— 慢动作时
       世界几乎静止，镜头却应该继续走，这正是"电影感"的来源。
       幅度跟变焦量挂钩：不放大就完全不摇。 */
    if (game.qte) {
      const sw = (zm - 1) * 7;
      f.x += Math.sin(game.rt * 0.63) * sw;
      f.y += Math.sin(game.rt * 0.47 + 1.9) * sw * 0.55;
    }
    // 夹住焦点：视窗跑到 640×360 之外的话，那块没有光照贴图会变成一片死白
    const hw = VIEW_W / (2 * zm);
    const hh = VIEW_H / (2 * zm);
    const fxp = clamp(f.x, hw, VIEW_W - hw);
    const fyp = clamp(f.y, hh, VIEW_H - hh);
    viewXform.s = zm;
    viewXform.tx = VIEW_W / 2 - fxp * zm;
    viewXform.ty = VIEW_H / 2 - fyp * zm;
  } else {
    viewXform.s = 1;
    viewXform.tx = 0;
    viewXform.ty = 0;
  }

  applyScreen(ctx);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  applyView(ctx);

  /* 远景背景层（露天区域才有）：夜空、云、三层城市剪影、楼下的街区。
     它在世界之外，不参与等距排序，也不走墙面那套画法 —— 直接一张
     屏幕空间贴图铺在最底下，跟着镜头抖动与变焦一起走。 */
  if (area.backdrop) blit(ctx, area.backdrop, shx, shy);

  // 静态图层
  blit(ctx, area.statics.img, snap(cam.x - area.statics.ox), snap(cam.y - area.statics.oy));
  if (area.id === 'lab' && game.door.hits > 0) drawDoorDamage(ctx, cam);
  fx.drawDecals(ctx, cam);

  /* --- 深度排序 --- */
  const items = [];
  for (const pr of area.props) items.push({ k: pr.x + pr.y, pr });
  for (const z of horde.list) items.push({ k: z.x + z.y - (z.dead ? 0.5 : 0), z });

  let px = p.x;
  let py = p.y;
  let zOff = 0;
  let bodyRot = 0;

  if (game.state === 'wake') {
    const w = wakePose(game.phase);
    px = w.x;
    py = w.y;
    zOff = w.z * TILE_Z;
    bodyRot = w.rot;
  } else {
    zOff = (p.z || 0) * TILE_Z;
  }

  // 在床上时深度键要压过床本身，否则人会被床挡住
  const onBed = game.state === 'wake' && zOff > 2;
  items.push({ k: px + py + (onBed ? 0.7 : 0), player: true });

  // 吊在绳上/被拽进舱那一段由 drawSky 负责画，世界层这里跳过，否则会有两个人
  const cabinPlayer = skyPlayer();

  items.sort((a, b) => a.k - b.k);
  for (const it of items) {
    if (it.pr) {
      const sx = cam.x + (it.pr.x - it.pr.y) * HW;
      const sy = cam.y + (it.pr.x + it.pr.y) * HH - (it.pr.zOff || 0) * TILE_Z;
      blit(ctx, it.pr.s.img, snap(sx - it.pr.s.ox), snap(sy - it.pr.s.oy));
    } else if (it.z) {
      const zs = { x: cam.x + (it.z.x - it.z.y) * HW, y: cam.y + (it.z.x + it.z.y) * HH };
      drawZombie(ctx, zs.x, zs.y, it.z, false);
    } else if (!p.hidden && !cabinPlayer) {
      drawPlayerSprite(ctx, cam, px, py, zOff, bodyRot);
    }
  }

  // 近侧矮护墙：必须压在道具与角色之上
  if (area.fg) {
    blit(ctx, area.fg.img, snap(cam.x - area.fg.ox), snap(cam.y - area.fg.oy));
  }

  fx.draw(ctx, cam);
  if (area.fire) drawFire(ctx, cam);

  /* --- 光照 --- */
  const litX = px;
  const litY = py;
  const pvis = computeVisibility(litX, litY, area.segments);

  // 区域可以自带更暗的环境光（天台的雨夜）
  lighting.ambient = area.ambient || AMBIENT_DEFAULT;
  lighting.begin();

  // 露天：天空光。屋面之外的背景层靠它露出来，不然会被 area.dark 压成纯黑
  if (area.skyLight) lighting.addBaked(area.skyLight, 1, shx, shy);

  let buzzLevel = 0;
  for (const L of area.lights) {
    const power = L.power * lightLevel(L);
    if (L.mode === undefined && L.id === 'tube1') buzzLevel = Math.max(buzzLevel, power);
    if (L.mode === 1 || L.mode === 0) buzzLevel = Math.max(buzzLevel, power * 0.7);
    if (game.noBake) lighting.add({ x: L.x, y: L.y, r: L.r, color: L.color, power, vis: L.vis, cam });
    else lighting.addBaked(L.tex, power, shx, shy);
  }
  SFX.setBuzz(1 - buzzLevel);

  // 角色周围的一点自体可见度，避免完全隐入黑暗
  lighting.add({ x: litX, y: litY, r: 1.7, color: [150, 168, 178], power: 0.12, vis: pvis, cam, blur: 2.5 });

  // 搏斗 QTE：给扭打处补一盏小的动态光。雨夜的天台本来就黑，近景又把手电
  // 的光锥推出了画面，不补光的话这一段只剩两团黑影在动。
  if (game.qte && game.qte.id === 'fight' && game.tentZ && !game.tentZ.dead) {
    const z = game.tentZ;
    lighting.add({
      x: (px + z.x) / 2, y: (py + z.y) / 2, r: 3.6, color: [226, 214, 188], power: 0.6, vis: pvis, cam, blur: 2.2,
    });
  }

  // 手电筒
  const flashHand = INV.equipped('flashlight');
  if (game.state !== 'wake' && flashHand && inv.flashOn) {
    const a = p.aim;
    const side = flashHand === 'left' ? 0.16 : -0.16;
    const ox = px + Math.cos(a + side * 3) * 0.18;
    const oy = py + Math.sin(a + side * 3) * 0.18;
    const jitter = 1 + Math.sin(game.t * 23) * 0.015;
    const coneHot = computeVisibilityCone(ox, oy, area.segments, a, 0.15);
    lighting.add({ x: ox, y: oy, r: 9.6 * jitter, color: [255, 250, 228], power: 1, vis: coneHot, cam, blur: 1 });
    const coneMain = computeVisibilityCone(ox, oy, area.segments, a, 0.34);
    lighting.add({ x: ox, y: oy, r: 8.2 * jitter, color: [255, 244, 210], power: 0.88, vis: coneMain, cam, blur: 1.4 });
    const coneWide = computeVisibilityCone(ox, oy, area.segments, a, 0.88);
    lighting.add({ x: ox, y: oy, r: 4.4, color: [232, 230, 212], power: 0.24, vis: coneWide, cam, blur: 3.5 });
    lighting.add({ x: ox, y: oy, r: 2.1, color: [214, 222, 224], power: 0.17, vis: pvis, cam });
  }

  // 枪口闪光
  if (game.flash > 0) {
    const k = game.flash / 0.075;
    const mx = px + Math.cos(p.aim) * 0.6;
    const my = py + Math.sin(p.aim) * 0.6;
    lighting.add({ x: mx, y: my, r: 9, color: [255, 232, 170], power: 1.1 * k, vis: pvis, cam, blur: 2 });
    lighting.addFlat([255, 236, 190], 0.1 * k);
  }

  // 火花点光
  for (const s of fx.sparkLights()) {
    lighting.add({ x: s.x, y: s.y, r: 2.2, color: [180, 214, 255], power: 0.5 * s.k, vis: pvis, cam, blur: 2 });
  }

  /* 闪电：整帧加亮一次，然后拖一段余辉。走 addFlat 而不是再加一盏点光，
     省掉一次可见性计算，也不会在地面上留下奇怪的圆形亮斑。 */
  if (game.storm && game.storm.flash > 0.01) {
    const k = game.storm.flash;
    const s = k > 0.78 ? 1 : k / 0.78; // 起手瞬间最亮
    lighting.addFlat([172, 198, 226], 0.6 * s * s);
  }

  // 直升机探照灯扫在天台上：只在它悬停之后给
  if (game.heli && game.heli.k >= 0.55) {
    const k = (game.heli.k - 0.55) / 0.45;
    lighting.add({
      x: px, y: py, r: 5.6, color: [210, 226, 236], power: 0.5 * Math.min(1, k), vis: pvis, cam, blur: 2.4,
    });
  }

  /* losOcclusion 打开时用玩家可见多边形裁剪光照（看不见视野外的东西）；
     关闭时只用房间轮廓做裁剪，光线遮挡（阴影）依然保留。
     露天区域（area.noMask）两条都不走：房间轮廓裁剪会把天台封成一个室内
     盒子，天空直接变黑。那里每盏灯自己的可见多边形已经把光框住了，
     不需要再套一层房间遮罩。 */
  if (!game.noLight) {
    const mask = area.noMask
      ? null
      : game.losOcclusion
        ? pvis
        : game.noBake
          ? area.roomVis
          : { tex: area.mask, dx: shx, dy: shy };
    lighting.finish(ctx, mask, cam, area.dark);
  }

  /* --- 灯具：外壳 + 亮着的灯管 --- */
  for (const f of area.fixtures) {
    const L = area.lights.find((l) => l.id === f.light);
    const i = (L ? lightLevel(L) : 0) * 0.9;
    drawFixtureBody(ctx, cam, f, i);
    drawFixtureGlow(ctx, cam, f, i);
  }
  drawHighlight(ctx, cam);
  if (area.id === 'lab') drawEmissive(ctx, cam);
  drawAreaGlow(ctx, cam);
  drawSky(ctx, cam, px, py, zOff);

  // 火花闪光的额外辉光
  if (area.id === 'lab' && game.sparkPower > 0.02) {
    const sp = {
      x: cam.x + (SPARK_SRC.x - SPARK_SRC.y) * HW,
      y: cam.y + (SPARK_SRC.x + SPARK_SRC.y) * HH - SPARK_SRC.z * TILE_Z,
    };
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, 26);
    grd.addColorStop(0, `rgba(190,220,255,${0.5 * game.sparkPower})`);
    grd.addColorStop(1, 'rgba(190,220,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(sp.x - 26, sp.y - 26, 52, 52);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* --- 以下是屏幕空间层：不跟着近景变焦缩放 --- */
  applyScreen(ctx);

  // 雨：画在光照之后，所以不会被压黑；两次 stroke，不做 filter: blur()
  if (game.storm) {
    rain.draw(ctx, 1 + game.storm.flash * 1.6);
    // 闪电的那一下在雨幕上也要能看见
    if (game.storm.flash > 0.02) {
      ctx.fillStyle = `rgba(196,214,236,${0.14 * game.storm.flash * game.storm.flash})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  // 受伤红闪 / 死亡黑幕
  if (game.hurtFlash > 0.002) {
    ctx.fillStyle = `rgba(120,20,16,${0.34 * game.hurtFlash})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (game.state === 'dead') {
    // 前 1.2 秒先让尸潮压上来，之后才黑屏
    // 红色只压一层薄的：这一段的重点是让玩家看见尸潮压上来
    const k = clamp((game.phase - 1.2) / 1.6, 0, 1);
    ctx.fillStyle = `rgba(90,14,10,0.16)`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = `rgba(0,0,0,${0.95 * k})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  // 换区域的淡入淡出
  const ta = transAlpha();
  if (ta > 0.002) {
    ctx.fillStyle = `rgba(0,0,0,${ta})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // 醒来时的黑幕 / 眨眼
  if (game.state === 'wake' || game.fade > 0.002) {
    let a = game.fade;
    const t = game.phase;
    if (t > 0.9 && t < 1.05) a = Math.max(a, 0.85);
    if (t > 1.35 && t < 1.45) a = Math.max(a, 0.6);
    if (game.fadeOff) a = 0;
    if (a > 0.002) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
  }

  // 画面内准星只给触屏用：触屏没有鼠标指针。键鼠一律用跟随光标的准星，
  // 有枪没枪是同一套形态，只是没枪时更小更淡，避免出现两套不同的准星。
  const armedNow = !!handOf('pistol');
  if (pad.enabled && game.state === 'play' && !game.bagOpen) {
    applyView(ctx);
    const armed = armedNow;
    const d = armed ? 2.9 : 2.0;
    const rx = px + Math.cos(p.aim) * d;
    const ry = py + Math.sin(p.aim) * d;
    const sx = cam.x + (rx - ry) * HW;
    const sy = cam.y + (rx + ry) * HH;
    const k = armed ? 1 : 0.62;
    ctx.save();
    ctx.globalAlpha = armed ? 0.85 : 0.55;
    ctx.strokeStyle = '#ded8c8';
    ctx.lineWidth = 1;
    const r = 4.5 + game.gun.recoil * 3;
    for (const [ax, ay] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      ctx.beginPath();
      ctx.moveTo(sx + ax * (r * 0.45), sy + ay * (r * 0.45) * 0.6);
      ctx.lineTo(sx + ax * r, sy + ay * r * 0.6);
      ctx.stroke();
    }
    ctx.fillStyle = '#ded8c8';
    ctx.fillRect(sx - 0.6, sy - 0.6, 1.4 * k, 1.4 * k);
    ctx.restore();
    applyScreen(ctx);
  }

  // 互动提示跟随物体：世界坐标 -> 画布坐标 -> 舞台 CSS 像素。
  // 画布坐标要先过一遍当前变焦，否则近景时提示会飘在物体外面。
  const it = game.interact;
  if (!pad.enabled && it && it.anchor && !game.bagOpen && game.state === 'play') {
    const an = it.anchor;
    const a0 = viewPt(cam.x + (an.x - an.y) * HW, cam.y + (an.x + an.y) * HH - an.z * TILE_Z);
    UI.setPromptAt(a0.x * view.scale, a0.y * view.scale, VIEW_W * view.scale, VIEW_H * view.scale);
  }

  // 准星
  const showCur = (game.state === 'play' || game.state === 'wake') && !game.bagOpen && !pad.enabled;
  if (showCur !== game.curShown) {
    game.curShown = showCur;
    UI.showCursor(showCur);
  }
  if (showCur) {
    const sp = game.gun.recoil * 0.5 + (game.player.moving ? 0.18 : 0);
    UI.moveCursor(mouse.x * view.scale, mouse.y * view.scale, sp);
  }
}

/* ------------------------------------------------------------------ *
 * 主循环
 * ------------------------------------------------------------------ */

UI.initUI();
INV.initInventory();
initDevcon(runDevCommand);
initControls(doAction);
if (pad.enabled) {
  setButton('interact', false);
  setButton('fire', false);
  setButton('reload', false);
  setButton('flash', false);
}
syncHUD();
UI.setLosState(game.losOcclusion);

let last = performance.now();
function frame(now) {
  const rdt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.rdt = rdt;
  game.rt += rdt;
  // 慢动作只作用在世界上；镜头与 QTE 计时用 game.rdt
  game.timescale += (game.tsTarget - game.timescale) * Math.min(1, rdt * 7);
  syncPixelGrid();
  update(rdt * game.timescale);
  render();
  present();
  endFrame();
  endFrameControls();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 调试用
window.__game = game;
window.__area = () => area;
window.__horde = horde;
window.__goto = (id, spawn) => enterArea(id, spawn);
window.__inv = INV;
window.__pad = pad;
window.__render = render; // 供性能基准脚本直接测量渲染耗时
/** 跳过标题与起床过场，供测试脚本快进（每个页面省 4 秒多） */
window.__skipIntro = () => {
  UI.hideTitle();
  game.state = 'play';
  game.phase = 9;
  game.fade = 0;
  game.player.x = PLAYER_START.x;
  game.player.y = PLAYER_START.y;
  SFX.initAudio();
  setPadVisible(true);
};

/* ---- 序章后半段的快进钩子 ----
 *
 *   __skipIntro()                 跳过标题与起床
 *   __goto('dorm312', 'enter')    直接进 312，自动触发对讲机呼叫
 *   __goto('corr3', 'fromDorm')   312 门口的三层走廊（东端就是天台门）
 *   __goto('stairRoof', 'fromCorr3')  天台楼梯间，往上走即上天台
 *   __goto('roof', 'fromStair')   直接上天台（雨、帐篷、直升机都在这里）
 *
 * 天台门在对讲机剧情走完前是锁着的。想跳过剧情直接上去，用 __arm() 先把
 * 装备和 radio.done 一起补齐，或者直接 __toRoof()。
 */

/** 补齐手电筒 / 手枪 / 弹匣，并把对讲机剧情标记成已完成 */
window.__arm = () => {
  if (!INV.has('flashlight')) INV.addItem('flashlight');
  if (!INV.has('pistol')) INV.addItem('pistol');
  if (INV.countItem('mag') < START_SPARE_MAGS) INV.addItem('mag', START_SPARE_MAGS);
  INV.quickEquip('flashlight');
  INV.quickEquip('pistol');
  game.door.tried = true;
  game.door.broken = true;
  game.radio = { phase: 'done', step: 0, t: 0, done: true };
  syncHUD();
};

/** 一步到天台：跳过场 + 补装备 + 跳过对讲机 */
window.__toRoof = () => {
  window.__skipIntro();
  window.__arm();
  enterArea('roof', 'fromStair');
};

/** 一步到 312 听对讲机 */
window.__toRadio = () => {
  window.__skipIntro();
  window.__arm();
  game.radio = { phase: 'idle', step: 0, t: 0, done: false };
  enterArea('dorm312', 'enter');
};

const DEV_HELP = [
  'roof              上天台（补装备、跳过对讲机）',
  'radio / 312       进 312 听对讲机',
  'arm               补装备并解锁天台门',
  'skip              跳过标题与起床',
  'lab corr2 stair corr3 corr1 stairroof',
  'goto <区域> [出生点]   例如 goto roof fromStair',
  'where             当前区域',
  'clear             清屏',
  'help              本说明',
].join('\n');

const AREA_ALIAS = {
  lab: ['lab', 'start'],
  corr2: ['corr2', 'fromLab'],
  stair: ['stair', 'respawn'],
  corr3: ['corr3', 'fromStair'],
  corr1: ['corr1', 'fromStair'],
  stairroof: ['stairRoof', 'fromCorr3'],
  roof: ['roof', 'fromStair'],
  '312': ['dorm312', 'enter'],
  dorm312: ['dorm312', 'enter'],
};

function runDevCommand(line) {
  const parts = line.trim().split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const a = parts[1];
  const b = parts[2];

  if (cmd === 'help' || cmd === '?') return DEV_HELP;

  if (cmd === 'skip' || cmd === 'intro') {
    window.__skipIntro();
    return '跳过标题';
  }
  if (cmd === 'arm') {
    window.__arm();
    return '已装备，天台门解锁';
  }
  if (cmd === 'roof') {
    window.__toRoof();
    closeDevcon();
    return '→ 天台';
  }
  if (cmd === 'radio' || cmd === '312') {
    window.__toRadio();
    closeDevcon();
    return '→ 312';
  }
  if (cmd === 'where') {
    const p = game.player;
    return (area.id || '?') + '  ' + p.x.toFixed(1) + ',' + p.y.toFixed(1);
  }
  if (cmd === 'goto') {
    if (!a) return '? goto <区域> [出生点]';
    const id = a === 'stairroof' ? 'stairRoof' : a === '312' ? 'dorm312' : a;
    if (!AREA_ALIAS[id.toLowerCase()] && !AREA_ALIAS[id]) {
      // 允许正式 id
      const ok = ['lab', 'corr2', 'corr3', 'corr1', 'stair', 'stairRoof', 'roof', 'dorm312'];
      if (ok.indexOf(id) < 0) return '? 没有区域 ' + a;
    }
    enterArea(id, b || undefined);
    game.state = 'play';
    UI.hideTitle();
    return '→ ' + id + (b ? ' / ' + b : '');
  }
  if (AREA_ALIAS[cmd]) {
    const [id, spawn] = AREA_ALIAS[cmd];
    window.__skipIntro();
    enterArea(id, spawn);
    return '→ ' + id;
  }
  return '? 未知指令，输入 help';
}
