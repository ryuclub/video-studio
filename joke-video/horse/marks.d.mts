// 给 joke-video 那边的 TS 用的声明。marks.mjs 是纯 .mjs（摆拍工具链要能独立跑）。
// **改了 marks.mjs 的导出，这儿要跟着改。**

export interface MarkBox { x: number; y: number; w: number; h: number }
export interface MarkOpts { size?: number; seed?: number; pop?: number; tilt?: number; x?: number; y?: number }

export declare const MARKS: Record<string, { fn: (seed: number) => string; label: string; note?: string }>;
export declare const MARK_NAMES: string[];
export declare const SPOTS: Record<string, { x: number; y: number }>;
export declare const HORSE_INK: { x0: number; x1: number; y0: number; y1: number };
export declare const HORSE_HEAD: { x0: number; x1: number; y0: number; y1: number };

export declare function mark(name: string, opts?: MarkOpts): string;
export declare function place(name: string, spot: string, box: MarkBox, opts?: MarkOpts): string;

export declare const BURST_SPOTS: Record<string, { x: number; y: number; flip: boolean }>;
export declare function speechBurst(
  t: number,
  box: MarkBox,
  opts?: { spot?: string; size?: number; tilt?: number; seed?: number }
): string;
