/**
 * 音色配置表
 *
 * 三个核心参数（其余都是修饰）：
 *   pitch   音高倍率。1.0 不变，>1 变高。决定"性别感 / 年龄感"。
 *   formant 共振峰倍率。1.0 不变，>1 声道变短（听着体型小），<1 体型大。
 *           这个参数是关键：只调 pitch 会变成花栗鼠电音，
 *           pitch 和 formant 分开调才有"换了个人"的感觉。
 *   tempo   语速倍率。1.0 不变。
 *
 * tone 是附加的 ffmpeg 音频滤镜，做质感（厚薄、沙哑、鼻音、颤抖…）。
 */

export type Preset = {
  id: string;
  name: string;
  group: string;
  /** 建议的基础音色（可在界面里换）*/
  base: string;
  pitch: number;
  formant: number;
  tempo: number;
  /** 附加 ffmpeg 滤镜 */
  tone?: string[];
  /** msedge-tts 侧的 SSML 韵律（在变声之前生效）*/
  prosody?: { rate?: string; pitch?: string };
  note: string;
};

/** 常用基础音色。完整清单跑 `npm run voices` 现拉。 */
export const BASE_VOICES = [
  { id: "zh-CN-XiaoxiaoNeural", label: "晓晓 · 女 · 温暖", lang: "中文" },
  { id: "zh-CN-XiaoyiNeural", label: "晓伊 · 女 · 少女", lang: "中文" },
  { id: "zh-CN-YunxiNeural", label: "云希 · 男 · 青年", lang: "中文" },
  { id: "zh-CN-YunxiaNeural", label: "云夏 · 男 · 少年", lang: "中文" },
  { id: "zh-CN-YunjianNeural", label: "云健 · 男 · 浑厚", lang: "中文" },
  { id: "zh-CN-YunyangNeural", label: "云扬 · 男 · 播音", lang: "中文" },
  { id: "zh-CN-liaoning-XiaobeiNeural", label: "晓北 · 女 · 东北", lang: "方言" },
  { id: "zh-CN-shaanxi-XiaoniNeural", label: "晓妮 · 女 · 陕西", lang: "方言" },
  { id: "zh-HK-HiuMaanNeural", label: "曉曼 · 女 · 粤语", lang: "方言" },
  { id: "ja-JP-NanamiNeural", label: "Nanami · 女", lang: "日语" },
  { id: "ja-JP-KeitaNeural", label: "Keita · 男", lang: "日语" },
  { id: "ja-JP-DaichiNeural", label: "Daichi · 男 · 明快", lang: "日语" },
  { id: "ja-JP-ShioriNeural", label: "Shiori · 女 · 柔和", lang: "日语" },
];

/** 质感模块，被下面的预设复用 */
const TONE = {
  /** 细 —— 去胸腔、加齿音亮度 */
  thin: ["highpass=f=170", "treble=g=3.5:f=4200", "equalizer=f=3000:t=q:w=1.4:g=2"],
  /** 粗 —— 加低频、压出胸腔感 */
  thick: ["bass=g=4:f=170", "acompressor=threshold=-18dB:ratio=3:attack=8:release=180", "lowpass=f=9000"],
  /** 老 —— 声带不稳的轻微颤抖 + 高频衰减 */
  aged: ["vibrato=f=5.2:d=0.11", "lowpass=f=7000", "equalizer=f=900:t=q:w=1.2:g=1.5"],
  /** 童 —— 提亮，去掉低频免得像变速带 */
  bright: ["highpass=f=150", "equalizer=f=3400:t=q:w=1.2:g=3"],
  /** 沙哑 —— 轻微谐波失真 */
  raspy: ["aexciter=level_in=1:level_out=1:amount=2.5:blend=1", "equalizer=f=1800:t=q:w=1.8:g=2.5"],
  /** 鼻音 —— 抬 1kHz 压 500Hz */
  nasal: ["equalizer=f=1050:t=q:w=1.1:g=6", "equalizer=f=520:t=q:w=1.0:g=-5", "lowpass=f=6500"],
  /** 空间感 —— 幽灵/回响 */
  ghost: ["aecho=0.8:0.85:220:0.32", "chorus=0.5:0.7:45:0.35:0.28:2"],
  /** 播音 —— 只做规整，不做怪 */
  broadcast: ["equalizer=f=240:t=q:w=1.0:g=1.5", "equalizer=f=6500:t=q:w=1.6:g=-2", "acompressor=threshold=-16dB:ratio=2.5:attack=12:release=220"],
};

export const PRESETS: Preset[] = [
  // ── 年龄 × 粗细 网格 ───────────────────────────────────────
  { id: "child-thin", name: "童声 · 细", group: "年龄 × 粗细", base: "zh-CN-XiaoyiNeural", pitch: 1.40, formant: 1.30, tempo: 1.06, tone: [...TONE.bright, ...TONE.thin], note: "小不点、精灵、宠物角色" },
  { id: "child-mid", name: "童声 · 中", group: "年龄 × 粗细", base: "zh-CN-YunxiaNeural", pitch: 1.32, formant: 1.22, tempo: 1.05, tone: TONE.bright, note: "标准小孩，讲笑话的捧场角色" },
  { id: "child-thick", name: "童声 · 粗", group: "年龄 × 粗细", base: "zh-CN-YunxiaNeural", pitch: 1.24, formant: 1.12, tempo: 1.02, tone: [...TONE.bright, "bass=g=2:f=200"], note: "胖小孩、憨憨的小反派" },

  { id: "teen-thin", name: "少年 · 细", group: "年龄 × 粗细", base: "zh-CN-XiaoyiNeural", pitch: 1.20, formant: 1.16, tempo: 1.04, tone: TONE.thin, note: "青涩、瘦高、话多" },
  { id: "teen-mid", name: "少年 · 中", group: "年龄 × 粗细", base: "zh-CN-YunxiaNeural", pitch: 1.14, formant: 1.10, tempo: 1.02, note: "干净的少年主角" },
  { id: "teen-thick", name: "少年 · 粗", group: "年龄 × 粗细", base: "zh-CN-YunxiNeural", pitch: 1.08, formant: 1.02, tempo: 1.00, tone: TONE.thick, note: "刚变声的壮少年" },

  { id: "young-thin", name: "青年 · 细", group: "年龄 × 粗细", base: "zh-CN-XiaoxiaoNeural", pitch: 1.08, formant: 1.08, tempo: 1.02, tone: TONE.thin, note: "轻快、伶俐" },
  { id: "young-mid", name: "青年 · 中", group: "年龄 × 粗细", base: "zh-CN-YunxiNeural", pitch: 1.00, formant: 1.00, tempo: 1.00, note: "基准音色，什么都没动" },
  { id: "young-thick", name: "青年 · 粗", group: "年龄 × 粗细", base: "zh-CN-YunjianNeural", pitch: 0.94, formant: 0.94, tempo: 0.99, tone: TONE.thick, note: "结实、可靠" },

  { id: "middle-thin", name: "中年 · 细", group: "年龄 × 粗细", base: "zh-CN-XiaoxiaoNeural", pitch: 0.98, formant: 0.97, tempo: 0.98, tone: [...TONE.thin, "lowpass=f=8500"], note: "精明、算计型" },
  { id: "middle-mid", name: "中年 · 中", group: "年龄 × 粗细", base: "zh-CN-YunyangNeural", pitch: 0.93, formant: 0.94, tempo: 0.97, note: "标准中年男，稳" },
  { id: "middle-thick", name: "中年 · 粗", group: "年龄 × 粗细", base: "zh-CN-YunjianNeural", pitch: 0.87, formant: 0.88, tempo: 0.96, tone: TONE.thick, note: "老板、掌柜、大块头" },

  { id: "old-thin", name: "老年 · 细", group: "年龄 × 粗细", base: "zh-CN-XiaoxiaoNeural", pitch: 0.95, formant: 1.02, tempo: 0.92, tone: [...TONE.aged, "highpass=f=180"], note: "干瘦老太、老学究" },
  { id: "old-mid", name: "老年 · 中", group: "年龄 × 粗细", base: "zh-CN-YunyangNeural", pitch: 0.88, formant: 0.93, tempo: 0.91, tone: TONE.aged, note: "标准老爷爷" },
  { id: "old-thick", name: "老年 · 粗", group: "年龄 × 粗细", base: "zh-CN-YunjianNeural", pitch: 0.82, formant: 0.86, tempo: 0.89, tone: [...TONE.aged, ...TONE.thick], note: "老族长、村长" },

  // ── 儿童（听得清的日常童声，不是卡通尖音）────────────────
  // 底子只有云夏（少年男声）离小孩最近。三条规矩：
  //   ① 慢下来放在 prosody.rate，不放 tempo —— TTS 侧变速是重新合成，
  //      ffmpeg 侧是拉伸，长句上后者会糊。
  //   ② pitch 抬得比 formant 多一点点就够，比例失衡立刻变花栗鼠。
  //   ③ pitch 别过 1.30，过了辅音会碎，正是"听不清在说什么"的来源。
  { id: "kid-calm", name: "儿童 · 平稳", group: "儿童", base: "zh-CN-YunxiaNeural", pitch: 1.12, formant: 1.10, tempo: 1.00, tone: TONE.bright, prosody: { rate: "-12%" }, note: "十来岁，念解说词用这个，字最清楚" },
  { id: "kid-natural", name: "儿童 · 自然", group: "儿童", base: "zh-CN-YunxiaNeural", pitch: 1.18, formant: 1.14, tempo: 1.00, tone: TONE.bright, prosody: { rate: "-8%" }, note: "七八岁，日常对话的默认童声" },
  { id: "kid-little", name: "儿童 · 年幼", group: "儿童", base: "zh-CN-YunxiaNeural", pitch: 1.26, formant: 1.20, tempo: 1.00, tone: TONE.bright, prosody: { rate: "-10%" }, note: "五六岁，再高就开始失真了" },
  { id: "kid-girl", name: "女童", group: "儿童", base: "zh-CN-XiaoyiNeural", pitch: 1.14, formant: 1.16, tempo: 1.00, tone: [...TONE.bright, ...TONE.thin], prosody: { rate: "-10%" }, note: "晓伊打底，formant 抬得比 pitch 多才像小女孩不像女声" },


  // ── 老马（段子独白线）· 候选，未定稿 ─────────────────────────
  //
  // 判据只有一个：**像「讲」不像「念」**。所以云扬（播音底）不在候选里 ——
  // 它的 F0 范围最宽（246Hz），那不是有感情，是播报腔的抑扬顿挫。
  //
  // 甲乙丙是一条路（找三十出头男的本色），丁戊是另一条路（做一个不像本色的
  // 细嗓子，靠反差当识别点）。**不是同一条线上的深浅，要整条选。**
  // 参数与 joke-video/src/cast.ts 的「老马甲…戊」一一对应，调完抄回去。
  { id: "laoma-a", name: "老马甲 · 云希本色", group: "老马候选", base: "zh-CN-YunxiNeural", pitch: 1.00, formant: 1.00, tempo: 1.00, prosody: { rate: "-6%" }, note: "不变声。F0 最平（sd 6Hz），没有 rubberband 痕迹" },
  { id: "laoma-b", name: "老马乙 · 云希压低", group: "老马候选", base: "zh-CN-YunxiNeural", pitch: 0.93, formant: 0.95, tempo: 1.00, prosody: { rate: "-6%" }, note: "往「累」上挪半档，169→159Hz。再压就是大叔了" },
  { id: "laoma-c", name: "老马丙 · 云健本色", group: "老马候选", base: "zh-CN-YunjianNeural", pitch: 0.97, formant: 0.97, tempo: 1.00, prosody: { rate: "-4%" }, note: "解说底，自带推进感。116Hz，偏大叔" },
  { id: "laoma-d", name: "老马丁 · 云健细声", group: "老马候选", base: "zh-CN-YunjianNeural", pitch: 1.18, formant: 1.16, tempo: 1.00, tone: TONE.thin, prosody: { rate: "-4%" }, note: "克制档。还听得出是成年人，只是嗓子细" },
  { id: "laoma-e", name: "老马戊 · 云健尖档", group: "老马候选", base: "zh-CN-YunjianNeural", pitch: 1.28, formant: 1.24, tempo: 1.00, tone: [...TONE.thin, "highpass=f=200"], prosody: { rate: "-4%" }, note: "顶着 1.30 上限，这条路的天花板。再高辅音碎" },
  { id: "laoma-f", name: "老马己 · 云希青年", group: "老马候选", base: "zh-CN-YunxiNeural", pitch: 1.20, formant: 1.20, tempo: 1.00, prosody: { rate: "-6%" }, note: "地图上拖出来的：从乙往右上到 1.20/1.20 等比。高而平 —— F0 188Hz 是全组最高，但标准差 6Hz 跟本色一样" },

  // ── 特色角色 ─────────────────────────────────────────────
  { id: "sprite", name: "尖细精灵", group: "特色角色", base: "zh-CN-XiaoyiNeural", pitch: 1.60, formant: 1.42, tempo: 1.12, tone: [...TONE.bright, "highpass=f=220", "treble=g=4:f=5000"], note: "极限高音，做旁白吐槽的小声音" },
  { id: "burly", name: "憨厚大块头", group: "特色角色", base: "zh-CN-YunjianNeural", pitch: 0.80, formant: 0.80, tempo: 0.90, tone: [...TONE.thick, "asubboost=dry=0.9:wet=0.4"], note: "笨重、慢半拍，适合捧哏" },
  { id: "giant", name: "巨人", group: "特色角色", base: "zh-CN-YunjianNeural", pitch: 0.62, formant: 0.68, tempo: 0.86, tone: ["asubboost=dry=0.9:wet=0.7", "lowpass=f=5500", "aecho=0.8:0.9:120:0.2"], note: "压迫感，别用长句" },
  { id: "raspy-old", name: "沙哑老头", group: "特色角色", base: "zh-CN-YunyangNeural", pitch: 0.85, formant: 0.90, tempo: 0.88, tone: [...TONE.aged, ...TONE.raspy], note: "烟酒嗓，讲古" },
  { id: "villain", name: "反派低语", group: "特色角色", base: "zh-CN-YunjianNeural", pitch: 0.84, formant: 0.90, tempo: 0.92, tone: ["bass=g=5:f=140", "aexciter=amount=1.5", "equalizer=f=3000:t=q:w=1.6:g=-3", "acompressor=threshold=-22dB:ratio=4"], note: "贴耳、阴，配黑屏字幕" },
  { id: "nasal-goof", name: "鼻音搞怪", group: "特色角色", base: "zh-CN-YunxiaNeural", pitch: 1.18, formant: 1.14, tempo: 1.06, tone: TONE.nasal, note: "段子里的倒霉角色" },
  { id: "tsundere", name: "傲娇少女", group: "特色角色", base: "zh-CN-XiaoyiNeural", pitch: 1.28, formant: 1.20, tempo: 1.10, tone: [...TONE.bright, "equalizer=f=2400:t=q:w=1.4:g=2.5"], prosody: { rate: "+8%" }, note: "语速快、音调高，抢话感" },
  { id: "narrator", name: "旁白播音", group: "特色角色", base: "zh-CN-YunyangNeural", pitch: 0.96, formant: 0.96, tempo: 0.98, tone: TONE.broadcast, note: "解说主轨用这个，最不容易听腻" },
  { id: "robot", name: "机械音", group: "特色角色", base: "zh-CN-YunxiNeural", pitch: 0.96, formant: 0.94, tempo: 1.00, tone: ["acrusher=level_in=1:level_out=1:bits=6:mode=log:aa=1", "chorus=0.6:0.9:35:0.4:0.25:2", "highpass=f=200", "lowpass=f=7000"], note: "AI / 系统提示音" },
  { id: "ghost", name: "幽灵回声", group: "特色角色", base: "zh-CN-XiaoxiaoNeural", pitch: 0.90, formant: 1.06, tempo: 0.94, tone: [...TONE.ghost, "highpass=f=200"], note: "灵异段子、内心独白" },
  { id: "drunk", name: "醉汉", group: "特色角色", base: "zh-CN-YunjianNeural", pitch: 0.90, formant: 0.92, tempo: 0.84, tone: ["vibrato=f=3.4:d=0.28", "lowpass=f=6800", "bass=g=3:f=180"], prosody: { rate: "-12%" }, note: "拖音、含混" },
  { id: "megaphone", name: "广播喇叭", group: "特色角色", base: "zh-CN-YunyangNeural", pitch: 1.02, formant: 1.00, tempo: 1.00, tone: ["highpass=f=500", "lowpass=f=3400", "aexciter=amount=3", "acompressor=threshold=-14dB:ratio=6", "volume=1.4"], note: "车站/商店街广播、通知音" },
];

/** 界面上可自由勾选的质感模块 */
export const TONE_MODULES = [
  { id: "thin", label: "细", filters: TONE.thin },
  { id: "thick", label: "粗", filters: TONE.thick },
  { id: "bright", label: "亮", filters: TONE.bright },
  { id: "aged", label: "苍老", filters: TONE.aged },
  { id: "raspy", label: "沙哑", filters: TONE.raspy },
  { id: "nasal", label: "鼻音", filters: TONE.nasal },
  { id: "ghost", label: "空间", filters: TONE.ghost },
  { id: "broadcast", label: "播音", filters: TONE.broadcast },
];

export const GROUPS = Array.from(new Set(PRESETS.map((p) => p.group)));
export const byId = (id: string) => PRESETS.find((p) => p.id === id);
