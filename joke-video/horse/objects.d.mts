// 给 joke-video 那边的 TS 用的声明。objects.mjs 是纯 .mjs（跟 scenes/marks 一样，
// 摆拍工具链要能独立跑）。**改了 objects.mjs 的导出，这儿要跟着改。**

export declare const W: number;
export declare const H: number;

/** 物件名 → 画法。名字就是稿件里 `object` 那个词 */
export declare const OBJECTS: Record<string, (seed?: number) => string>;

export declare function hasObject(name: string): boolean;

/** 出一个物件的特写（只有物件，不含背景和文字）。名字不在库里会抛，不回退 */
export declare function drawObject(name: string, seed?: number): string;
