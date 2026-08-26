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

  // ── 老马（段子独白线）· 定稿 ──────────────────────────────────────
  //
  // 人设：三十出头自称老马，不愤怒、累到平静，全程陈述句，不表演。
  // 判据只有一个：**像「讲」不像「念」。**
  //
  // 参数是**在音色实验室的地图上拖出来的**（voice-clone，`npm run lab`），不是算出来的。
  // **pitch 和 formant 同幅（1.20 / 1.20）**，跟治愈线「夜读」的 0.83/0.83 是同一个手法、
  // 反方向：等比移动＝整个人变小，而不是「捏着嗓子往高了说」。
  // 不挂 tone —— 地图上只有三个旋钮，试听时听到的就是不带音染的样子，抄回来不该偷偷加一层。
  //
  // ── 落选的五条，别再走一遍 ──
  //
  // 先拿落点句实测了三个可用的中文男声（云夏是童声，不算）：
  //
  //   音色    净语速     F0 均值   F0 范围   性质
  //   云希    282 字/分   184Hz    166Hz    对话向，最平
  //   云健    266 字/分   137Hz    216Hz    体育解说底，自带推进感
  //   云扬    293 字/分   130Hz    246Hz    新闻播报底
  //
  //   云扬        直接出局。说书线为同一件事换过一次音色：「云扬是微软的新闻播报音色，
  //               设计目标就是平稳、可信、不带个人色彩 —— 那几乎就是机械的定义」。
  //               它 246Hz 的 F0 范围不是「有感情」，是播报腔的抑扬顿挫。
  //   云希本色    1.00/1.00，F0 164Hz。像三十岁男人，但太本色，没有识别度
  //   云希压低    0.93/0.95，153Hz。往「累」上挪了半档，再压就是大叔
  //   云健本色    0.97/0.97，115Hz。偏大叔；他一低沉，自嘲就变成倚老卖老
  //   云健细声    1.18/1.16 ＋ thin，138Hz
  //   云健尖档    1.28/1.24 ＋ thin，150Hz。pitch 顶着 1.30 上限，这条路的天花板
  //
  // **丁戊落选的原因不是不够细，是不够平。** 它们从云健拉上去，
  // 云健自带解说腔的起伏（F0 范围 239/272Hz），抬高之后那份起伏跟着放大，
  // 听感是「一个人一本正经地急」—— 像在演。定稿这条从云希拉，
  // 抬完 F0 188Hz 全组最高，标准差还是 6Hz 跟本色一样：**又高又平**，
  // 细嗓子说 deadpan 要的正是这个。
  老马: {
    base: 'zh-CN-YunxiNeural',
    rate: '-6%',
    morph: { pitch: 1.2, formant: 1.2, tempo: 1 },
    note: '段子独白线主讲。云希等比上移 1.20/1.20，不加音染。全季一条，不为单条新开',
  },

  /**
   * **老牛**（长片 001 起）。云健，比 `大块头` 再低一档、再慢两档。
   *
   * ── 为什么新增而不是直接用 `大块头` ──
   *
   * `大块头`（0.86/0.84，-8%）是段子线的捧哏，改它等于改已出片的那几条
   * （音色库纪律：**共享预设只读，要变化就新增**）。老牛要的是另一个东西：
   * **不是壮，是慢**。
   *
   * ── 真正拉开两个人的不是音高，是语速 ──
   *
   * 双音色方案里最要紧的一句：老马碎、快、有语气词；老牛慢、短、几乎不带语气词。
   * **就算把音高差别全去掉，光靠这两样也能听出是两个人。**
   * 所以 rate 给到 -15%（老马是 -6%）—— 比老马慢两档，不是一档。
   *
   * ⚠ **云健的底子是体育解说，一定要压。** 方案给的解法是 SSML
   * `style="narration-relaxed" styledegree="0.5"`，**这条做不到** ——
   * 这条链走 `msedge-tts` 的 `toStream(text, {rate, pitch})`，
   * 它只接 rate/pitch 两个参数，进不去 `mstts:express-as`；
   * 而且 Edge 那个免费端点对 SSML 一向挑（`<break>` 就是一律被拒的）。
   * 所以解说腔只能靠**语速 ＋ 变声 ＋ 音染**压。**先听「那你现在知道了」那一句** ——
   * 带出解说腔的话，下一步是再降 rate，不是加 style。
   *
   * ⚠ **`lowpass=f=9000` 是方案里那条「6–9 kHz 削 2 dB」的落点** ——
   * 目的是让老牛闷一点、坐得更实。`TONE.thick` 自带这一条，不另加。
   *
   * ⚠ **共振峰 0.80 要试听验证**（方案 §七之二）：pitch 和共振峰同时压低，
   * 在**手机外放**上容易发闷、糊字，耳机上听不出来。0.88 那一版不进这张表 ——
   * 它是稿件里角色级的 `morph` 覆盖（A/B 用完就删，别在共享库里留一个半成品）。
   */
  老牛: {
    base: 'zh-CN-YunjianNeural',
    rate: '-15%',
    morph: { pitch: 0.8, formant: 0.8, tempo: 1, tone: [...TONE.thick] },
    note: '长片里的老牛。云健压到 0.80/0.80、-15%：慢、短、不带语气词，跟老马拉开的是语速不是音高',
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

  // ── 治愈线男主讲。2026-08-26 新增，**不动上面那条女声「夜读」** ──
  //
  // 设计意图一句话：**说书那套是推出来的，这一套是收回去的。**
  //
  //          说书·说书人          夜读男
  //   rate      +19%              −10%      ← **差 29 个百分点，最大的分辨点**
  //   pitch     0.92              0.97      ← 几乎不动
  //   formant   0.94              0.98
  //   低频      f=240 g=+1.5      f=200 g=+0.8   ← 少一半
  //   中高      —                 f=3200 g=−2.5  ← 削刺耳
  //   齿音      —                 f=7000 g=−3
  //   压缩      1.6:1             1.2:1 阈值提高  ← 基本不压
  //   房间感    干                aecho 极轻
  //
  // **一个在赶，一个在拖，听三句就知道不是同一档节目。**
  //
  // ⚠ **pitch 故意不压低。** 直觉是「治愈就该更低沉」，但云健压太低会发闷、糊字，
  // 而且跟说书那版 0.92 反而更近 —— **都往低走就撞在一起**。
  // 保持接近原声、靠 EQ 削亮度做柔，比压音高好。
  //
  // ⚠⚠ **style 这一条做不到，而且是这套参数里最要紧的那条。**
  //
  // 设计给的是 `mstts:express-as style="narration-relaxed" styledegree="0.4"`，
  // 用来压云健自带的体育解说底子。2026-08-26 **实测过，不是照抄旧结论**：
  // 走 `msedge-tts` 的 `rawToStream`（它收任意 SSML）发出去 ——
  //
  //   纯文本                ✓ 43488 字节
  //   <prosody rate="-10%"> ✓ 48096 字节（−10% 确实变长了）
  //   <break time="800ms">  ✗ 连接被掐，0 字节
  //   <emphasis>            ✗ 同上
  //   **mstts:express-as**  ✗ **同上。四个 style 全试（含瞎编的），一个都不通**
  //
  // 顺带纠一条旧记录：仓库里写着「Edge 拒绝一切标签」，**不准确** ——
  // `<prosody>` 是通的（管线本来就在用），被拒的是 break / emphasis / express-as。
  //
  // **所以解说腔只能靠 rate 压。** 出过两档 demo（−10% / −16%）对着听，
  // **定的是 −16%** —— style 本来要干的活，让语速顶上。输的那条已经删掉：
  // **A/B 用完就删，别在共享库里留半成品。**
  夜读男: {
    base: 'zh-CN-YunjianNeural',
    // **−16% 是试听定的**（2026-08-26，四条 A/B）。设计给的是 −10%，
    // 可 style 压不了云健的解说腔（见上面那段 ⚠），差的那份让语速顶上。
    // 实测 291 字/分，说书人 363 —— **差 20%，听三句就知道不是同一档节目**。
    rate: '-16%',
    morph: {
      pitch: 0.97,
      formant: 0.98,
      tempo: 1,
      tone: [
        // 低频托底。**只给说书那条的一半** —— 这一档不要"沉稳可信"，要"没有重量"
        'equalizer=f=200:t=q:w=1.0:g=0.8',
        // 削刺耳。3.2k 是齿擦和"精神头"聚的地方，压下去就柔了
        'equalizer=f=3200:t=q:w=1.2:g=-2.5',
        // 削齿音。7k 那一档在耳机上最扎，半睡的人尤其受不了
        'equalizer=f=7000:t=q:w=1.5:g=-3',
        // **基本不压**。阈值从说书的 −18 提到 −12，比例 1.6 降到 1.2 ——
        // 压缩把动态抹平会带出"念稿感"，而这一档要的正是有起伏的松弛
        'acompressor=threshold=-12dB:ratio=1.2:attack=25:release=400',
        // 极轻的房间感。22ms 是「同一个屋子里」的早期反射，不是混响。
        //
        // ⚠⚠ **out_gain 必须跟 in_gain 同量级，不能给 0.12。**
        // 设计给的是 `0.92:0.12`，本意是「回声很轻」——
        // 可 **ffmpeg 的 aecho 里 out_gain 缩放的是整条输出，不只是回声**，
        // 0.12 就等于把整个人声压掉 18.4 dB。
        //
        // 2026-08-26 实测（同一条输入，逐个滤镜单跑）：
        //   原样 −19.0 dB ／ 只 EQ −18.6 ／ 只压缩 −19.2 ／ **只 aecho −38.2**
        // 三个滤镜里另外两个各动零点几，全是这一个干的。
        //
        // **后果不是截断，是句尾掉进底噪。** 整期垫的是 −62 dBFS 粉噪，
        // 人声降 19 dB 之后信噪比从 36 dB 掉到 17 dB，本来就轻的收音沉进噪声里 ——
        // **听起来就是「上句没读完就接了下句」**，而波形上一个字都没少。
        // 这是「报成功的失败」那一类：文件时长对、manifest 对、拼接对，就是听着不对。
        //
        // 现在 `0.9:0.9` 只掉 1.9 dB，回声那点量靠 decay 0.03 控制（衰减到 3%）。
        'aecho=0.9:0.9:22:0.03',
      ],
    },
    note: '治愈线男主讲。云健收回去：慢（−16%，试听定的）、不压音高、削亮度、几乎不压缩、一点点房间感',
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
  // ── E05 新增。《婴宁》的主角从头笑到尾，艳鬼撑不住这个角色 ──
  //
  // 艳鬼是"十六七岁的美人相"，慢而清亮（rate −2%）。婴宁不是美人相，是**没长成的**：
  // 卡片写 +4 半音 / 语速 +12%，意思是她说话像个还没学会看场合的小姑娘。
  // 拿艳鬼硬调不行 —— 共享预设只读（见 cast-check.ts 的规矩②），所以新增一条。
  //
  // 跟艳鬼同底（Xiaoyi）是知情的选择：中文女声实际只有两个（晓晓/晓伊），
  // 而这一期要三个女角色（婴宁 / 王母 / 鬼母）。分法是**一个底子各占一头**：
  //   婴宁 = 晓伊，抬高 + 加快（1.16 / 1.17 / +12%）
  //   王母 = 妇人（晓晓，rate −4%，不动音高）
  //   鬼母 = 老太太（晓晓，rate −10% + aged 颤抖）
  // 两个晓晓靠"平稳 vs 颤抖 + 语速差 6%"分，婴宁在另一个底子上，离得最远。
  //
  // 不给她做"笑声"音效。**笑要写在文本里**（"她说着说着又笑了"由说书人交代），
  // TTS 合成的笑声一律是假的 —— 这跟"恐怖不靠变调"是同一条理由。
  笑娘: {
    base: 'zh-CN-XiaoyiNeural',
    rate: '+12%',
    morph: { pitch: 1.16, formant: 1.17, tempo: 1, tone: [...TONE.bright] },
    note: '爱笑的少女（婴宁）。比艳鬼再小几岁、快一档：不是美人相，是没学会看场合',
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
