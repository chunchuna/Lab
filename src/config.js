// 内部渲染分辨率（像素风），再整体放大到窗口
export const VIEW_W = 640;
export const VIEW_H = 360;

// 等距瓦片尺寸（2:1 菱形）
export const TILE_W = 36;
export const TILE_H = 18;
export const TILE_Z = 18; // 一个"高度单位"对应的屏幕像素
export const HW = TILE_W / 2;
export const HH = TILE_H / 2;

// 房间尺寸（瓦片）
export const ROOM_W = 14;
export const ROOM_H = 10;
export const WALL_H = 3.0; // 墙高（高度单位）

// 玩家
export const PLAYER_R = 0.3; // 碰撞半径（瓦片）
export const PLAYER_SPEED = 3.1; // 瓦片/秒

// 武器
export const MAG_SIZE = 6;
export const START_SPARE_MAGS = 2;
export const RELOAD_TIME = 1.55;
export const FIRE_COOLDOWN = 0.22;
