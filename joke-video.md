# joke-video —— 段子短视频流水线（扁平几何/剪纸风）

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

```bash
npm install
```

## 三、执行流程

**顺序很重要：先出稿件拿配音，再渲画面。** 配音是关键路径（要你手动在剪映里操作），
而画面时长完全由配音决定——先渲草片等于白渲一遍，改完时长 400 多帧全部要重来。

```
写 json  →  npm run voice  →  npm run align  →  npm run build     ← 全自动（推荐）
写 json  →  npm run script →  剪映朗读导出 wav  →  align  →  build  ← 走剪映
                    ↘ 等配音的这段时间，npm run still 看静帧确认画面
```

### 第 0 步：先听音效（只需第一次）

```bash
npm run sfx
```

生成到 `out/sfx/`：`_reel.wav` 是一条听完所有音效；另有 `thud`（定格那声"咚"）、
`wood`（木鱼）、`hiss`（蛇嘶）、`slide`（下滑音）、`grass`/`cicada`（环境）、
`whoosh`、`pop`、`gulp`，以及 `bgm-happy` / `bgm-cheeky`。
不满意就改 `src/audio/sfx.ts` 里对应函数的参数（频率、衰减 tau、滤波中心）。

### 第 1 步：拿配音（三条路，选一条）

配音有三种拿法，**推荐 A**。三种产出的文件放在同一个位置，后面的步骤完全一样。

#### A. 本地 TTS，全自动（推荐）

```bash
npm run voices                               # 列出可用音色（zh / ja）
npm run voice -- jokes/snake-poison.json     # 一条命令生成全部台词
```

按角色指定音色，写在 json 的角色里：

```jsonc
{ "id": "small", "tts": "少年",   "voice": "少年/奶气" },
{ "id": "big",   "tts": "浑厚男", "ttsRate": "-6%" }   // 语速慢一点更有"大哥"感
```

`tts` 可以填预设名，也可以直接填 ShortName：

| 预设 | ShortName | 适合 |
|---|---|---|
| 少年 | zh-CN-YunxiaNeural | 小孩/奶气角色 |
| 少女 | zh-CN-XiaoyiNeural | 活泼女声 |
| 温柔女 | zh-CN-XiaoxiaoNeural | 成年女 |
| 浑厚男 | zh-CN-YunjianNeural | "大哥"、憨厚角色 |
| 阳光男 | zh-CN-YunxiNeural | 成年男 |
| 播音男 | zh-CN-YunyangNeural | 旁白 |
| 东北女 | zh-CN-liaoning-XiaobeiNeural | 方言梗 |
| 日语女 / 日语男 | ja-JP-NanamiNeural / ja-JP-KeitaNeural | 日语段子 |

还能调 `ttsRate`（语速，如 `"-8%"`）和 `ttsPitch`（音高，如 `"+15Hz"`）。

**要联网**（走 Edge 朗读接口，不需要 key）。
**授权提醒**：这个接口不是官方商用 API。内容要变现的话，建议改成 Azure 语音服务的官方
key（同一批音色，条款干净），或者走下面的 B 方案。

#### B. 剪映手动

```bash
npm run script -- jokes/snake-poison.json        # 句间空白默认 1.2s
npm run script -- jokes/snake-poison.json 1.8    # 空白被吃掉时加大
```

得到 `out/<id>.srt`（剪映：**文本 → 本地字幕 → 导入**，台词直接排上时间线、句间空白已留好）
和 `out/<id>-配音文本.txt`（逐句粘贴用）。

导入后逐句选中文本 → 右侧「朗读」→ 挑音色 → 开始朗读。
**同角色用同音色，不同角色必须用不同音色**，否则观众分不清谁在说话。
导出时**取消勾选「视频导出」、勾选「音频导出」，格式选 WAV**。

#### C. Windows 自带 TTS，完全离线

```powershell
powershell -ExecutionPolicy Bypass -File tools/win-sapi.ps1 -List
powershell -ExecutionPolicy Bypass -File tools/win-sapi.ps1 `
  -Text "大哥，我们有毒吗？" -Voice "Microsoft Huihui Desktop" `
  -Out "voice/snake-poison/1-small.wav"
```

音色机械（Huihui/Kangkang），做段子偏弱，但断网可用、零授权风险，适合应急。

### 第 2 步：配音文件放哪

不管走哪条路，最终都是这两种形态之一：

```
voice/snake-poison/1-small.wav      # 每句一个（A、C 方案就是这样）
voice/snake-poison/2-big.wav
voice/snake-poison/3-small.wav

voice/snake-poison/all.wav          # 整轨一个（B 方案推荐，align 按静音自动切句）
```

两种都在的话整轨优先。采样率随便，脚本会自动重采样；16-bit / 32-bit float 都能读。

### 第 3 步（与第 2 步并行）：看静帧确认画面

```bash
npm run still -- jokes/snake-poison.json          # 自动出「开场/笑点/定格/结尾」四张
npm run still -- jokes/snake-poison.json 1.2 8.1  # 指定秒数
```

每张一秒左右就出来了。构图、配色、角色站位、字幕位置都在这一步定，
**不要为了看画面去渲整片**。

### 第 4 步：对齐 + 出片

```bash
npm run align -- jokes/snake-poison.json     # 静音检测 → 回填真实时长到 json
npm run build -- jokes/snake-poison.json     # 正式出片，一次搞定
```

渲染速度参考：**434 帧（14.7 秒）约 170 秒**。

### 日更就上批量

走 A 方案的话整条链路没有人工环节，写好 5 条 json 就能一路跑到底；
走 B 方案时剪映那步是唯一瓶颈，攒着一次录完 5 条再批量出片。

```bash
npm run batch -- voice       # 对 jokes/ 下所有 json 生成配音
npm run batch -- script      # （走剪映时）批量出稿件
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
  "scene": "grass",              // grass / room / office / street / abstract
  "intro": 2.0,                  // 开场空镜（秒）
  "freeze": 2.0,                 // 定格时长
  "hold": 4.0,                   // 定格后留白（挂钩子）
  "ambience": "grass",           // 环境音，"none" 关掉
  "bgm": { "enabled": true, "stopAtPunch": true, "key": "cheeky" },

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

- 音效点位由 `src/beats/typeA.ts` 自动排：回应句前木鱼、笑点尾拖滑音、定格处"咚"+BGM 骤停、定格后蝉鸣。
- **BGM 在定格处骤停**是本片最有效的笑点强化手段，别关（`stopAtPunch`）。
- 想换成真乐器 BGM：从剪映音乐库挑一段，然后把 `out/<id>-audio.wav`（脚本混好的音轨）
  和你的 BGM 在剪映里叠一下，或者改 `src/audio/mix.ts` 让它读你的文件。
- 电平约定在 `src/config.ts` 的 `GAIN`：打击类给足，**环境音压到 0.06**
  （合成的氛围音不如实录自然，压低当垫底就不难听了）。

## 七、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 字幕是方框或空白 | 字体没命中，用 `JOKE_FONT` 指定系统里确实存在的族名 |
| `ffmpeg 退出码 1` | ffmpeg 不在 PATH，或输出文件被占用（关掉正在播放的播放器） |
| 画面整体发绿 | 已修：纸纹用 `overlay`（带 alpha）而不是 `blend=multiply`。ffmpeg 的 multiply 会串色，别改回去 |
| 纸纹太重/太淡 | `src/video.ts` 里 `strength`（默认 0.38），0 就是不叠 |
| 渲染太慢 | `draft` 已用 `veryfast`+crf24；正片可把 `preset` 调成 `fast` |
| 两个角色叠在一起 | 改 `src/config.ts` 的 `SNAKE` / `SNAKE_DY`（长条动物）或 `SLOT`（人物） |
| 读不了配音 | 必须是 wav。剪映导出 mp3/m4a 的先 `ffmpeg -i in.m4a out.wav` |
| 整轨切出的段数不对 | 句间空白不够（朗读比字幕长会吃掉空白）。`npm run script -- <cfg> 1.8` 加大间隔重来 |
| 剪映没有「本地字幕」入口 | 版本差异，改用 `-配音文本.txt` 逐句粘贴 |
| `npm run voice` 报 403 / WebSocket 错误 | 联不上 Edge 朗读接口（断网、公司代理、或接口变动）。换 B/C 方案，或 `npm i msedge-tts@latest` |
| 找不到音色名 | `npm run voices` 看接口返回的 ShortName，别凭记忆填 |
| 时长不对 | 忘了跑 `align`，`build` 会退回估算时长 |

## 八、目录结构

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
├── tts.ts                 本地 TTS（按角色音色）+ 音色预设
├── audio/{wav,dsp,sfx,bgm,mix,align}.ts
├── video.ts               帧 → ffmpeg
└── cli.ts                 命令入口
tools/                     假配音生成器、Windows SAPI 脚本
jokes/                     一条片子一个 json
voice/<id>/                你本地生成的配音
out/                       输出
```

## 九、下一步

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
