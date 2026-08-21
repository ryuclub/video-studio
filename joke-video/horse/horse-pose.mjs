/**
 * 马 · 表情驱动
 *
 *   import { pose, lipsync } from "./horse-pose.mjs";
 *   writeFileSync("f.svg", pose(rig, { eyeX: -18, eyeY: 4, mouth: "A", turn: -12 }));
 *
 * 参数：
 *   eyeX/eyeY  眼珠位移，安全范围 ±26 / ±22（超出会顶出眼白）
 *   mouth      null | "A" | "I" | "O" | "E"
 *   turn       扭头角度，正=向右。±25 度以内可信，再大就该换整张头了
 *   headY      整个头上下浮动（点头、呼吸）
 */

const HEAD_CX = 352;   // 扭头的垂直轴
const DEPTH = 46;      // 视差量：脸相对头壳的横移系数
const MOUTHS = ["A", "I", "O", "E"];

export function pose(rig, { eyeX = 0, eyeY = 0, mouth = null, turn = 0, headY = 0 } = {}) {
  let s = rig;

  const ex = clamp(eyeX, -26, 26);
  const ey = clamp(eyeY, -22, 22);
  for (const side of ["l", "r"]) {
    s = s.replace(
      new RegExp(`<g id="pupil-${side}" transform="[^"]*">`),
      `<g id="pupil-${side}" transform="translate(${ex.toFixed(1)},${ey.toFixed(1)})">`
    );
  }

  // 口型：全部先关掉，再开指定的那个
  if (mouth) {
    s = s.replace('<g id="mouth-closed">', '<g id="mouth-closed" style="display:none">');
    if (!MOUTHS.includes(mouth)) throw new Error(`未知口型 ${mouth}`);
    s = s.replace(`<g id="mouth-${mouth}" style="display:none">`, `<g id="mouth-${mouth}">`);
  }

  const a = (turn * Math.PI) / 180;
  const sx = Math.cos(a);
  const shift = DEPTH * Math.sin(a);
  s = s.replace(
    /<g id="head" transform="[^"]*">/,
    `<g id="head" transform="translate(${HEAD_CX},${headY.toFixed(1)}) scale(${sx.toFixed(4)},1) translate(${-HEAD_CX},0)">`
  );
  s = s.replace(
    /<g id="face" transform="[^"]*">/,
    `<g id="face" transform="translate(${shift.toFixed(1)},0)">`
  );
  return s;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** 粗口型对齐：把一串带时间戳的音节转成每帧的口型 */
export function lipsync(syllables, fps = 24, total = null) {
  // syllables: [{ t: 起始秒, d: 时长秒, v: "a"|"i"|"u"|"e"|"o" }]
  const map = { a: "A", i: "I", u: "O", e: "E", o: "O" };
  const n = Math.round((total ?? syllables.at(-1).t + syllables.at(-1).d) * fps);
  const out = new Array(n).fill(null);
  for (const s of syllables) {
    const from = Math.round(s.t * fps);
    const to = Math.round((s.t + s.d) * fps);
    for (let i = from; i < to && i < n; i++) out[i] = map[s.v] ?? "E";
    // 每个音节末尾留一帧闭口，避免糊成一团
    if (to - 1 < n) out[to - 1] = null;
  }
  return out;
}

/** 自然的眼神游移：低频漂移 + 偶发扫视，比纯随机好看 */
export function idleEyes(frame, fps = 24, seed = 1) {
  const t = frame / fps;
  const drift = Math.sin(t * 0.7 + seed) * 6 + Math.sin(t * 0.23 + seed * 2) * 4;
  const saccade = Math.floor(t / 2.6 + seed) % 3 === 0 ? 14 : 0;
  return { eyeX: drift + saccade, eyeY: Math.sin(t * 0.41) * 3 };
}
