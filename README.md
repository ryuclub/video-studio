# vidgen

> ⚠ **这个文件只讲六条线里的一条**（空镜解说风）。
> 仓库全貌和「改了什么要重跑哪一步」看 **[RUNBOOK.md](RUNBOOK.md)**。
>
> | 内容线 | 目录 | 手册 |
> |---|---|---|
> | 资讯解说（空镜 / PPT 演示） | `src/` | 本文件 |
> | 段子（对话反转） | `joke-video/` | [joke-video/README.md](joke-video/README.md) |
> | 儿童故事（旁白叙述） | `joke-video/` | [儿童故事出片方案.md](joke-video/儿童故事出片方案.md) |
> | 说书（聊斋） | `shuoshu/` | [shuoshu/出片手册.md](shuoshu/出片手册.md) |
> | 治愈系旁白（助眠档） | `zhiyu/` | [zhiyu/治愈系出片方案.md](zhiyu/治愈系出片方案.md) |
> | 心理洞察（现象型） | `zhiyu/` | 管线同上，差异见 [心理洞察出片方案.md](zhiyu/心理洞察出片方案.md) |
> | 禅佛典（小故事大道理） | `zhiyu/` | 管线同上（`--line 禅佛典`），规范见 [小故事大道理](zhiyu/禅佛典向_小故事大道理_书目与稿件.md) |
>
> 写稿那一层还有一份跨线的 [说破层规范.md](说破层规范.md)（一期稿子的落点怎么定），
> 说书／心理洞察／禅佛典适用，治愈系旁白线反着来。
>
> 后五条线的画面**全部用代码画（SVG）**，不依赖 AI 出图。

**首次克隆后**：`npm i`；`cp .env.example .env` 填 key；字体和成片不在库里，
完整的环境要求见下一节。

---

## 运行环境

装完先跑 **`npm run doctor`**，它会实测这台机器能不能出片（ffmpeg 滤镜、每条线的字体、
.env）。**别只照着这份表核对** —— 字体这类东西看配置读不出真相，代码里首选的族名
在开发机上其实一个都没匹配上。

### 1. Node ≥ 20

```bash
npm i          # 根目录一次装完（joke-video / voice-clone 是 workspace）
```

### 2. ffmpeg（两个可选滤镜是硬要求）

```bash
# macOS
brew install ffmpeg
# Windows：用 gyan.dev 的 full build，https://www.gyan.dev/ffmpeg/builds/
```

装完必须确认这两个滤镜在：

| 滤镜 | 少了会怎样 |
|---|---|
| **`rubberband`** | 变声退化成单级重采样，**formant 被忽略** —— 女童（1.14/1.16）、精灵（1.5/1.38）、童声（1.18/1.14）、反派（0.84/0.9）这些靠 formant 立起来的音色会变成**另一个人**。这是编译期可选滤镜，很多发行版没带 |
| `aexciter` | 「沙哑老头」这一档会报错 |

```bash
ffmpeg -hide_banner -filters | grep -E "rubberband|aexciter"
```

`rubberband` 缺失时 preflight 会拦住出片；`aexciter` 只在用到那一档时才会炸。

### 3. 字体

**四条线用的不是同一套字体**，前三条是 fallback 链——链上哪个存在就用哪个，
这是**设计好的行为**（`joke-video/src/config.ts` 的注释就写着「Windows 建议：
Microsoft YaHei」）。代价是**换机器画面会变，而且不报错**。

| 用在哪 | 字体 | 环境变量 |
|---|---|---|
| 段子 / 儿童故事<br>字幕 · 封面 · 片头卡 | fallback 链：`Noto Sans CJK SC` → `Noto Sans CJK JP` → `Source Han Sans SC` → `Microsoft YaHei` → `Yu Gothic UI` → `PingFang SC` | `JOKE_FONT` |
| 说书 · 水墨题字 | fallback 链：`Noto Serif SC` → `Source Han Serif SC` → `SimSun` → `STSong` → `Songti SC` → `Microsoft YaHei` | `SHUOSHU_FONT` |
| 解说 · ass 字幕 | 单个族名，没有 fallback。**`.env` 里已经指定 `VG_FONT=Microsoft YaHei`** | `VG_FONT` |
| 说书 · 封面 | **不走系统字体**：直接加载仓库 `fonts/` 下的 7 个静态字重 OTF（`loadSystemFonts: false` + `fontFiles`），族名 `Noto Serif CJK SC` 就是这批文件自身的 typographic family | `SHUOSHU_COVER_FONT` |

**开发机（Windows）实测落到哪**（`npm run doctor` 会替你测这台）：

```
✓ 段子 / 儿童故事：Microsoft YaHei（链上第 4 个）
✓ 说书 水墨题字：Noto Serif SC（链上第 1 个）
✓ 解说 ass 字幕：Microsoft YaHei（.env 已指定）
✓ 说书 封面字重：fonts/ 下 7 个静态 OTF 齐全
```

**macOS 上会落到哪**——`Noto Sans CJK SC` / `Noto Sans CJK JP` / `Source Han Sans SC` /
`Microsoft YaHei` / `Yu Gothic UI` / `SimSun` 这些 macOS 默认都没有，
段子线大概率落到 `PingFang SC`、说书题字落到 `Songti SC`。
**这一条没有在 Mac 上实测过**，到了机器上跑一次 `npm run doctor` 就知道。

字幕纸片的尺寸是按字数估的（中文按字号全宽），跟真实字体无关，
所以**纸片大小不变、字的实际占宽会变**，可能溢出或两边留白不匀。

**想让两台机器出一模一样的画面**，两条路：

1. **用环境变量锁死**：`JOKE_FONT` / `SHUOSHU_FONT` / `VG_FONT` 都指向同一个
   两台机器都装了的族名。选哪个字体是美术决定，不是技术决定——
   现在 Windows 上出的片子用的是微软雅黑，Mac 上没有它，要保持一致就得
   两边都装同一个第三方字体（比如 Google Fonts 的
   [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)）并锁过去，
   **代价是已出的片子字形会变，要重渲**
2. **接受两边不同**：只在一台机器上出片，另一台只写稿和审片

说书**封面**那条不受影响，它本来就不看系统字体。但 `fonts/`（162M）**不在版本库里**，
Mac 上克隆后要自己补：从 <https://github.com/notofonts/noto-cjk/releases> 下
Noto Serif CJK 的 OTF 包，把这七个文件放到
`fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/`：

```
NotoSerifCJKsc-{Black,Bold,SemiBold,Medium,Regular,Light,ExtraLight}.otf
```

缺了不崩，会退回系统衬线字体，但字重会塌——resvg 对可变字体的 weight 轴支持有限，
只有 `NotoSerifSC-VF.ttf` 时 `font-weight="900"` 渲出来其实是 Regular。

### 4. .env

```bash
cp .env.example .env
```

| 键 | 谁要用 | 不填会怎样 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 解说线的 `npm run vg -- script` 自动写稿 | 该命令跑不了，稿件得手写 |
| `PEXELS_API_KEY` | 解说线的 `footage` 步骤下载空镜 | 该步骤失败 |

**段子 / 儿童故事 / 说书三条线一个 key 都不需要** —— 画面是代码画的，
配音走 Edge TTS（免费、不要 key）。

### 5. 不在版本库里、要自己生成的

| 东西 | 体积 | 怎么来 |
|---|---|---|
| 成片、音轨、配音分句 | 16G | 按各条线手册重跑 |
| Pexels 素材缓存 | 2.8G | 解说线的 `footage` 步骤自动下 |
| 字体 | 162M | 见上 |
| 逐镜静帧 / 场景图 | 101M | `npm run preview` / `npm run scene` |



文案驱动的解说视频自动化管线。输入一个选题或一个网址，输出横版 + 竖版成片。

```
选题/网址 ──[Claude API]──> script.json ──┬──[Edge TTS]──> voice.mp3 + timeline.json
                                          ├──[时间轴]────> subtitle_*.ass
                                          ├──[Pexels]───> shots.json
                                          └──[ffmpeg]───> landscape.mp4 / portrait.mp4
```

出片流程、每步要看什么、以及踩过的坑，见 **[RUNBOOK.md](RUNBOOK.md)**。

**script.json 是唯一需要人工干预的产物**，后面每一步都是确定性的。稿子不满意就改 JSON 重跑，不用重新走一遍全流程。

---

## 一、安装

完整环境（ffmpeg 滤镜、字体、.env）见上面的[运行环境](#运行环境)，装完先跑 `npm run doctor`。

```bash
npm install
cp .env.example .env      # 填入 API key
```

本仓库用 npm workspaces，根目录这一条会把 `joke-video`（情景对话段子）和
`voice-clone`（音色实验室）的依赖一起装好，子目录里不需要也不要再单独 `npm install`。

**ffmpeg（Windows）**：去 https://www.gyan.dev/ffmpeg/builds/ 下载 release full build，
解压后把 `bin` 目录加进 PATH。命令行里 `ffmpeg -version` 有输出就算装好。
必须是 full build —— essentials 版没有编译 `libass`，烧字幕会直接报错。

**字体**：需要系统装有中日文黑体。Linux 装 `fonts-noto-cjk`；
Windows 一般自带「微软雅黑」，把 `.env` 里的 `VG_FONT` 改成 `Microsoft YaHei` 即可。
字体名写错的表现是字幕全变成方框或干脆不显示。

**API key**：
- `ANTHROPIC_API_KEY` — https://console.anthropic.com/
- `PEXELS_API_KEY` — https://www.pexels.com/api/ ，免费，注册即得

---

## 二、用法

```bash
# 从选题写稿
npm run vg -- script --topic "1997年11月，日本银行业的黑色一周"

# 从指定网址改写（公司网站文章、新闻页都行）
npm run vg -- script --url https://example.com/article

# 加额外要求
npm run vg -- script --topic "..." --note "侧重制度层面，控制在两分钟"

# 稿子看过、改过之后，一路做到成片
npm run vg -- all 2026-08-15_1997年11月日本银行业的黑色一周

# 一条命令从选题直接到成片（不看稿）
npm run vg -- auto --topic "..."
```

单步执行（调参时用）：

```bash
npm run vg -- tts      <项目名>
npm run vg -- footage  <项目名>
npm run vg -- render   <项目名> --profile portrait
```

项目目录：`projects/记者读稿/<日期_标题>/`

| 文件 | 说明 |
|---|---|
| `script.json` | 稿件，可手改 |
| `voice/` | 逐行配音片段 |
| `voice.mp3` | 拼接后的整条人声 |
| `voice_mix.m4a` | 混音后的成片音轨（横竖版共用，只在 `voice.mp3` 更新后重建） |
| `timeline.json` | 行级时间轴（毫秒） |
| `subtitle_*.ass` | 字幕，可用 Aegisub 打开微调 |
| `shots.json` | 镜头与素材对应关系 |
| `landscape.mp4` / `portrait.mp4` | 成片 |

冒烟测试（不联网、不烧 API 费用，验证改动没搞坏管线）：

```bash
npx tsx src/smoke.ts
```

产物在 `.smoke/`，**不在 `projects/记者读稿/`** —— 它的音频是正弦测试音、画面是合成色块，
只用来验证时间轴、字幕和滤镜图。听到"滴滴嘟嘟"是正常的，那不是配音坏了。
真人声要走上面的正常流程。

---

## 三、script.json 结构

```json
{
  "title": "标题",
  "lines": [
    { "text": "1997年\\n11月17日 | 清晨", "style": "chip",
      "speech": "", "pauseAfterMs": 2400, "clip": "tokyo street dawn" },
    { "text": "门外已经排起了看不到头的长队", "style": "sub",
      "clip": "crowd waiting outside" },
    { "text": "银行",         "style": "emph",    "stack": 1 },
    { "text": "没有失去所有客户", "style": "emph",    "stack": 1 },
    { "text": "但失去的",     "style": "emph",    "stack": 1, "pauseAfterMs": 700 },
    { "text": "是最好的客户", "style": "emphKey", "stack": 1 }
  ]
}
```

开场自动生成一张**标题卡**，不用写进 `lines` —— 见下面「三之二」。

四种 `style`：

| style | 位置 | 样式 | 用途 |
|---|---|---|---|
| `chip` | 左侧中部 | 白字 + 红竖线分隔 | 时空角标，不配音，全片 ≤4 个 |
| `sub` | 底部单行 | 白字黑描边 | 常规解说，占八成 |
| `emph` | 画面中央 | 白字，参与堆叠 | 强调段常规行 |
| `emphKey` | 画面中央 | 红字黄描边，字号更大 | 强调段落点，一组只能有一个，且必须在最后 |

### 三之二、开场标题卡

第一帧不是留给时空角标的，是留给「这条片子讲什么」。所以 `buildAss()` 会自动
从 `title` 拆出关键词，做成盖在第一个镜头上的大字卡，停 2.6 秒，然后角标顺延接上。

- **内容**：按标题里的逗号顿号分行（「访日客五年首降，经营管理签证还稳吗」→ 两行），
  最多 3 行，末行是落点、给重色。标题本来就是按语义断好的，不需要分词
- **字号**：由最长那一行定 —— 先按基准放大，放不下就压到刚好进画。
  横版约 120px、竖版约 106px
- **压暗**：整帧盖一层 55% 的黑。不压的话白字撞上明亮的空镜（机场、雪地）就糊了，
  描边再粗也救不回来 —— 这是标题卡跟正文字幕最大的区别
- **版式**：四套（居中堆叠红底 / 左侧红竖线 / 上下分置红横线 / 底部红下划线），
  由**标题的哈希**决定用哪套。用哈希不用随机数，是为了保住管线的确定性：
  同一份 script.json 重跑必须逐帧一致，横竖两版也必须是同一个版式。
  不同选题自然会换版式，不用管

自动挑的那套不满意，在 script.json 顶层加 `"hookLayout": 0`（0–3）手动指定，
重跑 `render` 即可 —— 不用改标题。

**堆叠机制**是这套风格的核心：连续多行共用同一个 `stack` 编号，
逐行淡入、不清屏、往下累加，整组在最后一行说完后一起消失。
把停顿视觉化，观众眼睛被一行行往下拖，情绪攒到最后一句才释放。

拆句规律：每行 4–9 字；转折词单独成行（「但失去的」本身没信息量，纯粹制造顿挫）。
`emphKey` 全片每组只给一个，给多了就没有落点。

其它字段：`speech` 覆盖送去配音的文本（空字符串 = 不配音）；
`clip` 是英文素材检索词，不填则沿用上一个镜头；`pauseAfterMs` 是该句后的停顿。

---

## 四、调参

改 `.env`：

| 变量 | 说明 |
|---|---|
| `VG_MODEL` | 写稿模型。`claude-sonnet-5` 够用，追求文字质量换 `claude-opus-5` |
| `VG_VOICE` | 音色。`zh-CN-YunjianNeural` 沉稳叙事，`zh-CN-YunxiNeural` 年轻些，`zh-CN-XiaoxiaoNeural` 女声 |
| `VG_RATE` | 语速。`-4%` 略慢，纪实感更强 |
| `VG_CRF` | 成片画质。越大文件越小，18–28 合理。默认 `23`，对空镜+字幕肉眼几乎无损；要更小换 `26`（省一半） |
| `VG_PRESET` | x264 预设。默认 `medium`；`slow` 只省 3% 体积却翻倍耗时，不建议 |
| `VG_AUDIO_BITRATE` | 成片音频码率，默认 `128k`。人声是单声道升的立体声，再高是浪费 |

改代码：

- **标题卡** → `src/lib/ass.ts` 的 `HOOK_MS`（停留时长）、`HOOK_LAYOUTS`（四套版式）、
  `titleKeywords()`（关键词怎么拆）
- **字号 / 颜色 / 行距** → `src/lib/ass.ts` 顶部的 `BASE`、`LINE_GAP` 和颜色常量
  （ASS 的颜色是 `&HAABBGGRR`，**BGR 不是 RGB**，红色写 `&H000000FF`）
- **写稿风格** → `src/steps/script.ts` 的 `SYSTEM` 常量，这是最值得反复打磨的地方
- **调色** → 换掉 `assets/cold.cube`，或删掉这个文件关闭调色
- **运镜幅度** → `src/steps/render.ts` 的 `zoompan` 参数

**BGM**：把音乐文件放到 `assets/bgm.mp3` 就会自动混入，
并用 `sidechaincompress` 做闪避（人声一出来自动压低 BGM）。不放就是纯人声。

**读音纠正**：`assets/lexicon.json`。TTS 读中文时日语人名、机构名、缩写经常出错，
在这里做替换，只影响发音不影响屏幕上的字。这个文件是要长期养的。

---

## 五、素材策略

三档，混用：

- **A 免版权库**（已实现）：Pexels 检索，空镜、人群、城市，占七成，零风险
- **B AI 生成**：只用在 `stack` 那几个情绪落点。生成后放进
  `assets/manual/<关键词_下划线分隔>.mp4`，会**优先于检索**被使用
- **C 影视片段**：不建议。YouTube 的 Content ID 匹配日本影视素材很准，
  日更号被连续判定会拖垮整个账号权重

**横竖版分别检索**，不共用素材 —— 把 1920×1080 中心裁成 1080×1920 只剩原画面
28% 的宽度，人和招牌基本都被切掉。手动素材同理，竖版专用的命名为
`<关键词>_portrait.mp4`，找不到才回退到通用的那个（会警告，画面会被裁）。

素材按 `朝向 + 关键词` 的 MD5 缓存在 `assets/cache/<hash>-<朝向>.mp4`，
同一个关键词跨项目只下载一次。下载要过状态码、Content-Type、体积、
ffprobe 能否解码四道校验，并且先写 `.part` 再改名 —— 否则一个限流返回的 HTML
会被存成 mp4，把这个关键词的缓存永久毒掉。

关键词要写**画面**不写概念：`empty office night` 可以，`financial crisis` 不行 ——
后者检索不到东西。

---

## 六、成本与耗时

单条 3–4 分钟的片子：

| 项 | 成本 |
|---|---|
| 写稿（Sonnet 5） | 几毛人民币 |
| 配音（Edge TTS） | 免费 |
| 素材（Pexels） | 免费 |
| AI 生成镜头（可选，3–5 个） | 几块到十几块 |
| 渲染耗时 | 横竖两版约 5–12 分钟，取决于 CPU |

真正的成本是写稿时的人工审阅。模型能把结构和节奏搭好，
但**事实核查必须人来做** —— 具体数字、日期、人名，模型会记错，
这类内容一旦出错，评论区会立刻指出来。

---

## 七、已知限制

- 逐行 TTS 会让句间语气有轻微断点。每段合成后会自动削掉头尾静音
  （`src/steps/tts.ts` 的 `trimEdges()`），接缝已经很小，句间留白完全由
  `pauseAfterMs` 控制；真要严丝合缝的连贯朗读，还是得换整篇合成 + 词级时间戳切分
- **混音必须单独跑一遍 ffmpeg**（`buildAudioMix()`）。`loudnorm` 和 `libx264`
  放进同一次 run，音频会被整块丢掉：实测成片里出现 3.00s 的空洞，播放器表现为
  「画面卡住、声音消失几秒然后跳过去」，而时长和文件大小都正常。渲染结束的
  `assertAudioContinuous()` 会逐包检查，有空洞直接报错
- Pexels 的素材偏「国际化空镜」，日本本土题材经常检索不到贴切画面，
  这种时候走 B 档手动补
- `stack` 组的行数超过 6 行会顶出画面，`validate()` 目前没拦，自己注意
- 没做转场特效，全部硬切。这类片子硬切本来就更合适
