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

/** 场景包围盒（未加相机偏移） */
export const BOUNDS = {
  x0: -ROOM_H * HW,
  x1: ROOM_W * HW,
  y0: -WALL_H * TILE_Z,
  y1: (ROOM_W + ROOM_H) * HH,
};
BOUNDS.w = BOUNDS.x1 - BOUNDS.x0;
BOUNDS.h = BOUNDS.y1 - BOUNDS.y0;

/** 相机偏移：让整个房间居中 */
export const CAM = {
  x: Math.round(VIEW_W / 2 - (BOUNDS.x0 + BOUNDS.x1) / 2),
  y: Math.round(VIEW_H / 2 - (BOUNDS.y0 + BOUNDS.y1) / 2) + 4,
};

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
