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
  say?: {
    text: string;
    delivery?: string | DeliveryCfg;
    gap?: number;
    holdHead?: number;
    /**
     * 这一小句的表情（压过 line.look）。
     *
     * **一个表情挂满一句话就太久了。** 固视超过两秒眼睛就开始像定住的图，
     * 而拆过屏的句子本来就有好几个意思 —— 「第一个像拍马屁、最后一个像敷衍」
     * 是不屑别人，「第三个刚好像是认真读完的」是说自己，
     * 两处的眼神本来就不该一样。写 `"look": ""` 表示这一小句归中正视。
     */
    look?: string;
  }[];
  /**
   * 把这句**开头一个字**额外拉长（值 = 拉伸倍率，越小越长，0.4 以下会有金属味）。
   *
   * 做「妈~~~妈」这种慢节拍呼唤：整句先按 delivery 放慢喊出来，再单独把头字拖住。
   * **不要用 say 分句来做这个**——分句是两次独立合成、两个音节起头，
   * 听着是"妈…妈"两声，不是一口气里的拖长。
   */
  holdHead?: number;
  /**
   * 这一句属于**说破段**（出片方案 §四 第 7 条）。
   *
   * 标出来是为了让机器认得出：说破段是这条线的硬要求
   * （「没有说破段的稿子不进配音」），发布文案要把它整理进去给人核。
   *
   * ⚠ **现在拦得比这句话说的晚。** 早先这儿写着「`preflight` 要拦」——
   * 那是想要的样子，不是实际的样子：`preflight.ts` 里没有任何一处检查 `shuopo`，
   * `laoma-check.ts` 也没有。**唯一会报的是 `yiye-publish.ts`**，
   * 而那一步在配音之后，「不进配音」根本没兑现。
   * 要真按那条规矩办，得往 `preflight` 里加一道；在那之前别把这句当保险。
   *
   * **不做成 beat 值** —— `Beat` 那个联合类型是排时间轴用的
   * （typeA/typeB 按它分节奏），加一个值会牵动那两处的分支。
   * 说破段是「这句话是干什么的」，跟「这句怎么排」是两件事。
   */
  shuopo?: boolean;
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
  /**
   * 这一句期间**定住的眼神**：不屑 / 斜视 / 望天 / 低头（horse rig 专用）。
   *
   * 脸不做戏是这条线的人设，眼珠是唯一的出口 —— 所以「不屑」这种表情
   * 只能靠眼神给，而且必须由稿子点名：自动的漂移永远碰不出一个表情。
   */
  look?: string;

  /**
   * 说这一句时扭头多少度（正 = 向右）。**只用在话锋转了的那一句**，
   * 一条片子最多两次（horse/SCRIPT_GUIDE.md §四）；±13 度是好用的幅度，
   * 超过 ±25 度耳朵和鬃毛不会转到三维正确的位置，会穿帮。
   *
   * 渲染时**视线比头先动 0.12 秒** —— 同时动像是被人掰过去的，
   * 先动才像「他自己决定看那边」。
   */
  turn?: number;

  /**
   * 说完这一句之后闭目多少秒（0.8–1.5）。
   *
   * **闭目不是眨眼。** 超过 0.5 秒的闭眼在中文语境里读作「忍耐」或「认命」，
   * 是很重的情绪 —— **全片最多一次，而且不能用在落点句**
   * （落点要的是正视镜头，闭上就把最重的那一眼丢了）。
   * 用在铺垫段某个「受不了」的瞬间最好使。
   *
   * ⚠ 停顿要够长。这一句的 padAfter ＋ 下一句的 padBefore 撑不住的话，
   * 闭目会咬进下一句的开头 —— 体检会报。
   */
  closeEyes?: number;

  /**
   * 说完这一句之后**张着嘴、不出声**多少秒。
   *
   * 这是「他张嘴想说什么，说不出来」——**不是口型没对上，是他真的没话说**。
   * 口型平时由配音包络驱动，没声音就闭着；这一档是唯一一处手动把嘴掰开的地方。
   *
   * 老马这条线的画面限制（嘴跟着声音走）在这儿反过来成了表达手段：
   * 观众二十多秒都在「有声音＝嘴在动」里，突然嘴动了没声音，那个空是响的。
   *
   * ⚠ 要跟 `padAfter` 一起加长，否则会咬进下一句。跟 `closeEyes` 一样，体检拦。
   */
  openMouth?: number;

  /**
   * 这一句期间出现的漫符。**一条片子最多 3 个，同一个不重复**
   * （跟扭头一样有上限，见 horse/SCRIPT_GUIDE.md §五）。
   */
  marks?: MarkCfg[];
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
  rig: 'serpentine' | 'human' | 'turtle' | 'mouse' | 'cat' | 'none' | 'still' | 'horse';
  /** 'primary' | 'secondary' | 'neutral' 或直接给十六进制色 */
  color?: string;
  side: 'left' | 'right';
  /**
   * 显式站位 x（舞台坐标）。不写就按 side 取左右两个机位。
   * **超过两个角色同框时必须给**——不然第三个会跟 side 相同的那个完全重叠。
   */
  x?: number;
  /**
   * 单人镜时**不要**自动挪到画面中央，就站在 `x` 上。默认 false（照旧居中）。
   *
   * 居中是给对话类定的：一个人在说话时，他本来就该占住画面。
   * **但独白线整条片子只有一个人** —— 一直居中就等于把两边都占死了，
   * 侧边字幕没地方排。这条线让他站在三分之一处，把另外半幅让给字。
   */
  keepX?: boolean;
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

/** 漫符：老马头边上蹦出来的小符号。画法与用量规矩见 horse/marks.mjs */
export interface MarkCfg {
  /** 符号名，见 `node horse/render.mjs --marks` */
  name: string;
  /** 挂在头的哪一侧。默认右上 */
  spot?: '左上' | '右上';
  /** 占角色框宽度的比例。全身镜 0.40–0.50，近景 0.22–0.34 */
  size?: number;
  seed?: number;
  /** 倾斜（度）。歪一点才有「弹出来」的劲 */
  tilt?: number;
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
    /** 封面大字，4–8 字（**老马线是 4–7**，见 封面设计规范-COVER.md §七之二）。不写就从第一句自动推（兜底，上线前建议手写） */
    title?: string;
    /**
     * 副标题，排在大字下面。**只有老马线画它**（`laomaTitle`）。
     *
     * 它是**补充信息，不是重复**：大字抛出问题，副标题给一个具体细节。
     * ✓「电梯看哪儿」+「七人同看数字」　✗「电梯看哪儿」+「电梯里的尴尬」
     * 而且**不能剧透落点** —— 副标题给场景，不给转折句。
     */
    sub?: string;
    /**
     * 老马线专用：画面上方有东西要避让（电梯楼层屏那类）时给 true，
     * 标题块整体从 0.115 下移到画布高的 0.40。
     */
    titleLow?: boolean;
    /** 右下角系列标签，'none' 关掉 */
    tag?: string;
    /** 情绪符号，'none' 关掉 */
    mark?: string;
    /** 取帧时刻（秒），默认笑点结束 + 0.6s */
    at?: number;
    /** 大字纸片顶边。⚠ **老马线不看这个** —— 那条线的首行基线由规范定死（见 titleLow） */
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
  /**
   * 镜头。缺省 `follow`：跟随说话者、笑点句推近 —— **对话反转段子的母语，别改缺省**。
   *
   * `static` 全程不动，只保留开场那一下缓推。**独白线用这个。**
   * 一个人从头讲到尾时，跟随没有对象可跟（就他一个），推近也没有反转可推，
   * 剩下的只是画面在无缘无故地晃 —— 而这条线的画面纪律是「几乎不动」，
   * 不单调要靠眼珠、字幕滑入和漫符去挣，不是靠推镜头。
   */
  camera?: 'follow' | 'static';

  /**
   * 字幕排版。缺省 `strip`：米白纸片衬底 + 底部居中 —— **段子和《一页故事》靠它，别改缺省**。
   *
   * `side` 是独白线用的：**没有衬底、没有动效、按逗号一小句一行**，排在角色的侧边。
   * 理由写在 `subtitle.ts` 的 sideText() 顶上 —— 一个人讲到底、画面和镜头都不动时，
   * 字幕不是配角，它是观众的主要落点；给它加衬底加动效等于给主角化妆再让他别动。
   */
  subtitleStyle?: 'strip' | 'side';

  /**
   * 说话放射（黄色尖刺）。写了就在**每句台词期间**挂在头边上，跟着跳。
   *
   * 跟漫符不是一回事：漫符是「偶尔来一个」，这个是每句都在。
   * 所以它必须够小、够边上 —— 作用是让「他在说话」在静止画面里看得见，不是抢戏。
   *
   * `spot` 左/右（扇形朝哪边开），`size` 占角色框宽度的比例，`tilt` 整体旋转。
   */
  speechBurst?: {
    spot?: '左' | '右';
    size?: number;
    tilt?: number;
    seed?: number;
    /**
     * 按 beat 缩放，0 = 这一档不出。**不写就是全程常亮，而常亮等于没有** ——
     * 挂满 29 秒它就退化成一张装饰贴纸，落点那一下也没有额外的强调余地了。
     * 留白是为了让落点有东西可以亮。
     *
     * 建议：`{ setup: 0, reply: 0.7, punch: 1.15 }`
     */
    byBeat?: Record<string, number>;
  };

  /**
   * 片尾淡出到黑，多少秒。不写就没有。
   *
   * **不是所有片子都该有。** 段子的收尾是「定格去色 ＋ 钩子字幕」，那是 CTA，
   * 要亮着让人看见。黑场是另一种收尾：它把片子**关上**，不留 CTA，
   * 用在收尾本身就是情绪的那种稿子上 —— 那种片子最不需要的就是最后跳出来一行字。
   */
  fadeOut?: number;

  /**
   * 定格表情：**最后一句说完之后**（从落点定格起，一直到收尾卡结束）锁住的脸。
   *
   * 平时脸不做戏（人设：不表演），但落点砸完之后那几秒是全片唯一该有反应的地方 ——
   * 前面 25 秒的面无表情，就是为了给这一下攒的。
   *
   *   mouth  0 闭 / 1 半开 / 2 张
   *   eyes   normal / wide（瞪大，眼珠放大 1.45 倍并归位不再漂移）/ closed（闭着，laoma-002 在用）
   */
  endPose?: { mouth?: 0 | 1 | 2; eyes?: 'normal' | 'wide' | 'closed' };

  /**
   * 收尾卡那一段出的漫符。
   *
   * **从落点定格起就出**，一直到收尾卡结束。
   *
   * 早先只放在收尾卡上，规矩是「落点后那一拍要什么都不发生」。
   * 后来改成跟 `endPose` 同时起：那一拍的「什么都不发生」指的是**不再有新信息**，
   * 而张嘴、瞪眼、一滴大汗是同一个瞬间的三件事，拆开反而像分了两次镜。
   */
  endMark?: MarkCfg;

  /**
   * 音效开关。**A 类默认是开着四样的**（嘶 / 木鱼 / 下滑音 / 咚），
   * 那套默认值是给对话反转段子调的 —— 音效在那种片子里是节拍，帮观众断句。
   *
   * **独白 deadpan 档要全关。** 任何一个音效都在替观众定调，
   * 而「咚」尤其致命：它等于自己先敲了一下锣，笑点当场死亡
   * （跟稿件规范里「落点句不要有形容词」是同一条道理，形容词和音效都是在替观众下判断）。
   * 全关写法：`"cues": { "introHiss": false, "replyWood": false, "punchSlide": false, "freezeThud": false }`。
   */
  cues?: {
    /** 每句台词前的小 pop（音高明确，容易腻）。默认 false */
    subtitlePop?: boolean;
    /** 回应句前的木鱼。默认 true */
    replyWood?: boolean;
    /** 开场那声"嘶"。**蛇专属**，换成人物记得关掉。默认 true */
    introHiss?: boolean;
    /** 反转句尾那个下滑音。默认 true */
    punchSlide?: boolean;
    /** 定格那一下「咚」。默认 true */
    freezeThud?: boolean;
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
