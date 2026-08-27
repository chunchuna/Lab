import { HW, HH, TILE_Z, VIEW_W, VIEW_H, pixelScale } from './config.js';
import { ELLIPSE_SQUASH } from './iso.js';
import { makeCanvas, baseT, blit } from './util.js';

const RSX = HW * Math.SQRT2; // 世界半径 -> 屏幕椭圆水平半轴

export class Lighting {
  constructor(w = VIEW_W, h = VIEW_H) {
    this.w = w;
    this.h = h;
    this.ambient = 'rgba(58,80,100,0.05)';
    this.softness = 1.6;
    this.rebuild();
  }

  /** 倍率变了或第一次创建：按当前 N 重做工作缓冲。 */
  rebuild() {
    this.light = makeCanvas(this.w, this.h);
    this.scratch = makeCanvas(this.w, this.h);
    this.mask = makeCanvas(this.w, this.h);
    this.dark = makeCanvas(this.w, this.h);
  }

  begin() {
    const g = this.light.g;
    baseT(g);
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
   * 可见多边形的软边。
   *
   * 烘焙路径（force=true）**必须**糊：多边形的直边和墙面竖直拉伸出来的
   * 矩形一旦是硬边，光就不再像光，而像一块贴在画面上的玻璃板 ——
   * 主菜单收容舱上那个"发光菱形棱柱"就是这么来的。烘焙只在建区时跑一次，
   * blur 的开销无所谓。
   *
   * 每帧路径（手电筒光锥等）保持原判断：高倍率下整张 4K 缓冲的
   * filter: blur() 太贵，而高清网格上渐变本身采样已经够密。
   */
  _blur(g, px, force) {
    if (!force && pixelScale() >= 3) return;
    g.filter = `blur(${px}px)`;
  }

  /** 把一盏灯的径向渐变 ∩ 可见多边形渲染到 g 上 */
  _renderLight(g, o, power) {
    const cam = o.cam;
    const cx = cam.x + (o.x - o.y) * HW;
    const cy = cam.y + (o.x + o.y) * HH - (o.zOff || 0);
    const rad = o.r * RSX;

    const [r, g_, b] = o.color;
    const p = Math.min(1, power);
    g.save();
    g.translate(cx, cy);
    g.scale(1, o.squash === undefined ? ELLIPSE_SQUASH : o.squash);
    const grd = g.createRadialGradient(0, 0, rad * 0.04, 0, 0, rad);
    grd.addColorStop(0, `rgba(${r},${g_},${b},${p})`);
    grd.addColorStop(0.34, `rgba(${r},${g_},${b},${p * 0.82})`);
    grd.addColorStop(0.68, `rgba(${r},${g_},${b},${p * 0.38})`);
    grd.addColorStop(1, `rgba(${r},${g_},${b},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, rad, 0, Math.PI * 2);
    g.fill();
    g.restore();

    if (o.vis) {
      const m = this.mask.g;
      baseT(m);
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, this.w, this.h);
      this._shape(m, o.vis, cam);
      g.globalCompositeOperation = 'destination-in';
      this._blur(g, o.blur === undefined ? this.softness : o.blur, o.baked);
      blit(g, this.mask.c, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'source-over';
    }
  }

  /**
   * 添加一盏灯。
   * o = { x, y, r, color:[r,g,b], power, vis, cam, blur }
   */
  add(o) {
    if (o.power <= 0.004) return;
    const cam = o.cam;
    const cx = cam.x + (o.x - o.y) * HW;
    const rad = o.r * RSX;
    if (!o.vis && (cx + rad < 0 || cx - rad > this.w)) return;

    const s = this.scratch.g;
    baseT(s);
    s.globalCompositeOperation = 'source-over';
    s.clearRect(0, 0, this.w, this.h);
    this._renderLight(s, o, o.power);

    const l = this.light.g;
    l.globalCompositeOperation = 'lighter';
    blit(l, this.scratch.c, 0, 0);
    l.globalCompositeOperation = 'source-over';
  }

  /**
   * 静态光源在整局游戏里位置和遮挡都不变，只有亮度在闪。
   * 预先按满功率烘焙成贴图，每帧只需一次 drawImage + globalAlpha。
   */
  bakeLight(o) {
    const { c, g } = makeCanvas(this.w, this.h);
    this._renderLight(g, { ...o, baked: true }, 1);
    return c;
  }

  /** 预烘焙的裁剪遮罩（关闭视线遮挡时房间轮廓是固定的），软边一次性做掉 */
  bakeMask(vis, cam) {
    const t = makeCanvas(this.w, this.h);
    this._shape(t.g, vis, cam);
    const { c, g } = makeCanvas(this.w, this.h);
    this._blur(g, this.softness, true);
    blit(g, t.c, 0, 0);
    g.filter = 'none';
    return c;
  }

  /** 画一张烘焙好的光照贴图，alpha 即当前亮度；dx/dy 用于跟随镜头抖动 */
  addBaked(tex, alpha, dx = 0, dy = 0) {
    if (alpha <= 0.004) return;
    const l = this.light.g;
    l.globalCompositeOperation = 'lighter';
    l.globalAlpha = Math.min(1, alpha);
    blit(l, tex, dx, dy);
    l.globalAlpha = 1;
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

  /**
   * 用遮罩裁剪光照，再把黑暗合成到主画布。
   * mask 可以是可见多边形（每帧计算）或预烘焙的贴图 { tex, dx, dy }。
   */
  finish(ctx, mask, cam, darkColor = 'rgba(3,6,9,1)') {
    const l = this.light.g;
    if (mask && mask.tex) {
      l.globalCompositeOperation = 'destination-in';
      blit(l, mask.tex, mask.dx || 0, mask.dy || 0);
      l.globalCompositeOperation = 'source-over';
    } else if (mask) {
      const m = this.mask.g;
      baseT(m);
      m.globalCompositeOperation = 'source-over';
      m.clearRect(0, 0, this.w, this.h);
      this._shape(m, mask, cam);
      l.globalCompositeOperation = 'destination-in';
      this._blur(l, this.softness);
      blit(l, this.mask.c, 0, 0);
      l.filter = 'none';
      l.globalCompositeOperation = 'source-over';
    }

    const d = this.dark.g;
    baseT(d);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, this.w, this.h);
    d.fillStyle = darkColor;
    d.fillRect(0, 0, this.w, this.h);
    d.globalCompositeOperation = 'destination-out';
    blit(d, this.light.c, 0, 0);
    d.globalCompositeOperation = 'source-over';

    /* 光照缓冲和世界缓冲同在 N 倍像素网格上，按逻辑尺寸贴回去。 */
    ctx.globalCompositeOperation = 'source-over';
    blit(ctx, this.dark.c, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.38;
    blit(ctx, this.light.c, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
