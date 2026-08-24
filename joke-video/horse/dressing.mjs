/**
 * 场景小道具（「摆件」）
 *
 *   import { dressing } from "./dressing.mjs";
 *   const bg = scene(name, seed).replace("</svg>", dressing(name, day, { skip: cfg.object }) + "</svg>");
 *
 * ── 它要解决的问题 ──────────────────────────────
 *
 * 同一个场景连发几条，画面一模一样。`scenes.mjs` 换 `seed` 只是笔触重洗，
 * 桌上还是空的。这一层往桌面上摆一两件**跟这个场所本来就该有**的东西 ——
 * 工位上一支笔、一张纸、一个杯子。
 *
 * ── ⚠ 它跟「场景不要图解台词」那条规矩的边界 ──────────
 *
 * `SCRIPT_GUIDE.md` §五 写着：
 *
 * > 说外卖不一定要出现外卖盒。**画面出现了台词已经说过的东西，等于抢戏** ——
 * > 观众会去看画面而不是听你说。
 *
 * 而 `types.ts` 的 `object` 字段更明确：「进了画面就成了图解台词」。
 *
 * **这一层不违反那条，前提是守住两件事：**
 *
 * **一、池子按场所配，不按台词配。** 工位有笔和纸，跟这一条讲的是审批还是加班无关 ——
 * 换句话说，**同一个池子服务这个场景的所有稿子**。它是场所的常驻陈设，不是这条片子的插图。
 *
 * **二、`skip` 必须传稿件的 `object`。** 这是硬闸：那件东西正是台词点名的物件，
 * 摆进画面就是**图解**，恰恰是规矩禁的那种。传了 `skip`，池子里同名的那件直接不选。
 *
 * 判据一句话：**删掉这件摆件，有没有哪句台词变得不好懂？** 有 → 它成了插图，错了。
 *
 * ── 尺度 ────────────────────────────────────────
 * 跟 `scenes.mjs` 同一套坐标（1080×1920，GROUND=1500，U=1120）和同一套线宽（3–4px），
 * **不是 `objects.mjs` 那套特写**（那套是 6–8px、占画面 55%，给首帧用的）。
 * 两套混用的话，桌上会出现一支跟人一样高的笔。
 */
import { stroke, shape, rectPts, ellipsePts } from "./rough.mjs";

const GROUND = 1500;
const U = 1120;
const up = (f) => GROUND - f * U;

const INK = "#3B322B";
const LIGHT = "#FBF8F1";
const LW = 3.4;

/* ─────────────── 摆件本体 ─────────────── */
//
// 每个画在 (x, y) 上，y 是**它接触桌面的那条线**（不是中心），
// 这样换个桌高只要改 y，摆件本身不用动。

/** 笔：斜躺着。**不要立起来** —— 立着的笔要么是笔筒要么在写字，两样都在讲故事 */
function pen(x, y, s) {
  const L = 96, dy = 13;
  let o = stroke([[x, y], [x + L, y - dy]], { color: INK, w: LW * 2.1, passes: 2, amp: 1.5, seed: s });
  // 笔尖那一小截深一点
  o += stroke([[x + L * 0.82, y - dy * 0.82], [x + L, y - dy]], { color: INK, w: LW * 2.6, passes: 2, amp: 1.2, seed: s + 1 });
  return o;
}

/** 纸：一张，微微歪。歪 3–6 度就够，摆正了像 UI */
function sheet(x, y, s) {
  const w = 132, h = 96;
  const p = [[x, y], [x + w, y - 8], [x + w - 6, y - h], [x - 4, y - h + 7]];
  let o = shape(p, { fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 2.2 });
  for (let i = 0; i < 3; i++) {
    const yy = y - h * (0.68 - i * 0.2);
    o += stroke([[x + 14, yy], [x + w * (0.5 + (i % 2) * 0.28), yy - 3]], {
      color: INK, w: LW * 0.55, passes: 1, amp: 1.6, seed: s + 10 + i, op: 0.7,
    });
  }
  return o;
}

/** 杯：小的，带把手。**跟 objects.mjs 的杯子是两件东西** —— 那件是特写，这件是桌上一个 */
function cup(x, y, s) {
  const w = 62, h = 78;
  let o = stroke(ellipsePts(x + w + 12, y - h * 0.52, 16, 13), {
    color: INK, w: LW * 1.2, passes: 2, amp: 1.4, close: true, seed: s + 3,
  });
  o += shape([[x, y - h], [x + w, y - h], [x + w * 0.9, y], [x + w * 0.1, y]], {
    fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 2.2,
  });
  o += stroke(ellipsePts(x + w / 2, y - h, w / 2, 8), {
    color: INK, w: LW * 0.8, passes: 1, amp: 1.6, close: true, seed: s + 5,
  });
  return o;
}

/** 笔记本电脑：合着的一台，侧面看是两片。开着的话屏幕上就得有内容，那是另一件事 */
function laptop(x, y, s) {
  const w = 190, h = 26;
  let o = shape([[x, y], [x + w, y - 6], [x + w, y - h], [x, y - h + 5]], {
    fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 2,
  });
  o += stroke([[x + 6, y - h + 3], [x + w - 6, y - h - 2]], { color: INK, w: LW * 0.6, passes: 1, amp: 1.4, seed: s + 2, op: 0.7 });
  return o;
}

/** 文件夹：立着靠边，比纸厚 */
function folder(x, y, s) {
  const w = 118, h = 140;
  let o = shape([[x, y], [x + w, y - 6], [x + w - 4, y - h], [x + 4, y - h + 6]], {
    fill: LIGHT, hatchGap: 14, hatchAngle: 52, hatchOp: 0.22, seed: s, w: LW, line: INK, amp: 2.2,
  });
  o += stroke([[x + 10, y - h * 0.78], [x + w - 14, y - h * 0.8]], { color: INK, w: LW * 0.7, passes: 1, amp: 1.5, seed: s + 4, op: 0.8 });
  return o;
}

/** 手机：平放着。竖着立起来就成了在拍摄/在看，那是动作 */
function phoneFlat(x, y, s) {
  const w = 58, h = 104;
  let o = shape([[x, y], [x + w, y - 5], [x + w - 3, y - h], [x + 3, y - h + 5]], {
    fill: LIGHT, hatchGap: 0, seed: s, w: LW, line: INK, amp: 1.8,
  });
  o += stroke(rectPts(x + 8, y - h + 12, w - 16, h - 26), { color: INK, w: LW * 0.6, passes: 1, amp: 1.4, close: true, seed: s + 3, op: 0.75 });
  return o;
}

const PROPS = { 笔: pen, 纸: sheet, 杯子: cup, 电脑: laptop, 文件夹: folder, 手机: phoneFlat };

/* ─────────────── 每个场景摆什么、摆哪儿 ─────────────── */
//
// `y` 是那个场景桌面（或台面）的线，抄自 scenes.mjs：
// office-desk 桌面 up(0.43)，meeting-room 与 kitchen-table 同高，
// rental-living 的茶几在 up(0.2)。**没有台面的场景不配池子** ——
// 电梯、地铁、街道、候诊区，东西没处放，硬摆就是浮在空中。

/**
 * ⚠ **台面是斜的，摆件要跟着斜。**
 *
 * `scenes.mjs` 里桌子画成梯形（近大远小），`office-desk` 的桌沿从 (520,1018)
 * 斜到 (1070,1052)。按固定 y 摆的话，靠右那件**浮空二十多像素** ——
 * 渲出来一眼就看出「贴上去的」。所以 `y` 是个按 x 插值的函数，两端点抄自各场景的桌面四边形。
 */
const lerpY = (x0, y0, x1, y1) => (x) => y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);

const SURFACE = {
  // 桌面 [[520, up(0.43)], [1070, up(0.40)]]
  "office-desk": { y: lerpY(520, up(0.43) + 4, 1070, up(0.4) + 4), xs: [575, 700, 820, 940], pool: ["笔", "纸", "杯子", "手机", "文件夹"] },
  // 长桌 [[-40, up(0.43)], [1120, up(0.39)]]
  "meeting-room": { y: lerpY(-40, up(0.43) + 4, 1120, up(0.39) + 4), xs: [560, 700, 840, 960], pool: ["笔", "纸", "电脑", "杯子", "文件夹"] },
  // 餐桌 [[-30, up(0.43)], [1110, up(0.40)]]
  "kitchen-table": { y: lerpY(-30, up(0.43) + 4, 1110, up(0.4) + 4), xs: [180, 330, 900, 1000], pool: ["杯子", "纸", "手机"] },
  // 茶几是正矩形，不斜
  "rental-living": { y: () => up(0.2) + 2, xs: [590, 700, 800], pool: ["杯子", "手机"] },
};

/** 种子化 RNG，跟 rough.mjs 一个路子：同 seed 出图完全一致 */
function rng(seed) {
  let t = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 给一个场景摆一两件东西。
 *
 * @param sceneName 场景名（`scenes.mjs` 的 key）
 * @param seed      **传天数号**。同一条片子每帧必须摆得一模一样，
 *                  所以不能用 Math.random —— 那样每帧的笔都在跳。
 * @param opts.skip 稿件的 `object`。**必须传** —— 见文件顶上第二条。
 * @returns SVG 片段；这个场景没台面、或池子被 skip 清空了，就返回空串
 */
export function dressing(sceneName, seed, opts = {}) {
  const conf = SURFACE[sceneName];
  if (!conf) return "";
  const skip = opts.skip ? String(opts.skip) : "";
  // ⚠ 台词点名的那件东西不许摆 —— 摆了就是图解台词
  const pool = conf.pool.filter((k) => k !== skip && PROPS[k]);
  if (!pool.length) return "";

  const r = rng(seed * 2654435761);
  const n = Math.min(pool.length, r() < 0.45 ? 1 : 2);
  const picked = [];
  const bag = [...pool];
  for (let i = 0; i < n; i++) picked.push(bag.splice(Math.floor(r() * bag.length), 1)[0]);

  const slots = [...conf.xs];
  let o = "";
  for (const k of picked) {
    const x = slots.splice(Math.floor(r() * slots.length), 1)[0];
    o += PROPS[k](x, conf.y(x), Math.floor(r() * 1e6));
  }
  return o;
}

/** 这个场景有没有可摆的（给文档和体检用） */
export const dressablePool = (sceneName) => SURFACE[sceneName]?.pool ?? [];
