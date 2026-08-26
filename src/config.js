/**
 * 逻辑视口，同时也是**像素网格**：世界、精灵、光照全部画在这 640×360 个逻辑
 * 像素上，一个逻辑像素就是画面上的一个"大像素块"。世界坐标、碰撞、QTE、UI 的
 * em 缩放都以它为准。
 */
export const VIEW_W = 640;
export const VIEW_H = 360;

/**
 * 像素放大倍率的上限。6 就是 4K：640×6 = 3840，360×6 = 2160。
 * 再往上两档留给 5K / 8K 桌面 —— 世界永远只画一遍 640×360，倍率只影响最后
 * 那一次 drawImage 和显示画布的显存，所以放宽上限几乎不要钱。
 */
export const PIX_MAX = 8;

/**
 * 挑一个**整数**放大倍率：640×360 的每个逻辑像素在屏幕上正好占 N×N 个设备像素。
 *
 * 关键是按**设备像素**算（乘 devicePixelRatio），不是 CSS 像素 —— Windows 的
 * 125% / 150% 缩放和 Retina 都会让两者不等，只盯 CSS 像素就会退回"非整数倍拉伸"，
 * 也就是像素块忽大忽小、边缘又糊又有锯齿的老毛病。
 *
 * 一律向下取整，宁可四周多一圈黑边（layout() 负责居中留边），也不做非整数缩放。
 * 常见窗口的对照：720p→2、1080p→3、1440p→4、4K→6。
 */
export function pixelScale() {
  if (typeof window === 'undefined') return 3;
  const dpr = window.devicePixelRatio || 1;
  const w = (window.innerWidth || VIEW_W) * dpr;
  const h = (window.innerHeight || VIEW_H) * dpr;
  const fit = Math.floor(Math.min(w / VIEW_W, h / VIEW_H));
  return Math.max(1, Math.min(PIX_MAX, fit));
}

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
