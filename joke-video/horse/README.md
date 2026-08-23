# 老马 · 场景合成工具包

> 这份只管**美术工具包**（角色、场景、漫符、摆拍）。
> 怎么出片看 [../老马出片方案.md](../老马出片方案.md)，
> 稿子怎么写看 [SCRIPT_GUIDE.md](SCRIPT_GUIDE.md)，定位与选题看 [horse_standup_plan.md](horse_standup_plan.md)。
> 目录、命名、发布排期：[SCHEDULE.md](SCHEDULE.md)。
> **成品树 ＝ 排期树**，在 `projects/老马/段子/{_待发,_已发}/`，
> 校验 `npm run laoma:schedule`。
>
> ⚠ **2026-08-23：看盘专辑停掉了。** 那个专辑的规范、稿源、成片、排期全撤了，
> **物件库 `objects.mjs` 留着**（它本来就是老马线的首帧工具，跟专辑无关）。

全部 Node，无 Python 依赖。

## 文件

| 文件 | 作用 |
|---|---|
| `rough.mjs` | 手绘线条库：贝塞尔采样 + 噪声抖动 + 多遍描画 + 排线填充。所有随机走种子化 RNG，同 seed 出图完全一致 |
| `scenes.mjs` | 10 个场景，覆盖四个栏目。含尺度系统与站位预设 |
| `horse_only.svg` | 角色本体，透明背景，带驱动分组 |
| `horse-pose.mjs` | 驱动：转眼珠 / 口型 / 扭头 / 上下浮动，附 `lipsync()` 与 `idleEyes()` |
| `compose.mjs` | 把角色叠到任意背景上，站位用画布比例；漫符也在这一层合成 |
| `marks.mjs` | 漫符：吃惊/汗/无语等 10 个手绘小符号 ＋ 挂到头两侧的定位器。`node render.mjs --marks` 出一览图 |
| `objects.mjs` | 首帧物件特写库（出场档 ③ 专用）。名字不在库里 `drawObject()` 直接抛，体检也拦 |
| `dressing.mjs` | **场景摆件**：桌上按天数号随机摆一两件（笔/纸/杯/电脑/文件夹/手机）。**稿件的 `object` 永远不摆** —— 那是图解台词 |
| `plaque.mjs` | **标题牌匾**：木牌/贴纸/便签，或征用场景原有的屏。老马线走 `titleAbove()`，只挑字幕带以上的位 |
| `curtain.mjs` | 开场幕布，头 0.45 秒拉开。挂在 `render.ts` 的**两处**返回点 |
| `used-numbers.json` | 数字账本。由 `laoma:check --commit` 写 |
| `render.mjs` | 命令行入口 |

## 用法

```bash
node render.mjs --list      # 看有哪些场景
node render.mjs --demo      # 每个场景各出一张，用来挑图
node render.mjs --marks     # 漫符一览 → marks.svg
node render.mjs shots.json  # 按分镜表批量出图
```

## 尺度系统（改场景前必读）

画布 1080×1920，**地平线固定 GROUND=1500，参考人高 U=1120**。

场景里所有家具都用 `up(f)` 定位，`f` 是"距地多少个人高"。桌面 0.75 米 ÷ 1.75 米 ≈ 0.43，就写 `up(0.43)`。

这套换算是整个库的地基。马渲染出来正好 U 高，所以家具高度自动是对的——桌面到腰、沙发靠背到胯。

**画面顶部安全线是 `up(1.28)`**（约 y=66）。再高就出框了。

## 加新场景

在 `scenes.mjs` 里写个函数返回 SVG 字符串，然后登记到 `SCENES`：

```js
"my-scene": { fn: myScene, column: "工位", stand: "左侧", label: "说明" }
```

`stand` 声明画面哪块留给角色，`placeFor()` 会自动取。同一场景换 `seed` 就是笔触重洗的变体，避免同栏目连着几条画面一样。

## 接进视频管线

`render.mjs` 出的是 SVG。转 PNG 后：

```bash
ffmpeg -framerate 24 -i out/f%03d.png -c:v libx264 -pix_fmt yuv420p out.mp4
```

连续帧用 `sequence()`，背景只生成一次全帧复用——不然每帧笔触重洗会闪。
