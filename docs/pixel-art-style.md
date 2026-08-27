# Canvas 像素艺术风格：技术实现指南

> 适用范围：LAB 7（`pc` / rooftop 分支，v1.8.0 – v1.9.2）的像素画风实现。
> 面向想在 **Canvas 2D、零图片资源** 的项目里复刻这套观感的工程师。
> 文中引用的 API 与文件均为本仓库当前实现，可直接对照源码阅读。

---

## 1. 设计目标与术语

### 1.1 目标

一句话：**画面有像素游戏的材质读法，同时保持设备像素级的锐利。**

这两件事经常被混为一谈，先拆开定义：

| 术语 | 定义 | 由什么保证 |
|------|------|-----------|
| **清晰度** | 边缘落在设备像素上，无插值、无半透明过渡带 | 全分辨率绘制 + 关闭平滑 + 整数锚点 |
| **像素质感** | 有限调色板、色带 + 抖动、硬边台阶、定格动画 | 画法（绘制 API 的选择）+ 烘焙后处理 |

**像素质感来自「画法」，清晰度来自「分辨率策略」。二者独立，不要用牺牲
一个去换另一个** —— 具体说：不要用「先画低分辨率再放大」去换质感（会糊），
也不要用「平滑渐变直接上屏」去换省事（会露出矢量插画感）。

### 1.2 三条核心结论

| 常见误区 | 本项目的做法 |
|----------|-------------|
| 像素风 = 画 640×360 再最近邻放大 | **全分辨率画**（4K 时 3840×2160，1 逻辑像素 = N 设备像素） |
| 用 `stroke` / `ellipse` / gradient 画精灵 | **整数网格上的 `fillRect`** + 扫描线轮廓，斜边是台阶不是抗锯齿 |
| 所有图层统一做量化抖动 | **分层**：烘焙美术过 `finishArt()`；每帧动态层与光照保持平滑 |

---

## 2. 架构：渲染管线与两条资产路径

```
┌────────────────────────────────────────────────────────────────┐
│ 显示层 (CSS)                                                    │
│ #game { image-rendering: pixelated }   — 防半像素偏移时被插值    │
└────────────────────────────────────────────────────────────────┘
                               ▲ 上屏
┌────────────────────────────────────────────────────────────────┐
│ 主画布：backing store = 640N × 360N（4K → N=6）                 │
│ ctx.imageSmoothingEnabled = false                               │
│ setBase(ctx, N,0,0,N,0,0) — 调用方继续写 640×360 逻辑坐标        │
└────────────────────────────────────────────────────────────────┘
      │                    │                     │
      ▼                    ▼                     ▼
 路径 A：烘焙层        路径 B：每帧现画         光照 / 天气 / FX
 makeArtCanvas()      pixelSprite()           lighting.bakeLight()
 → px* helper 绘制    → px* helper 绘制       → 平滑渐变（不量化）
 → finishArt() 一次   → 不做后处理            → 每帧 drawImage
 → 每帧 blit()        （道具跑不起逐像素）      + globalAlpha 闪烁
 (地板/墙/道具/远景)   (角色/丧尸/直升机)
```

### 2.1 路径 A：烘焙贴图（一次生成，反复 blit）

适用：整局不变或极少变的图层 —— 区域静态层、道具精灵、前景层、远景层。

```js
import { makeArtCanvas, finishArt } from './util.js';

const { c, g } = makeArtCanvas(w, h);   // 逻辑 w×h，真实 wN×hN
paintStuff(g);                          // 用 px* helper + 平滑渐变都可以
finishArt({ c, g });                    // 量化 + Bayer 抖动，只跑这一次
// 之后每帧：blit(ctx, c, x, y)         // 按逻辑尺寸 1:1 贴回
```

关键点：**`finishArt` 是路径 A 的统一出口**。渐变、径向光晕这些"平滑"的
东西可以放心画进烘焙层 —— 出口处会统一断成色带 + 抖点。反过来说，
在烘焙层里手工模拟量化（手写硬分带、手写同心圆环）就是把像素化做了两遍，
见 §8.1 的反模式。

### 2.2 路径 B：每帧现画（角色、直升机、动态 FX）

适用：姿势、朝向、缩放每帧都变的精灵。逐像素后处理跑不起（每帧
getImageData/putImageData 是毫秒级开销），所以像素感只能靠画法本身：

```js
import { pixelSprite } from './util.js';

pixelSprite(g, x, y, box, (gg, ax, ay) => {
  // 这里面的写法与直接画在目标上完全一样，只是原点换到了整数锚点
  drawCharacter(gg, ax, ay, pose);
});
```

`pixelSprite` 只做一件事：**整数锚点吸附**（`Math.round`），保证走路时
精灵不亚像素游移。绘制函数内部全部用 `px*` helper（§4），禁止抗锯齿 API。

---

## 3. 分辨率与 `pixelScale` 策略

### 3.1 为什么不用「低分辨率 + 最近邻放大」

Canvas 在低分辨率画布上画任何斜线/圆弧，浏览器都会抗锯齿出**半透明过渡
像素**。最近邻放大 N 倍后，每个过渡像素变成 N×N 的**软糊色块** —— 恰好是
像素画最忌讳的"插值感"。本项目 v1.5–v1.7 的"纹素网格"方案实测如此，
v1.8 起整体移除（`src/config.js` 顶部注释记录了这段历史）。

### 3.2 现在的做法

- **逻辑视口** 固定 640×360：世界坐标、碰撞、相机、UI 的 em 缩放全按它算。
- **backing store** = 640N × 360N，N 由 `pixelScale()` 给出：

```js
// src/config.js —— 按设备像素（乘 devicePixelRatio）取最大整数倍率
export function pixelScale() {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth * dpr;
  const h = window.innerHeight * dpr;
  const fit = Math.floor(Math.min(w / VIEW_W, h / VIEW_H));
  return Math.max(1, Math.min(PIX_MAX, fit)) * pixBoost;
}
```

  一律**向下取整**：宁可四周多一圈黑边，不做非整数缩放。
  常见对照：720p→2、1080p→3、1440p→4、4K→6。

- **基础变换**：`setBase(g, N,0,0,N,0,0)`（`util.js`）。倍率折进变换，
  调用方永远写逻辑坐标。需要在基础变换之上叠局部变换用 `localT()`，
  回到基础变换用 `baseT()` —— 不要裸写 `setTransform`，近景变焦
  （`game.zoom`）时绝对变换会被抹掉。
- **对齐工具**：`snap(v)` 把逻辑坐标吸到 1/N 格上（= 1 个设备像素），
  给相机抖动这类不能全取整、又不能停在任意小数上的量用。
- **整幕放大的特例**：主菜单把 320×180 的取景铺满全屏，搭景时用
  `withPixelBoost(k, fn)` 临时抬高倍率，否则离屏缓冲贴回去还要再放大
  一轮，等于回到低分辨率放大的老路。

---

## 4. 像素绘制 API 参考（`src/util.js`）

### 4.1 基本纪律

```js
// ✅ 每帧/烘焙层都安全
g.fillRect(Math.round(x), Math.round(y), w, h);
pxLine(g, x0, y0, x1, y1, color, th);
pxPoly(g, [[x, y], ...], fill);

// ❌ 路径 B（每帧精灵）里禁止 —— 抗锯齿过渡像素直接上屏
g.stroke(); g.arc(); g.ellipse(); g.quadraticCurveTo();
g.createLinearGradient(); g.createRadialGradient();
g.lineCap = 'round'; g.lineJoin = 'round';

// ⚠️ 路径 A（烘焙层）里渐变**可以用**：finishArt 会把它量化成色带+抖点。
//    但形状轮廓仍要走 px* helper，finishArt 不会把糊边修硬。
```

### 4.2 Helper 速查

| 函数 | 签名要点 | 用途与原理 |
|------|----------|-----------|
| `pxLine(g,x0,y0,x1,y1,c,th)` | th×th 方块逐格落点 | 直线/描边。沿主轴步进、坐标取整，斜线是连续的硬边台阶 |
| `pxPolyline(g,pts,c,th)` | pts=[[x,y],…] | 折线：线缆、裂纹、垂管 |
| `pxPoly(g,pts,fill)` | 凸多边形 | 逐行扫描，每行取整成一条 `fillRect`，代替 `beginPath/fill` |
| `pxEllipse(g,cx,cy,rx,ry,c)` | 实心椭圆 | 逐行算半宽再 `fillRect` |
| `pxEllipseRing(g,cx,cy,rx,ry,c,th)` | 椭圆环 | 行扫+列扫两遍，防圆顶漏格。雨水花、尾桨护环 |
| `pxDither(g,x0,x1,y,c)` | 水平交界行 | 色带交界隔格点 1px，棋盘奇偶由 `(x+y)&1` 定 |
| `pxDitherV(g,x,y0,y1,c)` | 竖直交界列 | 同上，沿列 |
| `pxDitherLine(g,x0,y0,x1,y1,c)` | 斜向交界 | 沿 `pxLine` 落点取棋盘半数 |
| `edgeAt(pts,y)` / `rowScan(L,R,y0,y1)` | 轮廓工具 | 多段折线定义左右边界，逐行取整出 `[xl,xr]` |
| `pxShadow(g,cx,cy,rx,ry,a)` | 脚下阴影 | 三档同心 `pxEllipse` 平涂，代替径向渐变 |
| `pxGlow(g,x,y,r,'r,g,b',k)` | 小型辉光 | 三档同心**方块**，代替 `radialGradient`。航行灯、警示灯、火花（调用方自行开 `lighter`） |
| `pxBlob(g,cx,cy,rx,ry,c,rand)` | 污渍/水渍 | `pxEllipse` + 随机咬边，摊子不是光滑椭圆 |
| `pxText(g,x,y,str,c,s)` | 3×5 点阵字模 | 门牌、楼层号、警示喷涂。canvas `fillText` 在小字号下是一团糊 |

### 4.3 体积与明暗：色带 + 抖动，不用渐变

每帧精灵的体积感用**平涂色带 + 1px 高光/阴影边 + 交界抖动**表达：

```text
机身剖面（直升机 drawHeli，src/art.js）：
  外轮廓 1px 描边 (HP.out)
    → 主体平涂 (HP.low)
    → 上缘 2px 高光 (HP.hi)
    → 下缘 2px 暗部 (HP.belly)
    → 两色交界 pxDither() 棋盘过渡
```

调色板用命名常量（`HP.hi / HP.low / HP.out`…），每个材质手选 4–6 档。
`shade()` 连续插值只用于小面积点缀，不要拿它铺大面积过渡。

---

## 5. `finishArt`：量化 + Bayer 有序抖动

### 5.1 原理

```js
// src/util.js（节选）
const BAYER4 = Uint8Array.of(0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
const QSTEP = 14;                       // 量化步长：每通道 256/14 ≈ 18 级

// 对每个像素（跳过 alpha < 24 的极淡像素）：
const dth = ((BAYER4[bayerIndex] + 0.5) / 16 - 0.5) * QSTEP;  // ±QSTEP/2 的阈值偏移
channel = clamp(Math.round((v + dth) / QSTEP) * QSTEP);
```

两个实现细节决定了观感：

1. **抖动格子对齐逻辑像素**：Bayer 索引按 `(x/N)|0`、`(y/N)|0` 取，
   所以每个抖点是边长 N 设备像素的**实心方块** —— 分辨率没降
   （形状边缘仍是设备像素级），但大面积渐变读起来就是像素游戏的做法。
2. **低 alpha 跳过**：预乘存储在低 alpha 下往返取整的噪声会被量化放大成
   杂色，`a < 24` 直接不动。

### 5.2 QSTEP 调参

| QSTEP | 每通道档数 | 观感 |
|-------|-----------|------|
| 8 | ~32 | 抖点几乎不可见，接近原图 |
| **14（当前）** | ~18 | 大渐变有明显色带+抖点，小物件几乎无损 |
| 22 | ~12 | 强烈复古，暗部开始吃细节 |
| 32 | 8 | GameBoy 级，需要配合重新选色 |

调参只改 `util.js` 的这一个常量。注意 QSTEP 变大后**暗色之间的差会被
吃掉**（本项目大量 `#05080d` 级的夜景深色），先在天台远景和实验室
暗角处检查再定。

### 5.3 只跑一次

`finishArt` 是 `getImageData` 全量遍历，只允许出现在**生成期**（区域
首次构建、道具精灵生成）。每帧跑不起，也不该跑 —— 动态光照必须保持
平滑（§7）。

---

## 6. 动画离散化：`tick` 与 `qz`/`qstep`

像素风动画靠**离散关键帧**读法，不靠 smooth lerp 到底。

```js
// src/art.js（导出）；main.js 另有同型的局部定义 qstep
export const tick = (t, hz) => Math.floor(t * hz) / hz;   // 固定帧率采样
export const qz = (v, step) => Math.round(v / step) * step; // 数值分档
```

用法示例（均为仓库真实调用）：

```js
// 悬停浮沉：8fps 定格采样，而不是连续正弦
const bob = Math.sin(tick(t, 8) * 1.7) * 2.2;

// 绳索摆动相位定格 7fps，摆幅再吸到 1px
const tq = tick(t, 7);
const swx = qz(Math.sin(tq * 2.3 + k * 3.2) * 5 * sway, 1);

// 起床动画的躯干旋转：量化成 π/14 一档，读作逐帧动画
rot: A.qz(LIE_ROT * (1 - k), Math.PI / 14),

// 旋翼/弹壳翻滚：角度量化到 π/4、π/5 格点，上一格可以画半透明残影
const f = Math.round(spin / (Math.PI / 4)) & 3;   // 4 个朝向帧
```

**分寸**：`z` 高度、镜头平移、缩放这类"穿帮敏感"的量保持 smooth；
**pose、桨角、摆动相位**这类"读得出帧"的量才离散化。全都定格会卡顿，
全都 smooth 会像补间动画。

---

## 7. 光照分层：美术像素化，光照平滑

这是**刻意保留的反差**，也是这套画风最容易被误改的地方：

| 层 | 处理 | 理由 |
|----|------|------|
| 美术精灵/静态层 | 硬边 + 量化 + 抖动 | 像素游戏的材质读法 |
| 动态光照（手电锥、枪口闪、闪电 addFlat） | 设备像素级平滑渐变 | 夜景氛围；光照糊是"体积光"，不是"没对齐" |
| 静态灯 | `lighting.bakeLight()` 烘成贴图，每帧 `drawImage + globalAlpha` | 位置整局不变，只有亮度在闪 |
| **天空光 `area.skyPaint`** | **平滑线性渐变**（烘焙,但**不过** finishArt） | 它是光照贴图不是美术 —— v1.9.0 曾把它硬分带,结果见 §8.1 |
| 屏幕空间天气（雨) | 硬边 1px 像素雨丝（§8.2），但**透明度连续** | 雨丝是"美术"，雨的明暗跟闪电走是"光照" |

判断口诀：**乘/叠在别的图层上的半透明贴图是光照，直接构成画面内容的是
美术**。光照走平滑，美术走像素。

---

## 8. 常见陷阱与反模式

### 8.1 双重像素化（v1.9.0 天台远景回归，v1.9.2 修复）

**症状**：天台夜空出现两道横贯全屏的硬接缝，远处火光变成一块块
橙色"饼"，城市剪影淹没在噪点里。

**根因**：全游戏像素化时，把已经会被 `finishArt` 处理的烘焙层
（`paintRoofBackdrop`）里的平滑渐变**又**手写成了硬分带
（`bandFillV`）+ 手工同心摊（`pxBlob`）；同时把天空光 `skyPaint`
（光照贴图！）也硬分带了。等于像素化做了两遍：

```
渐变 → 手写 5 档硬分带 → finishArt 再量化
     ↑ 档位比 QSTEP 粗，接缝清晰可见，且骑在剪影上
```

**规则**：
- 走 `finishArt` 出口的烘焙层，大面积渐变**保持平滑**，量化交给出口。
- 光照贴图（skyPaint、bakeLight）**永远**不做量化抖动（§7）。
- 手写硬分带只用于**不过 finishArt** 的每帧绘制（路径 B）。

### 8.2 把连续笔画拆成不相连的段（v1.9.0 雨丝回归，v1.9.2 修复）

**症状**：暴雨从"斜着砸向天台的雨"变成"满屏到处都在滴落的散点"，
连楼外的黑暗虚空上都是白点。

**根因**：像素化时把一滴雨从一条 `stroke` 斜线改成了 **2~3 段横向
错位的 1px 竖条**。数学上首尾相接，但在 0.16~0.3 的低透明度下，
横向错位让眼睛串不起来 —— 每段读成一滴独立的雨，视觉密度翻了三倍,
方向感全失。

**修复**（`src/fx.js` `Rain.draw`）：每滴改回**一条连续的斜向像素线**
——逐行落点、同列并笔，硬边 1px、无抗锯齿，但台阶彼此相连：

```js
const len = Math.max(2, Math.round(L.len * d.k));
const dx = vx * d.k;                 // 整条雨丝的横向斜移
let sx = Math.round(d.x), sy = y0;
for (let yy = 1; yy <= len; yy++) {
  const x = yy === len ? null : Math.round(d.x + (dx * yy) / len);
  if (x !== sx) {                    // x 变了才落笔：同列行并成一次 fillRect
    g.fillRect(sx, sy, 1, y0 + yy - sy);
    sx = x; sy = y0 + yy;
  }
}
```

**规则**：把矢量笔画翻译成像素时，保住**连通性**和**方向读法**；
"分段错位"只适合刻意要做成虚线/雨夹雪的场合。
同理，硬边 1px 图元的**每像素覆盖率**比亚像素 stroke 高一倍以上，
翻译时透明度要相应打折（雨水花从 0.22 降到 0.12 才回到旧观感）。

### 8.3 裁剪与坐标空间

排查天气/远景类 bug 时，先把图层的坐标空间与裁剪链说清楚。本项目有
四套空间，各自的裁剪规则不同：

| 空间 | 例子 | 裁剪/遮罩 |
|------|------|----------|
| 世界（瓦片坐标 → 等距投影） | 地板、道具、角色 | 房间遮罩 `area.mask`（烘焙）或可见性多边形 |
| 屏幕空间・跟相机抖动 | `area.backdrop` 远景层 | 无裁剪；靠 `area.noMask` + `skyLight` 控制明暗 |
| 屏幕空间・不跟任何变换 | 雨（`Rain`）、全屏闪光、淡入淡出 | 画之前 `applyScreen(ctx)` 回到基础变换 |
| 背景层画布坐标 | `area.beacons` 障碍灯 | 与 backdrop 同空间，画时加相机差值 |

具体规则：

- **雨是屏幕空间粒子，唯一开关是 `game.storm`**。它由 `enterArea()`
  在进出天台时 `startStorm()/stopStorm()`，重生（`respawn`）与回主菜单
  （`resetRun`）都会走 `stopStorm()`。排查"别的区域下雨"先查这条开关链，
  再查绘制处 `if (game.storm)` 的条件 —— 不要在 Rain 类里找区域判断，
  它没有也不该有。
- **露天区域 `area.noMask = true`**：房间遮罩会把天台封成室内盒子，
  天空直接变黑。屋面外的可见性交给 `skyLight`（在 `ensureAreaLights`
  里用 `destination-out` 抠掉屋面），不要再套房间遮罩。
- **近景变焦（`game.zoom`）整帧一起缩放**。烘焙光贴图与遮罩都合成在
  未缩放的 640×360 屏幕空间里，只有整帧统一变换，几何与光照才不会错开。
  屏幕空间图层（雨/闪光）画之前必须回到基础变换。

### 8.4 其余反面教材（SVG 感来源清单）

1. `ellipse` / `arc` / `quadraticCurveTo` 直接上屏 —— 抗锯齿半透明边
2. `lineCap:'round'` —— 圆头描边像矢量插画
3. 每帧层里的 `createLinearGradient` / `radialGradient` —— 平滑过渡穿帮
4. 低分辨率离屏 → 放大 —— 过渡像素放大成糊斑（§3.1）
5. `imageSmoothingEnabled` 忘关 —— 任何缩放都插值
6. 亚像素定位（`x = 10.3`）—— 精灵行走发虚，用 `Math.round`/`snap`
7. 小字号 `fillText` —— 8px 以下是一团糊，用 `pxText` 字模
8. 在 `finishArt` 之前手写硬分带 —— 双重像素化（§8.1）
9. 把连续笔画拆成错位段 —— 读成散点（§8.2）
10. 给光照贴图做量化抖动 —— 夜景变"隔玻璃"（§7）

---

## 9. 迁移检查清单

### 渲染基础
- [ ] 逻辑分辨率固定（如 320×180 / 640×360），碰撞与 UI 按它算
- [ ] `pixelScale()` 按 devicePixelRatio 取**整数**倍率，画布 = 逻辑 × N
- [ ] 全局 `imageSmoothingEnabled = false`；CSS `image-rendering: pixelated`
- [ ] 基础变换封装（`setBase`/`baseT`/`localT`），禁止裸 `setTransform`
- [ ] 舞台定位对齐设备像素整数格

### 绘制规范
- [ ] 抽出 `pxLine/pxPoly/pxEllipse/pxDither/pxGlow/pxText` 工具集
- [ ] 每帧精灵禁用抗锯齿 API；体积用 4–6 档命名色带 + 交界抖动
- [ ] 硬边图元的透明度按覆盖率重新标定（比亚像素 stroke 低 30–50%）

### 资产管线
- [ ] 静态层：离屏绘制 → `finishArt`（量化 + Bayer）→ 缓存 blit
- [ ] 烘焙层内渐变保持平滑，量化只在出口做一次（防双重像素化）
- [ ] 动态层：整数锚点 + 全分辨率直接画，无逐像素后处理
- [ ] 光照/天气贴图不量化，与美术像素感分层

### 动画
- [ ] 周期运动 `tick(t, hz)` 定格；姿势插值 `qz(v, step)` 分档
- [ ] 旋转体角度量化到 `π/n` 格点，可加残影帧
- [ ] 位移/镜头保持 smooth，只离散"读得出帧"的量

### 坐标与裁剪
- [ ] 每个图层写明：坐标空间、跟不跟相机、被什么裁剪
- [ ] 屏幕空间图层画之前回到单位/基础变换
- [ ] 天气等全局粒子的开关挂在**场景切换**的单一入口上

### 部署
- [ ] 入口 HTML 带 `?v=` 缓存串
- [ ] **子模块 import 也要带 `?v=`**（ES module 不继承父 URL 的 query，
      纯视觉改动藏在子模块里时用户会一直命中旧缓存）

---

## 10. 本仓库文件索引

| 文件 | 内容 |
|------|------|
| `src/config.js` | `pixelScale`/`snap`/`withPixelBoost`、分辨率策略说明 |
| `src/util.js` | `finishArt`（QSTEP/BAYER4）、`pixelSprite`、全部 `px*` helper、`setBase/baseT/localT` |
| `src/art.js` | `drawHeli`（像素语言标杆）、`drawCharacter`、道具精灵、`tick`/`qz` |
| `src/areakit.js` | 通用墙/地/门件，出口统一 `finishArt` |
| `src/areas.js` | 各区域静态层；`paintRoofBackdrop` 天台远景（平滑渐变→finishArt 的范例）；`skyPaint` 天空光（光照保持平滑的范例） |
| `src/fx.js` | `Rain` 像素雨丝（连续斜线画法）、弹壳朝向帧、粒子 |
| `src/lighting.js` | `bakeLight`/`bakeMask`，光照永远平滑 |
| `src/main.js` | 主循环、渲染顺序（世界→光照→灯具→屏幕空间层）、`ensureAreaLights` 天空光合成 |
| `style.css` | `image-rendering`、舞台布局 |
| `tools/pixels.mjs` | 验证 backing store 分辨率 |
| `tools/pixcrop.mjs` | 放大抠块检查抖点是否为硬方块 |
| `tools/rainroof.mjs` | 天台雨/远景 + 其他区域无雨的冒烟截图 |

---

## 11. 调参旋钮

| 参数 | 位置 | 效果 |
|------|------|------|
| `QSTEP` | `util.js` | 烘焙层调色板级数（§5.2 有档位对照表） |
| `BAYER4` | `util.js` | 抖动图案，可换 8×8 Bayer 获得更细的过渡 |
| `PIX_BASE` / `PIX_MAX` | `config.js` | 整数倍率基准与上限 |
| 色带档位 | 各 `draw*` | 直升机 `HP.*` 是 5 档范例 |
| `tick(t, hz)` 的 hz | 动画处 | 越小越"定格"，7–8 是本项目的甜点 |
| `qz(v, s)` 的 s | 过场/QTE | 步长越小档位越多 |

---

## 12. 一句话总结

> **在全分辨率像素网格上，用整数 `fillRect` 和扫描线轮廓作画；烘焙层
> 出口统一量化 + 抖动（只做一遍）；光照与天气保持平滑；动画离散化
> "读得出帧"的量。清晰度与像素质感由不同机制分别保证，互不牺牲。**
