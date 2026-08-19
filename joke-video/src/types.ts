// ── 配置与时间轴的类型定义 ──────────────────────────────────────────────

export type Beat = 'setup' | 'ask' | 'reply' | 'punch';

export type Proportion = 'child' | 'adultM' | 'adultF' | 'elder';

export interface LineCfg {
  /** 说这句话的角色 id */
  who: string;
  /** 台词。写了 say 就不用写，会自动从 say 拼出来 */
  text?: string;
  /**
   * 字幕上显示的文本，覆盖 text。**给 TTS 的和给观众看的不总是同一串。**
   *
   * 典型场景：要拖长音时 text 必须写「妈妈！」（不带破折号，Edge 才会一口气念完），
   * 但字幕要显示「妈——妈！」把拖长表现出来。
   */
  subtitle?: string;
  /** 谐音注解，打在台词下方一行小字，如 "（归来）" */
  annotation?: string;
  /** 节拍：setup 铺垫 / ask 提问 / reply 回应 / punch 反转（笑点） */
  beat: Beat;
  /** 这句话之前的留白（秒） */
  padBefore?: number;
  /** 这句话之后的留白（秒） */
  padAfter?: number;
  /**
   * 这一句的音量倍率，默认 1。
   *
   * **说书的一个基本手段：压低嗓子把听众拉近。** 讲到"他趴在窗根底下，
   * 一动不敢动"时音量降下来，听的人会不自觉地凑近；到反转句再放开。
   * 全片一个音量是念稿，不是讲故事。
   *
   * 0.65 左右是"压低"，1.0 是常态，1.15 以上留给真正要放开的地方
   * （再高会顶到混音末尾的 softClip）。
   */
  gain?: number;
  /** 需要变芥黄高亮的关键词（字幕里） */
  highlight?: string;
  /** 由 align 命令回填：实际配音时长（秒） */
  dur?: number;
  /** 由 align 命令回填：去掉首尾静音后的配音文件 */
  audio?: string;
  /** 这一句怎么念：预设名（压低/拖长/泄气…）或直接给参数。punch 句几乎总要变调 */
  delivery?: string | DeliveryCfg;
  /**
   * 分句念法 —— 抑扬顿挫靠这个。
   *
   * 整句一个 delivery 只能做到"句与句之间有起伏"，一句话内部还是平的。
   * 拆成小句逐句给念法，才有真正的语调曲线：
   *
   *   "say": [
   *     { "text": "我没叫你名字，", "delivery": "急" },
   *     { "text": "我问你几点到。", "delivery": "压低" }
   *   ]
   *
   * 每小句单独合成再拼起来，中间留 gap 秒换气（默认 0.12）。
   * 写了 say 就不用写 text，text 会自动拼出来给字幕用。
   */
  say?: { text: string; delivery?: string | DeliveryCfg; gap?: number; holdHead?: number }[];
  /**
   * 把这句**开头一个字**额外拉长（值 = 拉伸倍率，越小越长，0.4 以下会有金属味）。
   *
   * 做「妈~~~妈」这种慢节拍呼唤：整句先按 delivery 放慢喊出来，再单独把头字拖住。
   * **不要用 say 分句来做这个**——分句是两次独立合成、两个音节起头，
   * 听着是"妈…妈"两声，不是一口气里的拖长。
   */
  holdHead?: number;
  /** 只有这一句换音色时才填（少见，比如角色捏着嗓子学别人说话） */
  cast?: string;
  /**
   * 这一镜里出现哪些角色（角色 id）。不写 = 全部都在。
   *
   * 单人镜头交替是对话类很常见的分镜——「镜头1 只有小龟，镜头2 只有龟妈妈」。
   * 只有一个角色在场时会自动放到画面中央，镜头也不再左右摇。
   */
  stage?: string[];
  /**
   * 这一镜的**意图**，会渲进方案.md 的分镜表。
   *
   * 存的是"为什么"，不是"是什么"——"是什么"看 scene/stage 就知道了。
   * 例：「龟妈妈慢悠悠爬过来，慢本身就是包袱的一部分，enterFrom 不要调小」。
   * 早先这类判断依据只存在于聊天记录里，改片子的人看不到，只能瞎猜。
   */
  note?: string;
  /** 这一镜换到别的场景。不写就沿用 cfg.scene */
  scene?: string;
  /** 说这句时从画面哪一侧爬入。从这一镜开始的那一刻起匀速挪进来 */
  enter?: 'left' | 'right';
  /** 爬入起点离站位多远（px），默认 700。调大 = 爬更久，显得更慢 */
  enterFrom?: number;
}

/** 相对角色音色的偏移量，不是绝对值 */
export interface DeliveryCfg {
  rate?: string;
  /** SSML 音高增量，如 "+15Hz"。改语调不改音色，抑扬顿挫用这个 */
  pitchHz?: string;
  /** 变声音高倍率。改的是"谁在说"，做语气起伏别动它 */
  pitch?: number;
  formant?: number;
  tempo?: number;
}

export interface CharacterCfg {
  id: string;
  /** none = 只有声音不出画面，旁白用 */
  rig: 'serpentine' | 'human' | 'turtle' | 'mouse' | 'cat' | 'none' | 'still';
  /** 'primary' | 'secondary' | 'neutral' 或直接给十六进制色 */
  color?: string;
  side: 'left' | 'right';
  /**
   * 显式站位 x（舞台坐标）。不写就按 side 取左右两个机位。
   * **超过两个角色同框时必须给**——不然第三个会跟 side 相同的那个完全重叠。
   */
  x?: number;
  /** 整体缩放，默认人物 1.25 / 长条动物 1.0 */
  scale?: number;

  // ── 配音 ──
  /**
   * 角色音色：选角表里的预设名（童声/老爷爷/大块头…，见 src/cast.ts），
   * 也可以直接填 ShortName（那样就只用原始音色、不变声）。
   * 一个字段同时决定基础音色、语速和变声参数。
   */
  cast?: string;
  /** 在 cast 的语速基础上再叠一档，如 "-6%" */
  rate?: string;
  /** 覆盖 cast 的变声参数，只写要改的那几个 */
  morph?: { pitch?: number; formant?: number; tempo?: number; tone?: string[] };

  // ── serpentine（长条动物：蛇/鱼/虫）/ turtle ──
  length?: number;
  /**
   * still 专用：用素材库里哪张原稿（不带扩展名的 key，如 "rabbit-white"）。
   * 静态形象不能说话，只适合旁白叙述型。
   */
  art?: string;
  /**
   * 形象变体。哪个 rig 认哪些值：
   *   turtle —— kid（小龟，有呆毛）/ mom（龟妈妈，有眉毛皱纹）
   *   cat    —— night（原稿夜猫，默认）/ day（白天的橘猫，同一副剪影换暖色）
   */
  variant?: 'kid' | 'mom' | 'night' | 'day';
  /** turtle 专用：固定的头伸出程度 0..1 */
  neck?: number;
  /**
   * turtle 专用：开口前缩着头，第一句台词前 0.5s 缓缓抬起。
   * 「远处一块灰色的石头缓缓抬起头」这种登场用它，默认关（默认是头伸着的）。
   */
  neckEmerge?: boolean;

  // ── human ──
  proportion?: Proportion;
  hair?: 'short' | 'long' | 'bun' | 'bald' | 'white';
  props?: ('glasses' | 'cane' | 'bag' | 'cap')[];
}

export interface PropCfg {
  /** 在 stage 里引用的名字 */
  id: string;
  /** 用道具库里的哪个画法，见 src/props/index.ts */
  kind: string;
  /** 舞台横坐标，默认画面中央 */
  x?: number;
  /**
   * **相对地面**的纵向偏移，默认 0（贴地）。负数往上抬——摞在别的道具上时用。
   *
   * 早先这里是绝对坐标 y。平地场景看着没问题，一换 hillside 这种斜坡
   * 就全飘在半空或陷进土里：地面在 x=0 处是 1440、x=1080 处是 1110，
   * 写死一个 1285 不可能同时对。
   */
  dy?: number;
  scale?: number;
  /**
   * 摞在哪个道具上（锅摞炉子）。声明了之后：
   * 站位检查把这对重叠当合法，求解器也会让两者共用同一个 x。
   */
  stack?: string;
  /** 水平翻转 */
  flip?: boolean;
}

export interface JokeCfg {
  id: string;
  /**
   * A 对话反转（两角色你来我往，一句 punch 驱动全片）
   * B 旁白叙述（一个旁白讲到底，角色只演不说，没有 punch）
   */
  type: 'A' | 'B';
  /**
   * 平台标题（发布用，不进画面）。
   * 跟 hook 是两回事：hook 是片尾打在画面上的钩子字幕，title 是发布时填的标题。
   * 多数段子两者可以是同一句，但不总是——比如尾字幕是点题金句、标题是个谜面。
   */
  title?: string;
  scene: string;
  characters: CharacterCfg[];
  /**
   * 道具：能摆进画面的物件（蛋、锅、蛋糕…）。
   * **跟角色共用 stage 名单** —— "stage": ["鼠甲", "egg"]，
   * 句间空白归属、镜头切换那套规则自动继承，不用再写一遍。
   */
  props?: PropCfg[];
  lines: LineCfg[];
  /** 结尾钩子字幕 */
  hook?: string;
  /**
   * 系列包装：片头那张固定的卡。
   *
   * 《一页故事》要求每期开头都是「一页故事，第 XX 页」——30 期同一张卡是频道识别。
   * 写死在每条稿件的画面代码里迟早写花（字号、位置、留白各期飘一点），所以做成配置。
   *
   * 卡只叠在 intro 空镜上，**不占额外时长**：想让卡停久一点就把 intro 调大。
   * 系列要求 3 秒，写 `"intro": 3`。
   */
  series?: {
    /** 系列名，片头大字 */
    name: string;
    /** 第几期。渲成「第 01 页」，个位数补零 */
    no: number;
    /** 期号的量词，默认「页」。别的系列可能是「集」「话」 */
    unit?: string;
  };
  /** 定格时长（秒），默认 2 */
  freeze?: number;
  /** 定格后保留钩子的时长（秒），默认 4 */
  hold?: number;
  /**
   * 节奏预设名，见 src/pace.ts。B 类默认 narrate，A 类默认 banter。
   *
   * 睡前故事写 "bedtime" 就够了 —— 语速之外的三层停顿（句内小句 / 句与句 /
   * 换镜）一次配齐，不用再一个个试。
   */
  pace?: string;
  /** 开场空镜时长（秒），默认 2 */
  intro?: number;
  bgm?: { enabled?: boolean; stopAtPunch?: boolean; gain?: number; key?: string };
  /** 环境音：grass / cicada / room / none */
  ambience?: string;
  /** 封面。规则见 封面设计规范-COVER.md */
  cover?: {
    /** 封面大字，4–8 字。不写就从第一句自动推（兜底，上线前建议手写） */
    title?: string;
    /** 右下角系列标签，'none' 关掉 */
    tag?: string;
    /** 情绪符号，'none' 关掉 */
    mark?: string;
    /** 取帧时刻（秒），默认笑点结束 + 0.6s */
    at?: number;
    /** 大字纸片顶边 */
    top?: number;
    /** 覆盖封面推镜。不写则按角色数自适应（多角色拉远，单角色用 1.9 紧景） */
    cam?: { zoom: number; tx: number; ty: number };
    /**
     * 把封面作为视频第一帧。默认 true。
     * 平台多数拿第一帧当缩略图，所以这一帧值钱。
     */
    asFirstFrame?: boolean;
    /**
     * 封面停留秒数，默认 0（只占 1 帧，约 33ms，肉眼看不见）。
     * 设大于 0 会同时把音频整体后移同样时长以保持同步，
     * 但短视频开头每多停一秒完播率就掉一截，非必要别调。
     */
    hold?: number;
  };
  /** 音效点位开关 */
  cues?: {
    /** 每句台词前的小 pop（音高明确，容易腻）。默认 false */
    subtitlePop?: boolean;
    /** 回应句前的木鱼。默认 true */
    replyWood?: boolean;
    /** 开场那声"嘶"。默认 true */
    introHiss?: boolean;
  };
}

// ── 时间轴 ──

export interface Segment {
  kind: 'intro' | 'line' | 'freeze' | 'hold';
  start: number;
  end: number;
  line?: LineCfg;
  lineIndex?: number;
}

export interface SfxCue {
  name: string;
  at: number;
  gain?: number;
  /** 循环铺底到该时刻 */
  until?: number;
}

export interface Timeline {
  cfg: JokeCfg;
  segments: Segment[];
  duration: number;
  punchStart: number;
  punchEnd: number;
  freezeStart: number;
  sfx: SfxCue[];
}

/**
 * 字幕文案。**句末的标点一律去掉。**
 *
 * 短视频字幕一句一屏，句子边界靠"这一屏结束"表达，末尾再点标点是冗余的，
 * 还会让字幕块右下角空出一个洞。句号、感叹号、问号、逗号、省略号、破折号，
 * 只要在末尾就去掉。
 *
 * 句子**中间**的标点全部保留 —— 多小句合成一屏时要靠它们断句。
 *
 * **只动显示，不动配音。** 配音读的是 lineText()，那边的标点必须原样留着：
 * Edge TTS 的停顿全靠标点，句号是唯一稳定产生停顿的（实测约 0.42s），
 * 去掉的话整句会连着念完（见 音色音调手册-VOICE.md 第一节）。
 * 两个函数分开就是为了这件事，别图省事合并。
 *
 * 这条规矩人工提过两次，这里落成代码，不再靠每条稿件自己注意。
 */
export function subtitleText(line: LineCfg): string {
  return (line.subtitle ?? lineText(line)).replace(/[。，、！？；：…—～.,!?;:~-]+$/, '');
}

/**
 * 台词文本：写了 say 就把小句拼起来。**这是送进 TTS 的那一串，标点原样保留。**
 * 时长估算、预览页也读这个，别直接读 line.text。
 */
export function lineText(line: LineCfg): string {
  if (line.say?.length) return line.say.map((s) => s.text).join('');
  return line.text ?? '';
}
