/**
 * storyboard.json 的数据契约。
 *
 * 设计原则：shot 只描述「要什么」，不描述「怎么做」。
 * 具体的 ffmpeg 滤镜链由各 layer 模块决定，换实现不动 storyboard。
 */

/** 三层素材来源 */
export type Tier =
  | 'A' // 静图 + 运镜（ffmpeg zoompan / crop）
  | 'B' // 伪 B：不调 AI，用脚本制造动感（cinemagraph / 代码渲染 / 叠加）
  | 'C'; // 现成素材（本地库 / 免费素材站）

/** A 层运镜预设 */
export type MotionPreset =
  | 'zoomIn' // 缓推
  | 'zoomOut' // 缓拉
  | 'panLeft' // 向左横移
  | 'panRight' // 向右横移
  | 'panUp'
  | 'panDown'
  | 'breath' // 手持呼吸感（微幅随机漂移，几乎察觉不到但画面不死）
  | 'still'; // 完全静止（画面里有文字时必须用这个）

/** 伪 B 层的子类型 */
export type PseudoBKind =
  | 'cinemagraph' // 静图 + 局部循环素材（云/水/烟/光）
  | 'render' // 代码渲染动效（图表 / 数字滚动 / 时间轴）
  | 'overlay' // 全画面叠加（颗粒 / 漏光 / 雨雪 / 扫描线）
  | 'compose'; // 分层视差（前景/中景/背景各自不同速度位移）

/** render 子类型支持的内置场景 */
export type SceneKind =
  | 'lineChart'
  | 'barChart'
  | 'counter'
  | 'timeline'
  | 'quote'
  | 'steps'
  | 'japanMap'
  /* ── 以下移植自 ../fx-kit ─────────────────────────────────
   * fx-kit 是 DOM/CSS + 无头浏览器的实现，本管线禁用浏览器，
   * 所以搬过来的是**规格**（参数、时长、缓动、配色），不是代码。 */
  /** 08 三级字幕：主句 + 补充 + 出处，依次升起并保持堆叠 */
  | 'subtitleStack'
  /** 09 遮罩上滑：逐行从行框下方滑出，露出前被裁掉 */
  | 'maskTitle'
  /** 10 故障标题：RGB 错位 + 切片抖动。全片最多 1–2 次 */
  | 'glitchTitle'
  /** 16 左右对照：成对数值从中线向两侧生长 */
  | 'compareBars'
  /** 20 箭头注记：圈选 / 箭头 + 标签。坐标由人给，不做画面识别 */
  | 'arrowAnnotate'
  /** 04 闪白打点：全幅，只在重音上砸一下 */
  | 'flash'
  /** 17 聚光引导：全幅，除一个光斑外整体压暗 */
  | 'spotlight'
  /** 19 颗粒漏光：全幅，走 ffmpeg 滤镜而不是 SVG 帧（理由见 overlay.ts） */
  | 'grain';

/**
 * 入场方向。
 *
 * 上浮是这套管线的母语：titleBlock、counter 的说明行、PPT 风的时间轴和数字全是上浮。
 * quote 的左滑是唯一的例外，为了不让已出片的观感漂移，它的默认值保持 left ——
 * 想改哪一处就在 spec 里显式写，改不改是一次可回退的决定。
 */
export type EnterDir = 'up' | 'down' | 'left' | 'right' | 'none';

/**
 * steps 的一条。
 *
 * 序号只是徽标里的**内容**，跟布局和动效无关 —— 所以同一个场景既能做
 * 「一/二/三」的序号卡，也能做没有序号的要点卡和打勾的核对清单。
 */
export interface StepItem {
  /** 徽标文字。不给就按 ordStyle 自动生成（一二三 / 01 02 / ①②③） */
  ord?: string;
  /** 正文。14 字以内 —— 超了在竖版面板里必折行，一折行整卡的行高就乱 */
  text: string;
  /** 正文下面的小字。只在 items ≤ 3 条时允许 */
  note?: string;
}

export interface SceneSpec {
  kind: SceneKind;
  title?: string;
  subtitle?: string;
  /** lineChart / barChart 用 */
  series?: number[];
  labels?: string[];
  unit?: string;
  /** counter 用：单个数字 */
  from?: number;
  to?: number;
  suffix?: string;
  /** counter 用：并排多个数字（2-3 个最佳）。给了 values 就忽略 from/to */
  values?: { label: string; from: number; to: number; suffix?: string }[];
  /** timeline 用 */
  events?: { year: string; text: string }[];
  /** quote 用 */
  text?: string;
  cite?: string;
  /** quote 用：逐字打出 */
  typewriter?: boolean;
  /**
   * quote 用：打字速度（字/秒）。中文 8–12 跟得上口播，fx-kit 的默认是 10。
   * 不给就按老办法在面板时长里铺满 —— 已出片的观感不变。
   */
  cps?: number;
  /**
   * quote 用：打完后变红并放大的关键词。
   * 必须显式给出 —— 自动识别猜错关键词比不强调更糟。
   */
  emphasize?: string[];

  /** steps 用：逐条上浮的清单，2–5 条 */
  items?: StepItem[];
  /** steps 用：徽标样式。默认 cn */
  ordStyle?: 'cn' | 'num' | 'circle' | 'dot' | 'none';
  /** steps 用：徽标画成勾号（核对清单）。给了就忽略 ordStyle */
  check?: boolean;
  /**
   * steps 用：各条入场时刻，相对面板起点的秒数。
   * 不给就在面板时长里均分 —— 给了才能做到「解说念到哪一条，哪一条才浮上来」。
   * 由 timeline.json 里对应解说行的 startMs 减去 overlay 的 at 得到。
   */
  itemAt?: number[];

  /** 入场方向。不给时由各场景自己定默认值（steps=up，quote=left） */
  enter?: EnterDir;

  /** japanMap 用。城市名须在 japan-geo.ts 的 CITIES 里有经纬度 */
  cities?: { name: string; value?: string }[];
  /** japanMap 用：没有对应城市但要点亮的都道府県（如「北海道」），在面板起点一起亮 */
  highlight?: string[];

  /* ── 以下是 fx-kit 移植过来的场景参数 ─────────────────── */

  /** subtitleStack / maskTitle 用：逐行文本。三级字幕取前三行当 主句 / 补充 / 出处 */
  lines?: string[];
  /**
   * 抖动持续多少秒。fx-kit 的默认是 0.9–1.0 秒，**别跟镜头时长绑在一起** ——
   * 铺满 3 秒的镜头就成了一帧帧的错位图，不是「信号坏了一下」。
   */
  dur?: number;
  /**
   * glitchTitle 用：垂直分量占水平位移的比例，0–1，默认 0.5。
   * fx-kit 只有横向位移，遇到全横笔画的标题（「三十三」「二十三天」）
   * 横着错开露不出面，读成零散色块。写 0 就是完全照搬 fx-kit。
   */
  vertical?: number;
  /** glitchTitle 用：切片数（30fps 下 3–4 最清楚）、错位幅度 px、随机种子 */
  slices?: number;
  amp?: number;
  seed?: number;
  /** compareBars 用：成对数值，2–5 行 */
  rows?: { label: string; l: number; r: number }[];
  /** compareBars 用：左右两侧的名字，画在表头 */
  leftLabel?: string;
  rightLabel?: string;
  /**
   * arrowAnnotate 用：圈选与箭头。**坐标是相对整幅画面的 0–1 归一值** ——
   * 它要指的是底片里的东西，所以这类效果必须全幅渲染，不能塞进面板。
   */
  circle?: { cx: number; cy: number; rx: number; ry: number; rot?: number };
  arrow?: { x1: number; y1: number; x2: number; y2: number };
  label?: string;
  labelX?: number;
  labelY?: number;
  /** flash 用：峰值不透明度与颜色 */
  peak?: number;
  color?: string;
  /** spotlight 用：光斑路径（0–1 归一坐标，多点则在时长内依次移动）、半径、压暗、边缘柔和度 */
  path?: { x: number; y: number }[];
  radius?: number;
  dark?: number;
  soft?: number;
  /** grain 用：颗粒强度 0–100、是否加暖色漏光 */
  strength?: number;
  leak?: boolean;
}

export interface Shot {
  /** 唯一 id，同时用作中间产物文件名前缀 */
  id: string;
  /** 在成片时间轴上的起点（秒）。由音频对齐回填，本模块只读不写 */
  start: number;
  /** 本镜头时长（秒） */
  duration: number;

  tier: Tier;

  /** A/C 层：源文件路径（相对项目根）。C 层留空则按 tags 从素材库检索 */
  source?: string;

  /** A 层 */
  motion?: MotionPreset;
  /** 运镜强度倍率，默认 1.0。0.5 = 更克制，1.5 = 更明显 */
  intensity?: number;

  /** 伪 B 层 */
  pseudo?: PseudoBKind;
  /** cinemagraph: 循环素材路径 */
  texture?: string;
  /** cinemagraph: 灰度蒙版路径（白 = 显示动态素材） */
  mask?: string;
  /** overlay: 叠加素材路径 + 混合模式 */
  overlayFile?: string;
  overlayMode?: 'screen' | 'overlay' | 'softlight' | 'lighten';
  overlayOpacity?: number;
  /** overlay: 用内置程序化颗粒代替素材文件 */
  grain?: number;
  /** render: 场景描述 */
  scene?: SceneSpec;
  /** compose: 分层图，index 0 = 最底层 */
  layers?: { file: string; speed: number }[];

  /** C 层：素材库检索标签 */
  tags?: string[];

  /** 出点转场（到下一镜）。不填用全局默认。可以写预设名，见 TRANSITION_PRESETS */
  transition?: TransitionSpec | string | null;

  /**
   * 透明输出：不画底色，产物是带 alpha 的 .mov，供叠加到已有视频上。
   * 只对 pseudo=render 有效。
   */
  transparent?: boolean;
  /** 透明输出时是否画半透明衬底。默认 true —— 底层画面亮度不可控 */
  scrim?: boolean;

  /** 调试用备注，不影响渲染 */
  note?: string;
}

/** overlay-onto 用的叠加规格 */
export interface OverlaySpec {
  id: string;
  /** 叠加在底片的第几秒 */
  at: number;
  duration: number;
  scene: SceneSpec;
  /** 动效画布尺寸。默认取底片尺寸的 scale 倍 */
  width?: number;
  height?: number;
  /** 相对底片的缩放，默认 0.55 */
  scale?: number;
  /** 位置，可写 '6%' 或像素数。默认水平居中、垂直 8% */
  x?: string | number;
  y?: string | number;
  fadeIn?: number;
  fadeOut?: number;
  scrim?: boolean;
}

export interface OverlayPlan {
  fps?: number;
  overlays: OverlaySpec[];
}

/**
 * 转场预设。storyboard 里可以直接写 `"transition": "crossfade"`，
 * 等价于写完整的 { type, duration }。名字对齐 fx-kit 的特效 id。
 *
 * xfade 做不出 whipPan 的方向性动态模糊（那是 CSS `filter: blur` 的活），
 * 所以横扫用「更短的滑动」来补 —— 380ms 的 slideleft 在观感上就是一次硬转折。
 */
export const TRANSITION_PRESETS: Record<string, TransitionSpec> = {
  /** 02 交叉溶解：同一段落内换镜头的默认转场 */
  crossfade: { type: 'fade', duration: 0.7 },
  /** 03 横扫切换：跨大段落，或稿件出现「然而 / 但是 / 问题在于 / 直到」 */
  whip: { type: 'slideleft', duration: 0.38 },
  /** 03 横扫切换（反向） */
  whipRight: { type: 'slideright', duration: 0.38 },
  /** 04 闪白当转场用时的形态；作为叠加效果用的是 scene.kind = 'flash' */
  flash: { type: 'fadewhite', duration: 0.18 },
};

export interface TransitionSpec {
  /** ffmpeg xfade 的 transition 名，如 fade / dissolve / wipeleft / slideup */
  type: string;
  /** 交叠时长（秒） */
  duration: number;
}

export interface Storyboard {
  title: string;
  /** 输出尺寸 */
  width: number;
  height: number;
  fps: number;
  /** 主音轨（解说词配音）。有则最终 mux 进去 */
  audio?: string;
  /** 字幕文件（.ass 优先，.srt 亦可），会烧录进画面 */
  subtitle?: string;
  /** 全局默认转场。可以写预设名，见 TRANSITION_PRESETS */
  defaultTransition?: TransitionSpec | string | null;
  shots: Shot[];
}

/** 单镜渲染结果 */
export interface ShotResult {
  id: string;
  file: string;
  duration: number;
  cached: boolean;
  ms: number;
}
