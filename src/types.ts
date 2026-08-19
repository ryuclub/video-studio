/**
 * 整条管线的唯一数据契约。
 * script.json 由 LLM 生成（或手写），后续所有步骤都是确定性的纯函数。
 */

/** 字幕层级 */
export type LineStyle =
  /** 情境角标：左侧中部，"1997年11月17日 | 清晨" 这类时空交代 */
  | 'chip'
  /** 常规解说：底部单行，跟读用 */
  | 'sub'
  /** 强调段：画面中央，白字，参与堆叠 */
  | 'emph'
  /** 强调段落点：红字黄边，一个 stack 组里最多出现一次 */
  | 'emphKey';

export interface ScriptLine {
  /** 屏幕上显示的文字。chip 用 " | " 分隔左右两段 */
  text: string;
  /**
   * 送进 TTS 的文本。缺省时等于 text。
   * 用途一：chip / emphKey 这类纯视觉元素可以设成 "" 表示不配音。
   * 用途二：读音纠正的兜底（词典搞不定的整句改写）。
   */
  speech?: string;
  style: LineStyle;
  /**
   * 堆叠组编号。同一个 stack 值的连续多行不清屏、逐行累加显示，
   * 直到该组最后一行的语音结束才整组消失。undefined 表示不堆叠。
   */
  stack?: number;
  /** 素材检索关键词（英文，供 Pexels 用）。缺省则沿用上一行的镜头 */
  clip?: string;
  /** 该行说完后额外停顿的毫秒数，用于制造顿挫 */
  pauseAfterMs?: number;
}

export interface Script {
  /** 视频标题，也用作输出目录名 */
  title: string;
  /** 选题来源，便于回溯 */
  source?: string;
  /** 生成时间 */
  createdAt?: string;
  /**
   * 开场标题卡的版式序号（0–3），缺省时由标题哈希自动挑一套。
   * **写 -1 表示只画压暗蒙版、不画标题字** —— 封面交给 video-pipeline 的
   * 故障标题（三层）叠上去，两边都画就会撞在一起。
   * 自动挑的那套不满意就手填一个数字重跑 render —— 不用改标题。
   */
  hookLayout?: number;
  lines: ScriptLine[];
}

/** TTS 返回的逐行时间轴（毫秒） */
export interface LineTiming {
  index: number;
  startMs: number;
  endMs: number;
}

export interface Timeline {
  audioFile: string;
  totalMs: number;
  lines: LineTiming[];
}

/** 画幅朝向。横竖版分别检索素材，不共用 */
export type Orientation = 'landscape' | 'portrait';

/**
 * 素材出处。Pexels 的 API 使用指南要求署名（License 页写的「可选」是指直接下载，
 * 走 API 就得给出处），所以检索到的信息必须留下来 —— 事后从 mp4 文件是查不回来的。
 * 手动素材（assets/manual/）没有这个字段。
 */
export interface ClipCredit {
  id: number;
  photographer: string;
  photographerUrl?: string;
  /** Pexels 上的原页面，署名链到这里 */
  url: string;
}

/** 一条落地的素材 */
export interface ShotClip {
  file: string;
  /** 素材本身的时长，用来排布镜头内的切换点 */
  durationMs: number;
  credit?: ClipCredit;
}

/**
 * 一个镜头：关键词 + 各朝向的素材序列 + 占用的时间区间。
 *
 * 一个镜头可能需要不止一条素材：镜头时长由稿件决定，免版权库的素材通常只有
 * 几秒。素材放完就切下一条，而不是把同一条循环播放 —— 循环非常显眼，
 * 观众一眼就看出是拼凑的。
 *
 * 竖版必须单独检索：把 1920x1080 中心裁成 1080x1920 只剩原画面 28% 的宽度，
 * 人、地标、招牌基本都被切掉了。
 */
export interface Shot {
  keyword: string;
  clips: Partial<Record<Orientation, ShotClip[]>>;
  startMs: number;
  endMs: number;
}

/** 输出规格 */
export interface RenderProfile {
  name: string;
  width: number;
  height: number;
  /** 字幕基准字号（按 1080p 横版标定，其它分辨率等比缩放） */
  fontScale: number;
  orientation: Orientation;
}

export const PROFILES: Record<string, RenderProfile> = {
  landscape: { name: 'landscape', width: 1920, height: 1080, fontScale: 1.0, orientation: 'landscape' },
  portrait: { name: 'portrait', width: 1080, height: 1920, fontScale: 1.45, orientation: 'portrait' },
};

/* ==================================================================
 * PPT 演示风格（style: "slide"）
 *
 * 跟上面那套「空镜解说风」是两条独立的管线，不共用 script.json 的结构：
 *  - 解说词是一整段连续文本，整条一次合成（不是逐行）
 *  - 时间轴靠 TTS 的词级时间戳还原，不是逐行测量
 *  - 画面是版式化的屏，不是素材视频
 * 详见 history/PPT-STYLE.md（这套风格 2026-08-17 起停用，代码保留）。
 * ================================================================== */

export type SlideLayout =
  /** 开场钩子：大字标题 + 红色下划线 */
  | 'hook'
  /** 单句结论：一句话独占一屏，全片的落点 */
  | 'statement'
  /** 时间轴：横向若干节点，逐个点亮 */
  | 'timeline'
  /** 左右分栏对比（竖版改成上下堆叠） */
  | 'compare'
  /** 要点逐条出现，带序号方块 */
  | 'list'
  /** 逐项勾选 */
  | 'checklist'
  /** 大数字特写 */
  | 'number'
  /** 多个大额数字并排，同时从 0 滚到目标值，滚完浮出一行说明 */
  | 'numbers'
  /** 金句：逐字打出，打完关键词变红放大 */
  | 'quote'
  /** 片尾来源页 */
  | 'source'
  /** 收尾 */
  | 'outro';

export interface RollNumber {
  /** 目标值。滚动从 0 开始，缓出到这个数 */
  target: number;
  /** 数字后面跟的单位，不参与滚动 */
  suffix?: string;
  /** 数字下面的小字 */
  label?: string;
}

export interface SlideColumn {
  title: string;
  items: string[];
}

/** 一屏的内容，不含定位方式 —— PPT 片按 anchor 定位，面板按 fromText 定位 */
export interface SlideBody {
  layout: SlideLayout;
  /** 角标：小字 + 红色短横，交代这一屏属于哪一段 */
  kicker?: string;
  title?: string;
  items?: string[];
  /**
   * 与 items 等长的逐条出现锚点。不给就在本屏时长里均分 ——
   * 给了才能做到「解说念到哪一条，哪一条才亮」。
   */
  itemAnchors?: string[];
  /** timeline 各节点下方的说明 */
  captions?: string[];
  /** compare 的左右两栏 */
  left?: SlideColumn;
  right?: SlideColumn;
  /** number 的主数字与单位 */
  value?: string;
  unit?: string;
  /** numbers 版式：并排滚动的数字 */
  values?: RollNumber[];
  /** quote 版式：句子里要变红放大的关键词，必须是 title 的子串 */
  highlight?: string;
  /** 底部补充小字 */
  note?: string;
}

export interface Slide extends SlideBody {
  /**
   * 该屏大致对应的解说词起始句（原文里的一小段，去标点后唯一匹配即可）。
   * start 由词级时间戳回填，不手写时间 —— 手写的时间在改稿后必然错位。
   */
  anchor: string;
}

export interface SlideScript {
  title: string;
  style: 'slide';
  source?: string;
  createdAt?: string;
  /** 封面标题，缺省用 title */
  cover?: string;
  /** 解说词主稿：一整段连续文本，从头到尾读得通 */
  narration: string;
  slides: Slide[];
}

/** TTS 返回的词级时间戳 */
export interface WordStamp {
  offMs: number;
  durMs: number;
  text: string;
}

export interface SlideTimeline {
  audioFile: string;
  totalMs: number;
  words: WordStamp[];
  /** 解说词去掉标点后的纯文本，words 拼起来必须与它逐字相等 */
  plain: string;
  /** plain 第 i 个字的起始毫秒。锚点定位就是查这张表 */
  charMs: number[];
}

