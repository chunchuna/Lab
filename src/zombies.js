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
  release(n, at, gap = 0.42) {
    this.pending += n;
    this.spawnAt = at;
    this.gap = gap;
    this.spawnT = 0;
  }

  spawnOne(x, y) {
    this.list.push({
      x,
      y,
      hp: 2 + (Math.random() < 0.35 ? 1 : 0),
      spd: 1.15 + Math.random() * 0.5,
      walk: Math.random() * 6,
      hurt: 0,
      dead: 0,
      lunge: 0,
      variant: (Math.random() * 3) | 0,
      sway: Math.random() * 6.3,
      biteCd: 0,
    });
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

      let dx = player.x - z.x;
      let dy = player.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;

      if (d < HIT_RANGE) {
        if (z.biteCd <= 0) {
          z.biteCd = 1.1;
          z.lunge = 0.22;
          if (this.onBite) this.onBite(z);
        }
      } else {
        // 左右摇晃，让群体不会挤成一条直线
        z.sway += dt * 2.2;
        const sw = Math.sin(z.sway) * 0.32;
        const mx = (dx - dy * sw) * z.spd * dt;
        const my = (dy + dx * sw) * z.spd * dt;
        if (!blocked(z.x + mx, z.y, R)) z.x += mx;
        else if (!blocked(z.x, z.y + my * 1.4, R)) z.y += my * 1.4;
        if (!blocked(z.x, z.y + my, R)) z.y += my;
        else if (!blocked(z.x + mx * 1.4, z.y, R)) z.x += mx * 1.4;
        z.walk += dt * z.spd * 4.2;
      }
      z.lunge = Math.max(0, z.lunge - dt * 4);

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

export function drawZombie(g, sx, sy, z, aimAway) {
  const x = Math.round(sx);
  const y = Math.round(sy);

  if (z.dead > 0) {
    drawCorpse(g, x, y, z);
    return;
  }

  const sw = Math.sin(z.walk) * 2.4;
  const bob = Math.abs(Math.sin(z.walk * 0.5)) * 1.1;
  const by = y - bob;
  const skin = SKIN[z.variant];
  const cloth = CLOTH[z.variant];
  const lung = z.lunge * 3;

  g.save();
  g.globalAlpha = 0.45;
  g.fillStyle = '#000';
  g.beginPath();
  g.ellipse(x, y, 6, 3, 0, 0, 6.3);
  g.fill();
  g.restore();

  // 腿
  g.fillStyle = '#33383a';
  g.fillRect(x - 4 + sw, by - 9, 3, 9);
  g.fillRect(x + 1 - sw, by - 9, 3, 9);
  g.fillStyle = '#1d2123';
  g.fillRect(x - 4 + sw, by - 2, 4, 2);
  g.fillRect(x + 1 - sw, by - 2, 4, 2);

  // 躯干（前倾）
  g.fillStyle = cloth;
  g.fillRect(x - 5, by - 20, 10, 11);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  g.fillRect(x + 2, by - 20, 3, 11);
  // 撕裂与血
  g.fillStyle = '#4a1512';
  g.fillRect(x - 3, by - 16, 4, 5);
  g.fillRect(x + 1, by - 13, 2, 4);

  // 手臂前伸
  const reach = 6 + lung;
  g.strokeStyle = skin;
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x - 4, by - 18);
  g.lineTo(x - 4 - reach * 0.5, by - 14 + Math.sin(z.walk * 0.8) * 1.5);
  g.moveTo(x + 4, by - 18);
  g.lineTo(x + 4 + reach * 0.5, by - 15 - Math.sin(z.walk * 0.8) * 1.5);
  g.stroke();

  // 头（歪着）
  const hx = x - 3;
  const hy = by - 27;
  g.fillStyle = skin;
  g.fillRect(hx, hy + 1, 6, 6);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(hx + 4, hy + 1, 2, 6);
  g.fillStyle = '#2b241c';
  g.fillRect(hx - 1, hy, 8, 3);
  if (!aimAway) {
    g.fillStyle = '#d8d0b8';
    g.fillRect(hx + 1, hy + 3, 1, 1);
    g.fillRect(hx + 4, hy + 3, 1, 1);
    g.fillStyle = '#4a1512';
    g.fillRect(hx + 1, hy + 5, 4, 2);
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
