/**
 * 落点符号
 *
 *   import { emote, EMOTE_SEC } from "./emote.mjs";
 *   svg += emote("dots", { p, x: 0.62, y: 0.20 });
 *
 * ── 为什么只有两个符号 ────────────────────────
 * 汗滴是慌张、感叹号是兴奋、星星是可爱、井字纹是生气 —— 全都是**画面替观众表态**，
 * 和"只陈述不评论"的人设正相反。老马能用的符号只有一类：**表达"没有情绪"的**。
 *
 * ── 位置 ──────────────────────────────────────
 * **贴着头侧上方**，不要飘在远处的墙上 —— 离得远就读成场景装饰，
 * 建立不起"这是他的反应"这层关系。角色站左就放头的右上，站右则相反。
 *
 * ── 时机 ──────────────────────────────────────
 * 只在**落点说完之后的定格里**出现。落点之前或同时出现就成了"这里好笑"的提示。
 * 一条片子最多一个，**且不是每条都有** —— 建议三成左右。
 *
 * 三个点要**依次**浮现，不能一起出。一起出是图形，依次出才是"他还没开口 / 他不打算说了"。
 */
import { stroke, poly, jitter, ellipsePts } from "./rough.mjs";

const INK = "#3B322B";
export const EMOTE_SEC = 1.0;      // 完整浮现时长

const fadeIn = (p, i, n) => {
  const each = 0.42;                            // 每个点的淡入时长（占比）
  const start = (i / n) * (1 - each) * 1.15;
  return Math.max(0, Math.min(1, (p - start) / each));
};

/**
 * @param kind dots 省略号 | dash 一横（更冷）
 * @param p    0→1 浮现进度
 */
const FONT = "Smiley Sans, Noto Sans CJK SC Black, sans-serif";

/** 每个符号都必须通过同一条测试：陈述事实或"没有情绪"，不替观众表态 */
export const SYMBOLS = {
  dots:     "省略号 …    没话说。最通用，落点后默认用这个",
  dash:     "一横 —      比省略号更冷，什么都不想说",
  question: "小问号 ?    不明白。要画得极小，大了就成了卖萌",
  num:      "数字        呼应落点里的数字，传 value",
  calendar: "日历撕页    呼应时间、天数、周期",
  clock:    "小钟        呼应等待、时长",
  zzz:      "zZ          困。老马唯一允许的生理状态",
  sink:     "下沉短箭头  算了。比省略号重一点",
};

const rp = (pts, seed, amp = 1.6) => poly(jitter(pts, amp, seed), true);

/**
 * @param kind SYMBOLS 里的键
 * @param p    0→1 浮现进度
 * @param value num 用的数字
 */
export function emote(kind = "dots", { p = 1, x = 0.42, y = 0.165, scale = 1.15, value = "", W = 1080, H = 1920, seed = 5 } = {}) {
  const cx = W * x, cy = H * y;
  const A = Math.max(0, Math.min(1, p));
  const rise = (a) => `translate(0,${((1 - a) * 10).toFixed(1)})`;
  let o = `<g id="emote" transform="translate(${cx.toFixed(0)},${cy.toFixed(0)}) scale(${scale})">`;

  if (kind === "dots") {
    for (let i = 0; i < 3; i++) {
      const a = fadeIn(A, i, 3);
      if (a <= 0) continue;
      o += `<g transform="${rise(a)}" opacity="${a.toFixed(2)}"><path d="${rp(ellipsePts(-58 + i * 58, 0, 15, 15, 20), seed + i, 1.4)}" fill="${INK}"/></g>`;
    }
  } else if (kind === "dash") {
    o += `<g opacity="${A.toFixed(2)}">${stroke([[-62, 0], [0, 4], [62, 0]], { color: INK, w: 9, passes: 2, amp: 2.4, seed })}</g>`;
  } else if (kind === "question") {
    o += `<g transform="${rise(A)}" opacity="${A.toFixed(2)}">` +
      stroke([[-22, -30], [-4, -44], [16, -34], [10, -14], [-2, -4], [-2, 6]], { color: INK, w: 8, passes: 2, amp: 2.2, seed }) +
      `<path d="${rp(ellipsePts(-2, 26, 8, 8, 16), seed + 1, 1.2)}" fill="${INK}"/></g>`;
  } else if (kind === "num") {
    o += `<g transform="${rise(A)}" opacity="${A.toFixed(2)}">` +
      `<text x="0" y="16" font-family="${FONT}" font-size="62" text-anchor="middle" fill="${INK}">${value}</text></g>`;
  } else if (kind === "calendar") {
    o += `<g transform="${rise(A)}" opacity="${A.toFixed(2)}">` +
      `<path d="${rp([[-40, -34], [40, -38], [44, 30], [-36, 34]], seed, 2)}" fill="#FBF8F1"/>` +
      stroke([[-40, -34], [40, -38], [44, 30], [-36, 34]], { color: INK, w: 5, passes: 2, amp: 2.4, close: true, seed: seed + 1 }) +
      stroke([[-38, -14], [42, -18]], { color: INK, w: 4, passes: 1, amp: 2, seed: seed + 2 }) +
      // 撕掉的一角
      `<path d="${rp([[16, 30], [44, 24], [40, 48]], seed + 3, 2)}" fill="#FBF8F1"/>` +
      stroke([[16, 30], [44, 24], [40, 48]], { color: INK, w: 4, passes: 1, amp: 2.2, close: true, seed: seed + 4 }) + `</g>`;
  } else if (kind === "clock") {
    o += `<g transform="${rise(A)}" opacity="${A.toFixed(2)}">` +
      `<path d="${rp(ellipsePts(0, 0, 38, 38, 28), seed, 1.8)}" fill="#FBF8F1"/>` +
      stroke(ellipsePts(0, 0, 38, 38, 28), { color: INK, w: 5, passes: 2, amp: 2, close: true, seed: seed + 1 }) +
      stroke([[0, 0], [0, -22]], { color: INK, w: 5, passes: 1, amp: 1.4, seed: seed + 2 }) +
      stroke([[0, 0], [18, 8]], { color: INK, w: 5, passes: 1, amp: 1.4, seed: seed + 3 }) + `</g>`;
  } else if (kind === "zzz") {
    [[-38, 10, 34], [8, -18, 46], [58, -46, 58]].forEach(([zx, zy, zs], i) => {
      const a = fadeIn(A, i, 3);
      if (a <= 0) return;
      o += `<g transform="${rise(a)}" opacity="${a.toFixed(2)}">` +
        stroke([[zx - zs * 0.3, zy - zs * 0.3], [zx + zs * 0.3, zy - zs * 0.3], [zx - zs * 0.3, zy + zs * 0.3], [zx + zs * 0.3, zy + zs * 0.3]],
          { color: INK, w: 6, passes: 2, amp: 2, seed: seed + i }) + `</g>`;
    });
  } else if (kind === "sink") {
    o += `<g transform="translate(0,${((1 - A) * -14).toFixed(1)})" opacity="${A.toFixed(2)}">` +
      stroke([[0, -34], [0, 22]], { color: INK, w: 8, passes: 2, amp: 2, seed }) +
      stroke([[-20, 2], [0, 26], [20, 2]], { color: INK, w: 8, passes: 2, amp: 2, seed: seed + 1 }) + `</g>`;
  }
  return o + `</g>`;
}


/** 落点定格里该不该出符号、出到第几分。setup/hook/turn 一律返回 null */
export function emoteAt({ type, t, dur, pauseAfter = 0, delay = 0.3, enabled = true }) {
  if (!enabled || type !== "punch") return null;
  const s = dur + delay;
  if (t < s) return null;
  return Math.min(1, (t - s) / EMOTE_SEC);
}
