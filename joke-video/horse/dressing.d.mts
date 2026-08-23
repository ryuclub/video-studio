// 给 joke-video 那边的 TS 用的声明。dressing.mjs 是纯 .mjs（跟 rough/scenes/objects 一样）。
// **改了 dressing.mjs 的导出，这儿要跟着改。**

/**
 * 给场景摆一两件小道具。
 * @param seed **传天数号** —— 同一条片子每帧要摆得一模一样
 * @param opts.skip 稿件的 `object`。**必须传**，否则会把台词点名的东西摆进画面（＝图解台词）
 */
export declare function dressing(
  sceneName: string,
  seed: number,
  opts?: { skip?: string }
): string;

/** 这个场景的摆件池（没台面的场景是空数组） */
export declare function dressablePool(sceneName: string): string[];
