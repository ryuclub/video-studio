# 音色实验室 voicelab

> ## ⚠ 这个目录里有两件不相干的东西
>
> | | 是什么 | 入口 |
> |---|---|---|
> | **音色实验室**（本文） | Edge 出基础人声 ＋ ffmpeg 变声，27 个预设。**它变不出某个特定的人。** | `npm run lab -w voice-clone` |
> | **音色克隆** | 拿真人录音训一个他自己的音色（GPT-SoVITS）。第一位客户是石老板。 | [音色克隆方案.md](音色克隆方案.md) |
>
> 变声是「把晓晓变粗变细」，克隆是「把石老板变出来」，两件事没有交集，别拿变声去凑克隆。
>
> **要跑训练，看 [训练手册.md](训练手册.md)**（拿到新录音照着走）；要知道为什么这么做，看 [音色克隆方案.md](音色克隆方案.md)。
>
> 克隆这边的脚本（都零依赖，只要 ffmpeg；`说话人扫描.py` 除外，它要 modelscope）：
>
> | | 干什么 |
> |---|---|
> | [`录音体检.mjs`](录音体检.mjs) | **闸**。一段录音能不能拿去训，十一条判据。`npm run check -w voice-clone -- <文件>` |
> | [`说话人扫描.py`](说话人扫描.py) | **另一道闸**：素材里混进第二个人了吗。声纹相似度，体检的十一条一条都抓不到这个 |
> | [`坏段扫描.mjs`](坏段扫描.mjs) | 切完之后逐段挑坏的（过短、没声、削波） |
> | [`推理测速.mjs`](推理测速.mjs) | 量 RTF —— 这台机器上一句话要多久。预热那句自动剔掉 |
> | [`停顿测量.mjs`](停顿测量.mjs) | 量「一个标点值多少秒」。⚠ GPT-SoVITS 上这张表**不成立**，见方案 §十一 |
> | [`基频对比.mjs`](基频对比.mjs) | 克隆音跟本人的 F0 差几个半音（验收判据之一，±1 半音） |
>
> 要给石老板的录音稿：[`录音稿_石老板.txt`](录音稿_石老板.txt)。

> **起它：在仓库根一条命令，不用 cd。**
>
> ```bash
> npm run lab -w voice-clone        # → http://localhost:5178
> ```
>
> 第一次先 `npm run doctor -w voice-clone`（见「装」）。RUNBOOK 顶上也有这条。

本地跑的角色音色工作台。两段链路：

```
台词文本 ──[msedge-tts]──> 基础人声 ──[ffmpeg 变声]──> 角色音色 wav
```

第一段走 Edge 朗读接口（免 API key，要联网，不计配额）。第二段全本地、离线、无限次。
27 个预设：15 个「年龄 × 粗细」网格 + 12 个特色角色。

## 装

```bash
npm install         # ⚠ 在**仓库根**装，不要在这个子目录里装（它是 npm workspace）
npm run doctor      # 查 ffmpeg / rubberband / Node
```

**在根目录跑的话**：`npm i` ／ `npm run doctor -w voice-clone`。

`doctor` 必须看到 **rubberband 可用**。这个滤镜是编译期可选项，很多 ffmpeg
发行版没带。缺了会自动退化成「音高与共振峰锁死」模式，也能出声，但角色区分度
明显打折（本质上就是变速带效果）。Windows 上装 gyan.dev 的 full build 即可。

## 用

```bash
npm run lab                          # 网页试听台 → http://localhost:5178（根目录：npm run lab -w voice-clone）
npm run all -- "你的真实台词"          # 批量生成全部 27 个到 out/ + manifest.json
npm run one -- narrator "你的台词"     # 只生成一个
npm run voices                       # 现拉可用的基础音色清单（中文/日语）
npm run voices -- ja-JP              # 按关键词过滤
```

试听台里：

- **音色地图** 是主控件。横轴共振峰（体型），纵轴音高。拖十字准线自己调，
  点小圆点直接载入那个预设。虚线交叉点是「什么都没动」的原始音色。
- 卡片上 ▶ 试听、载入（把参数灌到地图）、♥ 收藏。
- 收藏满意的 → 导出 `out/voices.selected.json`，这个文件可以直接被解说管线读。
- 试听台会显示当次用的完整 ffmpeg 滤镜链，可以直接抄进别的脚本。

**试听台词一定要用真实会用到的句子。** 「测试测试」这种听不出差别，
音色的区分度体现在长句的语调起伏里。

## 三个参数怎么理解

| 参数 | 作用 | 调高 | 调低 |
|---|---|---|---|
| `pitch` 音高 | 声带振动频率 | 更尖、更年轻、更女性 | 更低沉、更年长、更男性 |
| `formant` 共振峰 | 声道长度 = 体型感 | 体型变小（小孩/精灵） | 体型变大（大块头/巨人） |
| `tempo` 语速 | 快慢 | 急躁、伶俐 | 迟缓、苍老、醉 |

关键在于 pitch 和 formant **必须分开调**。只把 pitch 拉高会得到花栗鼠电音，
因为真实的小孩不只是音高高，声道也短。两个一起按不同比例动，才有「换了个人」
的感觉。这就是为什么需要 rubberband——它能在移动音高时保住共振峰位置。

`tone` 是附加滤镜，做质感（细/粗/苍老/沙哑/鼻音/空间/播音）。定义在
`src/presets.ts` 的 `TONE` 里，改数值即时生效，不用改别的。

## 接进解说管线

`render()` 是给别的脚本调的入口：

```ts
import { render } from "./src/render";
import { byId } from "./src/presets";

const p = byId("narrator")!;
const r = await render({
  text: "第一句解说词。",
  voice: p.base,
  params: p,
  prosody: p.prosody,
  outName: "line-001",
});
// r.file     out/line-001.wav
// r.duration 精确时长（秒）→ 直接回填 storyboard.json 的 start
```

多角色对话就是按行循环：每行选一个预设，逐行渲染，把返回的 duration 累加成
时间轴。因为每行都是独立 wav，不需要再做静音检测切分——时间戳是算出来的，
不是猜出来的。

## 已知的几个点

- 基础音是 mp3（Edge 接口只给 mp3/opus），头部可能有几毫秒编码静音。
  逐行渲染时这个误差不累积，可以忽略；如果要极精确对齐，在 `tone` 末尾加
  `silenceremove=start_periods=1:start_threshold=-50dB`。
- 所有输出过 `loudnorm` 统一到 -18 LUFS，A/B 试听时不会被音量骗。
  短句上 loudnorm 偶尔会抽，成片渲染建议改成两遍或直接去掉。
- 基础人声按（文本 + 音色 + 韵律）缓存在 `.cache/`，改参数重试不会重复调接口。
  清缓存直接删 `.cache/`。
- 极端参数（pitch < 0.6 或 > 1.8）会有金属感，做怪物音可以，做人声别过界。
