# joke-video —— 段子短视频流水线（扁平几何/剪纸风）

> **做儿童故事（《一页故事》这类旁白叙述型）看 [儿童故事出片方案.md](儿童故事出片方案.md)** ——
> 那边一条命令 `npm run ship` 从稿件到成片，本文档是段子（对话反转）的手册和字段说明。

把一段文字段子做成竖版短视频。角色**全部用代码画**（SVG），不依赖 AI 出图，
所以不会出现"每次重生成角色脸就飘"的问题。音效和 BGM 也是代码合成的，零版权风险。

- 输出：1080×1920 / 30fps / H.264 + AAC
- 技术栈：Node + TypeScript + ffmpeg（**不需要 Python**）
- 已跑通示例：`jokes/snake-poison.json`（两条蛇）、`jokes/example-human.json`（人物版）

---

## 一、前置要求

| 项 | 要求 | 检查命令 |
|---|---|---|
| Node.js | 18 以上 | `node -v` |
| ffmpeg | 命令行可用（要在 PATH 里） | `ffmpeg -version` |
| 中文字体 | 系统装有中文字体 | 见下 |

**字体**是唯一容易踩的坑。默认按这个顺序找：
`Noto Sans CJK SC → Noto Sans CJK JP → Source Han Sans SC → Microsoft YaHei → Yu Gothic UI → PingFang SC`。

Windows 一般命中「Microsoft YaHei」，没问题。如果字幕出现方框或者没字，用环境变量指定：

```bash
# Windows PowerShell
$env:JOKE_FONT="Microsoft YaHei"; npm run draft -- jokes/snake-poison.json
# macOS / Linux
JOKE_FONT="PingFang SC" npm run draft -- jokes/snake-poison.json
```

## 二、安装

这个包是 vidgen 的 npm workspace，**依赖装在仓库根目录**，不在这里：

```bash
cd ..        # 到 vidgen 根目录
npm install  # 一次装齐根管线 + joke-video + voice-clone
```

装完这里不会有自己的 `node_modules`，`npm run xxx` 照常在本目录跑。

之所以这么放：joke-video 的 5 个依赖里有 4 个（msedge-tts / tsx / typescript /
@types/node）根目录已经有了，而且版本完全一致，单独装一份等于白占 41MB。
独有的只有 `@resvg/resvg-js`（SVG 转 PNG，5MB）。

**别在这个目录里 `npm install`** —— 会重新长出一套本地 node_modules，
workspace 的提升就白做了。要加依赖：`npm i <包> -w joke-video`（在根目录跑）。

## 三、执行流程

**顺序很重要：先拿配音，再渲画面。** 画面时长完全由配音决定——先渲草片等于白渲一遍，
改完时长 400 多帧全部要重来。

```
写 json → cast/try → voice → align → build → cover → preview
        （选角试听）（合成变声）（回填时长）（出片）（封面）（预览页留档）
                        ↘ 等配音这段时间，npm run still 看静帧确认画面
```

### 第 0 步：先听音效（只需第一次）

```bash
npm run sfx
```

生成到 `out/sfx/`：`_reel.wav` 是一条听完所有音效；另有 `thud`（定格那声"咚"）、
`wood`（木鱼）、`hiss`（蛇嘶）、`slide`（下滑音）、`grass`/`cicada`（环境）、
`whoosh`、`pop`、`gulp`，以及 `bgm-happy` / `bgm-cheeky`。
不满意就改 `src/audio/sfx.ts` 里对应函数的参数（频率、衰减 tau、滤波中心）。

### 第 1 步：选角 + 生成配音

**这是对话类段子最要紧的一步。** 观众能不能分清谁在说话，决定这条片子成不成立。

```bash
npm run cast                                  # 看有哪些角色音色
npm run try -- 童声,大块头 "真实台词"          # 试听对比，出到 out/try/
npm run voice -- jokes/snake-poison.json      # 一条命令生成全部台词
```

音色写在角色的 `cast` 字段，一个字段同时定了基础音色、语速和变声参数：

```jsonc
{ "id": "small", "rig": "serpentine", "side": "left", "cast": "童声" },
{ "id": "big",   "rig": "serpentine", "side": "right", "cast": "大块头" }
```

#### 为什么需要变声这一层

Edge 中文一共只有 11 个音色，而且 SSML 的 `pitch` 只能抬基频、动不了共振峰
（实测 `+50Hz` 频谱质心只挪 7%，听感是「同一个人捏着嗓子」）。段子最需要的
**小孩**和**老人**这两端，光靠原生音色根本做不出来——微软的中文童声已经下架了。

所以链路是两段：

```
台词 ──[msedge-tts]──> 基础人声 mp3 ──[ffmpeg 变声]──> 角色音色 wav
```

第一段走 Edge 朗读接口（免 key、要联网），第二段全本地离线、无限次。
变声的核心是 **pitch 和 formant 必须分开调**：只抬 pitch 得到的是花栗鼠电音，
因为真实的小孩不只是音高高，声道也短。两个按不同比例动，才有「换了个人」的感觉。
这个解耦依赖 ffmpeg 的 **rubberband** 滤镜（编译期可选项，gyan.dev 的 full build 带）。
缺了会自动退化成锁死模式，能出声但区分度打折，`npm run voice` 会提示。

#### 常用角色音色

| cast | 基础音色 | pitch / formant | 用在哪 |
|---|---|---|---|
| `童声` | 云夏 `-8%` | 1.18 / 1.14 | 七八岁，小孩角色的默认 |
| `童声奶` | 云夏 `-10%` | 1.26 / 1.20 | 五六岁，再高就失真 |
| `女童` | 晓伊 `-10%` | 1.14 / 1.16 | 小女孩 |
| `少年` | 云夏 `-4%` | 1.06 / 1.05 | 十几岁男孩 |
| `青年男` / `青年女` | 云希 / 晓晓 | 原声 | 基准音色 |
| `大叔` | 云扬 `-4%` | 0.93 / 0.94 | 中年男 |
| `大块头` | 云健 `-8%` | 0.86 / 0.84 | 憨厚壮汉，捧哏 |
| `老爷爷` | 云扬 `-10%` | 0.88 / 0.93 | 老人 |
| `老太太` | 晓晓 `-10%` | 0.95 / 1.02 | 苍老感靠颤抖不靠音高 |
| `精灵` | 晓伊 `-6%` | 1.50 / 1.38 | 卡通尖音，只给短句 |

全表跑 `npm run cast`。还有 `沙哑老头` / `反派` / `鼻音怪` / `旁白` / 方言和日语。

**pitch 别超过 1.30**（`精灵` 是故意越界的）。过了这条线辅音开始碎，
表现是「音调是上去了，但字听不清」。

#### 念法：这一句怎么说

角色音色定的是「谁在说」，`delivery` 定的是「这句怎么说」。
**punch 句几乎总要变调**，不然三句话一个调子，包袱抖不响：

```jsonc
{ "who": "small", "text": "我咬到了自己的舌头", "beat": "punch", "delivery": "泄气" }
```

可选：`平` / `压低` / `拔高` / `拖长` / `急` / `弱` / `泄气`。
参数是**相对角色音色的偏移**，会自动叠加——`童声` 的 `-8%` 加上 `泄气` 的 `-12%`
就是 `-20%`，音高 `1.18 × 0.94 = 1.11`。跑 `npm run lines` 能看到叠完的结果。

也可以直接给参数：`"delivery": { "rate": "-15%", "pitch": 0.96 }`。

#### 微调参数

`npm run try` 出的 wav 不满意，就去 `voice-clone` 的网页试听台拖着调：

```bash
cd ../voice-clone && npm run lab      # → http://localhost:5178
```

那里有音色地图（横轴共振峰、纵轴音高），拖十字准线实时试听。
调满意了把 `pitch` / `formant` 抄回 `src/cast.ts`。两边用的是同一套滤镜链。

**试听句一定要用真实会用到的台词**，「测试测试」听不出差别——
音色的区分度体现在长句的语调起伏里。

#### 缓存

基础人声按（台词 + 音色 + 韵律）缓存在 `.cache/`，变声结果也缓存。
**改变声参数反复试不会重新联网**，只有改台词才真的打接口。清缓存直接删 `.cache/`。

#### 授权提醒

Edge 朗读接口不是官方商用 API。内容要变现的话，建议改成 Azure 语音服务的官方
key（同一批音色，条款干净）。变声那一段是本地 ffmpeg，没有授权问题。

### 第 2 步：配音文件放哪

`npm run voice` 会自动放好，每句一个：

```
voice/snake-poison/1-small.wav
voice/snake-poison/2-big.wav
voice/snake-poison/3-small.wav
```

时长是算出来的，不是靠静音检测猜的——每句独立成文件，误差不累积。
自己录的配音也可以放进来（必须是 wav，采样率随便，16-bit / 32-bit float 都能读）。

### 第 3 步（与第 2 步并行）：看静帧确认画面

```bash
npm run still -- jokes/snake-poison.json          # 自动出「开场/笑点/定格/结尾」四张
npm run still -- jokes/snake-poison.json 1.2 8.1  # 指定秒数
```

每张一秒左右就出来了。构图、配色、角色站位、字幕位置都在这一步定，
**不要为了看画面去渲整片**。

### 第 3.5 步：出片前的红线检查 ⚠

**build 是交付动作，不是调试手段。** 一次 build 要 30 分钟（145 秒的片子 4354 帧、
0.48 秒/帧），而下面每一项都只要几秒到十几秒。做过《小老鼠做蛋糕》那条片子的人
都知道代价：**同一条片子渲了四遍**，三遍都是渲完才从成片里抓帧发现问题。

```bash
npm run layout -- jokes/x.json          # ① 站位：重叠 / 出画框 / 顶出上边
npm run layout -- jokes/x.json --fix    #    有问题就自动推开
npm run still  -- jokes/x.json <每一镜各一个时刻>   # ② 逐镜看画面
npm run voice  -- jokes/x.json && npm run align -- jokes/x.json   # ③ 配音 + 回填时长
```

#### ① 站位一定要跑 layout，别靠眼睛

`npm run layout` 是**实测**的（单独光栅化每个角色/道具，量非透明像素包围盒），
不是按 `length/2` 估的。老鼠实测 [−138,+99]——**锚点不在正中**，尾巴甩在左边；
蛋壳车 [−171,+211]。按半宽估，八个镜头里六个会撞。

它已经接进 preflight，build 时会拦。但**要在 build 之前主动跑**，别等 build 报错。

#### ② 静帧要逐镜看，不是只看默认那四张

`npm run still` 不给参数只出「开场/笑点/定格/结尾」四张。B 类叙述片有八九个不同的
`stage`，那四张覆盖不到。正确做法是**每个不同的 stage 各取一个时刻**：

```bash
node -e "const j=require('./jokes/x.json');const s=new Set();j.lines.forEach((l,i)=>{const k=(l.stage||[]).join(',');if(!s.has(k)){s.add(k);console.log(i,k)}})"
```

`npm run preview` 也会给每一镜出静帧（日志里的「N 张场景图」）——**东西一直都在，要看**。

#### ③ 音画同步：时间轴只能有一份

改停顿只改 `beats/typeA.ts` / `beats/typeB.ts` 那一处。
`mixdown` 直接读 `segment.start` 铺配音，**不许在音频侧重算一遍时间**。

曾经踩过：`mix.ts` 自己按 `padBefore 0.15 / padAfter 0.2` 推时间，而 typeB 用
`0.25 / 0.35（换镜 1.2）`，每句差一点、**逐句累积**，22 句下来音画差十几秒，
表现是"音频和字幕不在一个节奏上，越到后面越离谱"。

出片前核一遍（几秒钟）：

```
逐句比对 segment.start / line.dur 和字幕窗口 [start-0.12, end)
配音必须完整落在窗口内
```

出片后再从**成片音轨**里找人声起点复核一遍，这是唯一的端到端证据。

#### ④ 节奏：用预设，别重新试

语速和停顿已经固化成命名预设（`src/pace.ts`）。新稿件写一行就拿到睡前故事那套节奏，
不用一个个试：

```jsonc
{ "type": "B", "pace": "bedtime", ... }
```

可选 `bedtime`（句内 0.55/0.30、句间 0.90s、换镜 1.95s）/ `narrate` / `banter`，
详见 音色音调手册-VOICE.md。要微调也**只调预设里的数值**，别写死到 beats 里。

`voice` 只要一两分钟，改完重跑 `voice + align` 再听——**不要用 build 来听配音**。

### 第 4 步：对齐 + 出片

```bash
npm run align -- jokes/snake-poison.json     # 去首尾静音 → 回填真实时长到 json
npm run build -- jokes/snake-poison.json     # 正式出片，一次搞定
```

成片和音轨直接落到 `../projects/段子与儿童故事/<日期>_<id>/`，不在 `out/`：

```
../projects/段子与儿童故事/2026-08-18_snake-poison/snake-poison.mp4      成片
../projects/段子与儿童故事/2026-08-18_snake-poison/snake-poison-audio.wav 混好的音轨
```

渲染速度参考（1080×1920 / crf 19 / preset medium）：

| | 每帧 | 156 秒的片子（4690 帧） |
|---|---|---|
| 单线程（旧） | 约 185 ms | 约 30 分钟 |
| **6 线程（现在的默认）** | **约 60 ms** | **约 8 分钟** |

慢的**只有光栅化**：实测单帧 240ms 里，拼出整帧 SVG 只占 1ms，resvg 占 99.6%。
所以并行的是光栅化，主线程照旧拼 SVG。线程数默认 `核数-2`（上限 6），
`JOKE_WORKERS=N` 覆盖，`JOKE_WORKERS=1` 退回单线程。

并行**不改画面**：同一份代码单线程和 6 线程渲同一条片子，406 帧逐帧 md5 完全一致
（帧序靠按帧号顺序消费保证，见 `video.ts`）。

顺带一提，说书线（`shuoshu-*`）不吃这个成本 —— 那边是现成 PNG 交给 ffmpeg 按时长拼，
一次光栅化都不做，所以 16 分钟的片子反而比这里 2 分半的还快。

### 第 5 步：稿件预览页

```bash
npm run preview -- jokes/snake-poison.json    # 单条
npm run preview                               # 汇总所有稿件到一页
```

产物落在 `../projects/段子与儿童故事/<日期>_<id>/`。四条线的成品都收在根级 `projects/<类型>/`，见 [projects/README.md](../projects/README.md)。
**一条片子的东西全在一个目录里**——成片、音轨、场景图、分析、留档配置：

```
projects/2026-08-18_snake-poison/
├── snake-poison.mp4        成片（npm run build 直接出到这）
├── snake-poison-audio.wav  混好的音轨：人声 + 音效 + BGM + 环境音
├── index.html              成片 + 场景图 + 对话内容 + 音色设置 + 分析，双击打开
├── 方案.md                 落地方案：分镜表 / 场景角色 / 发布文案
├── snake-poison.json       出这一版用的配置，留档
└── stills/                 每句台词一张场景图 + 开场/定格/钩子
```

`out/` 只留跨稿件的临时产物：`sfx/`（音效试听）、`try/`（音色试听）、纸纹缓存。

预览页顶上直接嵌了成片播放器，还没 build 的会显示占位提示。

**每句台词一张场景图**，页面里图和台词左右对照——「这句话配的是哪个画面」一眼就能
看出来。每句下面挂着音色、念法和实测配音时长，笑点句整行高亮。两个角色撞音色会在
页头红条报警。

`npm run preview`（不带参数）额外出一张 `projects/index.html`，把所有稿件按条分组
排在一页，**左侧是稿件目录导航**：每条带一张开场缩略图、片长、句数和用到的音色，
点了跳到对应稿件，滚动时当前那条自动高亮。日更时用来横向比。

每个项目目录里也各有一份自己的 `index.html`（单条稿件，无侧栏），
单独发人看时不用带上整个 `projects/`。

#### 方案.md —— 拆解过程的落盘

**这是"我为什么这么分镜"的唯一记录。** 之前只留结果（json + 场景图 + 成片），
判断依据全丢在聊天记录里：下次改片子时看得到 `enterFrom: 700`，
却不知道它是为了"体现乌龟的慢"才调出来的，动了会破坏什么无从判断。

文档分两种内容，用标记分开：

| | 谁写 | 重跑 preview 时 |
|---|---|---|
| `<!-- AUTO:shots -->` 分镜表 | 机器从当前配置生成 | **重写** |
| `<!-- AUTO:cast -->` 场景/角色/节奏 | 同上 | **重写** |
| 一、稿件定位 | 人 | 原样保留 |
| 四、发布文案 | 人 | 原样保留 |
| 五、人工核对 | 人 | 原样保留 |

分镜表是「时间 / 画面 / 台词 / 音效·BGM」四列，直接对着它核画面。
每一镜的**意图**写在 `line.note` 里（存"为什么"，不存"是什么"——
"是什么"看 scene/stage 就知道），会以斜体渲进「画面」列。

发布文案那一段是给平台用的：标题候选、内容关键词、热度关键词、话题标签、简介。
发片时直接抄。

文档会渲进预览页（表格、引用、任务勾选都支持），页面右上角有 `方案.md ↗` 直链，
要改就改那个文件。

**为什么不像以前那样"生成一次就不动"**：早先的 `分析.md` 就是那样，
于是永远停在第一次生成的版本——mouse-cake 的分析里写着"全片 116.8s"，
实际早已 145.09s；类型标着"B 类（对话反转）"，而 B 是旁白叙述。既过期又误导。

**`npm run build` 出片后会自动同步预览页**，成片、场景图、汇总页永远是同一版，
不用再单独跑 `preview`。同步时只重渲这条稿件的场景图，其余复用磁盘上已有的，
所以这一步只多花几秒。

单独跑 `npm run preview -- <cfg>` 也会顺带更新汇总页——单条页和汇总页共用一份代码，
两边不会各写各的。

顺序是 `voice → align → build`：先有配音场景图的时间点才准。

### 第 6 步：封面

```bash
npm run cover -- jokes/snake-poison.json                    # 大字自动推
npm run cover -- jokes/snake-poison.json "大哥，我完了"      # 指定大字
```

出三张到 `projects/<日期>_<id>/cover/`：`-9x16.png`（发布用）、`-3x4.png`（个人主页
九宫格的样子）、`-安全区.png`（带辅助线，看有没有被平台 UI 盖住）。

大字优先级：**命令行参数 > json 的 `cover.title` > 自动推**。自动推是拿第一句
（提问句）去标点截到 8 字——建立了情境但不含答案，天然不剧透，但只是兜底，
上线前建议手写一句。

右下角署名是账号名，改 `src/config.ts`（频道级常量，不写在每条稿件里）：
段子 /《一页故事》用 `ACCOUNT`，老马独白线用 `ACCOUNT_LAOMA`（`碎嘴老马`）——
**这条管线上跑着不止一个号**，谁署谁由 `cover.ts` 的 `accountFor()` 按 `rig === 'horse'` 判。

**封面会自动嵌成视频第一帧**，平台多数拿第一帧做缩略图。默认只占 1 帧（33ms），
观众看不见但平台取得到；`"cover": { "asFirstFrame": false }` 可关。

出片时会做三条机器校验并告警：大字里有没有笑点词（`highlight` 那个）、
大字是不是就是笑点句、大字和 `hook` 是不是同一句。

完整规则见 **[封面设计规范-COVER.md](封面设计规范-COVER.md)**。

### 日更就上批量

整条链路没有人工环节，写好 5 条 json 就能一路跑到底。

```bash
npm run batch -- voice       # 对 jokes/ 下所有 json 生成配音
npm run batch -- align       # 全部对齐
npm run batch -- build       # 全部出片
npm run batch -- still       # 全部出静帧
```

### 关于 draft

`npm run draft -- <cfg>` 出的是无配音草片（时长按字数估算）。
按上面的流程其实用不到它——只在"还没配音、但想看动效连不连贯"时才有意义。

## 四、配置文件说明

一条片子 = 一个 json。`jokes/snake-poison.json`：

```jsonc
{
  "id": "snake-poison",          // 输出文件名 / 配音目录名
  "type": "A",                   // A 类：对话反转
  "scene": "grass",              // 见 分镜手册-SHOT.md 一、场景（跑 npm run scene -- <名字> 单看空场）
  "intro": 2.0,                  // 开场空镜（秒）
  "freeze": 2.0,                 // 定格时长
  "hold": 4.0,                   // 定格后留白（挂钩子）
  "ambience": "grass",           // 环境音，"none" 关掉
  "bgm": { "enabled": true, "stopAtPunch": true, "key": "cheeky" },
  "cues": { "subtitlePop": false, "replyWood": true, "introHiss": true },

  "characters": [
    { "id": "small", "rig": "serpentine", "side": "left",
      "color": "secondary", "length": 560, "voice": "少年/奶气" },
    { "id": "big",   "rig": "serpentine", "side": "right",
      "color": "primary",   "length": 640, "voice": "憨厚/浑厚" }
  ],

  "lines": [
    { "who": "small", "text": "大哥，我们有毒吗？",   "beat": "ask",   "padBefore": 0.2 },
    { "who": "big",   "text": "你说这干啥？",         "beat": "reply", "padBefore": 0.25 },
    { "who": "small", "text": "我咬到了自己的舌头",   "beat": "punch",
      "padBefore": 0.45, "padAfter": 0.35, "highlight": "舌头" }
  ],

  "hook": "所以这条蛇……还有救吗"
}
```

**字段要点**

- `beat`：`ask` 提问 / `reply` 回应 / `punch` 反转。**必须有且只有一句 `punch`**，
  整条时间轴、BGM 骤停点、定格点、反应表情都是从它推出来的。
- `padBefore`：这句话前的留白。笑点句建议 0.4 以上，节奏全靠它。
- `highlight`：字幕里变芥黄的关键词。
- `color`：`primary`（藏青）/ `secondary`（朱红）/ `neutral`，也可以直接写 `#RRGGBB`。
- `hook`：结尾钩子。**定格去色时钩子不去色**，所以它会在灰调画面里跳出来。
  去色只发生在 A 类；B 类叙述片片尾**不去色**（收尾金句正落在那一帧上，突然变灰会把人吓醒）。
- `series`：系列片头卡，B 类系列用。写 `{ "name": "一页故事", "no": 1 }` 就会在开场空镜上
  叠一张「一页故事 / 第 01 页」。卡**只叠在 intro 上、不占额外时长**，要停 3 秒就把 `intro` 写成 3
  （低于 2.6 会被 preflight 提醒，卡一闪而过等于没有）。
  量词默认「页」，别的系列写 `"unit": "集"`。

## 五、换段子怎么改

### 换动物（长条型：蛇/鱼/虫）

改 `length`、`color`，改场景，改台词。骨架不用动。

### 换成人物

```jsonc
"characters": [
  { "id": "kid", "rig": "human", "side": "left", "color": "secondary",
    "proportion": "child", "hair": "short", "props": ["bag"] },
  { "id": "gramps", "rig": "human", "side": "right", "color": "primary",
    "proportion": "elder", "hair": "white", "props": ["glasses", "cane"] }
]
```

- `proportion`：`child`（约 4 头身，动作快而弹）/ `adultM` / `adultF` / `elder`（前倾 10°、动作慢 30%）
- `hair`：`short` / `long` / `bun` / `bald` / `white` —— 头发是识别年龄性别的主要手段
- `props`：`glasses` / `cane` / `bag` / `cap`
- `scale`：整体缩放，人物默认 1.25

手势由 `beat` 自动选：回应句→摊手，反转句→指，接梗的一方→扶额。
想手动指定，改 `src/render.ts` 里 `gesture` 那几行。

**人物比动物难**：人不动嘴一眼假，所以口型由音频振幅（RMS）驱动三态开合，
这块已经实现了，但**只有跑 `build`（有配音）时才准**；`draft` 用的是合成节奏。

### 换场景

`scene` 改成 `room` / `office` / `street` / `abstract`。
新增场景：在 `src/scenes/index.ts` 里加一个函数，返回 `{far, mid, near}` 三层，
注册到 `SCENES` 即可。三层会自动按 0.35 / 0.7 / 1.35 的速率做视差。

## 六、音效与 BGM

音效点位由 `src/beats/typeA.ts` 自动排：开场"嘶"、回应句前木鱼、笑点尾拖滑音、
定格处"咚" + BGM 骤停、定格后蝉鸣。

三个点位可以在 json 里开关：

```jsonc
"cues": {
  "subtitlePop": false,   // 每句台词前的小 pop，默认关
  "replyWood":   true,    // 回应句前的木鱼，默认开
  "introHiss":   true     // 开场那声"嘶"，默认开
}
```

**`subtitlePop` 默认是关的。** 它是 780→420Hz 的正弦扫频，听感是个音高明确的
"do"，每句话前面来一下，三句就腻了，还会盖住台词起头那个字。要字幕弹入的
打击感就打开它，但建议同时把 `GAIN` 里的电平压低。

**换成人物角色记得关掉 `introHiss`** —— 那是蛇的嘶声。

其余：

- **BGM 在定格处骤停**是本片最有效的笑点强化手段，别关（`stopAtPunch`）。
- 想换成真乐器 BGM：找一段无版权音乐，改 `src/audio/mix.ts` 让它读你的文件，
  或者拿 `projects/<日期>_<id>/<id>-audio.wav`（脚本混好的音轨）自己再叠一层。
- 电平约定在 `src/config.ts` 的 `GAIN`：打击类给足，**环境音压到 0.06**
  （合成的氛围音不如实录自然，压低当垫底就不难听了）。

## 七、镜头

镜头逻辑在 `src/render.ts` 的 `cameraKeys()`：跟随说话者，反转句推近（zoom 1.34），
平常句子中景（1.14）。

**关键是它必须走关键帧插值，不能按当前时刻直接算目标值。** 早先那版是
「有人说话就 zoom 1.14，没人说话就回 1.0」，于是每句话首尾各产生一次硬切——
14 秒的片子 ffmpeg 能检出 5 次场景切变，看起来一顿一顿的。

两条规矩：

1. **句间停顿不要把镜头拉回原位。** 保持上一句的构图，直到下一句起范儿才开始挪。
   镜头一回弹，观众会以为换镜头了。
2. **过渡要在台词起来之前就开始。** 现在是提前 `ease * 0.7` 起步、`ease * 0.3` 后落位，
   反转句 `ease=0.34`（推得快，抖包袱有劲），平常句 `ease=0.55`。

改完想验证有没有硬切：

```bash
ffmpeg -v error -i <成片>.mp4 -vf "select='gt(scene,0.06)',metadata=print:file=-" -an -f null -
```

**输出为空才算过。** 有输出就说明那个时刻是硬切，对着时间点去 `cameraKeys()` 里找。

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 字幕是方框或空白 | 字体没命中，用 `JOKE_FONT` 指定系统里确实存在的族名 |
| `ffmpeg 退出码 1` | ffmpeg 不在 PATH，或输出文件被占用（关掉正在播放的播放器） |
| 画面整体发绿 | 已修：纸纹用 `overlay`（带 alpha）而不是 `blend=multiply`。ffmpeg 的 multiply 会串色，别改回去 |
| 纸纹太重/太淡 | `src/video.ts` 里 `strength`（默认 0.38），0 就是不叠 |
| 渲染太慢 | `draft` 已用 `veryfast`+crf24；正片可把 `preset` 调成 `fast` |
| 两个角色叠在一起 | 改 `src/config.ts` 的 `SNAKE` / `SNAKE_DY`（长条动物）或 `SLOT`（人物） |
| 读不了配音 | 必须是 wav。mp3/m4a 先 `ffmpeg -i in.m4a out.wav` |
| `npm run voice` 报 403 / WebSocket 错误 | 联不上 Edge 朗读接口（断网、代理、或接口变动）。`npm i msedge-tts@latest` 试试 |
| 换场景/换句子时画面一顿一顿 | 镜头硬切了。用第七节那条 ffmpeg 命令查，有输出就是硬切；改 `cameraKeys()`，别按当前时刻直接算目标值 |
| 每句话前有个do的音 | `subtitlePop`，默认已关。老 json 里显式写了 `true` 的话删掉那行 |
| 人物段子里有蛇的嘶声 | `"cues": { "introHiss": false }` |
| 找不到音色名 | `npm run cast` 看角色音色表；要底层 ShortName 跑 `npm run voices` |
| 两个角色听着像同一个人 | `npm run lines` 会报音色撞车。低频/高频能量差至少拉开 6 dB 才好分辨 |
| 变声后声音发飘、有金属感 | pitch 超过 1.30 了。降到 1.30 以内，体型感改用 formant 补 |
| 提示 rubberband 缺失 | ffmpeg 不是 full build。pitch/formant 会锁死，角色区分度打折 |
| 时长不对 | 忘了跑 `align`，`build` 会退回估算时长 |

## 九、目录结构

```
src/
├── config.ts              画布/帧率/地平线/角色站位/电平/字体   ← 想调整体规格改这里
├── types.ts               配置与时间轴类型
├── anim.ts                缓动、关键帧、呼吸/眨眼/抖动
├── style/palette.ts       调色板 + 定格去色
├── style/papercut.ts      手撕边、圆头矩形、投影、纸纹        ← 剪纸风的规则都在这
├── rigs/state.ts          角色状态（所有 rig 共用一份）
├── rigs/serpentine.ts     长条型骨架
├── rigs/human.ts          人物骨架（四组比例参数）
├── scenes/index.ts        场景库（三层视差）
├── beats/typeA.ts         A 类节拍模板 + 音效点位            ← 最值钱的一层，换段子不改
├── subtitle.ts            纸片字幕
├── render.ts              单帧渲染（镜头/状态/字幕/定格）
├── cast.ts                选角表：角色音色 + 念法              ← 音色都在这
├── tts.ts                 配音：Edge 合成 → 变声，带缓存
├── preview.ts             稿件预览页（场景图 + 对话 + 分析）
├── cover.ts               封面（大字 + 情绪符号 + 署名，兼视频第一帧）
├── audio/morph.ts         变声滤镜链（pitch/formant 解耦）
├── audio/{wav,dsp,sfx,bgm,mix,align}.ts
├── video.ts               帧 → ffmpeg
└── cli.ts                 命令入口
tools/                     假配音生成器、Windows SAPI 脚本
jokes/                     一条片子一个 json
projects/<日期>_<id>/      成片 + 音轨 + 预览页 + 场景图 + 分析   ← 一条片子的全部产物
voice/<id>/                你本地生成的配音
out/                       跨稿件的临时产物（音效试听/音色试听/纸纹）
```

## 十、下一步

目前只实现了 **A 类：对话反转**。段子实际上有四类，各需要一个 `beats/` 模板：

| 类型 | 形态 | 状态 |
|---|---|---|
| A 对话反转 | 两角色，最后一句抖包袱 | ✅ 已实现 |
| B 叙述型 | 旁白讲一件事，结尾翻转 | 待做（旁白 + 画面接力） |
| C 视觉笑点 | 笑点在画面本身，台词极简 | 待做（画面必须放大展示 3 秒） |
| D 多轮递进 | 三次同样问答，第三次变调 | 待做（三拍重复 + 破拍） |

建议顺序：先用 A 类跑完两三条片子攒手感，再做 B 类。
因为 A 和 B 的差异会把「哪些属于模板、哪些属于实例」自然逼出来——
用一条片子去猜模板边界通常会猜错。

**内容侧提醒**：老人/小孩题材容易踩两条线（被判定嘲讽弱势群体、形象刻板化）。
写这类段子时让笑点落在**情境**上，不要落在"因为他老/他小"这类属性上。
另外蛇会让部分观众不适，角色已经卡通化处理（圆眼、无写实鳞片），封面别用蛇头特写。
