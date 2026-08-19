# fx-kit → video-pipeline 移植记录

`../fx-kit` 是一套 DOM/CSS/SVG + 无头 Chromium 逐帧截图的特效库。
本项目的动效管线是 **SVG 帧序列 + ffmpeg**，`video-pipeline/CLAUDE.md` 明令禁用
puppeteer / headless browser / 任何绘图库。

所以这次不是搬文件，是**移植规格**：参数名、默认时长、缓动、配色、以及 fx-kit
踩过的坑，全部照搬；实现全部重写成返回 SVG 字符串的 `FrameFn`。

移植日期 2026-08-17。本次落地 13 个（用户点名的那批）。

---

## 一、13 个特效落到哪儿了

| fx-kit | 中文名 | 在本管线里的形态 | 怎么用 |
|---|---|---|---|
| 02 `crossfade` | 交叉溶解 | 转场预设 | `"transition": "crossfade"` |
| 03 `whipPan` | 横扫切换 | 转场预设 | `"transition": "whip"` / `"whipRight"` |
| 04 `flashCut` | 闪白打点 | **全幅**场景 + 转场预设 | `{"kind":"flash","peak":0.85}`，duration 给 0.18 |
| 06 `typewriter` | 逐字打出 | 已有 `quote`，补了 `cps` | `{"kind":"quote","typewriter":true,"cps":10}` |
| 07 `keywordPop` | 关键词变红 | 已有 `quote.emphasize`，改成逐个变红 | `"emphasize":["路还在"]` |
| 08 `subtitleStack` | 三级字幕 | 新场景 | `{"kind":"subtitleStack","lines":[主句,补充,出处]}` |
| 09 `maskReveal` | 遮罩上滑 | 新场景 `maskTitle` | `{"kind":"maskTitle","lines":[...]}` |
| 10 `glitchTitle` | 故障标题 | 新场景 | `{"kind":"glitchTitle","text":"二十三天","slices":4,"amp":14}` |
| 15 `mapPing` | 地图亮点 | 重写了已有的 `japanMap` | `cities` + `highlight` |
| 16 `compareBars` | 左右对照 | 新场景 | `{"kind":"compareBars","rows":[{"label":"婚姻","l":3,"r":5}]}` |
| 17 `spotlight` | 聚光引导 | **全幅**场景 | `{"kind":"spotlight","path":[{x,y},…],"radius":0.15}` |
| 19 `grain` | 颗粒漏光 | **全幅 + ffmpeg 滤镜** | `{"kind":"grain","strength":14,"leak":true}` |
| 20 `arrowAnnotate` | 箭头注记 | **全幅**场景 | `{"kind":"arrowAnnotate","circle":{…},"arrow":{…},"label":"这一栋"}` |

「全幅」= `overlay.ts` 的 `FULL_FRAME`：画布按底片尺寸铺满、不画衬底，
`scale` / `x` / `y` 对它们无效。**它们的坐标是相对整幅画面的 0–1 归一值** ——
箭头要指的是底片里的东西，塞进面板就没有意义了。

## 二、剩下 7 个：本管线里早就有对应物

没做重复实现，写在这里是免得下次又去搬一遍。

| fx-kit | 本管线里的对应 |
|---|---|
| 01 `kenburns` 缓推运镜 | A 层 `motion: "zoomIn"` 等 8 种运镜预设（`layerA.ts`，带自适应超采样） |
| 05 `parallax` 视差分层 | 伪 B 层 `pseudo: "compose"` + `layers[]` |
| 11 `barGrow` 柱状图 | `{"kind":"barChart"}`，逐根延迟入场 |
| 12 `lineDraw` 折线描绘 | `{"kind":"lineChart"}`，曲线生长 |
| 13 `numberRoll` 数字滚动 | `{"kind":"counter"}`，单个或并排 |
| 14 `timelineWalk` 时间轴 | `{"kind":"timeline"}`，节点上下交错入场 |
| 18 `zoomPunch` 节奏推近 | **没有**。要做的话是 A 层的事（`zoompan`），不是叠加层 |

## 三、移植时被迫改掉的四处

照搬不动的地方都在这儿，改法和理由：

1. **`whipPan` 没有动态模糊。**
   fx-kit 靠 CSS `filter: blur(16px)` 在横扫中段糊一下。ffmpeg 的 xfade 没有这个能力。
   补偿办法是缩短时长（380ms 的 `slideleft`）—— 快到一定程度，观感上就是一次硬转折。

2. **`grain` 的颗粒不走 SVG 帧，改用 ffmpeg 的 `noise` 滤镜。**
   颗粒要整片常驻，而 4 分钟 1080p 的 RGBA PNG 序列有几个 GB，渲染时间也不可接受。
   `noise=alls=N:allf=t+u:all_seed=S` 是内置滤镜，一次编码顺手带上；
   `all_seed` 同样保证重渲一致（fx-kit 那边的规矩是「不要改成 `Math.random()`」，这里等价）。
   **漏光**仍是 SVG 层，脉冲用 overlay 的 `fadeIn`/`fadeOut` 各取一半时长做成三角包络。
   代价：噪点几乎不可压缩，14 秒的颗粒让 80 秒的 demo 从 4MB 涨到 11MB 左右，
   铺满 52 秒会直接到 36MB。要整片常驻就得接受体积翻几倍。

3. **`typewriter` 的排版不用「先量后建」那一套。**
   fx-kit 要先排一遍版读出每个字的最终位置，再重建成「每行一个 div」，
   是为了绕开浏览器的重排和 `text-wrap: balance`。SVG 这边没有流式排版 ——
   `wrapCJK()` 一次算好行，逐字 `<tspan>` 显现，从第 0 帧起位置就是终点，天然没有重排问题。

4. **`mapPing` 的都道府県轮廓直接搬了数据。**
   `japan-geo.ts` 是 fx-kit `japan-map.js` 的 TS 版（只加类型，路径数据一字未改），
   上游是 dataofjapan/land 的 GeoJSON 经墨卡托投影 + RDP 精简。
   原来这里是「中心线 + 半宽」程序化生成的示意缎带 —— 示意图上点亮一块，
   观众认不出那是哪儿，「某某县亮了」这个信息就没送到。
   要调精度回 fx-kit 那边改 `build-japan.js` 的 `eps`/`minArea` 重新生成再搬一次，
   **不要手改 `japan-geo.ts`**。

## 三之二、故障标题返工记录（2026-08-17，出片后比对参照发现）

第一版四处不像，都是「看着差不多、放到片子里一眼就不对」的那类：

1. **副本画在正文上面** → 切片带里的白字被整块染成红青。
   fx-kit 靠 `mix-blend-mode: screen`：白字压在彩色副本上仍是白的，只有错开的那一截露色。
   SVG 这边不依赖混合模式，**把两个副本画在正文下面**就等价了。
2. **两个副本共用一组切片带** → 红青齐步走，像整块在抖。
   fx-kit 是 `frames(1)` / `frames(-1)` 调两次，rand 序列各走各的，这边照做。
3. **抖动铺满整个镜头时长** → 3.2 秒的镜头里 4 个切片状态每个停 0.8 秒，成了一帧帧的错位图。
   改成**绝对 1 秒**（`dur` 参数，默认 1.0），之后标题干净地立着。
4. **左对齐 + 字号按内容区宽度除以字数** → 只占了四分之一幅宽。
   参照是 `textAlign: center` + `top: 40%` + `clamp(30px, 6vw, 84px)`，相对画布约半幅宽。
   改成**居中 + 字号按「整串占内容区 62% 宽」反推**（高度和 200px 封顶）。
   连带 `amp` 也改成**相对 84px 基准字号等比放大** —— 14px 的错位配 200px 的字看不见。

### 第二轮：红色那一路根本没出现

改完居中和字号之后，红色仍然基本看不见。把 seed=7 实际生成的 8 组切片值算出来才看清 ——
红色四个状态里死了两个：一个 `dx=0.6px`（等于没错位），一个切片带整条落在字形下方。
三个原因，各修各的：

1. **切片带的坐标系搬错了。** fx-kit 的 `inset(top% 0 bottom% 0)` 是相对**行盒**的，
   行盒里字形占了大半；我照抄成「基线 −0.9 起、跨 1.4 倍字号」，`top` 偏大的带就整条
   掉到基线以下 —— 中日文那里没有笔画，那一格是空的。改成在**字形高度**内取带。
2. **错位量会取到 0 附近。** 公式 `rand()*amp − amp*0.2` 的下界是 −0.2amp，
   取到 0 附近那一格就等于没错位。保留原分布，给绝对值加了个下限（字号的 5%）。
3. **两路撞在一起时后画的把前一路整格盖掉。** fx-kit 的 `.g-copy` 有
   `mix-blend-mode: screen`，两路重叠是叠加；我这边是不透明覆盖。
   实测 librsvg/sharp **认 `mix-blend-mode`**，加上就对了。
   另外把两路的方向定死（红往右、青往左）—— 原公式在 `rand() < 0.2` 时会变号，
   那一格两路朝同一边错开，窄的被宽的整格套住。RGB 分离本来就该左右分开。

验证方式：抽 4 个切片状态各一帧，数红/青像素。修之前红是 `0 / 82 / 68 / 62`，
修之后是 `32 / 81 / 68 / 62` —— 四格全部有红。

> **返工时踩到的**：改完 `scenes.ts` 重渲 demo，画面没变 ——
> `build/shots` 的缓存键只认 storyboard 内容和素材文件，**不包含渲染代码**。
> 改代码后重渲一律加 `--force`，否则会静默拿到旧画面。已写进 CLAUDE.md 的坑列表。

### 第三轮：配色不跟 THEME

本管线的规矩是「所有视觉参数统一在 `THEME`」，但 `glitchTitle` 定为**唯一的例外**：
RGB 错位的观感绑在「正红 + 蓝绿」这一对上，换成本项目的橙红 `#e0603a` + 蓝 `#4a9eba`，
两路色相差不够大，看着像重影不像信号坏了。

所以这个场景用 `scenes.ts` 里的 `GLITCH` 常量，四个色全部是 fx-kit 原值：

| | 值 | fx-kit 变量 |
|---|---|---|
| 正文 | `#F5F3EE` | `--fx-paper` |
| 红副本 | `#E5484D` | `--fx-accent` |
| 青副本 | `#4FB8A8` | `--fx-data` |
| 副标题 | `#8A94A2` | `--fx-dim` |

已写进 `CLAUDE.md` 的禁止事项里当例外条款，免得下次被「统一配色」顺手改回去。
成片里量到的是 `#e5545c` / `#56bcaf` —— 源色准确，偏移来自 h264 的 yuv420p
色度二次采样（彩色只有紧贴白字的一两像素宽，最容易被色度平均带偏），属正常。

### 第四轮：不是代码的问题，是选词

反馈「看上去是零散的颜色点缀，不是彩色文字阴影错位」。做了三组对照渲染：

| 文字 | amp | 结果 |
|---|---|---|
| 二十三天 | 14 | 笔画两端的小方块 |
| 二十三天 | 60 | **更大的方块** —— 加位移完全没用 |
| 第三章 · 失控（参照 demo 的原词） | 14 | **就是参照那个彩色鬼影** |
| 失控的二十三天 | 14 | 同上，读得出鬼影 |

原因是字形：RGB 错位是**横向**的，横笔画横着错开，重叠部分仍是白的，
只有两端露出宽度=位移量的小块 —— 「二十三天」四个字几乎全是横笔画，是这个效果的最坏情况。
带竖笔、撇捺的字错开之后，整条笔画都露在外面，才读成「彩色鬼影」。

所以算法没再动，把 demo 的标题从「二十三天」换成「失控的二十三天」，
并把选词规则写进了 `CLAUDE.md` 的场景说明 —— 这条是出片时真会踩的。

## 四、原样保留的规矩

这些是 fx-kit 用实拍验证过的数值/约束，移植时一个没动：

- 关键词放大到 **1.16 倍**、颗粒不透明度、闪白峰值 0.85 与 18% 的峰值位置
- 故障标题 `slices` 3–4、`amp` 不低于 10（低于 6 单帧看不出错位，校验会拦）
- 闪白 **不超过 250ms**，超过就廉价
- 地图：**城市红点与所属都道府県同刻亮**，分开出现观众看不出是一回事
- 箭头注记 **不做画面识别**，坐标必须由人写进 spec
- 所有随机走 `rng(seed)`，重渲结果完全一致

## 五、密度

fx-kit 的 `registry.json` 里有一套 `constraints`（每分钟 heavy ≤4、同 id 间隔 ≥8s…），
本管线已有自己的一套（`overlay.ts` 的 `warnIfCrowded`：4 分钟 4–6 个、同类 ≤2、相邻 ≥25s）。
两套没有合并 —— 本管线的更严，因为这边是**叠在真素材上**，不是整屏切换。

全幅类另算：颗粒可以常驻；闪白全片 2–3 次封顶；故障标题 1–2 次；
聚光和箭头只在解说明确指着画面某处时用。

## 六、验证

`storyboard.fx.json` 是这批特效的验证片（也是 `demo.mp4` 的第三段），
`overlays.demo-fx.json` 是四个全幅效果的叠加规格。两份都能重跑：

```bash
cd video-pipeline
node dist/build.js render storyboard.fx.json --out out/fx.mp4          # 场景类 + 三种转场
node dist/build.js overlay-onto <底片> --spec overlays.demo-fx.json --crf 23 --out final.mp4
```

校验分支在 `validateScene.ts`，13 条负例实测都拦住了（行数超限、坐标写成像素、
`compareBars` 缺数、`glitchTitle` 幅度过小等）。
