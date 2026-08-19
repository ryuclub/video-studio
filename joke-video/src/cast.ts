// ── 选角表：角色音色 = 基础音色 + SSML 韵律 + 变声参数 ─────────────────
//
// 对话类段子的成败在"观众能不能分清谁在说话"。所以音色不该是一堆散参数，
// 应该是一个"选角"动作：json 里写 "cast": "老爷爷"，就该出来一个老爷爷。
//
// 分工原则（踩过的坑）：
//   · 语速慢/快 → 走 SSML 的 rate，让 Edge 重新合成
//   · 音高、体型 → 走变声的 pitch / formant
//   · morph.tempo 基本不用，那是波形拉伸，长句会糊；只在要"拖腔"时小幅动
//
// pitch 上限压在 1.30（"精灵"是故意越界的卡通音）。超过这条线辅音开始碎，
// 表现就是"音调是上去了，但字听不清"。

import { TONE, type MorphParams } from './audio/morph.js';

export interface Cast {
  /** Edge 基础音色 ShortName */
  base: string;
  /** SSML 韵律，变声之前生效 */
  rate?: string;
  pitch?: string;
  /** 变声参数 */
  morph: MorphParams;
  note: string;
}

/** 不变声、不改韵律 */
const FLAT: MorphParams = { pitch: 1, formant: 1, tempo: 1 };

export const CASTS: Record<string, Cast> = {
  // ── 小孩：Edge 的中文童声已下架，只能拿云夏（少年男声）变上去 ──
  童声: {
    base: 'zh-CN-YunxiaNeural',
    rate: '-8%',
    morph: { pitch: 1.18, formant: 1.14, tempo: 1, tone: [...TONE.bright] },
    note: '七八岁，对话类小孩角色的默认',
  },
  童声奶: {
    base: 'zh-CN-YunxiaNeural',
    rate: '-10%',
    morph: { pitch: 1.26, formant: 1.2, tempo: 1, tone: [...TONE.bright] },
    note: '五六岁，再高就开始失真',
  },
  女童: {
    base: 'zh-CN-XiaoyiNeural',
    rate: '-10%',
    morph: { pitch: 1.14, formant: 1.16, tempo: 1, tone: [...TONE.bright, ...TONE.thin] },
    note: '小女孩。formant 抬得比 pitch 多，才像小女孩不像女声',
  },

  // ── 少年少女 ──
  少年: {
    base: 'zh-CN-YunxiaNeural',
    rate: '-4%',
    morph: { pitch: 1.06, formant: 1.05, tempo: 1 },
    note: '十几岁男孩，云夏的原始年龄段',
  },
  少女: {
    base: 'zh-CN-XiaoyiNeural',
    rate: '-4%',
    morph: { pitch: 1.04, formant: 1.06, tempo: 1 },
    note: '活泼女孩',
  },

  // ── 成年 ──
  青年男: { base: 'zh-CN-YunxiNeural', morph: FLAT, note: '成年男，基准音色' },
  青年女: { base: 'zh-CN-XiaoxiaoNeural', morph: FLAT, note: '成年女，基准音色' },
  干练女: {
    base: 'zh-CN-XiaoxiaoNeural',
    rate: '+6%',
    morph: { pitch: 1.02, formant: 1.03, tempo: 1, tone: [...TONE.thin] },
    note: '语速快、利落，适合职场段子',
  },
  大叔: {
    base: 'zh-CN-YunyangNeural',
    rate: '-4%',
    morph: { pitch: 0.93, formant: 0.94, tempo: 1 },
    note: '中年男，稳',
  },
  大块头: {
    base: 'zh-CN-YunjianNeural',
    rate: '-8%',
    morph: { pitch: 0.86, formant: 0.84, tempo: 0.96, tone: [...TONE.thick] },
    note: '憨厚壮汉，慢半拍，捧哏用',
  },

  // ── 老人 ──
  老爷爷: {
    base: 'zh-CN-YunyangNeural',
    rate: '-10%',
    morph: { pitch: 0.88, formant: 0.93, tempo: 1, tone: [...TONE.aged] },
    note: '标准老爷爷',
  },
  老太太: {
    base: 'zh-CN-XiaoxiaoNeural',
    rate: '-10%',
    morph: { pitch: 0.95, formant: 1.02, tempo: 1, tone: [...TONE.aged, 'highpass=f=180'] },
    note: '老太太。pitch 几乎不动，苍老感全靠 aged 的颤抖',
  },
  沙哑老头: {
    base: 'zh-CN-YunyangNeural',
    rate: '-12%',
    morph: { pitch: 0.85, formant: 0.9, tempo: 1, tone: [...TONE.aged, ...TONE.raspy] },
    note: '烟酒嗓，讲古',
  },

  // ── 特色 ──
  精灵: {
    base: 'zh-CN-XiaoyiNeural',
    rate: '-6%',
    morph: { pitch: 1.5, formant: 1.38, tempo: 1, tone: [...TONE.bright, 'highpass=f=220'] },
    note: '故意越界的卡通尖音。只给短句用，长句听不清',
  },
  鼻音怪: {
    base: 'zh-CN-YunxiaNeural',
    rate: '-4%',
    morph: { pitch: 1.16, formant: 1.12, tempo: 1, tone: [...TONE.nasal] },
    note: '段子里的倒霉角色',
  },
  反派: {
    base: 'zh-CN-YunjianNeural',
    rate: '-8%',
    morph: {
      pitch: 0.84,
      formant: 0.9,
      tempo: 1,
      tone: ['bass=g=5:f=140', 'equalizer=f=3000:t=q:w=1.6:g=-3', 'acompressor=threshold=-22dB:ratio=4'],
    },
    note: '贴耳、阴',
  },
  旁白: {
    base: 'zh-CN-YunyangNeural',
    rate: '-4%',
    morph: { pitch: 0.96, formant: 0.96, tempo: 1, tone: [...TONE.broadcast] },
    note: '旁白/解说，最不容易听腻',
  },
  东北女: { base: 'zh-CN-liaoning-XiaobeiNeural', morph: FLAT, note: '方言梗' },
  陕西女: { base: 'zh-CN-shaanxi-XiaoniNeural', morph: FLAT, note: '方言梗' },
  台湾女: { base: 'zh-TW-HsiaoChenNeural', morph: FLAT, note: '台湾腔' },
  日语女: { base: 'ja-JP-NanamiNeural', morph: FLAT, note: '日语段子' },
  日语男: { base: 'ja-JP-KeitaNeural', morph: FLAT, note: '日语段子' },








  // ── 治愈线主讲：定稿（P1）────────────────────────────────────────
  //
  // pitch / formant 是**人在音色实验室的地图上拖出来的**（voice-clone，
  // `npm run lab`），不是算出来的。0.83 / 0.83 等比下移约 3.2 个半音 ——
  // pitch 和 formant 同幅下降 = 整个人"变大"，而不是"捏着嗓子往低了说"。
  //
  // **朗读速度不动（没有 rate）。** 这是听了三档之后选的：
  //   P1 rate 0% + 句间 1.1s → 整期 225 字/分　← 选的这条
  //   P2 rate 0% + 句间 2.0s → 整期 189 字/分
  //   P3 rate −20% + 句间 1.1s → 整期 190 字/分
  //
  // ⚠ **整期均速 225 字/分，高于选题稿件写的助眠档 180–200。**
  // 那组数是稿件作者的估值，这里以实际听感为准（拉长每个字会放大 TTS 的
  // 合成痕迹 —— 第一版 rate −38% 六条全废就是这个原因）。
  // **代价是字数配额要按 225 重算**，比稿件里的 8500–11400 多约两成。
  //
  // 走过的弯路，记着别重犯：
  //   · 只压 pitch 不压 formant → 年轻姑娘捏嗓子
  //   · rate −38% → 每个字都被拉长。那个数是把稿件的「190 字/分」当成
  //     说话速度算的，但它是**整期含停顿的均速**，用来换算字数配额的
  //   · aecho 12ms → 那是梳状滤波不是房间反射，已去掉
  // **0.83 是共振峰的底，别再往下调。** 试过 formant 0.79（同样 202Hz、
  // 数字上更"厚"），听感是带回响 —— rubberband 拉得越狠痕迹越明显，
  // 说书线记过同一条。同理也别再降 pitch：0.7834 那一版（190Hz）听着偏沉。
  //
  // 所以《方丈记》那条「这一期要更低」的规则**不落在音色上**，
  // 只落在停顿上（句间 1.1 → 1.25s）。全季共用这一条音色，
  // 期与期的差别写在各期的稿件配置里，不要为单期新开音色。
  夜读: {
    base: 'zh-CN-XiaoxiaoNeural',
    morph: { pitch: 0.83, formant: 0.83, tempo: 1 },
    note: '治愈线主讲。全季唯一一条，音色地图拖出来的点，朗读速度不动',
  },
  // ── 说书（聊斋）：角色原型，17 期通用 ──────────────────────────────
  //
  // 设计原则跟段子类不同：**先用不同的基础音色拉开距离，morph 只做微调**。
  //
  // 稿件卡片给的是单旋钮半音（男主 −2、女主 +3、老者 −4…），那套模型假设
  // 所有角色共用一个基础音色。我们有 11 个基础音色可选，用基础音色分人
  // 比硬拉 pitch 好得多——morph 拉得越狠，rubberband 的金属味越明显，
  // 而说书是十几分钟连着听，一点点artifact 都会被放大。
  //
  // 半音换算：ratio = 2^(n/12)。−2 半音 = 0.891，−4 = 0.794，+3 = 1.189。
  // ── 定稿于 E01 前三幕试听之后。上一版是云扬 −6%，反馈是「太机械、偏慢」──
  //
  // **换掉云扬是这一版的核心。** 云扬是微软的新闻播报音色，设计目标就是
  // 「平稳、可信、不带个人色彩」——那几乎就是机械的定义。而上一版的 morph 是
  // 0.97/0.97，**几乎等于原声**，播音腔一点没被改掉。
  // 角色好听不是偶然：晓晓、晓伊、云希都是**对话向**音色。
  //
  // 云健是体育解说底子，自带推进感和句间起伏，是 Edge 中文这 8 个音色里
  // 最像「讲」不像「念」的一个。压到 pitch 0.92 / formant 0.94 做成沉稳中年，
  // 解说腔的亢奋去掉，推进感留着。
  //
  // rate +19% 不是拍脑袋：云健在同一个 rate 设定下**比云扬天生慢 13%**
  // （实测 +6% 时 239 字/分，云扬同设定 276）。补上这 13% 再加上要提的速，
  // 才落到 272 字/分——跟你认可的角色语速（书生 258 / 艳鬼 240）在一条线上。
  // 上一版实测只有 230，全场最慢。
  //
  // 跟乞丐同底（都是云健）是**知情的选择**：Edge 中文男声实际可用只有 3 个
  // （云扬/云希/云健，云夏是童声），而男角色有 4 个。乞丐全片 3 段、
  // pitch 1.06 提亮加脏 +10% 语速，跟这个沉稳低音分得开。
  说书人: {
    base: 'zh-CN-YunjianNeural',
    rate: '+19%',
    morph: {
      pitch: 0.92,
      formant: 0.94,
      tempo: 1,
      // 不用 TONE.broadcast —— 那里面 2.5:1 的压缩器会把节拍表用 gain 做的
      // 0.70–1.08 音量起伏按平一部分。这里只留低频托底和很轻的 1.6:1。
      tone: ['equalizer=f=240:t=q:w=1.0:g=1.5', 'acompressor=threshold=-18dB:ratio=1.6:attack=15:release=250'],
    },
    note: '说书叙述基准。云健压成沉稳中年男，保留推进感，十几分钟不发闷',
  },
  // ── E01 v2 新增。《画皮》补回道士捉鬼那一整幕之后，王生的弟弟二郎有了戏份 ──
  //
  // **难点是没有音色可分了。** Edge 中文男声实际可用只有三个（云扬/云希/云健，
  // 云夏是童声），而男角色已经有四个。二郎只能跟老道共用云扬——
  // 偏偏他俩在幕四是**同场一问一答**（「南边那个院子是谁家的」「是我住的」），
  // 这是全片对分离度要求最高的一处。
  //
  // 所以走反方向：老道是**低、慢、苍**（0.86 / 0.91 / −10% / aged），
  // 二郎就做**高、快、亮**（1.04 / 1.03 / +4% / 不加音染）。同一个底子，
  // 拉到两头去。他的戏份本来就是慌慌张张跑回来报信，快和亮是对的。
  二郎: {
    base: 'zh-CN-YunyangNeural',
    rate: '+6%',
    // 调了三轮，都是拿**同一句话**量出来的（换文本量基频会跳倍频，不可比）：
    //   pitch 1.04 → 跟老道差 21Hz，红线 25Hz，没过
    //   pitch 1.10 → 差 22Hz，还是没过（云扬本身在这个区间不太线性）
    //   pitch 1.14 + 推亮 → 见下，两根轴都过
    // **两根轴都留余量**比压着线走稳：一根是音高，一根是明暗（低高频差）。
    // +2.3 半音也还在「±2 能听出区别、±4 开始有加工痕迹」的安全区里。
    morph: {
      pitch: 1.14,
      formant: 1.07,
      tempo: 1,
      tone: ['equalizer=f=3000:t=q:w=1.4:g=5', 'equalizer=f=300:t=q:w=1.0:g=-3'],
    },
    note: '年轻男配（王生的弟弟二郎）。跟老道同底反向拉开：他高快亮，老道低慢苍',
  },
  书生: {
    base: 'zh-CN-YunxiNeural',
    rate: '-2%',
    morph: { pitch: 0.94, formant: 0.96, tempo: 1 },
    note: '年轻男主（王生/宁采臣/成名）。跟说书人换了基础音色，不靠压音高分人',
  },
  妇人: {
    base: 'zh-CN-XiaoxiaoNeural',
    rate: '-4%',
    morph: { pitch: 1.0, formant: 1.03, tempo: 1 },
    note: '成年女性（陈氏）。女声基础音色本身就跟男声分得很开，不需要抬音高',
  },
  艳鬼: {
    base: 'zh-CN-XiaoyiNeural',
    rate: '-2%',
    morph: { pitch: 1.1, formant: 1.13, tempo: 1, tone: [...TONE.bright, ...TONE.thin] },
    note: '女鬼的美人相。要比妇人年轻、清亮，听感上是"十六七岁"',
  },
  厉鬼: {
    base: 'zh-CN-XiaoyiNeural',
    // ── 定稿。曾经有过一版"变形版"（pitch 0.67 + 重低通 + 混响），试听淘汰 ──
    //
    // 淘汰的原因不是音色不好，是**方向错了**："低沉 + 大混响"是卡通怪兽的路子。
    // 回响 = 远，远就不威胁。而《画皮》的题眼是"那个美人就是那个东西"，
    // 鬼音做成通用怪物，这层联系就断了。
    //
    // 现在这版：**她的声音，只是不对劲。**
    //
    // 《画皮》的题眼是"那个美人就是那个东西"。鬼音做成通用怪物，这层联系就断了；
    // 做成"同一个人，语气全变了"，才立得住。
    //
    // 所以音高几乎不动（听得出还是她），全靠三件事做恐怖：
    //   · 慢 —— 它不慌，隔着门冷笑
    //   · 平 —— 没有情绪起伏，人说话不会这样
    //   · 22ms 的梳状回声 —— 一个声音里带出第二个，贴耳不空旷
    //
    // 跟艳鬼分不开是**故意的**，它俩本来就是同一个角色，
    // 分离度检查要把"同角色的不同状态"排除在外。
    rate: '-16%',
    morph: {
      pitch: 0.95,
      formant: 0.97,
      tempo: 1,
      tone: [
        'aecho=0.92:0.35:22:0.45',                 // 22ms = 梳状，听感是"一个人说话带出两个"
        'equalizer=f=3200:t=q:w=1.6:g=-3',
        'equalizer=f=700:t=q:w=1.2:g=2',
        'acompressor=threshold=-20dB:ratio=3.5:attack=6:release=200',  // 压平动态 = 没有情绪
      ],
    },
    note: '女鬼现形。跟艳鬼刻意分不开——同一个角色的两个状态',
  },
  老道: {
    base: 'zh-CN-YunyangNeural',
    rate: '-10%',
    morph: { pitch: 0.86, formant: 0.91, tempo: 0.94, tone: [...TONE.aged] },
    note: '道士/老者。语速压慢，话少但每句有分量',
  },
  乞丐: {
    // 云健本身就比云扬低，照卡片压到 0.82 会跟老道**撞在同一个基频**（实测都是 96Hz）。
    // 反过来想更对：撒泼耍赖的乞丐不该是低沉嗓子，抬上去、加脏、加快，
    // 跟老道那种慢而稳的低音才形成反差。
    base: 'zh-CN-YunjianNeural',
    rate: '+10%',
    // 同样靠第二根轴分开，方向相反：**去掉低频、猛抬高频**。
    // 街上撒泼耍赖的动静本来就是尖利刺耳的，不是浑厚的。
    morph: {
      pitch: 1.06,
      formant: 0.94,
      tempo: 1,
      tone: [...TONE.raspy, 'highpass=f=420', 'treble=g=10:f=3000', 'equalizer=f=2800:t=q:w=1.4:g=6'],
    },
    note: '粗粝角色（乞人/市井）。快、脏、偏亮，跟老道的慢而稳形成反差',
  },
};

export const CAST_NAMES = Object.keys(CASTS);

// ── 念法：同一个角色，这一句怎么念 ──────────────────────────────────
//
// 这是音调把控的第二层。角色音色定的是"谁在说"，念法定的是"这句怎么说"。
// punch 句几乎总要变调——压低、拖长、或者突然抢拍——不然三句话一个调子，
// 包袱抖不响。参数都是相对角色音色的倍率/增量，不是绝对值。

export interface Delivery {
  /** 叠加到角色 rate 上的语速增量，如 "-10%" */
  rate?: string;
  /**
   * 叠加到 SSML 上的音高增量，如 "+15Hz"。**抑扬顿挫走这个。**
   * 它让 Edge 重新合成出不同的语调曲线，只改旋律不改音色身份。
   */
  pitchHz?: string;
  /**
   * 变声的音高倍率。**这个改的是"谁在说"，不是"怎么说"。**
   * 做语气起伏别动它——动了角色会变成另一个人。只在特殊效果时用（捏嗓子学人说话）。
   */
  pitch?: number;
  /** 相对角色音色的共振峰倍率，同上，慎用 */
  formant?: number;
  /** 波形拉伸倍率。SSML rate 解决不了的极端拖腔才用（<0.8 会开始糊） */
  tempo?: number;
}

/**
 * Edge 的 SSML pitch 响应**又不对称、又不连续**。实测扫描（童声，「我问你几点到。」）：
 *
 *     设定     实测      变化
 *    +10Hz    310Hz      +0    ← 死区
 *    +20Hz    314Hz      +4    ← 死区
 *    +30Hz    343Hz     +33    ← 台阶，一下跳上来
 *    +40Hz    340Hz     +30    ← 平台
 *    +50Hz    343Hz     +33    ← 平台
 *    +60Hz    348Hz     +38
 *    +80Hz    372Hz     +62
 *   +100Hz    372Hz     +62    ← 饱和
 *    -20Hz    265Hz     -45
 *    -40Hz    223Hz     -87
 *    -60Hz    187Hz    -123
 *
 * 三条结论：
 *   ① 正方向 **+20Hz 以内等于没写**，+30Hz 才起跳
 *   ② **+30~+50Hz 是同一个平台**，在这区间里调数值没意义，要更高得跳到 +80Hz
 *   ③ 负方向近乎线性且灵敏，**斜率约 2.1×**（设 -20Hz 实际掉 45Hz）
 *
 * 所以下面只用 +30 / +80 / -15 / -20 / -32 这几个档位，别在平台里瞎调。
 */
export const DELIVERIES: Record<string, Delivery> = {
  平: {},
  // ── 旁白专用：**只动语速，pitchHz 一律为 0** ──
  // 旁白全片是同一个人在讲，音高一变就"串音"。而 SSML pitch 的正方向有死区，
  // 做不出轻微上扬，一动就是 +30Hz 起跳。所以旁白的抑扬顿挫只能靠快慢。
  // 数值是叠加在角色 rate 之上的。mouse-cake 旁白挂了 -8%，
  // 所以实际落到 -30% / -18% / -8%。
  // 上一版是 -12% / 0 / +10%（实际 -20% / -8% / +2%），听着还是在念稿。
  叙缓: { rate: '-22%' },
  叙平: { rate: '-10%' },
  叙快: {},
  压低: { rate: '-8%', pitchHz: '-20Hz' },
  拔高: { rate: '+4%', pitchHz: '+80Hz' },
  /** 朝远处喊：抬音高 + 拉长尾音。光抬音高不拉长，听着是说不是喊 */
  喊: { rate: '+2%', pitchHz: '+80Hz', tempo: 0.8 },
  /**
   * 极限拖腔，给"妈——"这种呼唤的头一个字用。
   * 字内拖长整句 tempo 做不到，必须配合 say 分句：头字用这档，尾字用「喊」。
   * tempo 低于 0.4 rubberband 会开始出金属味，别再往下压。
   */
  长音: { rate: '+2%', pitchHz: '+80Hz', tempo: 0.42 },
  疑问: { rate: '-2%', pitchHz: '+30Hz' },
  拖长: { rate: '-14%', pitchHz: '-12Hz' },
  /**
   * 极端拖腔（「龟——来——」那种）。
   * 实测破折号和省略号 Edge 直接吞掉（1.763s → 1.760s，纹丝不动），
   * 句号也只加得了 0.42s。所以只能靠波形拉伸。
   */
  延宕: { rate: '-10%', pitchHz: '-15Hz', tempo: 0.62 },
  急: { rate: '+14%', pitchHz: '+30Hz' },
  弱: { rate: '-6%', pitchHz: '-15Hz' },
  /** 恍然大悟/自曝那一下，punch 最常用 */
  泄气: { rate: '-12%', pitchHz: '-32Hz', tempo: 0.96 },
};

export const DELIVERY_NAMES = Object.keys(DELIVERIES);

/** 百分比字符串相加："-8%" + "-10%" → "-18%" */
export function addPercent(a: string | undefined, b: string | undefined): string | undefined {
  if (!a && !b) return undefined;
  const num = (s?: string) => (s ? Number(String(s).replace('%', '')) || 0 : 0);
  const v = num(a) + num(b);
  return `${v >= 0 ? '+' : ''}${v}%`;
}

/** Hz 字符串相加："+15Hz" + "-8Hz" → "+7Hz" */
export function addHz(a: string | undefined, b: string | undefined): string | undefined {
  if (!a && !b) return undefined;
  const num = (s?: string) => (s ? Number(String(s).replace(/Hz/i, '')) || 0 : 0);
  const v = num(a) + num(b);
  return `${v >= 0 ? '+' : ''}${v}Hz`;
}

export function resolveCast(name: string | undefined, fallback = '青年女'): Cast {
  if (!name) return CASTS[fallback];
  if (CASTS[name]) return CASTS[name];
  // 允许直接写 ShortName，当成不变声的原始音色用
  if (name.includes('-') && name.endsWith('Neural')) {
    return { base: name, morph: FLAT, note: '直接指定的 ShortName' };
  }
  throw new Error(`没有这个角色音色：${name}\n可用：${CAST_NAMES.join(' / ')}\n（也可以直接填 ShortName，如 zh-CN-YunxiNeural）`);
}

export function resolveDelivery(d: string | Delivery | undefined): Delivery {
  if (!d) return {};
  if (typeof d === 'string') {
    const hit = DELIVERIES[d];
    if (!hit) throw new Error(`没有这个念法：${d}\n可用：${DELIVERY_NAMES.join(' / ')}`);
    return hit;
  }
  return d;
}
