import type { SceneSpec } from '../types';
import { JAPAN, cityXY, prefOf } from './japan-geo';
import { escapeXml, easeOut, easeInOut, stagger, clamp01, enter, type FrameFn } from './svgRender';

/**
 * 内置动效场景。
 *
 * 为什么这些必须用代码渲染、不能交给 AI：
 * 数字、坐标轴、年份、引文 —— AI 视频模型对文字的还原是随机的，
 * 生成出来的「1997」可能变成「l99７」，图表刻度会自己漂移。
 * 而这类画面恰恰是文案解说片的骨架，出错就是硬伤。
 *
 * 两种渲染模式：
 *   不透明（整屏切换）—— 画满底色，动效就是这个镜头的全部
 *   透明（叠加到已有画面）—— 不画底色，只画一块半透明衬底 + 内容
 *
 * 叠加模式下底层视频的亮度不可控，浅色画面上白字会直接消失，
 * 所以衬底默认开启，并且所有文字都带深色描边兜底。
 */

export const THEME = {
  bg: '#0d1117',
  scrim: 'rgba(11,15,21,0.86)',
  scrimEdge: 'rgba(120,140,170,0.22)',
  grid: '#232a33',
  gridOnScrim: '#2e3949',
  accent: '#e0603a',
  accent2: '#4a9eba',
  text: '#e6edf3',
  muted: '#8a94a3',
  font: "'Noto Sans CJK SC','Noto Sans CJK JP','Source Han Sans','Microsoft YaHei',sans-serif",
  serif: "'Noto Serif CJK SC','Noto Serif CJK JP','Source Han Serif',serif",
};

export interface SceneOpts {
  /** true = 不画底色，供叠加使用 */
  transparent?: boolean;
  /** 叠加时是否画半透明衬底。默认跟随 transparent */
  scrim?: boolean;
}

interface Ctx {
  W: number;
  H: number;
  /** 字号缩放系数。画布比 1920 窄时字要跟着缩，否则叠加成小面板会挤爆 */
  u: number;
  transparent: boolean;
  scrim: boolean;
  /** 内容安全区 */
  box: { x0: number; x1: number; y0: number; y1: number };
}

function makeCtx(W: number, H: number, o: SceneOpts): Ctx {
  const transparent = !!o.transparent;
  const scrim = o.scrim ?? transparent;
  // 叠加模式下内容往里收，衬底才有边距可言
  const m = transparent ? 0.055 : 0.0;
  return {
    W,
    H,
    u: Math.max(0.7, Math.min(1.6, W / 1920)),
    transparent,
    scrim,
    box: { x0: W * (0.1 + m), x1: W * (0.9 - m), y0: H * (0.2 + m), y1: H * (0.86 - m) },
  };
}

export function buildSceneFrameFn(
  scene: SceneSpec,
  W: number,
  H: number,
  opts: SceneOpts = {},
): FrameFn {
  const ctx = makeCtx(W, H, opts);
  switch (scene.kind) {
    case 'lineChart':
      return lineChart(scene, ctx);
    case 'barChart':
      return barChart(scene, ctx);
    case 'counter':
      return counter(scene, ctx);
    case 'timeline':
      return timeline(scene, ctx);
    case 'quote':
      return quote(scene, ctx);
    case 'steps':
      return steps(scene, ctx);
    case 'subtitleStack':
      return subtitleStack(scene, ctx);
    case 'maskTitle':
      return maskTitle(scene, ctx);
    case 'glitchTitle':
      return glitchTitle(scene, ctx);
    case 'compareBars':
      return compareBars(scene, ctx);
    case 'arrowAnnotate':
      return arrowAnnotate(scene, ctx);
    case 'flash':
      return flash(scene, ctx);
    case 'spotlight':
      return spotlight(scene, ctx);
    case 'grain':
      // 颗粒本身是 ffmpeg 的 noise 滤镜（见 overlay.ts），SVG 这层只画漏光
      return grainLeak(scene, ctx);
    case 'japanMap':
      return japanMap(scene, ctx);
    default: {
      const never: never = scene.kind;
      throw new Error(`未知场景类型：${String(never)}`);
    }
  }
}

// ── 通用零件 ────────────────────────────────────────────────

/** 字号：按画布宽度缩放并取整 */
function fz(c: Ctx, base: number): number {
  return Math.max(11, Math.round(base * c.u));
}

function shell(c: Ctx, body: string): string {
  const { W, H } = c;
  let bg: string;
  let defs = '';

  if (c.transparent) {
    bg = c.scrim
      ? `<rect x="${(W * 0.03).toFixed(0)}" y="${(H * 0.05).toFixed(0)}" width="${(W * 0.94).toFixed(0)}" height="${(H * 0.9).toFixed(0)}" rx="${fz(c, 18)}" fill="${THEME.scrim}" stroke="${THEME.scrimEdge}" stroke-width="1.5"/>`
      : '';
    // 底层视频亮度不可控，所有文字加深色描边兜底。
    // paint-order=stroke 让描边画在字形下面，不会把笔画吃细。
    defs = `<style>text{paint-order:stroke;stroke:${THEME.bg};stroke-width:${Math.max(3, Math.round(4 * c.u))}px;stroke-linejoin:round;stroke-opacity:0.85;}</style>`;
  } else {
    bg = `<rect width="${W}" height="${H}" fill="${THEME.bg}"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>${defs}</defs>${bg}${body}</svg>`;
}

function gridColor(c: Ctx): string {
  return c.transparent ? THEME.gridOnScrim : THEME.grid;
}

function titleBlock(scene: SceneSpec, c: Ctx, p: number): string {
  if (!scene.title) return '';
  const a = easeOut(stagger(p, 0, 0.25));
  const dy = (1 - a) * 24 * c.u;
  const x = c.box.x0;
  const ty = c.transparent ? c.H * 0.16 : c.H * 0.105;
  const sub = scene.subtitle
    ? `<text x="${x.toFixed(0)}" y="${(ty + fz(c, 52) + dy).toFixed(0)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 30)}" opacity="${a.toFixed(3)}">${escapeXml(scene.subtitle)}</text>`
    : '';
  return `<text x="${x.toFixed(0)}" y="${(ty + dy).toFixed(0)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fz(c, 54)}" font-weight="700" opacity="${a.toFixed(3)}">${escapeXml(scene.title)}</text>${sub}`;
}

// ── lineChart ───────────────────────────────────────────────

function lineChart(scene: SceneSpec, c: Ctx): FrameFn {
  const data = scene.series ?? [];
  const max = Math.max(1, ...data);
  const b = c.box;

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const grow = easeInOut(stagger(p, 0.15, 0.7));
    const shown = grow * (data.length - 1);

    const pts: [number, number][] = [];
    const px = (k: number) => b.x0 + (k * (b.x1 - b.x0)) / Math.max(1, data.length - 1);
    const py = (v: number) => b.y1 - (v / max) * (b.y1 - b.y0);

    for (let k = 0; k < data.length; k++) {
      if (k > shown) break;
      pts.push([px(k), py(data[k] ?? 0)]);
    }
    // 末端插值到小数进度，线才是连续生长的而不是一段一段蹦出来
    const fi = Math.floor(shown);
    const fr = shown - fi;
    if (fr > 0 && fi + 1 < data.length) {
      const ax = px(fi), ay = py(data[fi] ?? 0);
      const bx = px(fi + 1), by = py(data[fi + 1] ?? 0);
      pts.push([ax + (bx - ax) * fr, ay + (by - ay) * fr]);
    }

    const d = pts.map((q, k) => `${k ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    const gridA = easeOut(stagger(p, 0.05, 0.2));

    const grid = [0, 0.25, 0.5, 0.75, 1]
      .map((v) => {
        const y = b.y1 - v * (b.y1 - b.y0);
        return `<line x1="${b.x0.toFixed(0)}" y1="${y.toFixed(1)}" x2="${b.x1.toFixed(0)}" y2="${y.toFixed(1)}" stroke="${gridColor(c)}" stroke-width="2" opacity="${gridA.toFixed(3)}"/>`;
      })
      .join('');

    const area =
      pts.length > 1
        ? `<path d="${d} L${last![0].toFixed(1)} ${b.y1.toFixed(1)} L${pts[0]![0].toFixed(1)} ${b.y1.toFixed(1)} Z" fill="${THEME.accent}" opacity="0.10"/>`
        : '';
    const line =
      pts.length > 1
        ? `<path d="${d}" fill="none" stroke="${THEME.accent}" stroke-width="${Math.round(6 * c.u)}" stroke-linecap="round" stroke-linejoin="round"/>`
        : '';
    const head = last
      ? `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="${Math.round(10 * c.u)}" fill="${THEME.accent}"/>`
      : '';
    const unit = scene.unit
      ? `<text x="${b.x1.toFixed(0)}" y="${(b.y1 + fz(c, 46)).toFixed(0)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 28)}" text-anchor="end">${escapeXml(scene.unit)}</text>`
      : '';

    return shell(c, `${grid}${area}${line}${head}${titleBlock(scene, c, p)}${unit}`);
  };
}

// ── barChart ────────────────────────────────────────────────

function barChart(scene: SceneSpec, c: Ctx): FrameFn {
  const data = scene.series ?? [];
  const labels = scene.labels ?? [];
  const max = Math.max(1, ...data);
  const b = c.box;

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const n = Math.max(1, data.length);
    const slot = (b.x1 - b.x0) / n;
    const bw = slot * 0.56;

    const bars = data
      .map((v, k) => {
        // 交错入场：每根柱子延迟一点点，视觉节奏比一起长出来好得多
        const a = easeOut(stagger(p, 0.12 + (k / n) * 0.45, 0.35));
        const h = (v / max) * (b.y1 - b.y0) * a;
        const x = b.x0 + slot * k + (slot - bw) / 2;
        const y = b.y1 - h;
        const lbl = labels[k]
          ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(b.y1 + fz(c, 42)).toFixed(0)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 26)}" text-anchor="middle" opacity="${a.toFixed(3)}">${escapeXml(labels[k]!)}</text>`
          : '';
        const val =
          a > 0.85
            ? `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 14 * c.u).toFixed(1)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fz(c, 28)}" font-weight="600" text-anchor="middle">${v}</text>`
            : '';
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${THEME.accent}" rx="${Math.round(4 * c.u)}"/>${lbl}${val}`;
      })
      .join('');

    const axis = `<line x1="${b.x0.toFixed(0)}" y1="${b.y1.toFixed(1)}" x2="${b.x1.toFixed(0)}" y2="${b.y1.toFixed(1)}" stroke="${gridColor(c)}" stroke-width="3"/>`;
    return shell(c, `${axis}${bars}${titleBlock(scene, c, p)}`);
  };
}

// ── counter（数字滚动，支持并排多个）────────────────────────

function counter(scene: SceneSpec, c: Ctx): FrameFn {
  // 单个写 from/to，并排写 values[]
  const items =
    scene.values && scene.values.length
      ? scene.values
      : [{ label: scene.title ?? '', from: scene.from ?? 0, to: scene.to ?? 100, suffix: scene.suffix ?? '' }];
  const n = items.length;

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    // 并排的数字同时滚动，不做交错 —— 交错会让人以为它们有先后关系
    const a = easeOut(stagger(p, 0.1, 0.6));
    const fadeIn = easeOut(stagger(p, 0, 0.2));
    const cy = c.H * (n > 1 ? 0.56 : 0.55);
    const numSize = fz(c, n > 2 ? 92 : n > 1 ? 118 : 150);

    const cols = items
      .map((it, k) => {
        const x = c.W * ((k + 0.5) / n);
        const v = it.from + (it.to - it.from) * a;
        const isInt = Number.isInteger(it.from) && Number.isInteger(it.to);
        const txt = (isInt ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + (it.suffix ?? '');
        const lbl = it.label
          ? `<text x="${x.toFixed(0)}" y="${(cy - numSize * 0.85).toFixed(0)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fz(c, n > 1 ? 34 : 42)}" text-anchor="middle" opacity="${fadeIn.toFixed(3)}">${escapeXml(it.label)}</text>`
          : '';
        return `${lbl}<text x="${x.toFixed(0)}" y="${cy.toFixed(0)}" fill="${THEME.accent}" font-family="${THEME.font}" font-size="${numSize}" font-weight="800" text-anchor="middle" opacity="${fadeIn.toFixed(3)}">${escapeXml(txt)}</text>`;
      })
      .join('');

    // 说明行在数字滚完之后才浮出来，避免观众提前读到结论
    const noteA = easeOut(stagger(p, 0.72, 0.25));
    const note = scene.subtitle
      ? `<text x="${(c.W / 2).toFixed(0)}" y="${(cy + numSize * 0.62 + (1 - noteA) * 18 * c.u).toFixed(0)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 34)}" text-anchor="middle" opacity="${noteA.toFixed(3)}">${escapeXml(scene.subtitle)}</text>`
      : '';
    const head = n > 1 && scene.title ? titleBlock({ ...scene, subtitle: undefined }, c, p) : '';

    return shell(c, `${head}${cols}${note}`);
  };
}

// ── timeline ────────────────────────────────────────────────

function timeline(scene: SceneSpec, c: Ctx): FrameFn {
  const ev = (scene.events ?? []).slice(0, 6);
  const y = c.H * 0.56;
  // 首尾往里收，否则第一个和最后一个节点的居中文字会被画面边缘切掉
  const x0 = c.W * 0.14;
  const x1 = c.W * 0.86;

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const lineA = easeInOut(stagger(p, 0.05, 0.35));
    const lx = x0 + (x1 - x0) * lineA;

    const nodes = ev
      .map((e, k) => {
        const at = ev.length <= 1 ? 0 : k / (ev.length - 1);
        const a = easeOut(stagger(p, 0.15 + at * 0.55, 0.25));
        if (a <= 0) return '';
        const x = x0 + (x1 - x0) * at;
        // 上下交错排布，相邻节点的文字才不会挤在一起
        const up = k % 2 === 0;
        const yearY = up ? y - 96 * c.u : y + 72 * c.u;
        const descY = up ? y - 56 * c.u : y + 112 * c.u;
        const dy = (1 - a) * (up ? 16 : -16) * c.u;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(0)}" r="${(9 * c.u * a).toFixed(1)}" fill="${THEME.accent}"/>
<line x1="${x.toFixed(1)}" y1="${y.toFixed(0)}" x2="${x.toFixed(1)}" y2="${(up ? y - 40 * c.u : y + 40 * c.u).toFixed(1)}" stroke="${gridColor(c)}" stroke-width="2" opacity="${a.toFixed(3)}"/>
<text x="${x.toFixed(1)}" y="${(yearY + dy).toFixed(1)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fz(c, 38)}" font-weight="700" text-anchor="middle" opacity="${a.toFixed(3)}">${escapeXml(e.year)}</text>
<text x="${x.toFixed(1)}" y="${(descY + dy).toFixed(1)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 26)}" text-anchor="middle" opacity="${a.toFixed(3)}">${escapeXml(e.text)}</text>`;
      })
      .join('');

    const line = `<line x1="${x0.toFixed(0)}" y1="${y.toFixed(0)}" x2="${lx.toFixed(1)}" y2="${y.toFixed(0)}" stroke="${gridColor(c)}" stroke-width="4"/>`;
    return shell(c, `${line}${nodes}${titleBlock(scene, c, p)}`);
  };
}

// ── quote（金句卡，支持逐字打出 + 关键词强调）──────────────

function quote(scene: SceneSpec, c: Ctx): FrameFn {
  const raw = tidyCaption(scene.text ?? '');
  const typewriter = !!scene.typewriter;
  // 关键词必须显式给出，不自动识别 —— 猜错关键词比不强调更糟。
  // **关键词里的句号也要跟着换**：`validateScene` 是拿原文校验的，
  // 而这儿的 `raw` 已经过了 tidyCaption；不换的话带句号的关键词会在这条
  // filter 里静默掉队 —— 校验过了、却不高亮，正是「静默不高亮等于白写」那种事故。
  const keys = (scene.emphasize ?? [])
    .map((k) => k.replace(/。/g, '，'))
    .filter((k) => k && raw.includes(k));

  // SVG 没有自动换行，得手工折行。
  // 每行字数按「内容区宽度 / 字号」算 —— 直接按画布宽度缩放会和字号缩放双重打折，
  // 面板一小行数就暴涨。中日文一个字约等于一个字号宽。
  const fsize0 = fz(c, 62);
  const perLine = Math.max(8, Math.floor((c.box.x1 - c.box.x0) / (fsize0 * 1.02)));
  const lines = wrapCJK(raw, perLine);

  // 每个字符在全文中的绝对下标，用于打字机进度和关键词命中判定
  const keyRanges: [number, number, number][] = [];
  keys.forEach((k, ki) => {
    let from = 0;
    for (;;) {
      const idx = raw.indexOf(k, from);
      if (idx < 0) break;
      keyRanges.push([idx, idx + k.length, ki]);
      from = idx + k.length;
    }
  });
  /** 命中第几个关键词；没命中返回 -1。多个关键词依次变红，不是一起变 */
  const keyOf = (i: number) => keyRanges.find(([s, e]) => i >= s && i < e)?.[2] ?? -1;

  const lh = 84 * c.u;
  const fsize = fz(c, 62);

  return (t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const startY = c.H / 2 - ((lines.length - 1) * lh) / 2;

    // 打字机：给了 cps 就按「字/秒」匀速打（fx-kit 的算法），
    // 不给就沿用老的做法 —— 在面板时长里 0.08~0.6 打完
    const typed = !typewriter
      ? raw.length
      : scene.cps
        ? Math.min(raw.length, Math.max(0, Math.floor((t - 0.15) * scene.cps)))
        : Math.floor(easeOut(stagger(p, 0.08, 0.52)) * raw.length);
    // 关键词逐个变红，间隔 fx-kit 是 260ms
    const emphOf = (ki: number) => easeOut(stagger(p, 0.66 + ki * 0.09, 0.22));

    let abs = 0;
    const body = lines
      .map((ln, k) => {
        const y = startY + k * lh;
        if (!typewriter) {
          // 非打字机：整行淡入 + 左滑
          const a = easeOut(stagger(p, 0.08 + k * 0.12, 0.3));
          // 默认仍是左滑：quote 已经出过片，改方向会让系列片的观感漂移。
          // 想让它跟 steps 一样上浮，在 spec 里显式写 "enter": "up"
          const t = `<g ${enter(a, scene.enter ?? 'left', 30 * c.u)}><text x="${c.box.x0.toFixed(1)}" y="${y.toFixed(1)}" fill="${THEME.text}" font-family="${THEME.serif}" font-size="${fsize}">${escapeXml(ln)}</text></g>`;
          abs += ln.length;
          return t;
        }
        // 打字机：逐字 tspan。关键词字符单独着色并放大
        const spans: string[] = [];
        for (let j = 0; j < ln.length; j++) {
          const gi = abs + j;
          if (gi >= typed) break;
          const ki = keyOf(gi);
          const emph = ki >= 0 ? emphOf(ki) : 0;
          const hot = ki >= 0;
          const col = hot ? mixToAccent(emph) : THEME.text;
          // 放大到 1.16 倍，跟 fx-kit 的 keywordPop 同值
          const sz = hot ? Math.round(fsize * (1 + 0.16 * emph)) : fsize;
          const w = hot && emph > 0.4 ? ' font-weight="700"' : '';
          spans.push(`<tspan fill="${col}" font-size="${sz}"${w}>${escapeXml(ln[j]!)}</tspan>`);
        }
        abs += ln.length;
        if (!spans.length) return '';
        // 光标：还没打完时跟在最后一个字后面
        const cursor =
          typed > abs - ln.length && typed < abs && Math.floor(p * 24) % 2 === 0
            ? `<tspan fill="${THEME.accent}">▌</tspan>`
            : '';
        return `<text x="${c.box.x0.toFixed(1)}" y="${y.toFixed(1)}" font-family="${THEME.serif}" font-size="${fsize}">${spans.join('')}${cursor}</text>`;
      })
      .join('');

    const citeA = easeOut(stagger(p, typewriter ? 0.8 : 0.55, 0.2));
    const cite = scene.cite
      ? `<text x="${c.box.x1.toFixed(0)}" y="${(startY + lines.length * lh + 40 * c.u).toFixed(1)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 30)}" text-anchor="end" opacity="${citeA.toFixed(3)}">— ${escapeXml(scene.cite)}</text>`
      : '';
    const bar = `<rect x="${(c.box.x0 - 40 * c.u).toFixed(0)}" y="${(startY - fsize).toFixed(1)}" width="${Math.round(6 * c.u)}" height="${(lines.length * lh).toFixed(1)}" fill="${THEME.accent}" opacity="${clamp01(p * 4).toFixed(3)}"/>`;
    return shell(c, `${bar}${body}${cite}`);
  };
}

// ── steps（序号卡：逐条上浮）────────────────────────────────

/**
 * 入场位移。全仓都在 16–28 这个带里（titleBlock 24 / counter 说明行 18 / PPT 风 22），
 * 改这个值等于改整套视觉语言的手感，要改就三处一起改。
 */
const RISE = 24;
/** 单条入场时长（秒）。PPT 风那边是 move 300ms + ad(300,0)，视觉等价 */
const ENTER_SEC = 0.45;

const CN_ORD = ['一', '二', '三', '四', '五'];
const CIRCLE_ORD = ['①', '②', '③', '④', '⑤'];

/** 徽标里写什么。序号只是内容，跟布局和动效无关 —— 所以同一个场景能做三种卡 */
function ordText(scene: SceneSpec, k: number): string | null {
  const it = scene.items?.[k];
  if (it?.ord) return it.ord;
  switch (scene.ordStyle ?? 'cn') {
    case 'cn':
      return CN_ORD[k] ?? String(k + 1);
    case 'num':
      return String(k + 1).padStart(2, '0');
    case 'circle':
      return CIRCLE_ORD[k] ?? String(k + 1);
    default:
      return null; // dot / none 不写字
  }
}

/**
 * 序号卡：几条并排，逐条从下往上浮进来。
 *
 * 三个定死的取舍：
 *  1. **固定槽位**。槽位按条数预分好，已入场的条目一个像素都不动。
 *     换成「新条从卡底推入、老条整体上移」的话，观众正在读的字会被抽走，
 *     而且卡片高度得跟着变，overlay.ts 按宽高比定尺寸的那套直接失效。
 *  2. **不退场**。整卡由 overlay 的 fadeOut 收 —— 清单的意义就在于最后一秒能一眼看全。
 *  3. **未入场的条目完全不画**。画灰色占位等于剧透，而且在空镜上是一片糊。
 */
function steps(scene: SceneSpec, c: Ctx): FrameFn {
  const items = (scene.items ?? []).slice(0, 5);
  const n = Math.max(1, items.length);
  const dir = scene.enter ?? 'up';
  const at = scene.itemAt && scene.itemAt.length === items.length ? scene.itemAt : null;
  const hasNote = items.some((it) => !!it.note);

  // 字号先按基准算，再用「内容区高度 / 条数」封顶 ——
  // 面板的宽高比是按条数推的，但 scale 和竖版会让实际高度浮动，
  // 不封顶的话五条卡在扁面板里会直接溢出衬底。
  const rowRatio = hasNote ? 2.5 : 1.95;
  const fsMain = Math.max(11, Math.min(fz(c, 56), Math.floor((c.box.y1 - c.box.y0) / n / rowRatio)));
  const fsNote = Math.max(10, Math.round(fsMain * 0.52));
  const rowH = fsMain * rowRatio;
  // 块高只跟条数有关，跟「已经进来几条」无关 —— 所以垂直居中是安全的，不会跳
  const blockH = rowH * n;
  const top = Math.max(c.box.y0, (c.box.y0 + c.box.y1) / 2 - blockH / 2);

  const bs = fsMain * 1.12; // 徽标边长
  const showBadge = scene.check || (scene.ordStyle ?? 'cn') !== 'none';
  const textX = c.box.x0 + (showBadge ? bs * 1.42 : 0);
  const maxChars = Math.max(6, Math.floor((c.box.x1 - textX) / (fsMain * 1.02)));

  return (t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);

    // 有 itemAt 就按秒锚定（解说念到哪条哪条才浮），没有就在面板时长里均分。
    // 均分时末条在 78% 处进完，尾巴留给观众把整卡读一遍。
    const alphas = items.map((_, k) =>
      at
        ? easeOut(clamp01((t - (at[k] ?? 0)) / ENTER_SEC))
        : easeOut(stagger(p, 0.06 + k * (0.66 / n), 0.22)),
    );
    let cur = -1;
    for (let k = 0; k < n; k++) if (alphas[k]! > 0.02) cur = k;

    const rows = items
      .map((it, k) => {
        const a = alphas[k]!;
        if (a <= 0.01) return '';
        const ty = top + k * rowH + fsMain;
        const badge = showBadge ? badgeSvg(scene, c, k, k === cur, c.box.x0, ty - fsMain * 0.82, bs) : '';
        const line = wrapCJK(it.text, maxChars)[0] ?? it.text;
        const main = `<text x="${textX.toFixed(1)}" y="${ty.toFixed(1)}" fill="${THEME.text}" font-family="${THEME.serif}" font-size="${fsMain}" font-weight="600">${escapeXml(line)}</text>`;
        const note = it.note
          ? `<text x="${textX.toFixed(1)}" y="${(ty + fsNote * 1.6).toFixed(1)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fsNote}">${escapeXml(it.note)}</text>`
          : '';
        return `<g ${enter(a, dir, RISE * c.u)}>${badge}${main}${note}</g>`;
      })
      .join('');

    // 左侧竖条随已入场条数生长 —— 跟金句卡同一根，视觉上认亲
    const grown = alphas.reduce((x, a) => x + a, 0);
    const barH = rowH * Math.min(n, Math.max(0.35, grown));
    const bar = `<rect x="${(c.box.x0 - 26 * c.u).toFixed(0)}" y="${top.toFixed(1)}" width="${Math.round(6 * c.u)}" height="${barH.toFixed(1)}" fill="${THEME.accent}" opacity="${clamp01(p * 4).toFixed(3)}"/>`;

    return shell(c, `${bar}${rows}${titleBlock(scene, c, p)}`);
  };
}

/**
 * 徽标。当前这条是实心正红，之前的退成描边 ——
 * 「现在念的是第几条」这个信息不用额外数据就拿到了。
 */
function badgeSvg(
  scene: SceneSpec,
  c: Ctx,
  k: number,
  isCur: boolean,
  x: number,
  y: number,
  bs: number,
): string {
  const style = scene.check ? 'check' : (scene.ordStyle ?? 'cn');

  if (style === 'check') {
    // 勾号用折线画，字体里的 ✓ 在不同系统上宽度不一致
    const w = Math.max(2.5, 3.4 * c.u);
    return `<polyline points="${(x + bs * 0.12).toFixed(1)},${(y + bs * 0.52).toFixed(1)} ${(x + bs * 0.42).toFixed(1)},${(y + bs * 0.82).toFixed(1)} ${(x + bs * 0.92).toFixed(1)},${(y + bs * 0.18).toFixed(1)}" fill="none" stroke="${THEME.accent}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (style === 'dot') {
    const d = bs * 0.42;
    return `<rect x="${(x + (bs - d) / 2).toFixed(1)}" y="${(y + (bs - d) / 2).toFixed(1)}" width="${d.toFixed(1)}" height="${d.toFixed(1)}" fill="${THEME.accent}"/>`;
  }

  const label = ordText(scene, k);
  const box = isCur
    ? `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bs.toFixed(1)}" height="${bs.toFixed(1)}" rx="${(bs * 0.22).toFixed(1)}" fill="${THEME.accent}"/>`
    : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bs.toFixed(1)}" height="${bs.toFixed(1)}" rx="${(bs * 0.22).toFixed(1)}" fill="none" stroke="${THEME.accent}" stroke-width="${Math.max(1.6, 2 * c.u).toFixed(1)}"/>`;
  const fs = Math.round(bs * 0.56);
  const txt = label
    ? `<text x="${(x + bs / 2).toFixed(1)}" y="${(y + bs * 0.68).toFixed(1)}" fill="${isCur ? '#ffffff' : THEME.accent}" font-family="${THEME.font}" font-size="${fs}" font-weight="700" text-anchor="middle">${escapeXml(label)}</text>`
    : '';
  return `${box}${txt}`;
}

/**
 * 屏幕上的一条字，上屏之前统一过这儿：**去尾标点 ＋ 句中的句号换逗号。**
 *
 * 两条都是频道规范（RUNBOOK 六之八）：结尾那个句号是噪声；
 * 而一行字里蹦出一个句号，读起来像话已经完了、可后面还接着。
 * 句中的逗号顿号冒号照留（那是节奏），半角 `.` 不碰（多半是数字）。
 *
 * **这份是抄的**，权威实现在 `joke-video/src/shuoshu-srt.ts` 的 `tidyCaption()`。
 * 三个 npm 工程互相导不进来（`FX-PORT.md`：跨工程搬规格不搬文件），改规则三处一起改：
 * 那份、`src/lib/ass.ts` 的同名函数、这一份。
 *
 * **长度只会从末尾变短**，所以 `quote` 里那些按 `indexOf` 算的关键词下标不受影响 ——
 * 前提是在算下标**之前**先过这个函数。
 */
function tidyCaption(s: string): string {
  return s
    .trim()
    .replace(/[。，、；：！？…·—.,;:!?]+$/u, '')
    .trim()
    .replace(/。(?=[\s\S]*[^\s。])/gu, '，');
}

/**
 * 中日文折行 + 行头禁则。
 * 直接按字数硬切会把「，」「。」「）」甩到下一行行首，中文排版里这是明显的错。
 * 处理方式：下一行若以禁则字符开头，就把它拉回上一行。
 */
const NO_LINE_START = '，。、；：？！）」』】》〉”’%…—·,.;:?!)]}>';
function wrapCJK(raw: string, perLine: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let end = Math.min(raw.length, i + perLine);
    // 允许把后续的禁则字符并到本行末尾（最多吃 2 个，避免行尾无限拉长）
    let eat = 0;
    while (end < raw.length && NO_LINE_START.includes(raw[end]!) && eat < 2) {
      end++;
      eat++;
    }
    out.push(raw.slice(i, end));
    i = end;
  }
  return out;
}

/** 关键词从正文色渐变到强调色 */
function mixToAccent(t: number): string {
  const a = [0xe6, 0xed, 0xf3];
  const b = [0xe0, 0x60, 0x3a];
  const m = a.map((v, i) => Math.round(v + (b[i]! - v) * clamp01(t)));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
// ── japanMap（15 地图亮点：城市依次亮起，所在都道府県同刻填色）─────

/**
 * 都道府県轮廓来自 `japan-geo.ts`（从 fx-kit 搬过来的 GeoJSON 产物）。
 *
 * 之前这里是「中心线 + 半宽」程序化生成的示意缎带。换成真轮廓不是为了好看：
 * 示意图上点亮一块，观众认不出那是哪儿，「某某县亮了」这个信息就没送到。
 *
 * 城市红点与它所属的都道府県**同刻**亮 —— 分开出现的话，
 * 观众看不出这块地和这个点是一回事。
 */
function japanMap(scene: SceneSpec, c: Ctx): FrameFn {
  const vx = JAPAN.viewBox[0]!;
  const vy = JAPAN.viewBox[1]!;
  const vw = JAPAN.viewBox[2]!;
  const vh = JAPAN.viewBox[3]!;
  const boxW = c.box.x1 - c.box.x0;
  const boxH = c.box.y1 - c.box.y0;
  // 主图 1048×1141 比 16:9 高得多，按较小的那个比例贴合，绝不拉伸
  const k = Math.min(boxW / vw, boxH / vh);
  // 主图比 16:9 高得多，横幅里居中会在左边留一大片空。往右偏，左边留给标题和数字
  const wide = boxW > vw * k * 1.35;
  const ox = c.box.x0 + (boxW - vw * k) * (wide ? 0.62 : 0.5) - vx * k;
  const oy = c.box.y0 + (boxH - vh * k) / 2 - vy * k;

  const cities = (scene.cities ?? [])
    .slice(0, 6)
    .map((ci) => {
      const xy = cityXY(ci.name);
      return xy ? { ...ci, x: ox + xy[0] * k, y: oy + xy[1] * k, pref: prefOf(ci.name) } : null;
    })
    .filter((v): v is NonNullable<typeof v> => !!v);

  const dimFill = 'rgba(230,237,243,0.07)';
  const dimStroke = 'rgba(230,237,243,0.28)';
  const litFill = 'rgba(224,96,58,0.34)';
  const base = Object.values(JAPAN.shapes)
    .map((d) => `<path d="${d}"/>`)
    .join('');
  const rBase = Math.max(4, 7 * c.u);

  return (t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const dur = durationOf(t, i, total);
    // fx-kit 的节奏是每城 620ms；面板短到装不下就压缩，装得下就照搬
    const step = Math.min(0.62, dur / (cities.length + 0.8));

    /** 都道府県 → 点亮进度。同一个县被多次指到时取最早的那次 */
    const prefA = new Map<string, number>();
    const bump = (pref: string | null | undefined, t0: number) => {
      if (!pref) return;
      const a = easeOut(clamp01((t - t0) / 0.52));
      prefA.set(pref, Math.max(prefA.get(pref) ?? 0, a));
    };
    for (const pref of scene.highlight ?? []) bump(pref, 0);
    cities.forEach((ci, idx) => bump(ci.pref, idx * step));

    const lit = [...prefA.entries()]
      .filter(([pref, a]) => a > 0.01 && !!JAPAN.shapes[pref])
      .map(
        ([pref, a]) =>
          `<path d="${JAPAN.shapes[pref]}" fill="${litFill}" stroke="${THEME.accent}" stroke-width="${(1.6 / k).toFixed(2)}" opacity="${a.toFixed(3)}"/>`,
      )
      .join('');

    // 标签防重叠：按 y 排序，挨得太近的往下推，推开的画一条引线回到红点
    const minGap = fz(c, 30) * 1.25;
    const labelY = new Map<number, number>();
    [...cities.keys()]
      .sort((a, b) => cities[a]!.y - cities[b]!.y)
      .forEach((idx, order, arr) => {
        const want = cities[idx]!.y + rBase * 0.6;
        const prev = order > 0 ? labelY.get(arr[order - 1]!)! : -Infinity;
        labelY.set(idx, Math.max(want, prev + minGap));
      });

    const marks = cities
      .map((ci, idx) => {
        const t0 = idx * step;
        const a = easeOut(clamp01((t - t0) / 0.22));
        if (a <= 0.01) return '';
        const core = easeOut(clamp01((t - t0) / 0.34));
        // 扩散环只脉冲一次，不循环 —— 循环动画在逐帧渲染下没法保证每次一样
        const ringP = clamp01((t - t0) / 1.0);
        const ring =
          ringP > 0 && ringP < 1
            ? `<circle cx="${ci.x.toFixed(1)}" cy="${ci.y.toFixed(1)}" r="${(rBase * (0.4 + 3.2 * easeOut(ringP))).toFixed(1)}" fill="none" stroke="${THEME.accent}" stroke-width="${Math.max(1.2, 2 * c.u).toFixed(1)}" opacity="${(0.9 * (1 - ringP)).toFixed(3)}"/>`
            : '';
        const val = ci.value ? `　${ci.value}` : '';
        const ly = labelY.get(idx)!;
        const lx = ci.x + rBase * 2.1;
        // 被推开了才画引线，没推开的画了反而是多余的一根短横
        const lead =
          ly - (ci.y + rBase * 0.6) > 2
            ? `<path d="M${(ci.x + rBase * 0.9).toFixed(1)} ${ci.y.toFixed(1)} L${(lx - rBase * 0.5).toFixed(1)} ${(ly - fz(c, 30) * 0.32).toFixed(1)}" fill="none" stroke="${THEME.accent}" stroke-width="${Math.max(1, 1.4 * c.u).toFixed(1)}" opacity="${(a * 0.7).toFixed(3)}"/>`
            : '';
        return `${ring}<circle cx="${ci.x.toFixed(1)}" cy="${ci.y.toFixed(1)}" r="${(rBase * core).toFixed(1)}" fill="${THEME.accent}"/>${lead}
<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fz(c, 30)}" font-weight="700" opacity="${a.toFixed(3)}">${escapeXml(ci.name + val)}</text>`;
      })
      .join('');

    const landA = easeOut(stagger(p, 0, 0.25));
    const land = `<g transform="translate(${ox.toFixed(2)},${oy.toFixed(2)}) scale(${k.toFixed(5)})" fill="${dimFill}" stroke="${dimStroke}" stroke-width="${(1.1 / k).toFixed(2)}" stroke-linejoin="round">${base}${lit}</g>`;
    return shell(c, `<g opacity="${landA.toFixed(3)}">${land}</g>${marks}${titleBlock(scene, c, p)}`);
  };
}

/**
 * 从帧序号反推面板总时长（秒）。
 * FrameFn 只拿到 (t, i, total)，而 fps = i/t，所以总时长 = total × t / i。
 * fx-kit 的规格是按毫秒写的（每城 620ms、聚光淡入 380ms），要照搬就得知道秒数。
 */
function durationOf(t: number, i: number, total: number): number {
  return i > 0 && t > 0 ? (t / i) * total : total / 30;
}

/** 确定性伪随机（xorshift32）—— 同一个 seed 永远给同一串数，重渲不会变样 */
function rng(seed = 1): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ── subtitleStack（08 三级字幕）──────────────────────────────

/**
 * 主句 / 补充 / 出处三级，依次升起并保持堆叠。
 *
 * 空镜风成片里这三级是 ASS 烧进去的（chip / sub / emph），这个场景是它的面板版：
 * 给已经剪好的片子在某几秒补一块「带出处的说明」，不用回去重排字幕重渲。
 */
function subtitleStack(scene: SceneSpec, c: Ctx): FrameFn {
  const lines = (scene.lines ?? []).slice(0, 3).map(tidyCaption);
  // 基准字号按 fx-kit 的三级比例，再按内容区高度放大：
  // 同一套代码既要当叠加面板用（矮），也要当整屏镜头用（高），不放大整屏下就是一小撮字
  const natural = [52, 32, 24];
  const naturalH = natural.slice(0, Math.max(1, lines.length)).reduce((h, v) => h + v * 1.5, 0);
  const grow = Math.max(1, Math.min(2.4, ((c.box.y1 - c.box.y0) * 0.62) / Math.max(1, fz(c, naturalH))));
  const sizes = natural.map((v) => fz(c, v * grow));
  const colors = [THEME.text, THEME.text, THEME.muted];
  const weights = ['800', '600', '400'];
  const alphas = [1, 0.86, 1];

  const rows = lines.map((text, k) => {
    const size = sizes[k]!;
    const per = Math.max(6, Math.floor((c.box.x1 - c.box.x0) / (size * 1.02)));
    return { text: wrapCJK(text, per)[0] ?? text, size, k };
  });
  const totalH = rows.reduce((h, r) => h + r.size * 1.5, 0);

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const top = (c.box.y0 + c.box.y1) / 2 - totalH / 2;
    let y = top;
    const body = rows
      .map((r) => {
        // fx-kit：dur 520ms、逐级 180ms、位移 0.55em
        const a = easeOut(stagger(p, 0.05 + r.k * 0.14, 0.34));
        y += r.size * 1.5;
        if (a <= 0.01) return '';
        return `<g ${enter(a, scene.enter ?? 'up', r.size * 0.55)}><text x="${c.box.x0.toFixed(1)}" y="${y.toFixed(1)}" fill="${colors[r.k]}" font-family="${THEME.font}" font-size="${r.size}" font-weight="${weights[r.k]}" opacity="${alphas[r.k]}">${escapeXml(r.text)}</text></g>`;
      })
      .join('');
    const bar = `<rect x="${(c.box.x0 - 26 * c.u).toFixed(0)}" y="${(top + 6).toFixed(1)}" width="${Math.round(6 * c.u)}" height="${totalH.toFixed(1)}" fill="${THEME.accent}" opacity="${clamp01(p * 4).toFixed(3)}"/>`;
    return shell(c, `${bar}${body}`);
  };
}

// ── maskTitle（09 遮罩上滑）─────────────────────────────────

/**
 * 逐行从行框下方滑出，露出之前的部分被行框裁掉 —— 比淡入有质感，标题级文字的默认写法。
 *
 * SVG 没有 overflow:hidden，靠 <clipPath> 给每行框一个矩形；文字在框内从
 * +105% 行高滑到 0。裁剪框比字号高一点（1.25 倍），否则字的上下伸出部分会被削掉。
 */
function maskTitle(scene: SceneSpec, c: Ctx): FrameFn {
  const lines = (scene.lines ?? (scene.title ? [scene.title] : [])).slice(0, 4).map(tidyCaption);
  const n = Math.max(1, lines.length);
  const fsize = Math.max(11, Math.min(fz(c, 64), Math.floor((c.box.y1 - c.box.y0) / n / 1.5)));
  const lh = fsize * 1.42;
  const totalH = lh * n;

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const top = (c.box.y0 + c.box.y1) / 2 - totalH / 2;
    const parts = lines
      .map((text, k) => {
        // fx-kit：dur 620ms、逐行 120ms
        const a = easeOut(stagger(p, 0.06 + k * 0.1, 0.34));
        if (a <= 0.001) return '';
        const boxY = top + k * lh;
        const baseY = boxY + fsize * 1.06;
        const dy = (1 - a) * lh * 1.05;
        const id = `mk${k}`;
        return `<clipPath id="${id}"><rect x="${(c.box.x0 - 8).toFixed(1)}" y="${boxY.toFixed(1)}" width="${(c.box.x1 - c.box.x0 + 16).toFixed(1)}" height="${(fsize * 1.25).toFixed(1)}"/></clipPath>
<g clip-path="url(#${id})"><text x="${c.box.x0.toFixed(1)}" y="${(baseY + dy).toFixed(1)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fsize}" font-weight="800">${escapeXml(text)}</text></g>`;
      })
      .join('');
    const ruleA = easeOut(stagger(p, 0.25, 0.3));
    const rule = `<rect x="${c.box.x0.toFixed(1)}" y="${(top + totalH + fsize * 0.3).toFixed(1)}" width="${((c.box.x1 - c.box.x0) * 0.22 * ruleA).toFixed(1)}" height="${Math.max(3, Math.round(5 * c.u))}" fill="${THEME.accent}"/>`;
    return shell(c, `${parts}${rule}`);
  };
}

// ── glitchTitle（10 故障标题）───────────────────────────────

/**
 * 故障标题**不跟 THEME 走**，四个颜色全部用 fx-kit 的原值。
 *
 * 这是明确定下的例外（2026-08-17）：RGB 错位的观感就绑在「正红 + 蓝绿」这一对上，
 * 换成本项目的橙红（#e0603a）+ 蓝（#4a9eba），两路的色相差不够大，
 * 分离感就散了 —— 看着像重影，不像信号坏了。
 *
 * **别顺手把它改回 THEME。** 别的场景一律跟 THEME，只有这一个例外。
 */
const GLITCH = {
  /** fx-kit --fx-paper */
  paper: '#F5F3EE',
  /** fx-kit --fx-accent */
  red: '#E5484D',
  /** fx-kit --fx-data */
  cyan: '#4FB8A8',
  /** fx-kit --fx-dim */
  dim: '#8A94A2',
};

/**
 * RGB 错位 + 切片抖动。**全片最多 1–2 次，连用立刻廉价。**
 *
 * fx-kit 用 CSS 的 steps() 缓动做切片跳变，这里换算成「按进度取第几个切片状态」：
 * 30fps 下 slices 取 3–4、amp 不低于 10，单帧才分得出层次。
 * 抖动量全部出自 rng(seed)，重渲结果完全一致 —— 不要改成 Math.random()。
 */
function glitchTitle(scene: SceneSpec, c: Ctx): FrameFn {
  // 封面三层：lines = [标题, 副标题, 关键内容]。
  // 只有第一层带 RGB 错位 —— 三层一起抖就没有主次了，副标题和关键词还得读得清。
  const tiers = scene.lines ?? [];
  const text = tiers[0] ?? scene.text ?? scene.title ?? '';
  const tier2 = tiers[1] ?? scene.subtitle;
  const tier3 = tiers[2];
  const slices = Math.max(2, Math.min(6, scene.slices ?? 4));
  const amp = scene.amp ?? 14;
  const rand = rng(scene.seed ?? 7);
  // 章节标题是要砸场的，字号按「整串占内容区 62% 宽」反推，再用高度封顶。
  // fx-kit 预览台那边是 text-align:center + clamp(30px, 6vw, 84px)，
  // 相对画布约占半幅宽 —— 按内容区宽度除以字数来算会小一大截，那是正文的算法
  const fsize = Math.max(
    11,
    Math.min(
      Math.floor(((c.box.x1 - c.box.x0) * 0.62) / Math.max(1, text.length)),
      Math.floor((c.box.y1 - c.box.y0) * 0.6),
      fz(c, 200),
    ),
  );

  // 两个副本各走各的随机序列 —— fx-kit 是 frames(1) / frames(-1) 调了两次，
  // 共用一组带的话红蓝会齐步走，看着像整块在抖，不像信号坏了
  // amp 是**相对 84px 基准字号**的像素错位量（fx-kit 的 clamp 上限就是 84px，
  // 默认 14 是配着它调的）。字号放到 200px 还用 14px 的错位，边缘细得看不见，
  // 所以按字号等比放大
  const ampScale = fsize / 84;
  const vertical = Math.max(0, Math.min(1, scene.vertical ?? 0.5));
  // 错位量下限：fx-kit 的公式 rand()*amp - amp*0.2 会取到 0 附近，
  // 那一格就等于没错位。四个切片里死掉一个，红色那一路就基本看不见了 ——
  // 保留原分布，只把绝对值不足字号 5% 的顶到 5%
  const floor = fsize * 0.05;
  const bands = (sign: number) =>
    Array.from({ length: slices }, () => {
      const raw = (rand() * amp - amp * 0.2) * ampScale;
      // 方向由 sign 定死（红往右、青往左），只取幅度。
      // fx-kit 的公式是 sign * (rand()*amp - amp*0.2)，rand() < 0.2 时会变号 ——
      // 那一格两路朝同一边错开，窄的那条被宽的整格套住，红色就整格看不见了。
      // RGB 分离本来就该是左右分开的，这里按分离来。
      const dx = sign * Math.max(floor, Math.abs(raw));
      // 垂直分量：fx-kit 只有 translateX，横笔画横着错开露不出面 ——
      // 「三十三」这种全横笔画的标题，彩色面积只有「泡沫破裂」的五分之一，
      // 读出来就是零散色块而不是彩色鬼影。加一个反向的竖直位移就跟字形解耦了。
      // 要完全照搬 fx-kit 就把 vertical 写成 0。
      const dy = -sign * Math.abs(dx) * vertical;
      return { dx, dy, top: rand() * 0.68, h: 0.14 + rand() * 0.26 };
    });
  const red = bands(1);
  const cyan = bands(-1);

  return (t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const dur = durationOf(t, i, total);
    // 抖动是**绝对 1 秒**的事，不是铺满整个镜头时长。
    // 铺满的话 4 个切片状态每个要停 0.8 秒，看着是一帧帧的错位图，不是「信号坏了一下」
    const glitchSec = Math.min(scene.dur ?? 1.0, dur);
    const gp = clamp01(t / glitchSec);
    // 居中，且略高于正中（参照是 top:40%）—— 下面要留给副标题
    const y = c.H * (tier2 || tier3 ? 0.42 : 0.48);
    const x = (c.box.x0 + c.box.x1) / 2;
    const done = gp >= 1;

    const copy = (b: { dx: number; dy: number; top: number; h: number }[], color: string, id: string) => {
      if (done) return '';
      const st = b[Math.min(slices - 1, Math.floor(gp * slices))]!;
      // 切片带必须落在**字形高度**内。fx-kit 的 inset(top% …) 是相对行盒的，
      // 行盒里字形占了大半；照抄成「基线 −0.9 起、跨 1.4 倍字号」会让 top 偏大的带
      // 整条掉到基线以下 —— 中日文那里没有笔画，那一格就是空的
      const inkTop = y - fsize * 0.92;
      const inkH = fsize * 0.95;
      const bandY = inkTop + st.top * inkH;
      const bandH = st.h * inkH;
      return `<clipPath id="${id}"><rect x="0" y="${bandY.toFixed(1)}" width="${c.W}" height="${bandH.toFixed(1)}"/></clipPath>
<g clip-path="url(#${id})" style="mix-blend-mode:screen"><text x="${(x + st.dx).toFixed(1)}" y="${(y + st.dy).toFixed(1)}" fill="${color}" font-family="${THEME.font}" font-size="${fsize}" font-weight="900" text-anchor="middle">${escapeXml(text)}</text></g>`;
    };

    // 两件事凑齐才对：
    //  1) 副本画在正文**下面** —— 白字压住中间，只有错开的那一截露出红/青；
    //  2) 副本用 **screen 混合**（跟 fx-kit 的 .g-copy 同款）—— 红青两路的切片带
    //     会撞在一起，不混合的话后画的那路把前一路整格盖掉，红色就整格消失。
    //     实测 librsvg/sharp 认这个属性。
    // 原注：fx-kit 那边靠 mix-blend-mode: screen，
    // 白字压在彩色副本上仍是白的，只有错开的那一截露出红/青。
    // 画在上面的话切片带里的字会被整块染成红青，白字被吃掉 —— 那是另一个效果了。
    const main = `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" fill="${GLITCH.paper}" font-family="${THEME.font}" font-size="${fsize}" font-weight="900" text-anchor="middle" opacity="${(tiers.length ? 1 : clamp01(t / 0.1)).toFixed(3)}">${escapeXml(text)}</text>`;
    // 二层、三层依次浮出，等一层的抖动收干净再进 —— 不然三层挤在一起像故障没修好
    const fs2 = fz(c, 40);
    const fs3 = fz(c, 30);
    // 封面（给了 lines）三层从第 0 帧就齐：各平台默认拿第 0 帧当封面图，
    // 二三层要是还在淡入，抓出来的封面就只有一行标题。
    // 单独当章节卡用（只给 text/subtitle）时才走延迟浮出。
    const cover = tiers.length > 0;
    const a2 = tier2 ? (cover ? 1 : easeOut(clamp01((t - glitchSec * 0.75) / 0.42))) : 0;
    const a3 = tier3 ? (cover ? 1 : easeOut(clamp01((t - glitchSec * 0.75 - 0.28) / 0.42))) : 0;
    const rule =
      tier2 || tier3
        ? `<rect x="${(x - (c.box.x1 - c.box.x0) * 0.06).toFixed(1)}" y="${(y + fsize * 0.34).toFixed(1)}" width="${((c.box.x1 - c.box.x0) * 0.12 * Math.max(a2, a3)).toFixed(1)}" height="${Math.max(3, Math.round(5 * c.u))}" fill="${GLITCH.red}"/>`
        : '';
    const line2 = tier2
      ? `<g ${enter(a2, 'up', 16 * c.u)}><text x="${x.toFixed(1)}" y="${(y + fsize * 0.34 + fs2 * 1.9).toFixed(1)}" fill="${GLITCH.paper}" font-family="${THEME.font}" font-size="${fs2}" font-weight="600" text-anchor="middle">${escapeXml(tier2)}</text></g>`
      : '';
    const line3 = tier3
      ? `<g ${enter(a3, 'up', 14 * c.u)}><text x="${x.toFixed(1)}" y="${(y + fsize * 0.34 + fs2 * 1.9 + fs3 * 1.9).toFixed(1)}" fill="${GLITCH.dim}" font-family="${THEME.font}" font-size="${fs3}" font-weight="400" text-anchor="middle" letter-spacing="${(fs3 * 0.06).toFixed(1)}">${escapeXml(tier3)}</text></g>`
      : '';
    const sub = `${rule}${line2}${line3}`;
    return shell(c, `${copy(red, GLITCH.red, 'gr')}${copy(cyan, GLITCH.cyan, 'gc')}${main}${sub}`);
  };
}

// ── compareBars（16 左右对照）───────────────────────────────

/**
 * 成对数值从中线向两侧生长。左灰右红 —— 红的那侧是「改定后 / 现在」，
 * 也就是观众该记住的那一边。数值画在条子的外端，跟着条子一起长出来。
 */
function compareBars(scene: SceneSpec, c: Ctx): FrameFn {
  const rows = (scene.rows ?? []).slice(0, 5);
  const max = Math.max(1, ...rows.flatMap((r) => [r.l, r.r]));
  const midW = (c.box.x1 - c.box.x0) * 0.22;
  const cx = (c.box.x0 + c.box.x1) / 2;
  const half = (c.box.x1 - c.box.x0 - midW) / 2;
  const hasHead = !!(scene.leftLabel || scene.rightLabel);

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const headA = easeOut(stagger(p, 0, 0.25));
    const headH = hasHead ? fz(c, 34) * 1.6 : 0;
    const avail = c.box.y1 - c.box.y0 - headH;
    // 行高封顶：不封的话两行会被拉到内容区的两端，读起来不像一组对照
    const rowH = Math.min(avail / Math.max(1, rows.length), fz(c, 96));
    const top = c.box.y0 + headH + (avail - rowH * rows.length) / 2;
    const barH = Math.min(rowH * 0.46, fz(c, 40));
    const fsLab = Math.max(11, Math.round(barH * 0.62));

    const head = hasHead
      ? `<text x="${(cx - midW / 2 - 10).toFixed(1)}" y="${(top - fz(c, 34) * 0.5).toFixed(1)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fz(c, 30)}" text-anchor="end" opacity="${headA.toFixed(3)}">${escapeXml(scene.leftLabel ?? '')}</text>
<text x="${(cx + midW / 2 + 10).toFixed(1)}" y="${(top - fz(c, 34) * 0.5).toFixed(1)}" fill="${THEME.accent}" font-family="${THEME.font}" font-size="${fz(c, 30)}" font-weight="700" opacity="${headA.toFixed(3)}">${escapeXml(scene.rightLabel ?? '')}</text>`
      : '';

    const body = rows
      .map((r, k) => {
        // fx-kit：dur 700ms、逐行 130ms
        const a = easeOut(stagger(p, 0.08 + k * 0.11, 0.3));
        if (a <= 0.01) return '';
        const y = top + k * rowH + (rowH - barH) / 2;
        const lw = (r.l / max) * half * a;
        const rw = (r.r / max) * half * a;
        const numA = easeOut(stagger(p, 0.26 + k * 0.11, 0.25));
        return `<rect x="${(cx - midW / 2 - lw).toFixed(1)}" y="${y.toFixed(1)}" width="${lw.toFixed(1)}" height="${barH.toFixed(1)}" fill="${THEME.muted}" opacity="0.75"/>
<rect x="${(cx + midW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${rw.toFixed(1)}" height="${barH.toFixed(1)}" fill="${THEME.accent}"/>
<text x="${cx.toFixed(1)}" y="${(y + barH * 0.74).toFixed(1)}" fill="${THEME.text}" font-family="${THEME.font}" font-size="${fsLab}" text-anchor="middle" opacity="${a.toFixed(3)}">${escapeXml(r.label)}</text>
<text x="${(cx - midW / 2 - lw - 8).toFixed(1)}" y="${(y + barH * 0.74).toFixed(1)}" fill="${THEME.muted}" font-family="${THEME.font}" font-size="${fsLab}" text-anchor="end" opacity="${numA.toFixed(3)}">${escapeXml(String(r.l))}</text>
<text x="${(cx + midW / 2 + rw + 8).toFixed(1)}" y="${(y + barH * 0.74).toFixed(1)}" fill="${THEME.accent}" font-family="${THEME.font}" font-size="${fsLab}" font-weight="700" opacity="${numA.toFixed(3)}">${escapeXml(String(r.r))}</text>`;
      })
      .join('');

    return shell(c, `${head}${body}${titleBlock(scene, c, p)}`);
  };
}

// ── 全幅效果（04 闪白 / 17 聚光 / 20 箭头注记）────────────────
//
// 这三个跟别的场景不是一类：它们要盖住整幅画面，坐标也是相对整幅画面的
// 0–1 归一值。overlay.ts 的 FULL_FRAME 会把画布尺寸设成底片尺寸并关掉衬底。

/** 04 闪白打点：只在音频重音上砸一下，超过 250ms 就变廉价 */
function flash(scene: SceneSpec, c: Ctx): FrameFn {
  const peak = scene.peak ?? 0.85;
  const color = scene.color ?? '#ffffff';
  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    // fx-kit 的包络：0 → 峰值(18%) → 0，线性，不加缓动
    const a = p < 0.18 ? (p / 0.18) * peak : peak * (1 - (p - 0.18) / 0.82);
    return shell(c, `<rect width="${c.W}" height="${c.H}" fill="${color}" opacity="${clamp01(a).toFixed(3)}"/>`);
  };
}

/**
 * 17 聚光引导：除光斑外整体压暗，光斑可以沿 path 移动。
 * 半径写成长度而不是百分比 —— fx-kit 那边踩过这个坑（gradient 的 circle 半径不接受百分比，
 * 整条 gradient 会被丢弃，表现为「一点效果都没有」）。
 */
function spotlight(scene: SceneSpec, c: Ctx): FrameFn {
  const path = scene.path?.length ? scene.path : [{ x: 0.5, y: 0.5 }];
  const dark = scene.dark ?? 0.78;
  const r = c.W * (scene.radius ?? 0.16);
  const outer = r * (scene.soft ?? 1.9);

  return (t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    const seg = p * (path.length - 1);
    const idx = Math.min(path.length - 2, Math.floor(seg));
    const f = path.length > 1 ? easeOut(seg - idx) : 0;
    const a0 = path[Math.max(0, idx)]!;
    const b0 = path[Math.min(path.length - 1, idx + 1)]!;
    const cx = (a0.x + (b0.x - a0.x) * f) * c.W;
    const cy = (a0.y + (b0.y - a0.y) * f) * c.H;
    // 压暗只用 380ms 淡入；光斑位置从第一帧起就是对的，不让它飘进来
    const veil = easeOut(clamp01(t / 0.38)) * dark;
    return shell(
      c,
      `<defs><radialGradient id="sp" gradientUnits="userSpaceOnUse" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${outer.toFixed(1)}">
<stop offset="0" stop-color="#000" stop-opacity="0"/>
<stop offset="${(r / outer).toFixed(3)}" stop-color="#000" stop-opacity="0"/>
<stop offset="1" stop-color="#000" stop-opacity="${veil.toFixed(3)}"/>
</radialGradient></defs><rect width="${c.W}" height="${c.H}" fill="url(#sp)"/>`,
    );
  };
}

/**
 * 19 颗粒漏光的**漏光**部分：右上角一块暖色光晕。
 *
 * 颗粒本身不在这儿 —— 它是 ffmpeg 的 `noise` 滤镜（overlay.ts 里注入）。
 * 理由是尺寸：颗粒要常驻整片，4 分钟的 1080p RGBA 帧序列有几个 GB，
 * 而 noise 滤镜是一次编码顺手带上的，`all_seed` 同样保证重渲一致。
 *
 * 脉冲不在这儿写：overlay 的 fadeIn / fadeOut 各取时长的一半，
 * 天然就是「暗→亮→暗」的三角包络，跟 fx-kit 的 0.18→0.34→0.18 是一回事。
 */
function grainLeak(scene: SceneSpec, c: Ctx): FrameFn {
  const on = scene.leak !== false;
  return () => {
    if (!on) return shell(c, '');
    return shell(
      c,
      `<defs><radialGradient id="lk" gradientUnits="userSpaceOnUse" cx="${c.W}" cy="0" r="${(c.W * 0.62).toFixed(0)}">
<stop offset="0" stop-color="#e8a33d" stop-opacity="0.5"/>
<stop offset="0.65" stop-color="#e8a33d" stop-opacity="0.12"/>
<stop offset="1" stop-color="#e8a33d" stop-opacity="0"/>
</radialGradient></defs><rect width="${c.W}" height="${c.H}" fill="url(#lk)"/>`,
    );
  };
}

/**
 * 20 箭头注记：圈选 / 箭头描出 + 标签。
 *
 * **不会自动对准物体** —— 这里没有画面识别能力，坐标必须由人写进 spec。
 * 描出用 stroke-dasharray：路径长度是算出来的（椭圆用拉马努金第二近似），
 * 不像浏览器那样有 getTotalLength() 可以问。
 */
function arrowAnnotate(scene: SceneSpec, c: Ctx): FrameFn {
  const sw = Math.max(2, 3 * (c.W / 1000));
  const el = scene.circle;
  const ar = scene.arrow;

  return (_t, i, total) => {
    const p = total <= 1 ? 1 : i / (total - 1);
    let out = '';

    if (el) {
      const rx = el.rx * c.W;
      const ry = el.ry * c.H;
      // 拉马努金第二近似，误差在千分之一以内，描线够用了
      const h = Math.pow(rx - ry, 2) / Math.pow(rx + ry, 2);
      const len = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
      const a = easeOut(clamp01(p / 0.55));
      const ecx = el.cx * c.W;
      const ecy = el.cy * c.H;
      out += `<ellipse cx="${ecx.toFixed(1)}" cy="${ecy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" transform="rotate(${el.rot ?? -8} ${ecx.toFixed(1)} ${ecy.toFixed(1)})" fill="none" stroke="${THEME.accent}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${(len * (1 - a)).toFixed(1)}"/>`;
    }

    if (ar) {
      const x1 = ar.x1 * c.W;
      const y1 = ar.y1 * c.H;
      const x2 = ar.x2 * c.W;
      const y2 = ar.y2 * c.H;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const a = easeOut(clamp01(p / 0.45));
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const hl = 18 * (c.W / 1000);
      const headA = easeOut(clamp01((p - 0.4) / 0.25));
      out += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="${THEME.accent}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${(len * (1 - a)).toFixed(1)}"/>`;
      if (headA > 0) {
        const hx1 = x2 - hl * Math.cos(ang - 0.42);
        const hy1 = y2 - hl * Math.sin(ang - 0.42);
        const hx2 = x2 - hl * Math.cos(ang + 0.42);
        const hy2 = y2 - hl * Math.sin(ang + 0.42);
        out += `<path d="M${hx1.toFixed(1)} ${hy1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)} L${hx2.toFixed(1)} ${hy2.toFixed(1)}" fill="none" stroke="${THEME.accent}" stroke-width="${sw.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="${headA.toFixed(3)}"/>`;
      }
    }

    if (scene.label) {
      const la = easeOut(clamp01((p - 0.45) / 0.3));
      const lx = (scene.labelX ?? 0.5) * c.W;
      const ly = (scene.labelY ?? 0.2) * c.H;
      out += `<g ${enter(la, 'up', 10 * (c.W / 1000))}><text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${THEME.accent}" font-family="${THEME.font}" font-size="${Math.round(38 * (c.W / 1000))}" font-weight="900">${escapeXml(scene.label)}</text></g>`;
    }

    return shell(c, out);
  };
}
