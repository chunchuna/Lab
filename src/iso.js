import { HW, HH, TILE_Z, TILE_W, ROOM_W, ROOM_H, WALL_H, VIEW_W, VIEW_H } from './config.js';

/** 世界坐标(瓦片) -> 屏幕坐标(未加相机偏移) */
export function toScreenX(x, y) {
  return (x - y) * HW;
}
export function toScreenY(x, y, z = 0) {
  return (x + y) * HH - z * TILE_Z;
}
export function toScreen(x, y, z = 0) {
  return { x: (x - y) * HW, y: (x + y) * HH - z * TILE_Z };
}

/** 屏幕坐标(未加相机偏移) -> 世界地面坐标 */
export function toWorld(sx, sy) {
  const a = sx / HW;
  const b = sy / HH;
  return { x: (b + a) / 2, y: (b - a) / 2 };
}

/** 世界半径 -> 屏幕椭圆半轴 */
export const RADIUS_SX = HW * Math.SQRT2;
export const RADIUS_SY = HH * Math.SQRT2;
export const ELLIPSE_SQUASH = HH / HW;

/** 某个 w×h 区域的屏幕包围盒（未加相机偏移） */
export function boundsFor(w, h, wallH = WALL_H) {
  const b = {
    x0: -h * HW,
    x1: w * HW,
    y0: -wallH * TILE_Z,
    y1: (w + h) * HH,
  };
  b.w = b.x1 - b.x0;
  b.h = b.y1 - b.y0;
  return b;
}

/** 相机偏移：让整个区域在视口内居中。每个区域尺寸不同，各自算一份 */
export function camFor(b) {
  return {
    x: Math.round(VIEW_W / 2 - (b.x0 + b.x1) / 2),
    y: Math.round(VIEW_H / 2 - (b.y0 + b.y1) / 2) + 4,
  };
}

/** 实验室房间（保留给旧代码引用） */
export const BOUNDS = boundsFor(ROOM_W, ROOM_H);
export const CAM = camFor(BOUNDS);

/** 地板空间变换：1 瓦片 = TILE_W x TILE_W 的正方形 */
export function floorTransform(g, ox, oy) {
  g.setTransform(HW / TILE_W, HH / TILE_W, -HW / TILE_W, HH / TILE_W, ox, oy);
}
/** 北墙（y=0）空间：u 沿 +x，v 自墙顶向下 */
export function wallNorthTransform(g, ox, oy) {
  g.setTransform(HW / TILE_W, HH / TILE_W, 0, 1, ox, oy - WALL_H * TILE_Z);
}
export function wallNorthPt(u, v, ox, oy) {
  return { x: ox + (u * HW) / TILE_W, y: oy - WALL_H * TILE_Z + (u * HH) / TILE_W + v };
}
/** 西墙（x=0）空间：u 沿 +y，v 自墙顶向下 */
export function wallWestTransform(g, ox, oy) {
  g.setTransform(-HW / TILE_W, HH / TILE_W, 0, 1, ox, oy - WALL_H * TILE_Z);
}
export function wallWestPt(u, v, ox, oy) {
  return { x: ox - (u * HW) / TILE_W, y: oy - WALL_H * TILE_Z + (u * HH) / TILE_W + v };
}
