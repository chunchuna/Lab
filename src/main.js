import {
  VIEW_W, VIEW_H, HW, HH, TILE_W, TILE_Z, WALL_H,
  PLAYER_R, PLAYER_SPEED, MAG_SIZE, START_SPARE_MAGS, RELOAD_TIME, FIRE_COOLDOWN,
} from './config.js';
import { toWorld, wallNorthPt, wallNorthTransform } from './iso.js';
import {
  DOOR, DOOR_SPOT, LOCKER_POS, LOCKER_SPOT, BED_POS, PLAYER_START, SCANNER,
  SPARK_SRC, SCREEN_SRC,
} from './level.js';
import { getArea, EXIT_SIGN } from './areas.js';
import { Horde, drawZombie } from './zombies.js';
import { computeVisibility, computeVisibilityCone, raycast, lineOfSight } from './visibility.js';
import { Lighting } from './lighting.js';
import { FX } from './fx.js';
import * as A from './art.js';
import * as UI from './ui.js';
import * as SFX from './audio.js';
import * as INV from './inventory.js';
import { inv } from './inventory.js';
import { initInput, keys, mouse, justPressed, endFrame, view } from './input.js';
import {
  pad, initControls, setButton, setPadVisible, endFrameControls, screenDirToWorld,
} from './controls.js';
import { clamp, flicker, lerp } from './util.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const stage = document.getElementById('stage');

const lighting = new Lighting();
const fx = new FX();
const horde = new Horde();

const BED_TOP = 0.86;
const PLAYER_HP = 4;

let area = getArea('lab');

const game = {
  t: 0,
  state: 'title', // title | wake | play | scan | dead
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
  radioStep: -1,
  radioT: 0,
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
  a.lit = true;
}
ensureAreaLights(area);

/* ------------------------------------------------------------------ *
 * 输入
 * ------------------------------------------------------------------ */

initInput(stage, (k) => {
  SFX.initAudio();
  SFX.resume();

  if (game.state === 'title') {
    startWake();
    return;
  }
  if (game.state !== 'play') return;

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

function enterArea(id, spawnName) {
  area = getArea(id);
  ensureAreaLights(area);
  const sp = area.spawns[spawnName] || area.spawns.start || { x: area.w / 2, y: area.h / 2 };
  game.player.x = sp.x;
  game.player.y = sp.y;
  game.areaT = 0;
  game.hordeReleased = false;
  game.doomed = 0;
  game.lastPrompt = '';
  game.interact = null;
  UI.setPrompt(null);
  fx.decals.length = 0;
  horde.clear();
  if (id !== 'corr2') game.radioStep = id === 'dorm312' ? -1 : game.radioStep;
  UI.msg(area.name, 'good');
  SFX.sfxThud();
  game.shake = 1.6;
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
  if (r === 'unequipped') UI.msg('收起了' + INV.ITEMS[item].name + '。');
  else if (r === 'left' || r === 'right') UI.msg((r === 'left' ? '左手' : '右手') + '装备：' + INV.ITEMS[item].name, 'good');
  else if (r === 'full') UI.msg('背包已满。', 'warn');
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
    return { id: 'link', link: lk, text: lk.text, short: lk.short, anchor: lk.anchor, target: lk.target };
  }
  if (area.id !== 'lab') {
    if (area.radio && dist(p.x, p.y, area.radio.x, area.radio.y + 0.9) < 1.5 && game.radioStep < 0) {
      return {
        id: 'radio',
        text: '拿起对讲机',
        short: '对讲机',
        target: 'desk',
        anchor: { x: area.radio.x, y: area.radio.y, z: 1.5 },
      };
    }
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

function tryInteract() {
  const it = currentInteract();
  if (!it) return;
  if (it.id === 'link') {
    enterArea(it.link.to, it.link.spawn);
    return;
  }
  if (it.id === 'radio') {
    startRadio();
    return;
  }
  if (it.id === 'doorOpen') {
    enterArea('corr2', 'fromLab');
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
      UI.msg('人脸识别系统错误 —— 门禁保持锁定。', 'warn');
      UI.setObjective('门打不开，在房间里找找别的办法');
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
    UI.msg('柜门吱呀一声弹开了。里面有东西。', 'good');
  } else if (it.id === 'loot') {
    game.locker.looted = true;
    const p = area.props.find((q) => q.id === 'locker');
    p.s = area.sprites.lockerEmpty;
    INV.addItem('flashlight');
    INV.addItem('pistol');
    INV.addItem('mag', START_SPARE_MAGS);
    SFX.sfxPickup();
    UI.msg('放进背包：手电筒 · 手枪 M1911 · 备用弹匣 x' + START_SPARE_MAGS, 'good');
    UI.setObjective('打开背包（I），把手电筒和手枪拖到左右手');
    setTimeout(() => {
      if (game.state === 'play' && !game.bagOpen) toggleBag();
    }, 700);
  } else if (it.id === 'bed') {
    if (!game.gotBadge) {
      game.gotBadge = true;
      INV.addItem('badge');
      SFX.sfxPickup();
      UI.msg('约束带被从内侧割断了。枕头下压着一张员工卡 —— 已经消磁。', 'good');
    } else {
      UI.msg('约束带被从内侧割断了。是谁放你出来的？');
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
    UI.msg('弹匣已满。');
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
    UI.msg('咔哒 —— 弹匣空了。按 R 换弹。', 'warn');
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

const DOOR_MSG = [
  '门板凹进去一块，锁体那边发出金属摩擦的声响 —— 有用。',
  '识别终端炸开火花，门被撬出一道缝。再来一发。',
];

function shootDoor() {
  const d = game.door;
  if (d.broken) return;
  if (!d.tried) {
    // 还没试过门禁，玩家不该知道要打门
    if (!d.hinted) {
      d.hinted = true;
      UI.msg('子弹在合金门上打出一个白点。也许该先弄清楚门是怎么锁的。');
    }
    return;
  }
  d.hits++;
  game.shake = 5.5;
  SFX.sfxImpact(true);
  fx.spark(DOOR.cx / TILE_W, 0.05, 1.4, 16, 1.2);
  if (d.hits < 3) {
    UI.msg(DOOR_MSG[d.hits - 1], 'good');
    SFX.sfxError();
  } else {
    d.broken = true;
    d.hits = 3;
    game.shake = 9;
    SFX.sfxThud();
    SFX.sfxServo(false);
    fx.spark(DOOR.cx / TILE_W, 0.05, 1.2, 34, 1.6);
    fx.dust(DOOR.cx / TILE_W, 0.6, 0.4, 12);
    UI.msg('锁体崩开了。门被硬生生顶出一道能过人的口子。', 'good');
    UI.setObjective('出去看看走廊');
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

function movePlayer(dt) {
  const p = game.player;
  const mv = moveIntent();
  p.moving = mv.mag > 0.02;
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

function updateAim() {
  const p = game.player;
  if (pad.enabled) {
    // 右摇杆给的是屏幕方向，转成世界角度
    const w = screenDirToWorld(pad.aim.x, pad.aim.y);
    p.aim = Math.atan2(w.y, w.x);
  } else {
    const w = toWorld(mouse.x - area.cam.x, mouse.y - area.cam.y);
    p.aim = Math.atan2(w.y - p.y, w.x - p.x);
  }
  p.aimScreen = normScreenDir(p.aim);
}

function normScreenDir(a) {
  const x = (Math.cos(a) - Math.sin(a)) * HW;
  const y = (Math.cos(a) + Math.sin(a)) * HH;
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
}

function update(dt) {
  game.t += dt;
  fx.update(dt);
  game.shake *= Math.pow(0.0015, dt);
  game.flash = Math.max(0, game.flash - dt);
  game.gun.recoil = Math.max(0, game.gun.recoil - dt * 6);

  game.hurtFlash = Math.max(0, game.hurtFlash - dt * 2.2);
  game.player.invuln = Math.max(0, game.player.invuln - dt);

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

  if (game.state === 'dead') {
    game.phase += dt;
    if (game.phase > 3.2) respawn();
    return;
  }

  if (game.state === 'wake') {
    game.phase += dt;
    game.fade = clamp(1 - (game.phase - 0.2) / 1.1, 0, 1);
    if (game.phase > 1.65 && game.phase < 1.72) SFX.sfxStep();
    if (game.phase > 3.5) {
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

  if (game.bagOpen) {
    game.player.moving = false;
    game.player.walk = lerp(game.player.walk, 0, Math.min(1, dt * 10));
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
      UI.msg('换弹完成。剩余备用弹匣：' + INV.countItem('mag'));
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
    if (pad.enabled) setButton('interact', !!text, it ? it.short || '互动' : '互动');
    else UI.setPrompt(text || null);
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
  if (p.hp <= 0) die('你被撕开了。');
  else UI.msg('被咬到了！', 'warn');
};

function updateAreaEvents(dt) {
  game.areaT += dt;

  // 二层：到达约 10 秒后从右端涌出丧尸
  if (area.horde && !game.hordeReleased && game.areaT > area.horde.delay) {
    game.hordeReleased = true;
    horde.release(area.horde.count, { x: area.horde.x, y: area.horde.y }, 0.38);
    UI.msg('走廊尽头传来拖行的脚步声 —— 很多。', 'warn');
    UI.setObjective('往楼梯间退，边退边打');
    SFX.sfxError();
    game.shake = 3;
  }

  // 一层：进来 5 秒后被扑倒，强制剧情杀
  if (area.doom && !game.doomed && game.areaT > area.doom.delay) {
    game.doomed = 1;
    horde.release(14, area.doom.from, 0.12);
    UI.msg('身后的黑暗里同时亮起几十双眼睛。', 'warn');
    SFX.sfxError();
    game.shake = 6;
  }
  if (area.doom && game.doomed === 1 && game.areaT > area.doom.delay + 2.6) {
    game.doomed = 2;
    die('一层全是它们。你没能跑出三步。');
  }

  // 对讲机播报
  if (game.radioStep >= 0 && game.radioStep < RADIO_LINES.length) {
    game.radioT -= dt;
    if (game.radioT <= 0) {
      const line = RADIO_LINES[game.radioStep];
      UI.msg(line.t, line.warn ? 'warn' : '');
      SFX.sfxBeep(line.warn ? 320 : 760, 0.05, 0.07);
      game.radioT = line.d;
      game.radioStep++;
      if (game.radioStep >= RADIO_LINES.length) {
        UI.setObjective('这里暂时安全');
      }
    }
  }
}

const RADIO_LINES = [
  { t: '……沙沙……有人吗？还有人在听吗……', d: 3.4 },
  { t: '这里是三层，312。我把门堵住了，撑不了太久。', d: 3.6 },
  { t: '别去一层。一层全是它们。', d: 3.4, warn: true },
  { t: '……如果你能到天台……信号塔那边还有一条路……', d: 3.8 },
  { t: '……沙沙……（信号断了）', d: 2.6 },
];

function startRadio() {
  game.radioStep = 0;
  game.radioT = 0.4;
  SFX.sfxClick();
  UI.msg('对讲机还有电。你按下了通话键。', 'good');
}

function die(reason) {
  if (game.state === 'dead') return;
  game.state = 'dead';
  game.phase = 0;
  game.deathReason = reason;
  game.shake = 8;
  SFX.sfxThud();
  UI.setPrompt(null);
  setPadVisible(false);
  UI.msg(reason, 'warn');
}

function respawn() {
  const p = game.player;
  p.hp = PLAYER_HP;
  p.invuln = 1.6;
  game.state = 'play';
  game.fade = 1;
  setPadVisible(true);
  horde.clear();
  // 一律回到楼梯间
  enterArea('stair', 'respawn');
  game.gun.mag = MAG_SIZE;
  if (INV.countItem('mag') < 1) INV.addItem('mag', 1);
  UI.setObjective('再想想该往哪走');
  syncHUD();
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

function playerScreen(cam, p) {
  return { x: cam.x + (p.x - p.y) * HW, y: cam.y + (p.x + p.y) * HH };
}

const ISO_ANG = Math.atan2(HH, HW);
const ISO_UNIT = Math.hypot(HW, HH);

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
  const sy = cam.y + (pr.x + pr.y) * HH;
  g.save();
  g.globalAlpha = a;
  g.drawImage(ring.img, Math.round(sx - pr.s.ox - ring.pad), Math.round(sy - pr.s.oy - ring.pad));
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

function resetTransform(g) {
  g.setTransform(1, 0, 0, 1, 0, 0);
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

/** 区域里的自发光小物件：安全出口灯、对讲机指示灯 */
function drawAreaGlow(g, cam) {
  if (area.id === 'stair') {
    const s = wallNorthPt(EXIT_SIGN.x * TILE_W, 20, cam.x, cam.y);
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
    const on = game.radioStep >= 0 && game.radioStep < RADIO_LINES.length;
    const k = on ? 0.5 + 0.5 * Math.sin(game.t * 14) : 0.35 + 0.2 * Math.sin(game.t * 1.6);
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

function render() {
  const shx = game.shake > 0.05 ? (Math.random() - 0.5) * game.shake : 0;
  const shy = game.shake > 0.05 ? (Math.random() - 0.5) * game.shake : 0;
  const cam = { x: area.cam.x + shx, y: area.cam.y + shy };
  const p = game.player;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 静态图层
  ctx.drawImage(area.statics.img, Math.round(cam.x - area.statics.ox), Math.round(cam.y - area.statics.oy));
  if (area.id === 'lab' && game.door.hits > 0) drawDoorDamage(ctx, cam);
  fx.drawDecals(ctx, cam);

  /* --- 深度排序 --- */
  const items = [];
  for (const pr of area.props) items.push({ k: pr.x + pr.y, pr });
  for (const z of horde.list) items.push({ k: z.x + z.y - (z.dead ? 0.5 : 0), z });

  let px = p.x;
  let py = p.y;
  let zOff = 0;
  let vscale = 1;
  let lying = false;

  if (game.state === 'wake') {
    const t = game.phase;
    if (t < 1.6) {
      lying = true;
    } else if (t < 2.6) {
      const k = (t - 1.6) / 1.0;
      px = BED_POS.x + 0.55;
      py = BED_POS.y + 0.5;
      zOff = BED_TOP * TILE_Z;
      vscale = 0.45 + 0.55 * k;
    } else {
      const k = Math.min(1, (t - 2.6) / 0.9);
      px = lerp(BED_POS.x + 0.55, PLAYER_START.x, k);
      py = lerp(BED_POS.y + 0.5, PLAYER_START.y, k);
      zOff = BED_TOP * TILE_Z * (1 - k);
    }
  }

  if (!lying) items.push({ k: px + py, player: true });

  items.sort((a, b) => a.k - b.k);
  for (const it of items) {
    if (it.pr) {
      const sx = cam.x + (it.pr.x - it.pr.y) * HW;
      const sy = cam.y + (it.pr.x + it.pr.y) * HH;
      ctx.drawImage(it.pr.s.img, Math.round(sx - it.pr.s.ox), Math.round(sy - it.pr.s.oy));
      if (it.pr.id === 'bed' && lying) {
        A.drawLying(ctx, Math.round(sx), Math.round(sy - BED_TOP * TILE_Z), game.t);
      }
    } else if (it.z) {
      const zs = { x: cam.x + (it.z.x - it.z.y) * HW, y: cam.y + (it.z.x + it.z.y) * HH };
      drawZombie(ctx, zs.x, zs.y, it.z, false);
    } else {
      const s = playerScreen(cam, { x: px, y: py });
      const kick = game.gun.recoil * 1.6;
      const aimS = p.aimScreen || { x: 1, y: 0.5 };
      ctx.save();
      if (vscale !== 1) {
        ctx.translate(s.x, s.y - zOff);
        ctx.scale(1, vscale);
        ctx.translate(-s.x, -(s.y - zOff));
      }
      A.drawCharacter(ctx, s.x - aimS.x * kick, s.y - zOff - aimS.y * kick, {
        scale: 1.12,
        aim: aimS,
        walk: p.walk,
        moving: p.moving && game.state === 'play',
        leftItem: game.state === 'play' ? INV.handItem('left') : null,
        rightItem: game.state === 'play' ? INV.handItem('right') : null,
        flashOn: inv.flashOn,
      });
      ctx.restore();
    }
  }

  // 近侧矮护墙：必须压在道具与角色之上
  if (area.fg) {
    ctx.drawImage(area.fg.img, Math.round(cam.x - area.fg.ox), Math.round(cam.y - area.fg.oy));
  }

  fx.draw(ctx, cam);
  if (area.fire) drawFire(ctx, cam);

  /* --- 光照 --- */
  const litX = lying ? BED_POS.x + 0.4 : px;
  const litY = lying ? BED_POS.y : py;
  const pvis = computeVisibility(litX, litY, area.segments);

  lighting.begin();

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

  // losOcclusion 打开时用玩家可见多边形裁剪光照（看不见视野外的东西）；
  // 关闭时只用房间轮廓做裁剪，光线遮挡（阴影）依然保留。
  if (!game.noLight) {
    const mask = game.losOcclusion
      ? pvis
      : game.noBake
        ? area.roomVis
        : { tex: area.mask, dx: shx, dy: shy };
    lighting.finish(ctx, mask, cam);
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

  // 受伤红闪 / 死亡黑幕
  if (game.hurtFlash > 0.002) {
    ctx.fillStyle = `rgba(120,20,16,${0.34 * game.hurtFlash})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (game.state === 'dead') {
    const k = Math.min(1, game.phase / 1.6);
    ctx.fillStyle = `rgba(0,0,0,${0.92 * k})`;
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

  // 画面内准星：触屏没有鼠标指针；键鼠在没拿到枪之前也需要一个朝向指示
  const armedNow = !!handOf('pistol');
  if ((pad.enabled || !armedNow) && game.state === 'play' && !game.bagOpen) {
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
  }

  // 互动提示跟随物体：世界坐标 -> 画布坐标 -> 舞台 CSS 像素
  const it = game.interact;
  if (!pad.enabled && it && it.anchor && !game.bagOpen && game.state === 'play') {
    const an = it.anchor;
    const ax = cam.x + (an.x - an.y) * HW;
    const ay = cam.y + (an.x + an.y) * HH - an.z * TILE_Z;
    UI.setPromptAt(ax * view.scale, ay * view.scale, VIEW_W * view.scale, VIEW_H * view.scale);
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
initControls(doAction);
if (pad.enabled) {
  setButton('interact', false);
  setButton('fire', false);
  setButton('reload', false);
  setButton('flash', false);
}
syncHUD();
UI.setLosState(game.losOcclusion);
UI.setObjective('离开这个房间');

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
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
