// ── 把 SMIL 动画烘成静态帧 ────────────────────────────────────────────
//
// **resvg 完全不认 SMIL。** 2026-08-26 实测：`柳条动画_填色.svg` 里有 200 个
// `<animateTransform>`，把它们全删掉再渲，PNG **字节数一模一样**（161141B）——
// 也就是说 resvg 渲的永远是基准姿态，而且**不报错、不警告**。
//
// 这跟仓库里「可变字体的加粗静默失效」是同一种坑：
// **文件看着是对的、渲染看着是成功的，只是没生效。**
// 所以带 SMIL 的素材一律得过这里烘一遍，别直接扔进管线。
//
// 做法：`additive="sum"` 的 rotate 动画，本质是「在父 g 的 transform 后面
// 再乘一个 rotate(θ)」。给定时刻 t 把 θ 算出来、拼到 transform 字符串尾巴上，
// 再把 `<animateTransform>` 删掉 —— 出来就是一张普通的静态 svg。

/** cubic-bezier(x1,y1,x2,y2)：给 x 求 y。keySplines 的缓动就是这个 */
function bezier(sp: number[], x: number): number {
  const [x1, y1, x2, y2] = sp;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const dfx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  // 牛顿八轮，收敛不了就二分兜底
  let t = x;
  for (let i = 0; i < 8; i++) {
    const e = fx(t) - x;
    if (Math.abs(e) < 1e-6) break;
    const d = dfx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= e / d;
  }
  if (t < 0 || t > 1) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; fx(t) < x ? (lo = t) : (hi = t); }
  }
  return ((ay * t + by) * t + cy) * t;
}

const nums = (s: string) => s.trim().split(/[\s,]+/).map(Number);
const secs = (s: string | undefined, dflt = 0) =>
  s === undefined ? dflt : Number(s.replace(/s$/, '')) || 0;

/** 从一个 `<animateTransform .../>` 标签算出 t 时刻的 transform 片段 */
function valueAt(tag: string, t: number): string {
  const at = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(tag)?.[1];
  const type = at('attributeName') === 'transform' ? at('type') : undefined;
  if (!type) return '';
  const dur = secs(at('dur'));
  if (!dur) return '';
  const begin = secs(at('begin'));
  const values = (at('values') ?? '').split(';').filter(Boolean).map(nums);
  if (values.length < 2) return '';
  const kt = at('keyTimes')
    ? nums(at('keyTimes')!.replace(/;/g, ' '))
    : values.map((_, i) => i / (values.length - 1));
  const spl = (at('keySplines') ?? '').split(';').filter(Boolean).map(nums);

  // 相位。begin 常是负数（各枝错开），取模要先补正
  const u = (((t - begin) % dur) + dur) % dur / dur;
  let i = 0;
  while (i < kt.length - 2 && u >= kt[i + 1]) i++;
  const span = kt[i + 1] - kt[i] || 1;
  const local = Math.min(1, Math.max(0, (u - kt[i]) / span));
  const e = at('calcMode') === 'spline' && spl[i]?.length === 4 ? bezier(spl[i], local) : local;
  const v = values[i].map((a, j) => a + ((values[i + 1][j] ?? a) - a) * e);
  return `${type}(${v.map((x) => Number(x.toFixed(4))).join(' ')})`;
}

/**
 * 把整张 svg 烘到 t 时刻（秒）。
 *
 * 只认「`<animateTransform>` 挂在父 `<g>` 上」这一种嵌法 —— 柳条那张就是
 * 一整棵这样的树（枝套枝，每层一个 `additive="sum"` 的 rotate）。
 * `additive="sum"` 对 transform 的语义就是**后乘**，所以直接拼到基准 transform
 * 尾巴上是对的。
 *
 * ⚠ 这里只管 `<animateTransform>`。飘落叶子那套（`animateMotion` + opacity）
 * 在 `bakeMotion()`，两个都要跑就用 `bake()`。收尾一律拿 `bakeCheck()` 卡。
 */
export function bakeSmil(svg: string, t: number): string {
  // **`<g>` 可以不带 transform。** 第一版正则写死了 `<g transform="…">`，
  // 200 个动画漏烘 30 个 —— 而漏掉的那些**不报错，只是不动**。
  // 现在按「任意属性的 g」认：有 transform 就往里拼，没有就补一个。
  let out = svg;
  for (let pass = 0; pass < 4; pass++) {
    const before = out;
    out = out.replace(
      /<g\b([^>]*?)>(\s*)(<animateTransform\b[^>]*?\/>)/g,
      (_m, attrs: string, ws: string, tag: string) => {
        const add = valueAt(tag, t);
        // 认不出来的也照样删掉 —— 留着就是个不报错的哑弹
        if (!add) return `<g${attrs}>${ws}`;
        const merged = /transform="[^"]*"/.test(attrs)
          ? attrs.replace(/transform="([^"]*)"/, (_x, v: string) => `transform="${v} ${add}"`)
          : `${attrs} transform="${add}"`;
        return `<g${merged}>${ws}`;
      }
    );
    if (out === before) break;   // 同一个 g 上可能挂着好几条，扫到不动为止
  }
  return out;
}

/** 烘完还剩 `<animate…>` 就是有没认出来的写法。返回剩几个 */
export function bakeCheck(baked: string): number {
  return (baked.match(/<animate/g) ?? []).length;
}

// ── 飘落的叶子：animateMotion + animate opacity ──────────────────────
//
// 柳条那张里还有 10 片**离枝飘落**的叶子，走的是另一套：沿一条折线路径漂下去，
// 同时淡入淡出。**这是「事件型」动画**（有开头有结尾、会让眼睛去追），
// 跟柳条摆动的「状态型」不是一回事 —— 助眠档要不要留它是内容判断，见
// `dropFalling()`。这里只负责烘得出来。

/** 把 `path="M x,y L x,y x,y …"` 解析成折线，并按弧长参数化 */
function polyline(d: string): { pts: [number, number][]; cum: number[] } {
  const raw = d.replace(/[ML]/g, ' ').trim().split(/[\s]+/);
  const pts: [number, number][] = [];
  for (const tok of raw) {
    const [x, y] = tok.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum };
}

/** t 时刻沿路径走到哪儿。**按弧长匀速**，不是按顶点匀速 */
function motionAt(tag: string, t: number): [number, number] | null {
  const at = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(tag)?.[1];
  const dur = secs(at('dur'));
  const d = at('path');
  if (!dur || !d) return null;
  const { pts, cum } = polyline(d);
  if (pts.length < 2) return null;
  const u = (((t - secs(at('begin'))) % dur) + dur) % dur / dur;
  const target = u * cum[cum.length - 1];
  let i = 0;
  while (i < cum.length - 2 && cum[i + 1] < target) i++;
  const seg = cum[i + 1] - cum[i] || 1;
  const f = (target - cum[i]) / seg;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
}

/** `<animate attributeName="opacity" values keyTimes>` 在 t 时刻的值 */
function scalarAt(tag: string, t: number): number | null {
  const at = (k: string) => new RegExp(`${k}="([^"]*)"`).exec(tag)?.[1];
  const dur = secs(at('dur'));
  const values = (at('values') ?? '').split(';').map(Number).filter((x) => Number.isFinite(x));
  if (!dur || values.length < 2) return null;
  const kt = at('keyTimes')
    ? at('keyTimes')!.split(';').map(Number)
    : values.map((_, i) => i / (values.length - 1));
  const u = (((t - secs(at('begin'))) % dur) + dur) % dur / dur;
  let i = 0;
  while (i < kt.length - 2 && u >= kt[i + 1]) i++;
  const span = kt[i + 1] - kt[i] || 1;
  const f = Math.min(1, Math.max(0, (u - kt[i]) / span));
  return values[i] + (values[i + 1] - values[i]) * f;
}

/**
 * 烘 animateMotion / animate。跟 `bakeSmil` 一样只认「挂在 g 上」这一种。
 * 一个 g 上通常两条都挂着（漂 + 淡），所以一次抓一整串。
 */
export function bakeMotion(svg: string, t: number): string {
  return svg.replace(
    /<g\b([^>]*?)>(\s*(?:<animate(?:Motion)?\b[^>]*?\/>\s*)+)/g,
    (_m, attrs: string, block: string) => {
      let tx: [number, number] | null = null;
      let op: number | null = null;
      for (const tag of block.match(/<animate(?:Motion)?\b[^>]*?\/>/g) ?? []) {
        if (tag.startsWith('<animateMotion')) tx = motionAt(tag, t) ?? tx;
        else if (/attributeName="opacity"/.test(tag)) op = scalarAt(tag, t) ?? op;
      }
      let a = attrs;
      if (tx) {
        const add = `translate(${tx[0].toFixed(2)} ${tx[1].toFixed(2)})`;
        a = /transform="[^"]*"/.test(a)
          ? a.replace(/transform="([^"]*)"/, (_x, v: string) => `transform="${v} ${add}"`)
          : `${a} transform="${add}"`;
      }
      if (op !== null) a = `${a} opacity="${op.toFixed(3)}"`;
      return `<g${a}>`;
    }
  );
}

/** 一次烘完：旋转 + 位移 + 透明度 */
export function bake(svg: string, t: number): string {
  return bakeMotion(bakeSmil(svg, t), t);
}

/**
 * 去掉飘落的叶子，只留摆动的柳条。
 *
 * **助眠档该用这个。** 飘落是事件型：一片叶子从上飘到下，有始有终，
 * 眼睛会跟着走一趟 —— 那正是「让人睁眼」的那种动。柳条摆动没有始终，
 * 眼睛滑过去就完了。判据见 zhiyu-scene.ts 文件头。
 */
export function dropFalling(svg: string): string {
  // ⚠ **不能用正则一刀切。** 第一版写的是 `<g…><animateMotion[\s\S]*?</g>`，
  // 非贪婪的 `</g>` 停在**第一个内层收尾**上，剪出来标签数对不上 ——
  // resvg 报的是「expected 'svg' tag, not 'g'」，完全看不出跟剪叶子有关系。
  // 老老实实数括号。
  let out = '';
  let i = 0;
  for (;;) {
    const m = /<g\b[^>]*?>\s*<animateMotion\b/.exec(out.length ? svg.slice(i) : svg.slice(i));
    if (!m) return out + svg.slice(i);
    const start = i + m.index;
    out += svg.slice(i, start);
    // 从这个 g 往后数深度，找它自己的收尾
    let depth = 0;
    let j = start;
    for (; j < svg.length; j++) {
      if (svg.startsWith('<g', j) && /[\s>]/.test(svg[j + 2] ?? '')) depth++;
      else if (svg.startsWith('</g>', j)) { depth--; if (depth === 0) { j += 4; break; } }
    }
    i = j;
  }
}
