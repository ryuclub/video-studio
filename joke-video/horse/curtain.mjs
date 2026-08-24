/**
 * 开场幕布
 *
 *   import { curtain, CURTAIN_SEC } from "./curtain.mjs";
 *   frame.replace("</svg>", curtain(t / CURTAIN_SEC) + "</svg>")
 *
 * ── 一条硬约束 ──────────────────────────────
 * **0.45 秒拉完，而且配音在幕布还没拉开时就开始。**
 * 前三秒定生死，幕布是在花钱买仪式感；声音先到、画面后到，它才不占时间。
 * 拉到一秒以上就是纯亏。
 *
 * 配色用赭红而不是剧场红丝绒 —— 后者和纸白配棕的整体色系打架。
 */
import { stroke, hatch, poly, jitter, rectPts } from "./rough.mjs";

const W = 1080, H = 1920;
const CLOTH = "#B0563F";
const FOLD = "#8A3F2C";
const RAIL = "#5A4232";
const LINE = "#3B2A22";

export const CURTAIN_SEC = 0.45;   // 拉开时长
/**
 * 闭幕持标题的停留时长（2026-08-24 加）。
 *
 * **配音从第 0 帧就响**，观众在这半秒里是边听边读标题，不是干等 ——
 * 等幕布拉开才出声，那半秒就是纯亏；闭幕超过 0.8 秒开始掉完播。
 * 中文六个字读完约 0.4 秒，0.5–0.7 够读又不至于失去耐心。
 */
export const HOLD_SEC = 0.6;

/** 缓出：开头快、结尾慢，比线性有份量 */
const ease = (p) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 2.2);

/**
 * 中缝重叠量。**两片布必须在中间叠上，不能只是「碰到」。**
 *
 * 原版 `w = W/2 + 30`、右片 `x0 = W/2` —— 两片正好在 x=540 相接、**重叠为零**；
 * 而内缘是波浪（`sin(...)*14`）且左右用了不同 seed，两条边各自摆 ±14 又不同步，
 * 最坏情况裂开 28px。全闭那一帧能看见一条**从上到下的缝**，背景直接漏出来。
 *
 * 60 的重叠量是量出来的：2 × 14（波浪）＋ 2 × 3（jitter）＝ 34，留一倍余量。
 */
const OVERLAP = 30;

function panel(side, seed) {
  const w = W / 2 + 30 + OVERLAP;
  const x0 = side < 0 ? -30 : W / 2 - OVERLAP;
  // 内缘做成波浪，不要一条直边
  const inner = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    inner.push([
      (side < 0 ? x0 + w : x0) + side * Math.sin(t * Math.PI * 2.4 + seed) * 14,
      H * t,
    ]);
  }
  // 两片的点序必须一致：外缘顶点 → 内缘自上而下 → 外缘底点。
  // 右片倒序内缘会画成自交的蝴蝶结，中间露出一个 X 形的洞。
  const outer = side < 0 ? x0 : x0 + w;
  const body = [[outer, 0], ...inner, [outer, H]];

  let o = `<path d="${poly(jitter(body, 3, seed), true)}" fill="${CLOTH}"/>`;
  // 褶皱：竖向波浪线，疏密不均
  for (let i = 1; i < 7; i++) {
    const fx = x0 + (w * i) / 7 + ((i * 37) % 19) - 9;
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      pts.push([fx + Math.sin(t * Math.PI * 2 + i) * 10, H * t]);
    }
    o += stroke(pts, { color: FOLD, w: 7 - (i % 3), passes: 1, amp: 4, seed: seed * 13 + i, op: 0.5 });
  }
  o += stroke(body, { color: LINE, w: 5, passes: 2, amp: 3.4, close: true, seed: seed + 5 });
  return o;
}

/**
 * @param p 0=全闭 1=全开
 */
export function curtain(p = 0) {
  if (p >= 1) return "";
  const shift = ease(p) * (W / 2 + 40);
  // 最后 15% 整体淡出，否则顶轨会在结束那一帧突然消失
  const op = p > 0.85 ? ((1 - p) / 0.15).toFixed(3) : 1;
  let o = `<g id="curtain" opacity="${op}">`;
  // ⚠ **拉到画外的那一片不要再画** —— 不是为了省，是 resvg 会崩。
  //
  // 一个带 `opacity` 的 <g> 会被渲染进离屏图层，而图层尺寸取自组内容的外接框；
  // 最后两帧里两片布都已经整个移出画布（左片右缘 x=-5、右片左缘 x=1115），
  // 离屏图层跟画布**没有交集**，resvg 在 geom.rs 里对空矩形 `unwrap()` 直接 panic ——
  // **Rust panic 是杀进程，不是抛异常，JS 那头 try/catch 接不住**，
  // 表现是 `npm run still` 退出码 3221226505，没有任何错误信息。
  //
  // 触发条件是「组透明度 ＜ 1」和「组内容全在画外」同时成立：
  // 淡出从 p>0.85 开始，而 p>0.86 之后布就全出画布了，那两帧正好撞上。
  // 实测 30fps 下第 12、13 帧崩，第 11 帧（还露 4px）不崩。
  const seen = (x0, x1) => x1 > 0 && x0 < W;
  const wide = W / 2 + 30 + OVERLAP;
  if (seen(-30 - shift, -30 + wide - shift))
    o += `<g transform="translate(${-shift.toFixed(1)},0)">${panel(-1, 3)}</g>`;
  if (seen(W / 2 - OVERLAP + shift, W / 2 - OVERLAP + wide + shift))
    o += `<g transform="translate(${shift.toFixed(1)},0)">${panel(1, 8)}</g>`;
  // 顶轨与吊环：常驻，不跟着拉开
  o += `<path d="${poly(jitter(rectPts(-20, -6, W + 40, 44), 2, 21), true)}" fill="${RAIL}"/>`;
  o += stroke(rectPts(-20, -6, W + 40, 44), { color: LINE, w: 4, passes: 2, amp: 2.6, close: true, seed: 22 });
  for (let i = 0; i < 12; i++) {
    const rx = 46 + i * 90;
    o += stroke([[rx, 38], [rx, 62]], { color: LINE, w: 5, passes: 1, amp: 2, seed: 30 + i });
  }
  return o + `</g>`;
}


/* ═══════ 拆片导出：给 ffmpeg 位移合成用 ═══════
 * 底图只渲一次、两片幕布各渲一次，位移交给 ffmpeg。
 * 比逐帧渲整张画面省掉几乎全部开销 —— 场景和角色才是渲染的大头。
 */

/** 单独一片幕布，画布尺寸不变，透明底。side: "left" | "right" */
export function curtainPanel(side, { rail = true } = {}) {
  const s = side === "left" ? -1 : 1;
  let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  o += panel(s, s < 0 ? 3 : 8);
  if (rail) {
    const half = s < 0 ? rectPts(-20, -6, W / 2 + 30, 44) : rectPts(W / 2, -6, W / 2 + 40, 44);
    o += `<path d="${poly(jitter(half, 2, 21), true)}" fill="${RAIL}"/>`;
    o += stroke(half, { color: LINE, w: 4, passes: 2, amp: 2.6, close: true, seed: 22 });
    for (let i = 0; i < 6; i++) {
      const rx = (s < 0 ? 46 : W / 2 + 46) + i * 90;
      if (rx > W) break;
      o += stroke([[rx, 38], [rx, 62]], { color: LINE, w: 5, passes: 1, amp: 2, seed: 30 + i });
    }
  }
  return o + "</svg>";
}

/** 某一帧该位移多少像素（正数＝向外）。给 ffmpeg 写表达式时对照用 */
export const shiftAt = (p) => ease(p) * (W / 2 + 40);


/* ═══════ 闭幕标题卡（2026-08-24 从素材包接进来）═══════
 *
 * 幕布闭合时把标题打在布面上，观众边听第一句边读标题。
 * **这一帧同时就是封面** —— 点进来的瞬间画面连续，没有割裂感，也省掉单独做一张。
 * 于是三处标题收敛成两处：**幕布写标题，牌匾写栏目名**，不再重复。
 */
const T_FONT = "Smiley Sans, Noto Sans CJK SC Black, sans-serif";
const T_SUB = "Noto Sans CJK SC, sans-serif";
const CREAM = "#FAF6EC";
const DEEP = "#41211A";

/**
 * ⚠ **标题和副标题都必须带深色描边。**
 * 幕布拉开后底下是浅色纸白，**奶白色无描边的字会直接消失** ——
 * 主标题本来就有描边所以没事，副标题和那条分隔线是后来补的：
 * 它们在幕布期间看得见、拉开后就没了。这类「只在某个阶段才暴露」的问题，
 * 必须把整段时间轴都渲出来才看得见。
 */
export function curtainTitle({ text, sub = "", y = 0.40 }) {
  const cy = H * y;
  const fs = Math.min(150, (W * 0.74) / Math.max([...text].length, 1));
  let o = `<g id="curtain-title">`;
  o += `<text x="${W / 2}" y="${cy}" font-family="${T_FONT}" font-size="${fs}" text-anchor="middle" fill="none" stroke="${DEEP}" stroke-width="${fs * 0.16}" stroke-linejoin="round">${text}</text>`;
  o += `<text x="${W / 2}" y="${cy}" font-family="${T_FONT}" font-size="${fs}" text-anchor="middle" fill="${CREAM}">${text}</text>`;
  if (sub) {
    const ss = fs * 0.34;
    o += stroke([[W / 2 - fs * 1.5, cy + fs * 0.42], [W / 2 + fs * 1.5, cy + fs * 0.44]],
      { color: DEEP, w: 7, passes: 1, amp: 2.4, seed: 40, op: 0.85 });
    o += stroke([[W / 2 - fs * 1.5, cy + fs * 0.42], [W / 2 + fs * 1.5, cy + fs * 0.44]],
      { color: CREAM, w: 4, passes: 1, amp: 2.4, seed: 41, op: 0.9 });
    o += `<text x="${W / 2}" y="${cy + fs * 0.86}" font-family="${T_SUB}" font-size="${ss}" text-anchor="middle" fill="none" stroke="${DEEP}" stroke-width="${ss * 0.28}" stroke-linejoin="round">${sub}</text>`;
    o += `<text x="${W / 2}" y="${cy + fs * 0.86}" font-family="${T_SUB}" font-size="${ss}" text-anchor="middle" fill="${CREAM}">${sub}</text>`;
  }
  return o + `</g>`;
}

/**
 * 整个开场：闭幕持标题 → 拉开 → 标题淡出。返回该帧的覆盖层。
 *
 * **标题固定在画面中间，不跟着幕布走。** 幕布从它两侧拉开，标题在幕布走完之后才淡出，
 * 这样标题始终可读、不会被拉扯变形。
 * （试过让标题沿中线劈成两半各跟一片走，"印在布上"的逻辑更硬，但拉开过程中
 *   标题被撕成两截反而看不清。**可读性优先于逻辑自洽。**）
 *
 * ⚠ **这儿的两片布必须走 `curtain()` 那套画法，不能照素材包里的 opening() 抄。**
 * 素材包那版是旧底子：既没有中缝重叠（全闭那一帧会裂开一条缝、背景漏出来），
 * 也没有「拉到画外就不画」的判断（最后两帧 resvg 直接 panic，退出码 3221226505、
 * 一行错误都没有）。两处都是这个仓库修过的，接新功能不能把它们带回去。
 */
export function opening(t, { text, sub, hold = HOLD_SEC, open = CURTAIN_SEC, linger = 0.38 } = {}) {
  const p = t < hold ? 0 : (t - hold) / open;
  if (p >= 1 + linger / open) return "";

  // 标题：幕布走完之后才开始淡出，再用 linger 秒消失
  let tOp = 1;
  if (p > 1) tOp = Math.max(0, 1 - (p - 1) * (open / linger));

  let o = `<g id="opening">`;
  if (p < 1) o += curtain(p);
  if (tOp > 0) o += `<g opacity="${tOp.toFixed(3)}">${curtainTitle({ text, sub })}</g>`;
  return o + `</g>`;
}

/** 开场整段占多久（闭幕 ＋ 拉开 ＋ 标题淡出）。字幕要等它走完 */
export const OPENING_SEC = HOLD_SEC + CURTAIN_SEC + 0.38;
