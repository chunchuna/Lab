/**
 * 逻辑视口。世界坐标、碰撞、QTE、UI 的 em 缩放仍以这 640×360 为准。
 *
 * 真正的**像素网格**是逻辑尺寸 × N：4K 时 N=6，即 3840×2160，一个内部
 * 像素对上一个设备像素。不再先画一张 640×360 再吹大 —— 那只会得到
 * 6×6 的色块，信息量还是 230400，看起来就是上一档的糊。
 */
export const VIEW_W = 640;
export const VIEW_H = 360;

/**
 * 4K 基准倍率：640×6 = 3840，360×6 = 2160。
 * 再往上两档留给 5K / 8K 桌面，那些窗口会用自己的整数 N 当像素网格。
 */
export const PIX_BASE = 6;
export const PIX_MAX = 8;

/**
 * 整幕放大的场景（主菜单把 320×180 的取景铺满全屏）在搭景时要临时抬高倍率：
 * 屏幕上一个逻辑单位占 SCALE×N 个设备像素，离屏缓冲若还按 N 生成，贴回去就要
 * 再放大一轮 —— 那正是 640×360 吹大的老路。
 *
 * 只包住搭景那一段**同步**代码，用完立刻还原。
 */
let pixBoost = 1;
export function withPixelBoost(k, fn) {
  const prev = pixBoost;
  pixBoost = Math.max(1, k);
  try {
    return fn();
  } finally {
    pixBoost = prev;
  }
}

/**
 * 当前窗口能放下的最大整数倍率。按**设备像素**算（乘 devicePixelRatio），
 * 不是 CSS 像素 —— Windows 的 125% / 150% 和 Retina 会让两者不等。
 *
 * 一律向下取整，宁可四周多一圈黑边，也不做非整数缩放。
 * 常见对照：720p→2、1080p→3、1440p→4、4K→6。
 */
export function pixelScale() {
  if (typeof window === 'undefined') return PIX_BASE * pixBoost;
  const dpr = window.devicePixelRatio || 1;
  const w = (window.innerWidth || VIEW_W) * dpr;
  const h = (window.innerHeight || VIEW_H) * dpr;
  const fit = Math.floor(Math.min(w / VIEW_W, h / VIEW_H));
  return Math.max(1, Math.min(PIX_MAX, fit)) * pixBoost;
}

/** 把逻辑坐标对齐到当前像素网格的整数格上（4K 上就是 1 个设备像素）。 */
export function snap(v) {
  const n = pixelScale();
  return Math.round(v * n) / n;
}

/* ------------------------------------------------------------------ *
 * 像素质感怎么来（v1.8 起）
 *
 * 曾经试过"纹素网格"：美术先画在 640×360 那一档的离屏画布上，再最近邻
 * 整数倍贴回来。结论是**看起来糊**——Canvas 在低分辨率上画任何斜线/圆弧
 * 都会抗锯齿出半透明的过渡像素，放大 N 倍之后这些过渡色成了一大块
 * 软绵绵的混色，恰恰是像素画最忌讳的"插值感"。已整体移除。
 *
 * 现在的做法：**素材一律画在 640N×360N 的全分辨率上**（4K 与设备像素
 * 1:1，锐度就是 v1.5 那一档），像素感改由"画法"给：
 *   - 烘焙贴图统一过一遍 finishArt()（见 util.js）：有限调色板 +
 *     按逻辑像素对齐的 4×4 有序抖动。渐变变成色带 + 方块抖点，
 *     每个抖点是边长 N 设备像素的实心方块——硬的，不是糊的。
 *   - 每帧现画的角色仍走 pixelSprite() 的整数锚点吸附，不会亚像素游移。
 *   - 光照、雨、辉光继续用设备像素级的平滑渐变，保持
 *     "像素质感的美术 + 设备像素级的光" 这个反差。
 * ------------------------------------------------------------------ */

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
