# Canvas 像素艺术风格实现指南

> 本文档总结 LAB 7（`pc` / rooftop 分支）在 v1.8–v1.9 形成的像素画风。
> 目标：**画面清晰锐利，同时有像素游戏的质感**——不是把分辨率压低，而是换一套画法。

---

## 1. 核心结论（先看这三条）

| 误区 | 正解 |
|------|------|
| 像素风 = 先画 640×360 再最近邻放大 | **全分辨率画**（4K 时 3840×2160，1 逻辑像素 = N 设备像素），锐度不丢 |
| 用 `stroke` / `ellipse` / `gradient` 画精灵 | **整数网格上的 `fillRect`** + 扫描线轮廓，斜边是台阶不是抗锯齿 |
| 所有东西都做调色板量化 | **分两条路**：烘焙贴图后处理量化；角色/直升机每帧直接画，光照保持平滑 |

**像素质感来自「画法」；清晰度来自「全分辨率 + 关插值 + 整数锚点」。**

---

## 2. 渲染管线总览

```
┌─────────────────────────────────────────────────────────────┐
│  显示层 (CSS)                                                │
│  #game { image-rendering: pixelated }  — 保险，防半像素偏移   │
└─────────────────────────────────────────────────────────────┘
                              ▲
┌─────────────────────────────────────────────────────────────┐
│  主画布 640N × 360N                                          │
│  ctx.imageSmoothingEnabled = false                           │
│  pixelScale() 按窗口 DPR 取最大整数倍率 N（4K → N=6）         │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   烘焙静态层            每帧动态精灵           光照 / 雨 / FX
   finishArt()          pixelSprite()          保持平滑渐变
   (道具/墙地/远景)      (角色/丧尸/直升机)      (不量化)
```

### 2.1 逻辑坐标 vs 像素网格

- **逻辑视口**：640×360（碰撞、相机、UI 的 `em` 缩放仍按这个算）
- **真实画布**：`640 × N` 宽、`360 × N` 高，与设备像素 1:1
- **基础变换**：`setBase(g, N, 0, 0, N, 0, 0)`，调用方继续写逻辑坐标，倍率折进变换

关键代码：`src/config.js`（`pixelScale`、`snap`）、`src/main.js`（`sizeCanvas`）

### 2.2 为什么不用「低分辨率离屏 + 放大」

Canvas 在低分辨率上画斜线/圆弧时，浏览器会抗锯齿出**半透明过渡像素**。最近邻放大 N 倍后，这些过渡色变成大块**软糊混色**——正是「SVG 感 / 插值感」的来源。

v1.8 起已移除纹素网格方案。现在：

- 素材画在 **640N×360N** 全分辨率上
- 像素感由 **硬边绘制 + 调色板量化（仅烘焙层）** 给出

详见 `src/config.js` 顶部注释。

---

## 3. 两条绘制路径

### 路径 A：烘焙贴图（场景、道具、远景）

**适用**：整局不变或极少变的图层——地板墙、静态道具、天台夜空、区域前景。

```
makeArtCanvas(w, h)  →  用像素 helper 绘制  →  finishArt()  →  每帧 blit()
```

`finishArt()`（`src/util.js`）做两件事：

1. **调色板量化**：每通道约 18 级（`QSTEP = 14`）
2. **4×4 Bayer 有序抖动**：抖动格子对齐**逻辑像素**（边长 N 的设备像素实心方块）

效果：大面积渐变断成**色带 + 棋盘抖点**，放大看是硬方块，不是糊斑。

**注意**：只在生成时跑一次。每帧重算跑不起，且会破坏动态光照的平滑感。

### 路径 B：每帧现画（角色、丧尸、直升机、部分 FX）

**适用**：姿势、朝向、缩放每帧都变的精灵。

```
pixelSprite(g, x, y, box, (gg, ax, ay) => drawCharacter(gg, ax, ay, ...))
```

`pixelSprite` **不做**离屏降分辨率，只做一件事：

- **整数锚点吸附**：`Math.round(x/y)`，走路不亚像素游移

绘制函数内部全部用 `pxLine` / `pxPoly` / `pxEllipse` 等 helper，**禁止** `stroke` 曲线、`ellipse` 填色、`createLinearGradient`。

直升机 `drawHeli` 是这套语言的「标杆实现」，见 `src/art.js`。

---

## 4. 像素绘制语言（`src/util.js`）

从直升机段落提炼、全游戏共用的 helper 集。

### 4.1 基本规则

```javascript
// ✅ 推荐
g.fillRect(Math.round(x), Math.round(y), w, h);
pxLine(g, x0, y0, x1, y1, color, thickness);
pxPoly(g, [[x,y], ...], fillColor);

// ❌ 避免（会产生抗锯齿过渡像素）
g.stroke(); g.arc(); g.ellipse(); g.quadraticCurveTo();
g.createLinearGradient(); g.lineCap = 'round'; g.lineJoin = 'round';
```

线帽/连接一律 `butt` / `miter`。

### 4.2 Helper 速查

| 函数 | 用途 | 原理 |
|------|------|------|
| `pxLine` | 直线、轮廓描边 | Bresenham 式逐格 `fillRect`，斜边是台阶 |
| `pxPolyline` | 折线、线缆 | 多段 `pxLine` |
| `pxPoly` | 凸多边形填充 | 逐行扫描，每行一条 `fillRect` |
| `pxEllipse` | 圆/椭圆实体 | 逐行算半宽，`fillRect` 填一行 |
| `pxEllipseRing` | 圆环（尾桨护环、套环） | 行扫 + 列扫两遍，防漏格 |
| `pxDither` | 水平色带交界 | 交界行隔格点 1px 方块 |
| `pxDitherV` | 竖向色带交界 | 同上，沿列 |
| `pxDitherLine` | 斜向交界抖动 | 沿 `pxLine` 落点，棋盘奇偶取半 |
| `rowScan` / `edgeAt` | 复杂轮廓 | 多段折线定义左右边界，逐行取整 |
| `pxShadow` | 脚下阴影 | 三档同心 `pxEllipse`，代替径向渐变 |
| `pxGlow` | 航行灯/火花 | 三档同心方块，代替 `radialGradient` |
| `pxBlob` | 污渍、水渍 | `pxEllipse` + 随机咬边 |
| `pxText` | 门牌、编号 | 3×5 点阵字模手拼，不用 `fillText` |

### 4.3 体积与明暗：硬分带 + 抖动

不用渐变表达体积，用**平涂色带 + 1px 高光/阴影边**：

```text
机身示例（直升机）：
  外轮廓 1px 描边 (HP.out)
  → 主体平涂 (HP.low)
  → 上缘 2px 高光 (HP.hi)
  → 下缘 2px 暗部 (HP.belly)
  → 两色交界处 pxDither() 棋盘过渡
```

调色板用命名常量（如 `HP.hi / HP.low / HP.out`），每通道手动选 4–6 档，**不要** `shade()` 连续插值做大面积过渡（小面积点缀可以）。

### 4.4 参考实现：直升机 `drawHeli`

位于 `src/art.js`，建议新项目直接读源码。结构要点：

1. 机心取整：`X = Math.round(x)`, `Y = Math.round(y)`
2. 尾梁：**逐列扫描**——每列 `bx` 算上下边界，4 条 `fillRect`（描边/主体/高光/暗部）
3. 机身：**预计算 `HULL_ROWS`**——每行 `[xl, xr]`，循环 `fillRect`
4. 风挡：多边形硬边 + 一条斜向反光带（`pxPoly`）
5. 旋翼：角度 **量化到 π/4 或 π/5 格点**，上一格画半透明残影
6. 探照灯：每 3px 一条扫描带，隔带明暗交替（`drawHeliBeam`）

---

## 5. 动画：清晰 ≠ 丝滑

像素风动画靠**离散关键帧**，不靠 smooth lerp 到底。

### 5.1 位置吸附

```javascript
// 落点、相机抖动
const shx = snap((Math.random() - 0.5) * amp);  // snap = round(v*n)/n

// 精灵锚点
pixelSprite(g, hx, hy, HELI_BOX, (gg, ax, ay) => drawHeli(gg, ax, ay, t));
```

### 5.2 时间量化

```javascript
// 固定帧率采样：7fps / 8fps 定格
const tick = (t, hz) => Math.floor(t * hz) / hz;
const bob = Math.sin(tick(t, 8) * 1.7) * 2.2;

// 进度量化：6 档 / 8 档步进
const qstep = (v, s) => Math.round(v / s) * s;
c.reach = qstep(smoothstep(k), 1 / 6);
c.door  = qstep(k, 1 / 7);
```

**原则**：`z` / `shrink` / 相机平移可保持 smooth（避免穿帮）；**pose / 桨角 / 绳索相位** 用 `qstep` 或 `tick`。

### 5.3 绳索 `drawRope`

- 摆动相位 `tick(t, 7)`，偏移 `snap` 到 1.5px 网格
- 绳股：逐像素铺 4px 宽，两色交错
- 套环：`pxEllipseRing`，不用 `stroke` 画圆

---

## 6. 光照与像素感的分工

**故意保留反差**：

| 层 | 处理方式 | 原因 |
|----|----------|------|
| 美术精灵 | 硬边、有限色、抖动 | 像素游戏读法 |
| 动态光照、雨、探照灯锥、全屏闪光 | 设备像素级平滑 alpha/渐变 | 夜景氛围、性能（烘焙贴图每帧只 `drawImage`） |
| 静态光源 | 启动时 `lighting.bakeLight()` 烘焙 | 整局位置不变，每帧一次 blit |

不要把 `finishArt()` 套在每帧光照上——会又糊又慢。

---

## 7. 显示层（CSS）

```css
#game {
  image-rendering: pixelated;  /* 防止舞台半像素偏移时边缘被插值 */
}
.icon, #portrait {
  image-rendering: pixelated;
}
```

舞台尺寸由 `layout()` 按**整数设备像素**算好，避免 `translate(-50%,-50%)` 停在半像素上。

DOM 中文 UI 仍是矢量字体，与 canvas 像素美术**刻意分离**——内部分辨率 640×360 上画中文会不可读。

---

## 8. 反面教材（SVG 感的来源）

1. **`ellipse` / `arc` / `quadraticCurveTo`** — 浏览器抗锯齿出半透明边
2. **`lineCap: 'round'`** — 圆头描边像矢量插画
3. **`createLinearGradient` / `radialGradient`** — 平滑过渡，缺少色带+抖动
4. **低分辨率离屏 → `drawImage` 放大** — 过渡像素被放大成糊斑
5. **`imageSmoothingEnabled: true`**（默认）— 任何缩放都插值
6. **亚像素定位** — `x = 10.3` 走路时精灵发虚
7. **canvas `fillText` 小字号** — 小于约 8px 是一团糊，改 `pxText` 字模

---

## 9. 迁移到其他项目的检查清单

### 渲染基础

- [ ] 逻辑分辨率固定（如 320×180 / 640×360）
- [ ] `pixelScale()` 按 DPR 取**整数**倍率，画布 = 逻辑尺寸 × N
- [ ] 全局 `imageSmoothingEnabled = false`
- [ ] CSS `image-rendering: pixelated`（可选但推荐）
- [ ] 舞台定位对齐设备像素整数格

### 绘制规范

- [ ] 抽出 `pxLine` / `pxPoly` / `pxEllipse` / `pxDither` 工具集
- [ ] 精灵绘制禁止 `stroke` 曲线；线用 `pxLine` 方块叠出来
- [ ] 明暗用 3–5 档命名色 + `pxDither` 交界，不用渐变铺体积
- [ ] 小字号用点阵字模，不用 `fillText`

### 资产管线

- [ ] 静态层：`离屏绘制 → finishArt（量化+Bayer）→ 缓存 blit`
- [ ] 动态层：`pixelSprite 整数锚点 → 全分辨率直接画`
- [ ] 光照/天气：保持平滑，与美术像素感分层

### 动画

- [ ] 周期性运动：`tick(t, fps)` 定格
- [ ] 姿势插值：`qstep(v, 1/6)` 分档
- [ ] 旋转桨叶/指针：角度量化到 `π/n` 格点 + 残影帧

### 部署

- [ ] 入口 HTML 的 `?v=` 缓存串
- [ ] **子模块 import 也要带 `?v=`**（ES module 不会继承父 URL 的 query）

---

## 10. 本仓库文件索引

| 文件 | 内容 |
|------|------|
| `src/config.js` | `pixelScale`、`snap`、像素风设计说明 |
| `src/util.js` | `finishArt`、`pixelSprite`、全部 `px*` helper |
| `src/art.js` | `drawHeli`（标杆）、`drawCharacter`、道具绘制 |
| `src/areakit.js` | 通用墙/地/门件 + `finishArt` 烘焙 |
| `src/areas.js` | 各区域静态层、天台远景 |
| `src/zombies.js` | 丧尸像素躯体 |
| `src/fx.js` | 弹壳帧、雨丝、烟雾等像素化特效 |
| `src/main.js` | 主循环、`pixelSprite` 调用、`qstep`/`tick` 动画 |
| `style.css` | `image-rendering`、舞台布局 |
| `tools/pixels.mjs` | 验证后备存储分辨率 |
| `tools/pixcrop.mjs` | 放大抠块检查抖点是否为硬方块 |

---

## 11. 调参旋钮

| 参数 | 位置 | 效果 |
|------|------|------|
| `QSTEP` | `util.js` | 烘焙层调色板级数，越小越「复古」，越大越细腻 |
| `PIX_MAX` | `config.js` | 最大整数倍率上限 |
| `BAYER4` | `util.js` | 有序抖动图案，可换 8×8 Bayer |
| 色带档位数 | 各 `draw*` 内 | 直升机 `HP.*` 是 5 档范例 |
| `tick(t, hz)` | 动画处 | hz 越小越「定格」，越大越流畅 |
| `qstep(v, s)` | 过场/QTE | s 越小档位越多 |

---

## 12. 一句话总结

> **在全分辨率像素网格上，用整数 `fillRect` 和扫描线轮廓作画；烘焙层再用量化+抖动收束颜色；动态光照保持平滑；动画用分档步进代替无限插值。**

这样既有 4K 的锐利，又有像素游戏的材质读法——两者不靠降低分辨率，而靠分层处理。
