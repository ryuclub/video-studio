// 给 joke-video 那边的 TS 用的声明。plaque.mjs 是纯 .mjs（跟 rough/scenes/objects/dressing 一样）。
// **改了 plaque.mjs 的导出，这儿要跟着改。**

/** 牌匾本体（wall 那一档） */
export declare function plaque(opts: {
  text: string; sub?: string;
  style?: 'wood' | 'tape' | 'pin';
  x?: number; y?: number; rot?: number; scale?: number;
  W?: number; H?: number; seed?: number;
}): string;

/** 长在场景原有物件上的载体（screen / led / sticky / deskSign / mug） */
export declare function titleOn(
  type: string,
  opts: { text: string; sub?: string; x: number; y: number; w?: number; h?: number; rot?: number; seed?: number; W?: number; H?: number }
): string;

/** 每个场景的牌匾位 */
export declare const PLAQUE_AT: Record<string, { x: number; y: number; rot: number; style: string }>;
export declare function plaqueFor(scene: string): { x: number; y: number; rot: number; style: string };

/** 每个场景两到三个载体位；`slotFor(场景, 集数)` 自动轮换 */
export declare const SLOTS: Record<string, Array<Record<string, unknown>>>;
export declare function slotFor(scene: string, n?: number): Record<string, unknown>;

/** 统一入口：wall 走牌匾，其余走载体。**n 传集数**，同一场景连发几集不会重复 */
export declare function title(opts: {
  text: string; sub?: string; scene: string; n?: number;
  [k: string]: unknown;
}): string;

/** 只挑字幕带以上（y<0.30）的载体位 —— 老马线用这个，`slotFor` 会挑到被字幕盖住的位 */
export declare function slotAboveSubtitle(scene: string, n?: number): Record<string, unknown>;
/** 老马线的统一入口，选位规则同上 */
export declare function titleAbove(opts: { text: string; sub?: string; scene: string; n?: number; [k: string]: unknown }): string;
