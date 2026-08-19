import type { RenderProfile, Slide, SlideBody, SlideScript, SlideTimeline } from '../types.js';
import { CONFIG } from '../config.js';

/**
 * PPT 演示风格的版式引擎。
 *
 * 跟 src/lib/ass.ts 是两套独立的东西，一行代码都不共用 —— 配色、字号基准、
 * 布局逻辑全都相反（那边深底冷调，这边米白暖底）。常量重复几个，
 * 好过把两种风格塞进一套参数化的配置里：那样改一边必然弄坏另一边。
 *
 * 底图是 ffmpeg 的纯色源，不进这个文件；这里只出 ASS。
 */

/* ---------- 配色。ASS 是 &HAABBGGRR，BGR 不是 RGB ---------- */
/** 米白底 #FDF3E4 —— 底图由 ffmpeg 画，这里只在需要盖块时用 */
const PAPER = '&H00E4F3FD';
/** 主色 #C5381C */
const BRAND = '&H001C38C5';
/** 正文 #1F1B18 */
const INK = '&H00181B1F';
/** 次要文字 #6B625A */
const MUTED = '&H005A626B';
/** 未点亮的节点 #C9BFB2 */
const DIM = '&H00B2BFC9';
const WHITE = '&H00FFFFFF';

/* ---------- 字号基准，按 1920x1080 标定 ---------- */
const S = {
  kicker: 40,
  hookTitle: 116,
  statement: 92,
  slideTitle: 68,
  item: 52,
  timelineNode: 54,
  timelineCap: 36,
  number: 168,
  unit: 52,
  note: 34,
  source: 36,
  /** 底部跟读字幕。PPT 风的字幕是配角，比空镜风小一号 */
  cue: 44,
};

/** 屏内左右留白（占画幅宽度） */
const PAD_RATIO = 0.085;
/** 一屏淡入淡出 */
const FADE = '\\fad(200,200)';
/** 逐条出现的单条淡入 */
const ITEM_FADE = '\\fad(260,0)';

/* ---------- 文本工具（跟 ass.ts 各留一份，故意不共用） ---------- */

const PUNCT = /[，。、；：！？「」『』（）——…\s]/g;
/** 同一个字符集但不带 g —— 带 g 的正则 .test() 是有状态的，逐字判断会隔一个漏一个 */
const PUNCT_ONE = /[，。、；：！？「」『』（）——…\s]/;

/** 去掉标点，得到跟 TTS 词事件逐字对应的纯文本 */
export function stripPunct(text: string): string {
  return text.replace(PUNCT, '');
}

function estimateWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) units += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.55;
  return units * fontSize;
}

/** 按宽度折行，优先断在标点后 */
function wrap(text: string, fontSize: number, maxWidth: number): string[] {
  const BREAK_AFTER = '，、；：。！？,;:!?）」』';
  const lines: string[] = [];
  let cur: string[] = [];
  let w = 0;
  for (const ch of text) {
    const cw = estimateWidth(ch, fontSize);
    if (w + cw > maxWidth && cur.length && !BREAK_AFTER.includes(ch)) {
      let cut = -1;
      for (let k = cur.length - 1; k >= Math.floor(cur.length * 0.5); k--) {
        if (BREAK_AFTER.includes(cur[k])) { cut = k + 1; break; }
      }
      if (cut > 0 && cut < cur.length) {
        lines.push(cur.slice(0, cut).join(''));
        cur = cur.slice(cut);
        w = estimateWidth(cur.join(''), fontSize);
      } else {
        lines.push(cur.join(''));
        cur = [];
        w = 0;
      }
    }
    cur.push(ch);
    w += cw;
  }
  if (cur.length) lines.push(cur.join(''));
  return lines;
}

/** 缩到放得下为止。返回实际字号和折好的行 */
function fit(text: string, base: number, maxWidth: number, maxLines: number) {
  let size = base;
  let lines = wrap(text, size, maxWidth);
  while (lines.length > maxLines && size > base * 0.6) {
    size *= 0.93;
    lines = wrap(text, size, maxWidth);
  }
  return { size: Math.round(size), lines };
}

function ms2ass(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/* ---------- 事件构造 ---------- */

/**
 * 两套配色。
 *
 * paper 是独立 PPT 片用的（米白底），overlay 是盖在素材视频上用的
 * —— 后者必须跟空镜风的配色一致（白字 + 那边的正红），
 * 否则中途插进来的面板会像一张贴上去的截图。
 */
const OVERLAY = {
  [BRAND]: '&H002222EE', // 空镜风的正红
  [INK]: '&H00FFFFFF',
  [MUTED]: '&H00B8B8B8',
  [DIM]: '&H00707070',
} as Record<string, string>;

/** 面板盖在素材上时的压暗程度，跟片头封面卡是同一块（实测压暗 55%） */
const OVERLAY_SCRIM_ALPHA = '&H30&';

interface Ctx {
  p: RenderProfile;
  /** 画幅缩放：竖版所有尺寸按宽度比缩，而不是按 profile.fontScale */
  k: number;
  startMs: number;
  endMs: number;
  out: string[];
  /** 'paper' = 独立 PPT 片，'overlay' = 盖在素材视频上 */
  theme: 'paper' | 'overlay';
  /** ASS 样式名。独立片用 Slide，面板挂在空镜风的字幕里时用 Panel */
  style: string;
  /**
   * 逐条高亮的时间窗。
   *
   * 给了就是「全部条目一开始就出齐，讲到哪条哪条变亮」；
   * 不给就退回 itemStarts 那套「讲到哪条哪条才出现」。
   * 时间轴那种按时间排的图必须用前者 —— 稿件的叙述顺序跟时间顺序不一定一致，
   * 逐个点亮会让节点跳着亮。
   */
  active?: Array<[number, number] | null>;
  /**
   * 内容带：版式只在这个纵向区间里排版。
   * 独立 PPT 片是整幅，盖在素材上的面板只占画面上半部分 ——
   * 下半部分要留给素材本身和底部跟读字幕。
   */
  band: { top: number; bottom: number };
  /** 该主题的淡入淡出。面板按规格是各 0.5 秒，比独立片长 */
  fade: string;
}

/** 内容带的垂直中线 */
function midY(c: Ctx): number {
  return (c.band.top + c.band.bottom) / 2;
}

/** 内容带顶部起排的位置 */
function topY(c: Ctx, ratio: number): number {
  return c.band.top + (c.band.bottom - c.band.top) * ratio;
}

/** 把配色换成当前主题的。颜色常量是 10 位的独特串，直接整串替换不会误伤 */
function tint(c: Ctx, s: string): string {
  if (c.theme === 'paper') return s;
  let out = s;
  for (const [from, to] of Object.entries(OVERLAY)) out = out.split(from).join(to);
  return out;
}

function ev(c: Ctx, tags: string, text: string, layer = 2, startMs = c.startMs): void {
  c.out.push(
    `Dialogue: ${layer},${ms2ass(startMs)},${ms2ass(c.endMs)},${c.style},,0,0,0,,{${tint(c, tags)}}${text}`,
  );
}

/** 实心矩形 */
function box(c: Ctx, x: number, y: number, w: number, h: number, color: string, layer = 1, startMs = c.startMs): void {
  const [W, H] = [Math.round(w), Math.round(h)];
  if (W <= 0 || H <= 0) return;
  c.out.push(
    `Dialogue: ${layer},${ms2ass(startMs)},${ms2ass(c.endMs)},${c.style},,0,0,0,,` +
      `{\\an7\\pos(${Math.round(x)},${Math.round(y)})\\p1\\c${tint(c, color)}\\bord0\\shad0${FADE}}` +
      `m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}{\\p0}`,
  );
}

/** 多行文本块，返回块底部的 y */
function block(
  c: Ctx,
  lines: string[],
  size: number,
  x: number,
  y: number,
  align: 'left' | 'center',
  color: string,
  gap = 1.34,
  startMs = c.startMs,
  fade = FADE,
): number {
  const an = align === 'center' ? 8 : 7;
  lines.forEach((t, i) => {
    ev(c, `\\an${an}\\pos(${Math.round(x)},${Math.round(y + i * size * gap)})\\fs${size}\\c${color}${fade}`, t, 2, startMs);
  });
  return y + lines.length * size * gap;
}

/** 角标：小字 + 底下一条红短横 */
function kicker(c: Ctx, text: string, x: number, y: number): number {
  const fs = Math.round(S.kicker * c.k);
  ev(c, `\\an7\\pos(${x},${y})\\fs${fs}\\c${BRAND}${c.fade}`, text);
  box(c, x, y + fs * 1.5, estimateWidth(text, fs), Math.max(3, 4 * c.k), BRAND);
  return y + fs * 1.5 + 4 * c.k;
}

/* ---------- 逐条出现的时间点 ---------- */

/**
 * 每条什么时候亮。
 *
 * 有 itemAnchors 就按锚点（解说念到哪条哪条亮），没有就在本屏时长里均分。
 * 均分时把全部条目压在前 70% 出完 —— 最后一条卡着切屏才出现等于没出现。
 */
function itemStarts(slide: SlideBody, n: number, startMs: number, endMs: number, anchorMs: (a: string) => number | null): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = slide.itemAnchors?.[i];
    const t = a ? anchorMs(a) : null;
    out.push(t === null ? startMs + ((endMs - startMs) * 0.7 * i) / Math.max(1, n) : t);
  }
  // 单调递增，防止锚点写反
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
  return out.map((t) => Math.max(startMs, Math.min(t, endMs - 300)));
}

/* ================= 九种版式 ================= */

function layoutHook(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const maxW = p.width * (1 - PAD_RATIO * 2);
  const cx = Math.round(p.width / 2);
  const { size, lines } = fit(s.title ?? '', S.hookTitle * k, maxW, 3);
  const totalH = lines.length * size * 1.3;
  let y = Math.round(midY(c) -  totalH / 2);

  if (s.kicker) {
    const fs = Math.round(S.kicker * k);
    ev(c, `\\an8\\pos(${cx},${y - fs * 2.6})\\fs${fs}\\c${BRAND}${c.fade}`, s.kicker);
  }
  y = block(c, lines, size, cx, y, 'center', INK, 1.3);
  const ruleW = Math.min(maxW, estimateWidth(lines[lines.length - 1] ?? '', size));
  box(c, cx - ruleW / 2, y + size * 0.18, ruleW, Math.max(6, 10 * k), BRAND);
  if (s.note) {
    const fs = Math.round(S.note * k);
    ev(c, `\\an8\\pos(${cx},${Math.round(y + size * 0.18 + 10 * k + fs * 0.9)})\\fs${fs}\\c${MUTED}${c.fade}`, s.note);
  }
}

function layoutStatement(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const maxW = p.width * (1 - PAD_RATIO * 2);
  const cx = Math.round(p.width / 2);
  const { size, lines } = fit(s.title ?? '', S.statement * k, maxW, 4);
  const totalH = lines.length * size * 1.32;
  const y = Math.round(midY(c) -  totalH / 2);
  // 上方一条短红线当引号
  box(c, cx - 60 * k, y - size * 0.75, 120 * k, Math.max(5, 8 * k), BRAND);
  block(c, lines, size, cx, y, 'center', BRAND, 1.32);
}

function layoutNumber(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const cx = Math.round(p.width / 2);
  const vfs = Math.round(Math.min(S.number * k, (p.width * (1 - PAD_RATIO * 2)) / Math.max(1, estimateWidth(s.value ?? '', 1))));
  let y = Math.round(midY(c) -  vfs * 0.75);
  if (s.kicker) {
    const fs = Math.round(S.kicker * k);
    ev(c, `\\an8\\pos(${cx},${y - fs * 2.4})\\fs${fs}\\c${BRAND}${c.fade}`, s.kicker);
  }
  ev(c, `\\an8\\pos(${cx},${y})\\fs${vfs}\\c${BRAND}${c.fade}`, s.value ?? '');
  y += vfs * 1.12;
  if (s.unit) {
    const fs = Math.round(S.unit * k);
    ev(c, `\\an8\\pos(${cx},${Math.round(y)})\\fs${fs}\\c${INK}${c.fade}`, s.unit);
    y += fs * 1.5;
  }
  if (s.note) {
    const fs = Math.round(S.note * k);
    const { size, lines } = fit(s.note, fs, p.width * (1 - PAD_RATIO * 2), 2);
    block(c, lines, size, cx, Math.round(y), 'center', MUTED, 1.35);
  }
}

function layoutList(c: Ctx, s: SlideBody, checklist: boolean, anchorMs: (a: string) => number | null): void {
  const { p, k } = c;
  const x = Math.round(p.width * PAD_RATIO);
  const maxW = p.width * (1 - PAD_RATIO * 2);
  let y = Math.round(topY(c, 0.05));

  if (s.kicker) y = kicker(c, s.kicker, x, y) + 34 * k;
  if (s.title) {
    const { size, lines } = fit(s.title, S.slideTitle * k, maxW, 2);
    y = block(c, lines, size, x, y, 'left', INK, 1.28) + 26 * k;
  }

  const items = s.items ?? [];
  const starts = itemStarts(s, items.length, c.startMs, c.endMs, anchorMs);
  const ifs = Math.round(S.item * k);
  const markW = ifs * 1.05;
  const rowGap = ifs * 1.86;

  items.forEach((t, i) => {
    const ry = Math.round(y + i * rowGap);
    const st = starts[i];
    if (checklist) {
      // 勾号用绘图画，字体里的 ✓ 在不同系统上宽度不一致
      const b = ifs * 0.62;
      c.out.push(
        `Dialogue: 1,${ms2ass(st)},${ms2ass(c.endMs)},Slide,,0,0,0,,` +
          `{\\an7\\pos(${x},${Math.round(ry + ifs * 0.22)})\\p1\\c${BRAND}\\bord0\\shad0${ITEM_FADE}}` +
          `m 0 ${Math.round(b * 0.52)} l ${Math.round(b * 0.16)} ${Math.round(b * 0.36)} ` +
          `l ${Math.round(b * 0.42)} ${Math.round(b * 0.66)} l ${Math.round(b)} 0 ` +
          `l ${Math.round(b * 1.14)} ${Math.round(b * 0.2)} l ${Math.round(b * 0.42)} ${Math.round(b)}{\\p0}`,
      );
    } else {
      box(c, x, ry + ifs * 0.14, markW * 0.72, markW * 0.72, BRAND, 1, st);
      ev(
        c,
        `\\an7\\pos(${Math.round(x + markW * 0.16)},${Math.round(ry + ifs * 0.2)})` +
          `\\fs${Math.round(ifs * 0.62)}\\c${WHITE}${ITEM_FADE}`,
        String(i + 1),
        2,
        st,
      );
    }
    const tx = Math.round(x + markW * 1.5);
    const { size, lines } = fit(t, ifs, maxW - markW * 1.5, 2);
    block(c, lines, size, tx, ry, 'left', INK, 1.24, st, ITEM_FADE);
  });

  if (s.note) {
    const fs = Math.round(S.note * k);
    ev(c, `\\an7\\pos(${x},${Math.round(y + items.length * rowGap + 12 * k)})\\fs${fs}\\c${MUTED}${c.fade}`, s.note);
  }
}

function layoutTimeline(c: Ctx, s: SlideBody, anchorMs: (a: string) => number | null): void {
  const { p, k } = c;
  const items = s.items ?? [];
  const caps = s.captions ?? [];
  const starts = itemStarts(s, items.length, c.startMs, c.endMs, anchorMs);
  const x = Math.round(p.width * PAD_RATIO);
  const maxW = p.width * (1 - PAD_RATIO * 2);
  let y = Math.round(topY(c, 0.05));

  if (s.kicker) y = kicker(c, s.kicker, x, y) + 30 * k;
  if (s.title) {
    const { size, lines } = fit(s.title, S.slideTitle * k, maxW, 2);
    y = block(c, lines, size, x, y, 'left', INK, 1.28) + 40 * k;
  }

  const vertical = p.height > p.width;
  const nfs = Math.round(S.timelineNode * k);
  const cfs = Math.round(S.timelineCap * k);
  const dot = Math.max(14, Math.round(22 * k));

  // 高亮窗：整段面板都把节点画出来，只有正在讲的那个变亮
  const act = c.active;
  /** 取一段时间窗内的临时上下文，用来叠一层高亮 */
  const at = (w: [number, number]): Ctx => ({ ...c, startMs: w[0], endMs: w[1] });

  if (vertical) {
    // 竖版：纵向时间轴，节点在左，文字在右
    const lineX = Math.round(x + dot / 2);
    const step = Math.min(320 * k, (c.band.bottom - y) / Math.max(1, items.length));
    box(c, lineX - Math.max(2, 3 * k), y, Math.max(4, 6 * k), step * (items.length - 1) + dot, DIM);
    items.forEach((t, i) => {
      const ny = Math.round(y + i * step);
      const tx = Math.round(lineX + dot * 1.8);
      const capBox = (ctx: Ctx, color: string, st: number, fade: string) => {
        if (!caps[i]) return;
        const { size, lines } = fit(caps[i], cfs, maxW - dot * 2.4, 2);
        block(ctx, lines, size, tx, Math.round(ny + nfs * 1.15), 'left', color, 1.28, st, fade);
      };
      box(c, lineX - dot / 2, ny, dot, dot, DIM);
      if (act) {
        ev(c, `\\an7\\pos(${tx},${ny - nfs * 0.12})\\fs${nfs}\\c${MUTED}${c.fade}`, t);
        capBox(c, MUTED, c.startMs, c.fade);
        const w = act[i];
        if (w) {
          const h = at(w);
          box(h, lineX - dot / 2, ny, dot, dot, BRAND);
          ev(h, `\\an7\\pos(${tx},${ny - nfs * 0.12})\\fs${nfs}\\c${INK}${ITEM_FADE}`, t, 3);
          capBox(h, INK, w[0], ITEM_FADE);
        }
      } else {
        box(c, lineX - dot / 2, ny, dot, dot, BRAND, 1, starts[i]);
        ev(c, `\\an7\\pos(${tx},${ny - nfs * 0.12})\\fs${nfs}\\c${INK}${ITEM_FADE}`, t, 2, starts[i]);
        capBox(c, MUTED, starts[i], ITEM_FADE);
      }
    });
  } else {
    /*
     * 横版：横向时间轴，节点等距、**上下交替**排布、**交错入场**。
     *
     * 上下交替是为了给说明文字腾地方 —— 五个节点全挤在轴上方，
     * 说明文字会互相顶。交替之后每条说明有整整一格的高度可用。
     *
     * 入场是逐个的（每个晚 320ms），跟「哪个节点变红」是两件事：
     * 入场只发生一次，高亮跟着解说走。
     */
    const cy = Math.round(topY(c, 0.68));
    const n = Math.max(1, items.length);
    const step = maxW / n;
    const ENTER_GAP = 320;
    const RISE = Math.round(22 * k);

    // 轴本身先出来，节点再逐个落上去
    box(c, x, cy - Math.max(2, 3 * k), maxW, Math.max(4, 6 * k), DIM);

    items.forEach((t, i) => {
      const nx = Math.round(x + step * (i + 0.5));
      const above = i % 2 === 0;
      const enter = c.startMs + 260 + i * ENTER_GAP;
      const capLines = caps[i] ? fit(caps[i], cfs, step * 0.92, 3) : null;

      // 标签贴着轴，说明在标签外侧；above 的一整块都往上排
      const labelY = above ? cy - dot * 1.05 : cy + dot * 1.05;
      const labelAn = above ? 2 : 8;
      /*
       * block() 是从顶端往下长的（\an8）。所以上方那一组要把整块的高度
       * 全减掉，让它的**底边**落在标签上方 —— 少减一行，说明就会压在标签上。
       */
      const capH = capLines ? capLines.lines.length * capLines.size * 1.3 : 0;
      const capY = above ? labelY - nfs * 1.22 - capH : labelY + nfs * 1.18;

      const ENTER = `\\move(${nx},${labelY + (above ? RISE : -RISE)},${nx},${labelY},0,300)\\fad(300,0)`;
      const capEnter = (yy: number) =>
        `\\move(${nx},${yy + (above ? RISE : -RISE)},${nx},${yy},0,300)\\fad(300,0)`;

      const capBox = (ctx: Ctx, color: string, st: number, fade: string) => {
        if (!capLines) return;
        block(ctx, capLines.lines, capLines.size, nx, Math.round(capY), 'center', color, 1.3, st, fade);
      };

      // 节点方块：交错入场，暗色底
      box(c, nx - dot / 2, cy - dot / 2, dot, dot, DIM, 1, enter);

      if (act) {
        const base: Ctx = { ...c, startMs: enter };
        ev(base, `\\an${labelAn}\\pos(${nx},${Math.round(labelY)})\\fs${nfs}\\c${MUTED}${ENTER}`, t, 2, enter);
        capBox(base, MUTED, enter, capEnter(Math.round(capY)));
        const w = act[i];
        if (w) {
          const h = at(w);
          box(h, nx - dot / 2, cy - dot / 2, dot, dot, BRAND);
          ev(h, `\\an${labelAn}\\pos(${nx},${Math.round(labelY)})\\fs${nfs}\\c${INK}${ITEM_FADE}`, t, 3);
          capBox(h, INK, w[0], ITEM_FADE);
        }
      } else {
        box(c, nx - dot / 2, cy - dot / 2, dot, dot, BRAND, 1, starts[i]);
        ev(c, `\\an${labelAn}\\pos(${nx},${Math.round(labelY)})\\fs${nfs}\\c${INK}${ENTER}`, t, 2, enter);
        capBox(c, MUTED, enter, capEnter(Math.round(capY)));
      }
    });
  }
}

function layoutCompare(c: Ctx, s: SlideBody, anchorMs: (a: string) => number | null): void {
  const { p, k } = c;
  const x = Math.round(p.width * PAD_RATIO);
  const maxW = p.width * (1 - PAD_RATIO * 2);
  let y = Math.round(topY(c, 0.05));

  if (s.kicker) y = kicker(c, s.kicker, x, y) + 30 * k;
  if (s.title) {
    const { size, lines } = fit(s.title, S.slideTitle * k, maxW, 2);
    y = block(c, lines, size, x, y, 'left', INK, 1.28) + 40 * k;
  }

  const cols = [s.left, s.right].filter(Boolean) as NonNullable<Slide['left']>[];
  const starts = itemStarts(s, cols.length, c.startMs, c.endMs, anchorMs);
  const tfs = Math.round(S.item * k * 0.86);
  const ifs = Math.round(S.item * k);
  const vertical = p.height > p.width;

  cols.forEach((col, i) => {
    const isRight = i === 1;
    const color = isRight ? BRAND : MUTED;
    let cx: number;
    let cy: number;
    let colW: number;
    if (vertical) {
      // 竖版：上下堆叠
      cx = x;
      colW = maxW;
      cy = Math.round(y + i * ((c.band.bottom - y) * 0.46));
    } else {
      colW = maxW / 2 - 40 * k;
      cx = Math.round(x + i * (colW + 80 * k));
      cy = y;
    }
    // 栏头色条
    box(c, cx, cy, colW, Math.max(5, 8 * k), color, 1, starts[i]);
    ev(c, `\\an7\\pos(${cx},${Math.round(cy + 20 * k)})\\fs${tfs}\\c${color}${ITEM_FADE}`, col.title, 2, starts[i]);
    let iy = cy + 20 * k + tfs * 1.5;
    for (const t of col.items) {
      const { size, lines } = fit(t, ifs, colW, 2);
      iy = block(c, lines, size, cx, Math.round(iy), 'left', isRight ? INK : MUTED, 1.24, starts[i], ITEM_FADE) + 12 * k;
    }
  });

  if (!vertical && cols.length === 2) {
    // 中间的分隔线 + 箭头暗示方向
    const mid = Math.round(p.width / 2);
    box(c, mid - Math.max(1, 2 * k), y, Math.max(2, 3 * k), (c.band.bottom - y) * 0.8, DIM);
  }
}

function layoutSource(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const x = Math.round(p.width * PAD_RATIO);
  const maxW = p.width * (1 - PAD_RATIO * 2);
  let y = Math.round(topY(c, 0.08));
  if (s.kicker) y = kicker(c, s.kicker, x, y) + 30 * k;
  if (s.title) {
    const { size, lines } = fit(s.title, S.slideTitle * k * 0.8, maxW, 2);
    y = block(c, lines, size, x, y, 'left', INK, 1.3) + 26 * k;
  }
  const fs = Math.round(S.source * k);
  for (const t of s.items ?? []) {
    const { size, lines } = fit(t, fs, maxW, 2);
    y = block(c, lines, size, x, Math.round(y), 'left', MUTED, 1.3) + 14 * k;
  }
  if (s.note) {
    const nfs = Math.round(S.note * k);
    const { size, lines } = fit(s.note, nfs, maxW, 3);
    block(c, lines, size, x, Math.round(y + 20 * k), 'left', MUTED, 1.32);
  }
}

function layoutOutro(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const cx = Math.round(p.width / 2);
  const maxW = p.width * (1 - PAD_RATIO * 2);
  const { size, lines } = fit(s.title ?? '', S.statement * k * 0.92, maxW, 3);
  const y = Math.round(midY(c) -  (lines.length * size * 1.3) / 2);
  const bottom = block(c, lines, size, cx, y, 'center', INK, 1.3);
  box(c, cx - 90 * k, bottom + size * 0.22, 180 * k, Math.max(6, 10 * k), BRAND);
  if (s.note) {
    const fs = Math.round(S.note * k);
    const w = fit(s.note, fs, maxW, 2);
    block(c, w.lines, w.size, cx, Math.round(bottom + size * 0.22 + 10 * k + fs * 1.1), 'center', MUTED, 1.32);
  }
}

/* ---------- 底部跟读字幕 ---------- */

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * 把解说词切成跟读字幕。
 *
 * 按标点切，太长的再按宽度切；每条的起止时间由词级时间戳查出来。
 * 这条字幕是配角 —— 画面上的版式才是主角，所以字号比空镜风小一号、
 * 颜色也压成次要色，不跟版式抢。
 */
export function buildCues(script: SlideScript, tl: SlideTimeline, p: RenderProfile): Cue[] {
  const maxChars = p.height > p.width ? 15 : 26;
  // narration 的第 i 个字符对应 plain 里的哪一位
  const map: number[] = [];
  let pi = 0;
  for (const ch of script.narration) {
    map.push(PUNCT_ONE.test(ch) ? -1 : pi++);
  }
  const chars = [...script.narration];

  const cues: Cue[] = [];
  let buf: number[] = [];
  const flush = () => {
    const kept = buf.filter((i) => map[i] >= 0);
    if (!kept.length) { buf = []; return; }
    const a = map[kept[0]];
    const b = map[kept[kept.length - 1]];
    const startMs = tl.charMs[a] ?? 0;
    const endMs = (tl.charMs[b + 1] ?? tl.totalMs) + 60;
    cues.push({ startMs, endMs, text: buf.map((i) => chars[i]).join('').trim() });
    buf = [];
  };
  for (let i = 0; i < chars.length; i++) {
    buf.push(i);
    const ch = chars[i];
    const hard = '。！？'.includes(ch);
    const soft = '，、；：'.includes(ch);
    const kept = buf.filter((j) => map[j] >= 0).length;
    // 逗号处的软断阈值压到 45%：定高了就会跑到 kept >= maxChars 那个分支，
    // 在没有标点的地方硬切，字幕会断在词中间（「值得去确认一 / 下状态」）
    if (hard || (soft && kept >= maxChars * 0.45) || kept >= maxChars) flush();
  }
  flush();
  return cues;
}

/* ---------- 主入口 ---------- */

function styleHeader(p: RenderProfile): string {
  const f = CONFIG.fontName;
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${p.width}`,
    `PlayResY: ${p.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ' +
      'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, ' +
      'Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 米白底上不需要描边，描边反而脏。字号逐条用 \fs 覆盖
    `Style: Slide,${f},60,${INK},&H000000FF,${PAPER},${PAPER},-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Cue,${f},${Math.round(S.cue * (p.height > p.width ? 1.18 : 1.0))},${INK},&H000000FF,${PAPER},${PAPER},` +
      `0,0,0,0,100,100,0,0,1,0,0,2,80,80,${Math.round(64 * (p.height > p.width ? 1.18 : 1.0))},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
}

/* ---------- 大额数字并排，从 0 滚到目标值 ---------- */

/** 单个数字滚多久 */
const ROLL_MS = 1100;
/** 滚动分几帧。26 帧在 1.1 秒里约 42ms 一跳，肉眼是连续的 */
const ROLL_STEPS = 26;
/** 相邻两个数字之间错开多久起跳 */
const ROLL_STAGGER = 160;

/**
 * ASS 没有计数器，滚动只能一帧一个 Dialogue 事件。
 *
 * 26 帧 × 几个数字，事件数完全在可接受范围内。缓动用三次方缓出
 * （前快后慢）—— 匀速滚出来像秒表，缓出才像「停在一个数上」。
 */
function layoutNumbers(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const vals = s.values ?? [];
  if (!vals.length) return;

  const cx = Math.round(p.width / 2);
  const vertical = p.height > p.width;
  const n = vals.length;
  const slot = (p.width * (1 - PAD_RATIO * 2)) / n;
  // 数字要能并排放下：按最宽的那个算字号
  const widest = Math.max(...vals.map((v) => estimateWidth(`${v.target}${v.suffix ?? ''}`, 1)));
  const vfs = Math.round(Math.min(S.number * k * 0.78, (slot * 0.86) / widest));
  const lfs = Math.round(S.note * k * 1.15);

  let y = Math.round(topY(c, 0.34));
  if (s.kicker) {
    const fs = Math.round(S.kicker * k);
    ev(c, `\\an8\\pos(${cx},${y - fs * 2.8})\\fs${fs}\\c${BRAND}${c.fade}`, s.kicker);
  }
  if (s.title) {
    const { size, lines } = fit(s.title, S.slideTitle * k * 0.8, p.width * (1 - PAD_RATIO * 2), 2);
    y = block(c, lines, size, cx, y - size * 1.9, 'center', INK, 1.28) + size * 0.6;
  }

  const rollEnd = c.startMs + ROLL_STAGGER * (n - 1) + ROLL_MS;

  vals.forEach((v, i) => {
    const nx = Math.round(p.width * PAD_RATIO + slot * (i + 0.5));
    const t0 = c.startMs + ROLL_STAGGER * i;
    for (let f = 0; f < ROLL_STEPS; f++) {
      const a = t0 + (ROLL_MS * f) / ROLL_STEPS;
      const bEnd = f === ROLL_STEPS - 1 ? c.endMs : t0 + (ROLL_MS * (f + 1)) / ROLL_STEPS;
      const prog = (f + 1) / ROLL_STEPS;
      const eased = 1 - Math.pow(1 - prog, 3);
      const shown = Math.round(v.target * eased);
      const step: Ctx = { ...c, startMs: a, endMs: bEnd };
      // 只有第一帧和最后一帧带淡入淡出，中间帧不带 —— 否则每跳一次都闪一下
      const fade = f === 0 ? '\\fad(220,0)' : f === ROLL_STEPS - 1 ? '\\fad(0,200)' : '';
      ev(step, `\\an8\\pos(${nx},${y})\\fs${vfs}\\c${BRAND}${fade}`, `${shown}${v.suffix ?? ''}`, 3, a);
    }
    if (v.label) {
      ev(c, `\\an8\\pos(${nx},${Math.round(y + vfs * 1.16)})\\fs${lfs}\\c${MUTED}${c.fade}`, v.label, 2, t0);
    }
  });

  // 滚完之后说明才浮出来 —— 提前出现会跟跳动的数字抢注意力
  if (s.note) {
    const fs = Math.round(S.note * k * 1.1);
    const ny = Math.round(y + vfs * 1.16 + lfs * 2.0);
    const late: Ctx = { ...c, startMs: rollEnd };
    ev(
      late,
      `\\an8\\move(${cx},${ny + Math.round(26 * k)},${cx},${ny},0,320)\\fs${fs}\\c${MUTED}\\fad(300,200)`,
      s.note,
      2,
      rollEnd,
    );
  }
}

/* ---------- 金句：逐字打出，打完关键词变红放大 ---------- */

/** 每个字打出来的间隔 */
const TYPE_MS = 62;

function layoutQuote(c: Ctx, s: SlideBody): void {
  const { p, k } = c;
  const x = Math.round(p.width * PAD_RATIO);
  const maxW = p.width * (1 - PAD_RATIO * 2) - 40 * k;
  const { size, lines } = fit(s.title ?? '', S.statement * k * 0.86, maxW, 4);
  const totalH = lines.length * size * 1.32;
  const y = Math.round(midY(c) -  totalH / 2);

  // 左侧一条红竖线，跟空镜风的角标是同一套语汇
  const barW = Math.max(6, Math.round(11 * k));
  box(c, x - 34 * k - barW, y, barW, totalH * 0.94, BRAND);

  const flat = lines.join('');
  const total = [...flat].length;
  const typeMs = Math.min(TYPE_MS * total, (c.endMs - c.startMs) * 0.55);
  const per = typeMs / Math.max(1, total);

  /** 取前 n 个字，按原来的折行位置重新插回 \N */
  const partial = (n: number): string => {
    const out: string[] = [];
    let left = n;
    for (const ln of lines) {
      const arr = [...ln];
      if (left <= 0) break;
      out.push(arr.slice(0, left).join(''));
      left -= arr.length;
    }
    return out.join('\\N');
  };

  const tags = (extra = '') => `\\an7\\pos(${x},${y})\\fs${size}\\c${WHITE}${extra}`;

  for (let i = 1; i <= total; i++) {
    const a = c.startMs + per * (i - 1);
    const b = i === total ? c.startMs + typeMs : c.startMs + per * i;
    const step: Ctx = { ...c, startMs: a, endMs: b };
    ev(step, tags(i === 1 ? '\\fad(160,0)' : ''), partial(i), 3, a);
  }

  // 打完的定版：关键词变红并放大一点
  const hl = s.highlight && flat.includes(s.highlight) ? s.highlight : null;
  let body = lines.join('\\N');
  if (hl) {
    // 关键词可能被折行切开，所以在插过 \N 的字符串上找带 \N 的变体
    const variants = [hl, [...hl].join('\\N'), ...[...hl].map((_, i) => [...hl].slice(0, i + 1).join('') + '\\N' + [...hl].slice(i + 1).join(''))];
    const hit = variants.find((v) => body.includes(v));
    if (hit) {
      body = body.replace(
        hit,
        `{\\c${BRAND}\\fscx100\\fscy100\\t(0,320,\\fscx112\\fscy112)}${hit}{\\c${WHITE}\\fscx100\\fscy100}`,
      );
    }
  }
  const done: Ctx = { ...c, startMs: c.startMs + typeMs };
  ev(done, tags('\\fad(0,220)'), body, 3, c.startMs + typeMs);
}

function dispatch(c: Ctx, s: SlideBody, soft: (a: string) => number | null): void {
  switch (s.layout) {
    case 'hook': layoutHook(c, s); break;
    case 'statement': layoutStatement(c, s); break;
    case 'number': layoutNumber(c, s); break;
    case 'numbers': layoutNumbers(c, s); break;
    case 'quote': layoutQuote(c, s); break;
    case 'list': layoutList(c, s, false, soft); break;
    case 'checklist': layoutList(c, s, true, soft); break;
    case 'timeline': layoutTimeline(c, s, soft); break;
    case 'compare': layoutCompare(c, s, soft); break;
    case 'source': layoutSource(c, s); break;
    case 'outro': layoutOutro(c, s); break;
  }
}

/**
 * 锚点 → 毫秒。
 *
 * 锚点是解说词里的一小段原文，去标点后在 plain 里找位置，再查 charMs。
 * 找不到或找到多处都直接抛错 —— 这是整条链路最容易在改稿后悄悄错位的地方，
 * 宁可编译不过，也不要出一条画面跟解说对不上的片子。
 */
function makeAnchorResolver(tl: SlideTimeline) {
  return (anchor: string): number => {
    const key = stripPunct(anchor);
    if (!key) throw new Error('锚点为空');
    const first = tl.plain.indexOf(key);
    if (first < 0) throw new Error(`锚点在解说词里找不到：「${anchor}」`);
    if (tl.plain.indexOf(key, first + 1) >= 0) {
      throw new Error(`锚点在解说词里出现多次，请写长一点：「${anchor}」`);
    }
    return tl.charMs[first] ?? 0;
  };
}

export function buildSlideAss(script: SlideScript, tl: SlideTimeline, p: RenderProfile): string {
  const resolve = makeAnchorResolver(tl);
  const soft = (a: string): number | null => {
    try { return resolve(a); } catch { return null; }
  };

  // 每屏的起点由锚点定，终点是下一屏的起点
  const starts = script.slides.map((s) => resolve(s.anchor));
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1]) {
      throw new Error(
        `第 ${i} 屏的锚点「${script.slides[i].anchor}」不在第 ${i - 1} 屏之后，分镜顺序跟解说词对不上`,
      );
    }
  }

  const out: string[] = [];
  script.slides.forEach((s, i) => {
    const startMs = i === 0 ? 0 : starts[i];
    const endMs = i === script.slides.length - 1 ? tl.totalMs : starts[i + 1];
    /*
     * 竖版不能只按画幅宽度等比缩。
     *
     * 1080 宽只有横版的 0.5625，纯等比缩下来「占画面宽度的比例」是一样的，
     * 但竖版是手机上看的，同样的比例在手上就是一堆蚂蚁。再乘 1.55 之后，
     * 标题约占画幅宽度的 5.5%，跟另一套风格的竖版字号量级对得上。
     */
    const k = (p.width / 1920) * (p.height > p.width ? 1.55 : 1);
    dispatch(
      { p, k, startMs, endMs, out, theme: 'paper', style: 'Slide',
        band: { top: 0, bottom: p.height }, fade: FADE },
      s, soft,
    );
  });

  // 跟读字幕最后叠上去
  for (const cue of buildCues(script, tl, p)) {
    out.push(
      `Dialogue: 4,${ms2ass(cue.startMs)},${ms2ass(cue.endMs)},Cue,,0,0,0,,` +
        `{\\c${MUTED}\\fad(100,100)}${cue.text}`,
    );
  }

  return `${styleHeader(p)}\n${out.join('\n')}\n`;
}

/** 顺带产出 srt，发平台时能直接上传外挂字幕 */
export function buildSrt(script: SlideScript, tl: SlideTimeline, p: RenderProfile): string {
  const t = (ms: number) => {
    const x = Math.max(0, Math.round(ms));
    const h = Math.floor(x / 3600000);
    const m = Math.floor((x % 3600000) / 60000);
    const s = Math.floor((x % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(x % 1000).padStart(3, '0')}`;
  };
  return buildCues(script, tl, p)
    .map((c, i) => `${i + 1}\n${t(c.startMs)} --> ${t(c.endMs)}\n${c.text}\n`)
    .join('\n');
}

/** 底图纯色，给 ffmpeg 用（RGB 十六进制，不是 ASS 的 BGR） */
export const PAPER_HEX = '0xFDF3E4';
