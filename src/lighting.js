import { HW, HH, TILE_Z, VIEW_W, VIEW_H } from './config.js';
import { ELLIPSE_SQUASH } from './iso.js';
import { makeCanvas } from './util.js';

const RSX = HW * Math.SQRT2; // 世界半径 -> 屏幕椭圆水平半轴

export class Lighting {
  constructor(w = VIEW_W, h = VIEW_H) {
    this.w = w;
    this.h = h;
    this.light = makeCanvas(w, h);
    this.scratch = makeCanvas(w, h);
    this.mask = makeCanvas(w, h);
    this.dark = makeCanvas(w, h);
    this.ambient = 'rgba(58,80,100,0.05)';
    this.softness = 1.6;
  }

  begin() {
    const g = this.light.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, this.w, this.h);
    g.fillStyle = this.ambient;
    g.fillRect(0, 0, this.w, this.h);
  }

  /** 把可见多边形画成白色遮罩（含墙面竖直拉伸） */
  _shape(g, vis, cam) {
    const hits = vis.hits || vis;
    const n = hits.length;
    if (n < 2) return;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sx[i] = cam.x + (hits[i].x - hits[i].y) * HW;
      sy[i] = cam.y + (hits[i].x + hits[i].y) * HH;
    }
    g.fillStyle = '#fff';
    g.beginPath();
    if (vis.origin) {
      g.moveTo(cam.x + (vis.origin.x - vis.origin.y) * HW, cam.y + (vis.origin.x + vis.origin.y) * HH);
      for (let i = 0; i < n; i++) g.lineTo(sx[i], sy[i]);
    } else {
      g.moveTo(sx[0], sy[0]);
      for (let i = 1; i < n; i++) g.lineTo(sx[i], sy[i]);
    }
    g.closePath();
    g.fill();

    // 命中的墙面向上拉伸，让墙体/物体正面也被照亮
    const closed = !vis.origin;
    const last = closed ? n : n - 1;
    g.beginPath();
    let any = false;
    for (let i = 0; i < last; i++) {
      const a = hits[i];
      const j = (i + 1) % n;
      const b = hits[j];
      if (!a.seg || a.seg !== b.seg) continue;
      const dz = a.seg.h * TILE_Z;
      g.moveTo(sx[i], sy[i]);
      g.lineTo(sx[j], sy[j]);
      g.lineTo(sx[j], sy[j] - dz);
      g.lineTo(sx[i], sy[i] - dz);
      g.closePath();
      any = true;
    }
    if (any) g.fill();
  }

  /**
   * 添加一盏灯。
   * o = { x, y, r, color:[r,g,b], power, vis, cam, cone, blur }
   */
  add(o) {
    if (o.power <= 0.004) return;
    const cam = o.cam;
    const cx = cam.x + (o.x - o.y) * HW;
    const cy = cam.y + (o.x + o.y) * HH - (o.zOff || 0);
    const rad = o.r * RSX;
    if (cx + rad < 0 || cx - rad > this.w || cy + rad * ELLIPSE_SQUASH < -40 || cy - rad * ELLIPSE_SQUASH > this.h + 40) {
      if (!o.vis) return;
    }

    const s = this.scratch.g;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, this.w, this.h);

    const [r, g_, b] = o.color;
    const p = Math.min(1, o.power);
    s.save();
    s.translate(cx, cy);
    s.scale(1, o.squash === undefined ? ELLIPSE_SQUASH : o.squash);
    const grd = s.createRadialGradient(0, 0, rad * 0.04, 0, 0, rad);
    grd.addColorStop(0, `rgba(${r},${g_},${b},${p})`);
    grd.addColorStop(0.34, `rgba(${r},${g_},${b},${p * 0.82})`);
    grd.addColorStop(0.68, `rgba(${r},${g_},${b},${p * 0.38})`);
    grd.addColorStop(1, `rgba(${r},${g_},${b},0)`);
    s.fillStyle = grd;
    s.beginPath();
    s.arc(0, 0, rad, 0, Math.PI * 2);
    s.fill();
    s.restore();

    if (o.vis) {
      const m = this.mask.g;
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, this.w, this.h);
      this._shape(m, o.vis, cam);
      s.globalCompositeOperation = 'destination-in';
      s.filter = `blur(${o.blur === undefined ? this.softness : o.blur}px)`;
      s.drawImage(this.mask.c, 0, 0);
      s.filter = 'none';
      s.globalCompositeOperation = 'source-over';
    }

    const l = this.light.g;
    l.globalCompositeOperation = 'lighter';
    l.drawImage(this.scratch.c, 0, 0);
    l.globalCompositeOperation = 'source-over';
  }

  /** 不受遮挡的全屏加亮（枪口闪光等） */
  addFlat(color, alpha) {
    if (alpha <= 0.002) return;
    const l = this.light.g;
    l.globalCompositeOperation = 'lighter';
    l.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
    l.fillRect(0, 0, this.w, this.h);
    l.globalCompositeOperation = 'source-over';
  }

  /** 用玩家视野裁剪光照，并把黑暗合成到主画布 */
  finish(ctx, playerVis, cam, darkColor = 'rgba(3,6,9,1)') {
    const l = this.light.g;
    if (playerVis) {
      const m = this.mask.g;
      m.setTransform(1, 0, 0, 1, 0, 0);
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, this.w, this.h);
      this._shape(m, playerVis, cam);
      l.globalCompositeOperation = 'destination-in';
      l.filter = `blur(${this.softness}px)`;
      l.drawImage(this.mask.c, 0, 0);
      l.filter = 'none';
      l.globalCompositeOperation = 'source-over';
    }

    const d = this.dark.g;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, this.w, this.h);
    d.fillStyle = darkColor;
    d.fillRect(0, 0, this.w, this.h);
    d.globalCompositeOperation = 'destination-out';
    d.drawImage(this.light.c, 0, 0);
    d.globalCompositeOperation = 'source-over';

    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.dark.c, 0, 0);
    // 彩色辉光
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.38;
    ctx.drawImage(this.light.c, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
