// 给 joke-video 那边的 TS 用的声明。scenes.mjs 是纯 .mjs（摆拍工具链要能独立跑），
// 但 src/scenes/index.ts 要 import 它，没有这份 tsc 会报「找不到声明文件」。
// **改了 scenes.mjs 的导出，这儿要跟着改。**

export declare const W: number;
export declare const H: number;
export declare const GROUND: number;
export declare const U: number;

export declare function scene(name: string, seed?: number): string;

export declare const SCENES: Record<
  string,
  { fn: (seed?: number) => string; column: string; stand: string; label: string }
>;

export declare const PLACES: Record<
  string,
  { anchor: string; x: number; y: number; height: number; flip?: boolean }
>;

export declare function placeFor(name: string): PLACES[string];
