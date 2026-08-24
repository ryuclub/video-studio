// 给 joke-video 那边的 TS 用的声明。curtain.mjs 是纯 .mjs（跟 rough/scenes/objects 一样，
// 摆拍工具链要能独立跑）。**改了 curtain.mjs 的导出，这儿要跟着改。**

/** 幕布拉完要多久（秒）。0.45 是硬约束，见 curtain.mjs 顶上那段 */
export declare const CURTAIN_SEC: number;

/** @param p 0 = 全闭，1 = 全开（返回空串） */
export declare function curtain(p?: number): string;

/** 单独一片幕布，整张画布尺寸、透明底。给 ffmpeg 位移合成用 —— 这个仓库不走那条路，见 render.ts */
export declare function curtainPanel(side: 'left' | 'right', opts?: { rail?: boolean }): string;

/** 某一帧该位移多少像素（正数＝向外） */
export declare function shiftAt(p: number): number;

export declare const HOLD_SEC: number;
/** 闭幕 ＋ 拉开 ＋ 标题淡出，字幕要等它走完 */
export declare const OPENING_SEC: number;
export declare function curtainTitle(o: { text: string; sub?: string; y?: number }): string;
export declare function opening(
  t: number,
  o: { text: string; sub?: string; hold?: number; open?: number; linger?: number }
): string;
