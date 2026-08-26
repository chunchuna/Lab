import { HW, HH, TILE_Z, VIEW_W, VIEW_H } from './config.js';

export class FX {
  constructor() {
    this.parts = [];
    this.decals = [];
    this.tracers = [];
  }

  emit(p) {
    if (this.parts.length > 700) this.parts.shift();
    this.parts.push(p);
  }

  spark(x, y, z, n = 8, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 2.6) * spread;
      this.emit({
        x, y, z,
        vx: Math.cos(a) * s * 0.5,
        vy: Math.sin(a) * s * 0.5,
        vz: (Math.random() - 0.15) * 3.4,
        life: 0.25 + Math.random() * 0.55,
        age: 0,
        g: 7,
        type: 'spark',
        col: Math.random() > 0.4 ? '#fff3c4' : '#ffb04a',
        size: 0.9 + Math.random() * 1.1,
        bounce: 0.35,
      });
    }
  }

  debris(x, y, z, n = 6, col = '#8d9694') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.4 + Math.random() * 1.6;
      this.emit({
        x, y, z,
        vx: Math.cos(a) * s * 0.4,
        vy: Math.sin(a) * s * 0.4,
        vz: 0.8 + Math.random() * 2.4,
        life: 0.5 + Math.random() * 0.8,
        age: 0,
        g: 8,
        type: 'chunk',
        col,
        size: 0.8 + Math.random() * 1.4,
        bounce: 0.25,
      });
    }
  }

  smoke(x, y, z, n = 5) {
    for (let i = 0; i < n; i++) {
      this.emit({
        x: x + (Math.random() - 0.5) * 0.1,
        y: y + (Math.random() - 0.5) * 0.1,
        z,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        vz: 0.5 + Math.random() * 0.7,
        life: 0.5 + Math.random() * 0.7,
        age: 0,
        g: -0.4,
        type: 'smoke',
        col: '210,215,210',
        size: 1.6 + Math.random() * 2.2,
        bounce: 0,
      });
    }
  }

  casing(x, y, z, ang) {
    const a = ang + Math.PI * 0.55 + (Math.random() - 0.5) * 0.5;
    this.emit({
      x, y, z,
      vx: Math.cos(a) * 1.5,
      vy: Math.sin(a) * 1.5,
      vz: 2.0 + Math.random(),
      life: 2.4,
      age: 0,
      g: 9,
      type: 'casing',
      col: '#e8c76a',
      size: 1.4,
      bounce: 0.42,
      spin: Math.random() * 6,
    });
  }

  dust(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      this.emit({
        x, y, z,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.2,
        vz: 0.15 + Math.random() * 0.35,
        life: 0.6 + Math.random() * 0.6,
        age: 0,
        g: -0.1,
        type: 'smoke',
        col: '150,150,140',
        size: 1 + Math.random() * 1.6,
        bounce: 0,
      });
    }
  }

  tracer(x0, y0, z0, x1, y1, z1) {
    this.tracers.push({ x0, y0, z0, x1, y1, z1, t: 0 });
  }

  decal(x, y, z, kind) {
    this.decals.push({ x, y, z, kind, r: 1.2 + Math.random() * 0.8, a: Math.random() * 6.3 });
    if (this.decals.length > 48) this.decals.shift();
  }

  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      p.vz -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.z < 0 && p.bounce > 0) {
        p.z = 0;
        p.vz = -p.vz * p.bounce;
        p.vx *= 0.6;
        p.vy *= 0.6;
        if (Math.abs(p.vz) < 0.25) {
          p.vz = 0;
          p.g = 0;
          p.vx = 0;
          p.vy = 0;
        }
      } else if (p.z < 0) {
        p.z = 0;
      }
      if (p.spin !== undefined) p.spin += dt * 12;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      this.tracers[i].t += dt;
      if (this.tracers[i].t > 0.07) this.tracers.splice(i, 1);
    }
  }

  drawDecals(ctx, cam) {
    for (const d of this.decals) {
      const sx = cam.x + (d.x - d.y) * HW;
      const sy = cam.y + (d.x + d.y) * HH - d.z * TILE_Z;
      ctx.save();
      ctx.translate(sx, sy);
      if (d.kind === 'floor') ctx.scale(1, HH / HW);
      ctx.fillStyle = 'rgba(6,8,9,0.75)';
      ctx.beginPath();
      ctx.arc(0, 0, d.r, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,160,158,0.22)';
      ctx.beginPath();
      ctx.arc(0, 0, d.r + 1.1, 0, 6.3);
      ctx.fill();
      ctx.fillStyle = 'rgba(6,8,9,0.85)';
      ctx.beginPath();
      ctx.arc(0, 0, d.r * 0.6, 0, 6.3);
      ctx.fill();
      ctx.restore();
    }
  }

  draw(ctx, cam) {
    for (const t of this.tracers) {
      const a = 1 - t.t / 0.07;
      const x0 = cam.x + (t.x0 - t.y0) * HW;
      const y0 = cam.y + (t.x0 + t.y0) * HH - t.z0 * TILE_Z;
      const x1 = cam.x + (t.x1 - t.y1) * HW;
      const y1 = cam.y + (t.x1 + t.y1) * HH - t.z1 * TILE_Z;
      ctx.strokeStyle = `rgba(255,238,190,${a * 0.85})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,200,120,${a * 0.25})`;
      ctx.lineWidth = 2.6;
      ctx.stroke();
    }

    for (const p of this.parts) {
      const k = 1 - p.age / p.life;
      const sx = cam.x + (p.x - p.y) * HW;
      const sy = cam.y + (p.x + p.y) * HH - p.z * TILE_Z;
      if (p.type === 'smoke') {
        ctx.fillStyle = `rgba(${p.col},${0.16 * k})`;
        ctx.beginPath();
        ctx.arc(sx, sy, p.size * (1 + (1 - k) * 2.4), 0, 6.3);
        ctx.fill();
      } else if (p.type === 'spark') {
        ctx.fillStyle = p.col;
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      } else if (p.type === 'casing') {
        ctx.fillStyle = p.col;
        ctx.globalAlpha = Math.min(1, k * 3);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.spin || 0);
        ctx.fillRect(-1.6, -0.8, 3.2, 1.6);
        ctx.restore();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = p.col;
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.fillRect(sx - p.size / 2, sy - p.size / 2, p.size, p.size);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** 返回需要作为动态光源的火花点 */
  sparkLights() {
    const out = [];
    for (const p of this.parts) {
      if (p.type !== 'spark') continue;
      const k = 1 - p.age / p.life;
      if (k < 0.45) continue;
      out.push({ x: p.x, y: p.y, z: p.z, k });
      if (out.length > 4) break;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ *
 * 暴雨：屏幕空间雨丝
 *
 * 雨不参与等距深度排序，也不该被光照压黑，所以画在光照之后、DOM UI 之前，
 * 且用的是未经镜头缩放的屏幕坐标。整场雨只走两次 stroke（远景一层、近景
 * 一层），不做 filter: blur()。
 * ------------------------------------------------------------------ */

export class Rain {
  constructor(n = 150) {
    this.on = false;
    this.gust = 0;
    this.gustT = 0;
    this.layers = [
      { drops: [], n: Math.round(n * 0.55), spd: 520, len: 9, w: 0.8, a: 0.16, slant: -0.2 },
      { drops: [], n: Math.round(n * 0.45), spd: 820, len: 15, w: 1.1, a: 0.3, slant: -0.28 },
    ];
    for (const L of this.layers) {
      for (let i = 0; i < L.n; i++) {
        L.drops.push({ x: Math.random() * (VIEW_W + 120) - 60, y: Math.random() * VIEW_H, k: 0.7 + Math.random() * 0.6 });
      }
    }
    this.splashes = [];
  }

  setOn(v) {
    this.on = v;
    if (!v) this.splashes.length = 0;
  }

  update(dt) {
    if (!this.on) return;
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 1.6 + Math.random() * 3.4;
      this.gust = (Math.random() - 0.4) * 0.5;
    }
    for (const L of this.layers) {
      const vx = (L.slant + this.gust) * L.spd;
      const vy = L.spd;
      for (const d of L.drops) {
        d.x += vx * d.k * dt;
        d.y += vy * d.k * dt;
        if (d.y > VIEW_H + 20) {
          d.y = -20 - Math.random() * 40;
          d.x = Math.random() * (VIEW_W + 200) - 100;
          // 落地水花：只从近景那层生成，数量有限
          if (L.spd > 700 && this.splashes.length < 26) {
            this.splashes.push({ x: Math.random() * VIEW_W, y: VIEW_H * 0.45 + Math.random() * VIEW_H * 0.5, t: 0 });
          }
        }
        if (d.x < -100) d.x += VIEW_W + 200;
        else if (d.x > VIEW_W + 100) d.x -= VIEW_W + 200;
      }
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      this.splashes[i].t += dt;
      if (this.splashes[i].t > 0.34) this.splashes.splice(i, 1);
    }
  }

  draw(g, bright = 1) {
    if (!this.on) return;
    g.save();
    for (const L of this.layers) {
      const vx = (L.slant + this.gust) * L.len;
      g.strokeStyle = `rgba(186,206,220,${L.a * bright})`;
      g.lineWidth = L.w;
      g.beginPath();
      for (const d of L.drops) {
        g.moveTo(d.x, d.y);
        g.lineTo(d.x + vx * d.k, d.y + L.len * d.k);
      }
      g.stroke();
    }
    // 水花：一圈迅速摊开的扁椭圆
    g.strokeStyle = `rgba(190,210,220,${0.22 * bright})`;
    g.lineWidth = 0.8;
    g.beginPath();
    for (const s of this.splashes) {
      const k = s.t / 0.34;
      g.moveTo(s.x + 4 * k, s.y);
      g.ellipse(s.x, s.y, 4 * k, 1.6 * k, 0, 0, 6.3);
    }
    g.stroke();
    g.restore();
  }
}
