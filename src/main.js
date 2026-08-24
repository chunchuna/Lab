import {
  VIEW_W, VIEW_H, HW, HH, TILE_W, TILE_Z, ROOM_W, ROOM_H, WALL_H,
  PLAYER_R, PLAYER_SPEED, MAG_SIZE, START_SPARE_MAGS, RELOAD_TIME, FIRE_COOLDOWN,
} from './config.js';
import { CAM, toWorld, wallNorthPt } from './iso.js';
import {
  buildLevel, DOOR, DOOR_SPOT, LOCKER_SPOT, BED_POS, PLAYER_START, SCANNER, SPARK_SRC, SCREEN_SRC,
} from './level.js';
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

const level = buildLevel();
const lighting = new Lighting();
const fx = new FX();

const BED_TOP = 0.86;

const game = {
  t: 0,
  state: 'title', // title | wake | play | scan
  phase: 0,
  shake: 0,
  flash: 0,
  fade: 1,
  player: { x: BED_POS.x, y: BED_POS.y, aim: 0.9, walk: 0, moving: false, stepT: 0 },
  /** 真实视线遮挡（看不到视野外/被遮挡的区域）。代码保留，默认关闭，V 键切换 */
  losOcclusion: false,
  bagOpen: false,
  gun: { mag: MAG_SIZE, reload: 0, cool: 0, recoil: 0, clicks: 0 },
  locker: { open: false, looted: false },
  doorTried: false,
  nextSpark: 1.2,
  sparkPower: 0,
  lastPrompt: '',
};

/* 静态光源的可见多边形只需算一次，并按满功率烘焙成贴图：
   每帧只剩一次 drawImage，省掉 5 组渐变填充与模糊合成。 */
for (const L of level.lights) {
  L.vis = computeVisibility(L.x, L.y, level.segments);
  L.tex = lighting.bakeLight({ x: L.x, y: L.y, r: L.r, color: L.color, vis: L.vis, cam: CAM });
}
/* 关闭视线遮挡时裁剪遮罩是固定的，同样预烘焙（含模糊） */
const ROOM_MASK = lighting.bakeMask(level.roomVis, CAM);

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
  if (dist(p.x, p.y, DOOR_SPOT.x, DOOR_SPOT.y) < 1.9) {
    return { id: 'door', text: game.doorTried ? '再次尝试人脸识别' : '使用人脸识别面板', short: '识别' };
  }
  if (dist(p.x, p.y, LOCKER_SPOT.x, LOCKER_SPOT.y) < 1.7) {
    if (!game.locker.open) return { id: 'locker', text: '打开应急储物柜', short: '开柜' };
    if (!game.locker.looted) return { id: 'loot', text: '取出柜内物品', short: '拿取' };
    return { id: 'lockerEmpty', text: '储物柜已空', short: '空柜' };
  }
  if (dist(p.x, p.y, BED_POS.x, BED_POS.y + 1.1) < 1.5) return { id: 'bed', text: '查看实验床', short: '查看' };
  return null;
}

function tryInteract() {
  const it = currentInteract();
  if (!it) return;
  if (it.id === 'door') {
    game.state = 'scan';
    game.doorTried = true;
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
    const p = level.props.find((q) => q.id === 'locker');
    p.s = level.sprites.lockerOpen;
    SFX.sfxServo(false);
    SFX.sfxThud();
    fx.dust(LOCKER_SPOT.x - 0.6, LOCKER_SPOT.y, 0.4, 6);
    UI.msg('柜门吱呀一声弹开了。里面有东西。', 'good');
  } else if (it.id === 'loot') {
    game.locker.looted = true;
    const p = level.props.find((q) => q.id === 'locker');
    p.s = level.sprites.lockerEmpty;
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
  const hit = raycast(mx, my, dx, dy, level.segments, 40);

  fx.tracer(mx, my, 1.05, hit.x, hit.y, 1.05);
  fx.smoke(mx, my, 1.05, 4);
  fx.casing(p.x, p.y, 1.0, a);

  const seg = hit.seg;
  const isWall = seg && seg.id === 'wall';
  fx.spark(hit.x - dx * 0.05, hit.y - dy * 0.05, 1.05, 9, 1);
  fx.debris(hit.x - dx * 0.05, hit.y - dy * 0.05, 1.05, 4, isWall ? '#6b7370' : '#8d9694');
  fx.decal(hit.x - dx * 0.02, hit.y - dy * 0.02, 1.05, 'wall');
  SFX.sfxImpact(true);

  // 命中门 / 扫描仪的特殊反馈
  if (isWall && Math.abs(hit.y) < 0.06) {
    const dxTile = hit.x * TILE_W;
    if (dxTile > DOOR.u0 && dxTile < DOOR.u1 && !game.shotDoor) {
      game.shotDoor = true;
      UI.msg('子弹在合金门上打出一个白点 —— 它连晃都没晃一下。', 'warn');
    } else if (Math.abs(dxTile - SCANNER.u) < 12 && !game.shotScanner) {
      game.shotScanner = true;
      UI.msg('识别终端碎了一地。门锁毫无反应。', 'warn');
      SFX.sfxError();
    }
  }
}

/* ------------------------------------------------------------------ *
 * 移动与碰撞
 * ------------------------------------------------------------------ */

function blocked(x, y) {
  const r = PLAYER_R;
  if (x - r < 0.08 || x + r > ROOM_W - 0.08 || y - r < 0.08 || y + r > ROOM_H - 0.08) return true;
  for (const c of level.colliders) {
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
    const w = toWorld(mouse.x - CAM.x, mouse.y - CAM.y);
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

  // 墙面破损处的电火花
  game.sparkPower = Math.max(0, game.sparkPower - dt * 3.4);
  game.nextSpark -= dt;
  if (game.nextSpark <= 0 && game.state !== 'title') {
    game.nextSpark = 0.9 + Math.random() * 3.2;
    game.sparkPower = 0.9 + Math.random() * 0.5;
    fx.spark(SPARK_SRC.x, SPARK_SRC.y, SPARK_SRC.z, 10 + Math.random() * 8, 0.7);
    SFX.sfxSpark();
  }

  if (game.state === 'title') return;

  if (game.state === 'wake') {
    game.phase += dt;
    game.fade = clamp(1 - (game.phase - 0.2) / 1.1, 0, 1);
    if (game.phase > 1.65 && game.phase < 1.72) SFX.sfxStep();
    if (game.phase > 3.5) {
      game.state = 'play';
      game.player.x = PLAYER_START.x;
      game.player.y = PLAYER_START.y;
      UI.msg('头很痛……这里是七号实验室。电力系统好像出了大问题。');
      setTimeout(() => UI.msg('先想办法出去。门在那边。'), 3200);
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

  // 互动提示：键鼠用底部提示条，触屏用上下文按钮
  const it = currentInteract();
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
 * 渲染
 * ------------------------------------------------------------------ */

function playerScreen(cam, p) {
  return { x: cam.x + (p.x - p.y) * HW, y: cam.y + (p.x + p.y) * HH };
}

const ISO_ANG = Math.atan2(HH, HW);
const ISO_UNIT = Math.hypot(HW, HH);

function drawFixture(g, cam, f, intensity) {
  const cx = cam.x + (f.x - f.y) * HW;
  const cy = cam.y + (f.x + f.y) * HH - f.z * TILE_Z;
  const i = clamp(intensity, 0, 1);
  const L = (f.len * ISO_UNIT) / 2;

  g.save();
  g.translate(cx, cy);
  g.rotate(ISO_ANG + (f.tilt || 0));

  // 吊杆（一端断裂的灯会歪着挂）
  g.strokeStyle = 'rgba(112,124,124,0.55)';
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
    g.strokeStyle = 'rgba(24,28,30,0.85)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(L - 6, -2);
    g.quadraticCurveTo(L - 2, -9, L - 8, -14);
    g.stroke();
  }

  // 灯壳
  g.fillStyle = '#2e3533';
  g.fillRect(-L - 1, -6, L * 2 + 2, 7);
  g.fillStyle = '#4a5350';
  g.fillRect(-L - 1, -6, L * 2 + 2, 2.2);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(-L - 1, -6, L * 2 + 2, 0.8);
  // 端盖
  g.fillStyle = '#3a4240';
  g.fillRect(-L - 1, -6, 3, 7);
  g.fillRect(L - 2, -6, 3, 7);

  // 灯管
  const c = Math.round(48 + 207 * i);
  g.fillStyle = `rgb(${c},${Math.min(255, Math.round(c * 1.03))},${Math.round(c * 0.94)})`;
  g.fillRect(-L + 2, -3.4, L * 2 - 4, 3.4);
  if (i > 0.05) {
    g.fillStyle = `rgba(255,255,255,${0.5 * i})`;
    g.fillRect(-L + 2, -3.2, L * 2 - 4, 1.2);
    g.globalCompositeOperation = 'lighter';
    const grd = g.createLinearGradient(0, -12, 0, 14);
    grd.addColorStop(0, 'rgba(180,220,235,0)');
    grd.addColorStop(0.4, `rgba(205,235,245,${0.3 * i})`);
    grd.addColorStop(1, 'rgba(180,220,235,0)');
    g.fillStyle = grd;
    g.fillRect(-L - 10, -12, L * 2 + 20, 26);
    g.globalCompositeOperation = 'source-over';
  }
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

function render() {
  const shx = game.shake > 0.05 ? (Math.random() - 0.5) * game.shake : 0;
  const shy = game.shake > 0.05 ? (Math.random() - 0.5) * game.shake : 0;
  const cam = { x: CAM.x + shx, y: CAM.y + shy };
  const p = game.player;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // 静态图层
  ctx.drawImage(level.statics.img, Math.round(cam.x - level.statics.ox), Math.round(cam.y - level.statics.oy));
  fx.drawDecals(ctx, cam);

  /* --- 深度排序 --- */
  const items = [];
  for (const pr of level.props) items.push({ k: pr.x + pr.y, pr });

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

  fx.draw(ctx, cam);

  /* --- 光照 --- */
  const litX = lying ? BED_POS.x + 0.4 : px;
  const litY = lying ? BED_POS.y : py;
  const pvis = computeVisibility(litX, litY, level.segments);

  lighting.begin();

  let buzzLevel = 0;
  for (const L of level.lights) {
    let power = L.power;
    if (L.id === 'tube1') {
      power *= flicker(game.t, L.seed, 0.72);
      buzzLevel = Math.max(buzzLevel, power);
    } else if (L.id === 'tube2') {
      power *= flicker(game.t * 1.7, L.seed, 0.35) * (Math.sin(game.t * 0.7) > -0.6 ? 1 : 0.15);
    } else if (L.id === 'emg') {
      power *= 0.35 + 0.65 * Math.pow(Math.sin(game.t * 2.1) * 0.5 + 0.5, 2);
    } else if (L.id === 'emg2') {
      power *= 0.78 + 0.22 * Math.sin(game.t * 1.3 + 2);
      if (Math.sin(game.t * 0.9 + L.seed) > 0.985) power *= 0.2;
    } else if (L.id === 'screen') {
      power *= 0.7 + 0.3 * Math.sin(game.t * 9.1) * Math.sin(game.t * 2.3);
    } else if (L.id === 'spark') {
      power = game.sparkPower * 0.85;
    }
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
    const coneHot = computeVisibilityCone(ox, oy, level.segments, a, 0.15);
    lighting.add({ x: ox, y: oy, r: 9.6 * jitter, color: [255, 250, 228], power: 1, vis: coneHot, cam, blur: 1 });
    const coneMain = computeVisibilityCone(ox, oy, level.segments, a, 0.34);
    lighting.add({ x: ox, y: oy, r: 8.2 * jitter, color: [255, 244, 210], power: 0.88, vis: coneMain, cam, blur: 1.4 });
    const coneWide = computeVisibilityCone(ox, oy, level.segments, a, 0.88);
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
        ? level.roomVis
        : { tex: ROOM_MASK, dx: shx, dy: shy };
    lighting.finish(ctx, mask, cam);
  }

  /* --- 自发光元素（灯具本身）--- */
  for (const f of level.fixtures) {
    const L = level.lights.find((l) => l.id === f.light);
    let i = 0;
    if (f.light === 'tube1') i = flicker(game.t, L.seed, 0.72);
    else i = flicker(game.t * 1.7, L.seed, 0.35) * (Math.sin(game.t * 0.7) > -0.6 ? 1 : 0.15);
    drawFixture(ctx, cam, f, i * 0.9);
  }
  drawEmissive(ctx, cam);

  // 火花闪光的额外辉光
  if (game.sparkPower > 0.02) {
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

  // 触屏：画面内准星（没有鼠标指针，用世界内的十字表示朝向）
  if (pad.enabled && game.state === 'play' && !game.bagOpen) {
    const armed = !!handOf('pistol');
    const d = armed ? 2.9 : 2.0;
    const rx = px + Math.cos(p.aim) * d;
    const ry = py + Math.sin(p.aim) * d;
    const sx = cam.x + (rx - ry) * HW;
    const sy = cam.y + (rx + ry) * HH;
    const k = armed ? 1 : 0.62;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = armed ? 'rgba(255,120,100,0.95)' : 'rgba(150,225,220,0.8)';
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
    ctx.fillStyle = armed ? 'rgba(255,200,190,0.95)' : 'rgba(200,245,240,0.85)';
    ctx.fillRect(sx - 0.6, sy - 0.6, 1.4 * k, 1.4 * k);
    ctx.restore();
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
window.__level = level;
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
