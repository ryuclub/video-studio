// 给 joke-video 那边的 TS 用的声明。emote.mjs 是纯 .mjs（摆拍工具链要能独立跑）。
// **改了 emote.mjs 的导出，这儿要跟着改。**

export declare const SYMBOLS: Record<string, string>;
export declare const EMOTE_SEC: number;

export declare function emote(
  kind?: string,
  opts?: { p?: number; x?: number; y?: number; scale?: number; value?: string | number; W?: number; H?: number; seed?: number }
): string;

export declare function emoteAt(a: {
  type: string;
  t: number;
  dur: number;
  pauseAfter?: number;
  delay?: number;
  enabled?: boolean;
}): number | null;
