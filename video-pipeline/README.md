# A / 伪B / C 三层素材管线 — 落地方案

一条命令把 `storyboard.json` 渲成成片。**不调任何 AI 视频服务，不花一分钱，完全离线。**

运行时依赖只有一个：`ffmpeg`。TypeScript 源码零 npm 运行时依赖（`package.json` 里只有 `typescript` 和 `@types/node` 两个 devDependency）。

---

## 1. 它做什么，不做什么

**做**：把静态图片、现成视频素材、以及代码渲染的动效，按分镜表拼成带转场、配音、烧录字幕的成片。

**不做**：AI 视频生成。这是刻意的取舍 —— 4 分钟解说片约 40–60 个镜头，全走 AI 图生视频一条片几百块、生成几小时，日更撑不住。这套管线的目标是把「需要 AI」的镜头压到接近零。

如果将来确实要接真 B 层（可灵 / 即梦 API），扩展点在第 7 节。

---

## 2. 快速开始

```bash
npm install
npm run build

node dist/build.js doctor                      # 环境检查
node dist/build.js render storyboard.json      # 出片 → out/final.mp4
```

常用选项：

```
--only s03,s07        只渲指定镜头（改一个镜头时用，秒级反馈）
--force               忽略缓存全部重渲
--preset veryfast     赶时间时用；默认 medium
--crf 22              画质，默认 18
-j 4                  并发镜头数，默认 CPU 核数的一半
-v                    打印完整 ffmpeg 命令行（调滤镜链时必开）
```

---

## 3. 三层各自的能力

### A 层 — 静图 + 运镜

占比目标 **60–70%**。源图建议 4K 起步（见第 4.1 节的原因）。

| motion | 效果 | 用在哪 |
|---|---|---|
| `zoomIn` / `zoomOut` | 缓推 / 缓拉 | 默认选择，最不容易出错 |
| `panLeft` / `panRight` / `panUp` / `panDown` | 横移 / 摇镜 | 宽幅场景、城市天际线、长卷图 |
| `breath` | 手持呼吸感（两个不同周期的正弦叠加，几乎察觉不到） | 需要画面「活着」但不能抢戏时 |
| `still` | 完全静止 | **画面里有文字或图表时必须用这个**，任何运镜都会让字抖 |

`intensity` 调幅度，默认 1.0。横移建议 1.2 左右，缓推 1.0 就够。

### 伪B 层 — 脚本制造动感

| pseudo | 做什么 | 需要什么 |
|---|---|---|
| `render` | 代码渲染动效（图表 / 数字滚动 / 时间轴 / 金句卡 / 序号卡） | 只要数据，**不需要任何素材** |
| `cinemagraph` | 静图 + 局部循环素材（云飘、水流、霓虹闪） | 底图 + 循环素材 +（可选）灰度蒙版 |
| `overlay` | 全画面叠加胶片颗粒 / 漏光 / 雨雪 | 底图；颗粒可程序化生成，不需要素材文件 |
| `compose` | 分层视差，伪 3D 纵深 | 分好层的透明 PNG（抠图这步 ffmpeg 干不了） |

**`render` 是这套管线里价值最高的部分。** 做金融、历史这类文案片，大量画面是数据、曲线、年份、引文 —— 这些交给 AI 是灾难（数字会乱、年份会写错、文字会糊），用代码渲染却是完美的：精确、可复用、改数据重跑一遍就行。

内置 15 种场景，都在 `src/layers/scenes.ts`：

```jsonc
{ "kind": "lineChart", "title": "…", "series": [12,18,15,…], "unit": "単位：兆円" }
{ "kind": "barChart",  "title": "…", "series": [...], "labels": ["1997","1998",…] }
{ "kind": "counter",   "title": "三年内破产企业", "from": 0, "to": 18704, "suffix": " 社" }
{ "kind": "timeline",  "title": "…", "events": [{ "year": "1997", "text": "山一证券破产" }] }
{ "kind": "quote",     "text": "…", "cite": "辜朝明《大衰退》" }
{ "kind": "steps",     "title": "…", "items": [{ "text": "转职当年的年收洼地" }, …] }
{ "kind": "japanMap",  "title": "地价跌幅", "cities": [{ "name": "東京", "value": "-68%" }] }
{ "kind": "subtitleStack", "lines": ["主句", "补充", "出处"] }
{ "kind": "maskTitle", "lines": ["制度在收紧", "但收紧不等于关门"] }
{ "kind": "glitchTitle", "text": "二十三天", "slices": 4, "amp": 14 }
{ "kind": "compareBars", "rows": [{ "label": "婚姻", "l": 3, "r": 5 }] }
{ "kind": "arrowAnnotate", "arrow": {…}, "label": "这一栋" }   // 全幅
{ "kind": "flash", "peak": 0.85 }                              // 全幅
{ "kind": "spotlight", "path": [{ "x": 0.35, "y": 0.5 }] }      // 全幅
{ "kind": "grain", "strength": 14, "leak": true }               // 全幅 + 滤镜
```

后 8 种是从 `../fx-kit` 移植的，对应关系与取舍见根目录 `FX-PORT.md`。

配色统一在 `scenes.ts` 顶部的 `THEME`，改一处全片一致。加新场景就是加一个返回 `FrameFn` 的函数 —— 签名是 `(t, index, total) => svgString`，写 SVG 字符串即可，不用碰 ffmpeg。

### C 层 — 现成素材

刻意做成**本地库优先**而不是每次调素材站 API：免费素材站的关键词匹配质量一般，人工挑一次好过每次碰运气；跑几十条片之后本地库就够用，之后完全离线，也不受限流和条款变更影响。

```
assets/library/
  index.json          ← { "city-night-01.mp4": ["城市","夜景","东京"] }
  city-night-01.mp4
```

分镜里写 `"tags": ["城市","夜景"]` 自动检索，或直接给 `source` 指定文件。

时长处理：素材比需要的长 → **从中段截取**（开头结尾常有淡入淡出和不稳定镜头）；比需要的短 → **循环**而不是变速。变速会让运动看起来不自然，循环在解说片里几乎察觉不到，因为观众注意力在文案上。

---

## 4. 关键技术决策与踩过的坑

### 4.1 运镜抖动：为什么必须超采样

`zoompan` 和 `crop` 的 x/y/zoom 都按**输入图的整数像素**取样。直接对 1920 宽的图做 6 秒缓推，每帧位移不到 1 像素，ffmpeg 会连续几帧停在同一位置然后突然跳一格 —— 肉眼看到的就是一格一格的抖动。这是自己写运镜脚本时最容易翻车的地方，而且在预览小窗里不明显，全屏一看全是问题。

解法：先把源图 scale 到 `输出尺寸 × SS`，1 个输入像素 = 1/SS 个输出像素，位移精度提高到亚像素。

倍率是**自适应**的（`pickSupersample`）：取 `源图宽 / 输出宽` 和 4 的较小值，下限 2。超过源图分辨率的放大是纯浪费 —— 插值不出新细节，只让每帧多做一次昂贵的 scale。实测 4K 源图 + 1080p 输出，自适应到 SS=2 后横移镜头从 64s 降到 21s，画质无差别。

**代价**：源图分辨率必须够。1080p 输出至少要 4K 源图，否则 scale 上去的是插值出来的糊像素，推近了发虚。管线会在源图小于输出宽 2 倍时打警告。

### 4.2 xfade 的静默数据丢失

最直觉的拼接写法是把所有镜头串成一条 xfade 链，硬切处用一个极短的 fade（比如 1/30 秒）代替。**这条路是坑**：

```
duration=0.5    → 输出 8.50s  ✓ 正确
duration=0.1    → 输出 8.90s  ✓ 正确
duration=0.0333 → 输出 5.07s  ✗ 前一段被整个丢掉
```

不报错，退出码 0，直到 ffprobe 成片才发现 43 秒的片子只剩 5 秒。

所以 `assemble.ts` 改成**分段策略**：按真转场把时间轴切段，段内全是硬切走 concat demuxer（`-c copy` 零重编码），只有段之间才用 xfade，且强制最短 0.1 秒。副作用是快得多 —— 4 分钟的片只有转场附近那几秒需要重编码。

**建议**：解说片大部分镜头用硬切，只在段落分界处加转场。一是重编码慢，二是转场用多了显得廉价。

### 4.3 代码渲染动效：SVG 是最省事的路

不用 node-canvas、不用无头浏览器、不用任何原生模块。逐帧生成 SVG 字符串写盘，ffmpeg 自己光栅化（编译时带 `--enable-librsvg`）。

好处：矢量渲染任意分辨率都锐利，改成 4K 输出不用动代码；中日文字用系统字体正常排版。

**兜底**：Windows 上常见的 ffmpeg 构建（BtbN）不带 librsvg。`doctor` 会检测，检测不到会自动尝试用可选依赖 `sharp` 走 SVG→PNG 降级路径。两条路都不通会给出明确处置建议，而不是抛一个看不懂的 ffmpeg 错误。

Windows 上建议直接用 gyan.dev 的 full 版，或者在 WSL 里跑整条管线。

### 4.4 缓存

`shotKey` 把「决定这个镜头长什么样的所有输入」哈希成 key：shot 对象本身 + 所有引用文件的 mtime/size + 输出规格。改一版文案只有受影响的镜头重渲，其余秒过。

用 mtime+size 而不是文件内容哈希 —— 4K 素材几十 MB，全量哈希比重渲染还慢。

### 4.5 Windows 路径转义

`subtitles` 滤镜的路径是最常见的坑：反斜杠要转正斜杠，**盘符的冒号必须转义**，否则 ffmpeg 会把 `C:` 当成滤镜参数分隔符，报一个完全看不懂的错。`assemble.ts` 的 `escapeForFilter` 已经处理。

---

## 5. 怎么接进现有的 `article-to-video` 流程

你现在的流程是：解说词主稿 → 提炼画面文案从稿 → storyboard.json（start 由对齐回填）→ 竖版单独写。

这套管线接在 **storyboard.json 之后**，只多几个字段：

```jsonc
{
  "id": "s12",
  "start": 68.4,        // 由音频对齐回填，本管线只读不写
  "duration": 5.2,
  "tier": "A",          // ← 新增
  "source": "assets/images/s12.png",
  "motion": "zoomIn",   // ← 新增
  "intensity": 1.0
}
```

`start` 字段管线不使用 —— 因为音频主导、画面跟随，成片时间轴由各镜头 `duration` 顺序累加决定。`start` 留着给对齐脚本和调试用。

管线会在合成后校验：画面总长和音轨时长差超过 0.5 秒就告警，提示回头调 `duration`。

**竖版**：同一套代码，`storyboard-vertical.json` 里把 `width/height` 改成 1080×1920 即可。`render` 分支的 SVG 场景是按 W/H 比例布局的，自动适配。A 层的 `crop` 会自动裁中，横图转竖版建议改用 `panUp`/`panDown` 或者单独准备竖构图的源图。

---

## 6. 性能参考

容器实测（**单核**，1080p30，preset=veryfast）：

| 镜头类型 | 4–5 秒镜头耗时 |
|---|---|
| A / zoomIn（SS=2） | 4 s |
| A / panLeft（SS=2） | 22 s |
| A / breath | 19 s |
| B / render（SVG 图表） | 3 s |
| B / overlay（程序化颗粒，geq 逐像素） | 21 s |
| C / 素材裁切 | 6 s |
| 合成（10 镜 + 1 转场） | 约 3 s |

多核机器上并发跑（`-j 4`）会快得多。一条 4 分钟的片，首次全量渲染大致在十几分钟量级；之后改文案重跑只渲变动的镜头，通常一两分钟内。

`overlay` 的 `geq` 是逐像素跑的，最慢。如果颗粒镜头多，建议预先生成一段 10 秒的颗粒素材文件，改用 `overlayFile` 引用，速度会快一个数量级。

---

## 6.5 叠加到已有视频

不重走整条管线，只在已剪好的片子上按时间点浮出动效：

```bash
node dist/build.js overlay-onto <底片.mp4> --spec overlays.json --out final.mp4
```

底片只重编码一次（不管叠几个），音轨 `-c:a copy` 原样搬运。
动效渲成带 alpha 的 `.mov` 后用 `overlay` 滤镜合成，淡入淡出作用在 alpha 上。

规格文件字段见 `CLAUDE.md`。几个容易搞错的点：

- **`scale` 是「占底片宽度的比例」**，不是面积也不是高度。竖版用 0.85~0.92
- **`y` 默认靠上 8%** —— 屏幕下 1/3 通常被三级字幕占满
- 面板宽高比按场景类型自动定（地图接近正方、时间轴很扁），
  想覆盖就显式写 `width`/`height`
- 底片亮度不可控，衬底默认开启且文字带深色描边。关掉衬底（`"scrim": false`）
  只在确定底片够暗时用

alpha 编码用的是 **PNG-in-MOV**。一开始试 `qtrle`，1080p RGBA 的 RLE
慢到直接超时不可用。

### 三个值得单说的场景

- `japanMap` —— 城市依次亮起，标签自动防重叠（挨得近的会下推并画引线）。
  本州轮廓用「中心线 + 半宽」程序化生成缎带；手写双边多边形试过两版都自交，形状会崩
- `quote` 的 `typewriter` + `emphasize` —— 逐字打出，打完后指定关键词渐变到强调色并放大。
  关键词必须显式给出，**自动识别猜错关键词比不强调更糟**
- `steps` —— 序号卡：几条并排，逐条从下往上浮。三个定死的取舍：槽位按条数**预分固定**
  （已入场的条目一个像素都不动，否则观众正在读的字会被抽走）、**不退场**（整卡由 fadeOut 收，
  清单的意义就是最后一秒能一眼看全）、未入场的条目**完全不画**（灰色占位等于剧透）。
  序号只是徽标内容，`ordStyle` 一换就是要点卡或核对清单

### 数据校验是硬拦截

`validateScene.ts` 在渲染前检查，不通过直接失败不出片：
`series` 为空、labels 与 series 数量不符、柱子超 8 根、时间轴超 6 节点、
并排数字超 3 个、`emphasize` 的词不在 `text` 中。

最后一条尤其值得：关键词写错字不会报错，只会静默不高亮 —— 那就等于白写。

## 7. 将来要接真 B 层的话

扩展点很干净：在 `src/layers/` 加一个 `layerBAi.ts`，实现同样的签名

```ts
(shot, sb, projectRoot, buildDir, outFile, crf, preset) => Promise<void>
```

然后在 `build.ts` 的 `renderShot` 里按 `shot.pseudo === 'ai'` 分流。缓存机制自动生效 —— 这点对付费 API 特别重要，改一版文案不会把没变的镜头重新买一遍。

需要注意的：AI 服务只出固定档位时长（5s / 10s），你的镜头是 5.2s，adapter 里要做补齐；生成的文件通常有保留期（可灵是 30 天），必须立刻转存本地，别直接引 URL。

---

## 8. 目录结构

```
video-pipeline/
├── src/
│   ├── types.ts              storyboard 数据契约
│   ├── build.ts              CLI 入口、并发池、缓存调度
│   ├── assemble.ts           分段拼接、转场、音轨、字幕烧录
│   ├── util/
│   │   ├── ffmpeg.ts         进程封装、探测、错误处理
│   │   └── cache.ts          内容哈希缓存
│   └── layers/
│       ├── layerA.ts         运镜滤镜链（含自适应超采样）
│       ├── layerB.ts         伪B 四条分支的路由
│       ├── layerC.ts         素材库检索 + 时长适配
│       ├── svgRender.ts      SVG 帧序列 → mp4（含 sharp 降级）
│       └── scenes.ts         内置动效场景，扩展新场景改这里
├── assets/
│   ├── images/               A 层源图（建议 4K）
│   └── library/              C 层素材库 + index.json
├── build/                    中间产物与缓存，可随时删
└── out/final.mp4
```

---

## 9. 建议的上手顺序

1. `npm run build && node dist/build.js doctor` 确认 ffmpeg 和 SVG 解码都正常
2. `node dist/build.js render storyboard.example.json` 跑通示例，看看各层长什么样
3. 拿一篇真文案，先**全部标成 A 层 + `still`**，跑出一条完整片子 —— 这是基线
4. 逐个镜头加运镜，数据类镜头改成 `render`
5. 到这一步再回头看，哪些镜头是真的非 AI 不可。大概率比你现在以为的少得多

文案解说类内容的天花板在文案和节奏上，不在画面精度上。
