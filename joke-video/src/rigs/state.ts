// ── 角色状态：所有 rig 吃同一份状态,所以换动物/换人不用改时间轴代码 ──

export interface CharState {
  id: string;
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  /** 口型三态：0 闭 / 1 半开 / 2 张。由音频振幅驱动。要精确指名用 mouthShape */
  mouth: 0 | 1 | 2;
  eyes: 'normal' | 'wide' | 'closed';
  brows: 'normal' | 'up' | 'down';
  /** 说话节拍造成的头部上下偏移(px) */
  bob: number;
  /** 呼吸造成的 scaleY */
  breath: number;
  /** 前倾角(度)，老人为正 */
  lean: number;
  shakeX: number;
  shakeY: number;
  opacity: number;
  /** 时间(秒)，rig 内部相位用 */
  t: number;
  color: string;
  accent: string;

  /** still：用哪张原稿（素材库的 key，或直接给路径） */
  art?: string;
  /**
   * 说话强度 0..1（配音包络）。
   * mouth 是量化成三态的结果，**这个是原始值**——做手臂摆动、身体起伏
   * 这类连续动作要用它，用三态会一跳一跳的。
   */
  speech?: number;
  /** turtle：形象变体 kid / mom */
  variant?: string;
  /** turtle：走路强度 0..1，驱动四肢摆动 */
  walking?: number;

  // serpentine
  tongue?: number; // 0..1 舌头伸出程度
  tongueNick?: boolean; // 舌头带豁口（本段子的梗）
  length?: number;

  // horse（老马）
  /**
   * 扭头角度（度），正 = 向右。±25 以内可信，再大该换一张头了。
   *
   * **不是每句都动。** 稿件规范 §四：扭头一条最多两次，多了像抽搐。
   * 它标的是「话锋转了」，不是「让画面动一动」。
   */
  turn?: number;
  /**
   * 定住的眼神（见 rigs/horse.ts 的 LOOKS：不屑 / 斜视 / 望天 / 低头）。
   *
   * **压过自动眼神。** 平时眼珠是自动排的扫视，这一档是表演 ——
   * 待机动作永远碰不出表演，得由稿子点名。
   */
  look?: string;

  /**
   * 眼珠位移（原稿坐标 px），由渲染层按时间轴算好递进来。
   *
   * ── 为什么不在 rig 里算 ──
   *
   * 眼动的模型是**扫视 ＋ 固视**：瞬间跳到一点、钉住不动、再瞬间跳走。
   * 「跳到哪、什么时候跳」要看 beat（铺垫/转折/落点各有各的规矩）、
   * 要看这一句说到哪、要看这次停顿从哪到哪 —— rig 只看得到当前时刻，
   * 这些它一样都不知道。所以整条轨在 render.ts 里排好，这儿只收结果。
   *
   * 上一版是 rig 自己按停顿进度画一个圆。**圆是匀速的，匀速就是漂移** ——
   * 人的眼球在生理上没有匀速运动这回事，看着像游魂不像人。
   */
  gaze?: { x: number; y: number } | null;

  /**
   * 口型直接指名（'A' 大张 / 'I' 半开 / 'E' 中间态）。压过 mouth 的三态。
   *
   * 只为一件事：**闭 ↔ 大张之间垫一帧 E**。从一条细线直接跳到一个圆块，
   * 切换那一下会「啵」地弹一下；中间垫一帧就顺了。
   */
  mouthShape?: 'A' | 'I' | 'E' | null;

  // human
  gesture?: 'down' | 'point' | 'shrug' | 'facepalm';
  proportion?: 'child' | 'adultM' | 'adultF' | 'elder';
  hair?: 'short' | 'long' | 'bun' | 'bald' | 'white';
  props?: string[];
}

export type Rig = (s: CharState, ink: (c: string) => string, seed: number) => string;
