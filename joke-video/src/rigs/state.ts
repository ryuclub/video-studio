// ── 角色状态：所有 rig 吃同一份状态,所以换动物/换人不用改时间轴代码 ──

export interface CharState {
  id: string;
  x: number;
  y: number;
  scale: number;
  facing: 1 | -1;
  /** 口型三态：0 闭 / 1 半开 / 2 张。由音频振幅驱动 */
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

  // human
  gesture?: 'down' | 'point' | 'shrug' | 'facepalm';
  proportion?: 'child' | 'adultM' | 'adultF' | 'elder';
  hair?: 'short' | 'long' | 'bun' | 'bald' | 'white';
  props?: string[];
}

export type Rig = (s: CharState, ink: (c: string) => string, seed: number) => string;
