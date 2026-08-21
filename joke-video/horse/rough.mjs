/**
 * 手绘感线条库（rough.py 的 Node 版）
 *
 * 原理：贝塞尔采样成点 → 加噪声抖动 → 同一条线画两遍且第二遍略偏移变淡。
 * 填充用按角度铺的排线，间距和长度都带随机，模拟铅笔涂抹。
 *
 * 所有随机都走种子化 RNG，同一个 seed 出的图永远一样 —— 场景可复现，
 * 改一帧不会导致整张图的笔触重新洗牌。
 */

/** mulberry32：小而快的种子化随机 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = (r, lo, hi) => lo + r() * (hi - lo);

/** 一段三次贝塞尔 → 点列 */
export function bez(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/** 连续多段贝塞尔 → 点列。segs: [[p0,p1,p2,p3], ...] */
export function sample(segs, n = 22) {
  let out = [];
  for (const s of segs) out = out.concat(bez(s[0], s[1], s[2], s[3], n).slice(0, -1));
  out.push(segs[segs.length - 1][3]);
  return out;
}

/** 给点列加手抖 */
export function jitter(pts, amp = 3, seed = 0) {
  const r = rng(seed * 2654435761 + 12345);
  const ph = r() * 10;
  return pts.map(([x, y], i) => [
    x + Math.sin(i * 0.204 + ph) * amp + rand(r, -amp * 0.45, amp * 0.45),
    y + Math.cos(i * 0.156 + ph * 1.7) * amp + rand(r, -amp * 0.45, amp * 0.45),
  ]);
}

export function poly(pts, close = false) {
  const d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)} ` +
    pts.slice(1).map(p => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return close ? d + " Z" : d;
}

/** 多遍描画的手绘线 */
export function stroke(pts, {
  color = "#3B322B", w = 3.2, passes = 2, amp = 2.6,
  close = false, seed = 1, op = 0.92,
} = {}) {
  let out = "";
  for (let k = 0; k < passes; k++) {
    const j = jitter(pts, amp * (0.7 + 0.5 * k), seed * 97 + k * 13);
    out += `<path d="${poly(j, close)}" fill="none" stroke="${color}" ` +
      `stroke-width="${(w * (1 - 0.18 * k)).toFixed(2)}" stroke-linecap="round" ` +
      `stroke-linejoin="round" opacity="${(op - 0.22 * k).toFixed(2)}"/>`;
  }
  return out;
}

/** 点是否在多边形内（射线法） */
export function inside(pp, x, y) {
  let c = false;
  for (let i = 0, n = pp.length; i < n; i++) {
    const [x1, y1] = pp[i], [x2, y2] = pp[(i + 1) % n];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1 + 1e-9) + x1) c = !c;
  }
  return c;
}

/** 在多边形内按角度铺排线 */
export function hatch(pp, {
  angle = 58, gap = 9, color = "#8A5426", w = 1.5,
  amp = 1.4, seed = 3, op = 0.5, jitterGap = true,
} = {}) {
  const r = rng(seed * 40503 + 7);
  const xs = pp.map(p => p[0]), ys = pp.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const diag = Math.hypot(x1 - x0, y1 - y0);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;

  let out = "";
  for (let t = -diag / 2; t < diag / 2; t += gap * (jitterGap ? rand(r, 0.75, 1.3) : 1)) {
    const px = cx + nx * t, py = cy + ny * t;
    let seg = [];
    const runs = [];
    for (let s = -diag / 2; s < diag / 2; s += 4) {
      const X = px + dx * s, Y = py + dy * s;
      if (inside(pp, X, Y)) seg.push([X, Y]);
      else { if (seg.length > 3) runs.push(seg); seg = []; }
    }
    if (seg.length > 3) runs.push(seg);
    for (const run of runs) {
      const three = [run[0], run[(run.length / 2) | 0], run[run.length - 1]];
      out += `<path d="${poly(jitter(three, amp, (r() * 9999) | 0))}" fill="none" ` +
        `stroke="${color}" stroke-width="${w.toFixed(2)}" stroke-linecap="round" ` +
        `opacity="${(op * rand(r, 0.7, 1.0)).toFixed(2)}"/>`;
    }
  }
  return out;
}

/** 便捷图元 */
export const rectPts = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export function ellipsePts(cx, cy, rx, ry, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

/** 一个"有填充 + 排线 + 手绘轮廓"的形状，场景里反复用到 */
export function shape(pts, {
  fill = null, hatchColor = "#6E6459", hatchGap = 14, hatchAngle = 48,
  hatchOp = 0.26, line = "#3B322B", w = 3.2, seed = 1, amp = 2.4,
} = {}) {
  let out = "";
  if (fill) out += `<path d="${poly(jitter(pts, 2, seed), true)}" fill="${fill}"/>`;
  if (hatchGap > 0) out += hatch(pts, { angle: hatchAngle, gap: hatchGap, color: hatchColor, w: 1.3, op: hatchOp, seed: seed + 1 });
  out += stroke(pts, { color: line, w, passes: 2, amp, close: true, seed: seed + 2 });
  return out;
}
