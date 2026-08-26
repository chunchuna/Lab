/**
 * 逻辑视口。**所有**世界坐标、精灵偏移、光照贴图都仍在这套 640×360 的坐标系里算，
 * 改成高清渲染并没有动它 —— 动的只是"一个逻辑像素落到几个真实像素上"。
 */
export const VIEW_W = 640;
export const VIEW_H = 360;

/**
 * 渲染倍率（超采样）。canvas 的实际像素 = 逻辑尺寸 × RS，绘制时基础变换里
 * 乘一个 RS，所以画代码一律照旧写逻辑坐标。
 *
 * 以前是 640×360 的画布靠 CSS 放大 2～3 倍，再配 image-rendering: pixelated ——
 * 窗口尺寸不是整数倍时块大小忽大忽小，看起来就是又糊又有锯齿块。现在按启动时
 * 的窗口大小挑一个整数倍率，让画布像素接近真实显示像素，CSS 只做最后的等比微调。
 *
 * 精灵与静态层是在启动时一次性烘焙的，倍率跟着窗口变会全部作废，所以 RS 只在
 * 载入时定一次；之后改窗口大小只影响 CSS 那一层的平滑缩放。
 */
export const RS = pickRenderScale();

function pickRenderScale() {
  if (typeof window === 'undefined') return 2;
  const w = window.innerWidth || VIEW_W;
  const h = window.innerHeight || VIEW_H;
  const fit = Math.min(w / VIEW_W, h / VIEW_H);
  // 上限 3：再往上是 9 倍填充率，光照那几张全屏缓冲会开始吃满帧预算
  return Math.max(2, Math.min(3, Math.round(fit)));
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
