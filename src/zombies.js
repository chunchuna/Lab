import { HW, HH, TILE_Z } from './config.js';
import { PAL } from './art.js';

/**
 * 丧尸：只做"朝玩家直线推进 + 撞墙绕行"的简单行为。
 * 走廊是单向压迫，玩家只能边退边打，不需要真正的寻路。
 */

const R = 0.3; // 碰撞半径
const HIT_RANGE = 0.62; // 撕咬距离

export class Horde {
  constructor() {
    this.list = [];
    this.pending = 0;
    this.spawnT = 0;
    this.spawnAt = null;
    this.gap = 0.42;
    this.onBite = null;
  }

  clear() {
    this.list.length = 0;
    this.pending = 0;
    this.spawnAt = null;
  }

  /** 排队生成 n 只，从 at 位置陆续涌入 */
  release(n, at, gap = 0.42, opt = {}) {
    this.pending += n;
    this.spawnAt = at;
    this.gap = gap;
    this.spawnT = 0;
    this.opt = opt;
  }

  spawnOne(x, y, opt = {}) {
    const z = {
      x,
      y,
      hp: opt.hp || 2 + (Math.random() < 0.35 ? 1 : 0),
      spd: (opt.fast ? 2.95 : 2.0) + Math.random() * 0.7,
      walk: Math.random() * 6,
      hurt: 0,
      dead: 0,
      lunge: 0,
      variant: (Math.random() * 3) | 0,
      sway: Math.random() * 6.3,
      biteCd: 0,
      climb: !!opt.climb,
      stumble: 0,
      nextStumble: 2 + Math.random() * 5,
      // 面朝方向（屏幕空间单位向量），决定画正面还是背面
      face: { x: 1, y: 0.5 },
      z: 0,
      // 爬出来的过场：emerge 秒内只做"从地面/帐篷里钻出"的动画，不移动也不咬人
      emerge: opt.emerge || 0,
      emergeMax: opt.emerge || 0,
    };
    this.list.push(z);
    return z;
  }

  get alive() {
    return this.list.filter((z) => !z.dead).length;
  }

  update(dt, player, blocked, area) {
    // 陆续涌入
    if (this.pending > 0 && this.spawnAt) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawnT = this.gap;
        this.pending--;
        this.spawnOne(
          this.spawnAt.x + (Math.random() - 0.5) * 0.8,
          Math.max(0.6, Math.min(area.h - 0.6, this.spawnAt.y + (Math.random() - 0.5) * 2.6)),
          this.opt || {},
        );
      }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (z.dead > 0) {
        z.dead += dt;
        if (z.dead > 14) this.list.splice(i, 1);
        continue;
      }
      z.hurt = Math.max(0, z.hurt - dt * 3);
      z.biteCd = Math.max(0, z.biteCd - dt);
      if (z.emerge > 0) {
        z.emerge = Math.max(0, z.emerge - dt);
        z.walk += dt * 3.2;
        continue;
      }

      let dx = player.x - z.x;
      let dy = player.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;

      // 面朝：把世界方向转成屏幕方向，决定画正面/背面/左右
      const fsx = (dx - dy) * HW;
      const fsy = (dx + dy) * HH;
      const fl = Math.hypot(fsx, fsy) || 1;
      z.face.x = fsx / fl;
      z.face.y = fsy / fl;

      // 偶尔踉跄一下，群体的步伐才不会像列队行进
      z.nextStumble -= dt;
      if (z.nextStumble <= 0) {
        z.nextStumble = 2.5 + Math.random() * 5;
        z.stumble = 0.45;
      }
      z.stumble = Math.max(0, z.stumble - dt);
      const speedMul = z.stumble > 0 ? 0.35 : 1;

      if (d < HIT_RANGE) {
        if (z.biteCd <= 0) {
          z.biteCd = 1.1;
          z.lunge = 0.26;
          if (this.onBite) this.onBite(z);
        }
      } else {
        // 左右摇晃，让群体不会挤成一条直线
        z.sway += dt * 2.2;
        const sw = Math.sin(z.sway) * 0.32;
        const mx = (dx - dy * sw) * z.spd * speedMul * dt;
        const my = (dy + dx * sw) * z.spd * speedMul * dt;
        if (z.climb) {
          // 一层的尸潮直接翻越障碍，只受房间边界限制
          z.x = Math.max(0.4, Math.min(area.w - 0.4, z.x + mx));
          z.y = Math.max(0.4, Math.min(area.h - 0.4, z.y + my));
        } else {
          if (!blocked(z.x + mx, z.y, R)) z.x += mx;
          else if (!blocked(z.x, z.y + my * 1.4, R)) z.y += my * 1.4;
          if (!blocked(z.x, z.y + my, R)) z.y += my;
          else if (!blocked(z.x + mx * 1.4, z.y, R)) z.x += mx * 1.4;
        }
        z.walk += dt * z.spd * speedMul * 3.4;
      }
      z.lunge = Math.max(0, z.lunge - dt * 4);

      // 翻越障碍时抬高，看起来是踩在堆积物上
      if (z.climb) {
        const on = blocked(z.x, z.y, R * 0.5);
        z.z += ((on ? 0.55 : 0) - z.z) * Math.min(1, dt * 6);
      }

      // 彼此推开，避免完全重叠
      for (const o of this.list) {
        if (o === z || o.dead) continue;
        const ox = z.x - o.x;
        const oy = z.y - o.y;
        const od = Math.hypot(ox, oy);
        if (od > 0.001 && od < R * 1.8) {
          const push = ((R * 1.8 - od) / 2) * 0.5;
          z.x += (ox / od) * push;
          z.y += (oy / od) * push;
        }
      }
    }
  }

  /** 在玩家附近的活体数量，用来判断"被尸潮淹没" */
  crowdedAt(x, y, r = 0.95) {
    let n = 0;
    for (const z of this.list) {
      if (z.dead) continue;
      if (Math.hypot(z.x - x, z.y - y) < r) n++;
    }
    return n;
  }

  /** 子弹命中检测：返回被打中的丧尸 */
  hitScan(ox, oy, dx, dy, maxDist) {
    let best = null;
    let bestT = maxDist;
    for (const z of this.list) {
      if (z.dead) continue;
      const ex = z.x - ox;
      const ey = z.y - oy;
      const t = ex * dx + ey * dy;
      if (t < 0 || t > bestT) continue;
      const perp = Math.abs(ex * dy - ey * dx);
      if (perp > 0.45) continue; // 稍微宽容一点，等距下瞄准本来就不精确
      bestT = t;
      best = z;
    }
    return best ? { z: best, t: bestT } : null;
  }

  damage(z, n = 1) {
    z.hp -= n;
    z.hurt = 1;
    if (z.hp <= 0) {
      z.dead = 0.001;
      return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * 绘制
 * ------------------------------------------------------------------ */

const SKIN = ['#7d8a6e', '#8b8a72', '#6f7d68'];
const CLOTH = ['#5a5148', '#4a5058', '#584a4a'];

export function drawZombie(g, sx, sy, z) {
  const x = Math.round(sx);
  const y = Math.round(sy - (z.z || 0) * TILE_Z);

  if (z.dead > 0) {
    drawCorpse(g, x, y, z);
    return;
  }

  // 钻出来：整体往下压，再裁掉脚线以下，看起来像从帐篷/地面里爬出
  if (z.emerge > 0 && z.emergeMax > 0) {
    const k = z.emerge / z.emergeMax; // 1 刚开始 → 0 完全站起
    g.save();
    g.beginPath();
    g.rect(x - 18, y - 40, 36, 42);
    g.clip();
    g.translate(0, k * 28);
    drawZombieBody(g, x, y, z);
    g.restore();
    return;
  }

  drawZombieBody(g, x, y, z);
}

function drawZombieBody(g, x, y, z) {
  // 面朝：屏幕方向决定朝左还是朝右、正面还是背面
  const f = z.face || { x: 1, y: 0.5 };
  const dir = f.x >= 0 ? 1 : -1;
  const back = f.y < -0.12; // 朝画面上方走 = 背对镜头

  // 蹒跚步态：两腿摆动幅度不同，身体跟着一歪一歪
  const sw = Math.sin(z.walk) * 2.6;
  const sw2 = Math.sin(z.walk + 0.9) * 1.7;
  const bob = Math.abs(Math.sin(z.walk * 0.5)) * 1.3;
  const tilt = Math.sin(z.walk * 0.5) * 0.9 + (z.stumble > 0 ? 2.2 : 0);
  const by = y - bob;
  const skin = SKIN[z.variant];
  const cloth = CLOTH[z.variant];
  const lung = z.lunge * 3;

  g.save();
  g.globalAlpha = 0.45;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x, y + (z.z ? 1 : 0), 6, 3, 0, 0, 6.3);
  g.fill();
  g.restore();

  // 腿
  g.fillStyle = '#33383a';
  g.fillRect(x - 4 + sw, by - 9, 3, 9);
  g.fillRect(x + 1 - sw2, by - 9, 3, 9);
  g.fillStyle = '#1d2123';
  g.fillRect(x - 4 + sw - (dir > 0 ? 0 : 1), by - 2, 4, 2);
  g.fillRect(x + 1 - sw2 - (dir > 0 ? 0 : 1), by - 2, 4, 2);

  // 躯干（前倾，随步伐左右歪）
  g.save();
  g.translate(x + tilt * 0.4, by - 14);
  g.rotate(tilt * 0.03);
  g.fillStyle = cloth;
  g.fillRect(-5, -6, 10, 11);
  g.fillStyle = 'rgba(0,0,0,0.24)';
  g.fillRect(dir > 0 ? 2 : -5, -6, 3, 11);
  // 撕裂与血
  g.fillStyle = '#4a1512';
  g.fillRect(-3, -2, 4, 5);
  g.fillRect(1, 1, 2, 4);
  g.restore();

  // 手臂前伸：朝着移动方向探出去
  const reach = 7 + lung;
  const ax = f.x * reach;
  const ay = f.y * reach * 0.7;
  g.strokeStyle = skin;
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - 4, by - 18);
  g.lineTo(x - 4 + ax * 0.8, by - 15 + ay + Math.sin(z.walk * 0.8) * 1.6);
  g.moveTo(x + 4, by - 18);
  g.lineTo(x + 4 + ax * 0.8, by - 16 + ay - Math.sin(z.walk * 0.8) * 1.6);
  g.stroke();

  // 头（歪着）
  const hx = x - 3 + dir + tilt * 0.5;
  const hy = by - 27;
  g.fillStyle = skin;
  g.fillRect(hx, hy + 1, 6, 6);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(hx + (dir > 0 ? 4 : 0), hy + 1, 2, 6);
  g.fillStyle = '#2b241c';
  g.fillRect(hx - 1, hy, 8, 3);
  if (back) {
    // 背对镜头：后脑勺，没有五官
    g.fillRect(hx - 1, hy, 8, 7);
  } else {
    g.fillStyle = '#d8d0b8';
    if (dir > 0) {
      g.fillRect(hx + 2, hy + 3, 1, 1);
      g.fillRect(hx + 4, hy + 3, 1, 1);
    } else {
      g.fillRect(hx + 1, hy + 3, 1, 1);
      g.fillRect(hx + 3, hy + 3, 1, 1);
    }
    // 张着的嘴
    g.fillStyle = '#4a1512';
    g.fillRect(hx + (dir > 0 ? 2 : 1), hy + 5, 3, 2);
  }

  // 受击闪白
  if (z.hurt > 0) {
    g.save();
    g.globalAlpha = Math.min(0.8, z.hurt);
    g.fillStyle = '#ded8c8';
    g.fillRect(x - 6, by - 28, 12, 28);
    g.restore();
  }
}

function drawCorpse(g, x, y, z) {
  const t = Math.min(1, z.dead / 0.35);
  g.save();
  g.globalAlpha = 0.5;
  g.fillStyle = '#3f1210';
  g.beginPath();
  g.ellipse(x, y + 1, 9 * t, 4 * t, 0, 0, 6.3);
  g.fill();
  g.restore();
  // 保持人形轮廓，只是躺下：躯干 + 头 + 腿平铺
  const cloth = CLOTH[z.variant];
  const skin = SKIN[z.variant];
  g.fillStyle = cloth;
  g.fillRect(x - 8, y - 5, 11, 6);
  g.fillStyle = '#33383a';
  g.fillRect(x + 2, y - 4, 8, 4);
  g.fillStyle = skin;
  g.fillRect(x - 12, y - 6, 5, 5);
  g.fillStyle = '#2b241c';
  g.fillRect(x - 12, y - 7, 5, 2);
  g.strokeStyle = skin;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x - 6, y - 4);
  g.lineTo(x - 9, y + 2);
  g.stroke();
}

export function zombieScreen(cam, z) {
  return { x: cam.x + (z.x - z.y) * HW, y: cam.y + (z.x + z.y) * HH };
}
