// ── 心理洞察线封面：video 1280×720 + square 1400×1400 ─────────────────
//
// 用法：npx tsx src/xinli-cover.ts --line 心理 --ep 已读不回
//
// 版式全部照 `zhiyu/心理洞察向_书目与稿件.md` §七 落的，**这里不发明设计**。
//
// ── 为什么不复用 zhiyu-cover.ts ──
//
// 那份是治愈档的书封版式：左竖条 384px、书名与期标题两列、圆角印在左下、
// 底部 12px 色带、山水插画四层色阶。**§七 是另一套骨架** ——
// 和纸底 + 木格窗框 + 竖排标题 + 落款位方印 + 底部细进度线 + 木刻线描 motif。
// 硬塞进那份的 L/SHOTS 结构里两边都别扭，而且会动到已出片四期的封面代码。
// 治愈那套原样留着，这条线自己一份。
//
// ── 三条不要绕过的 ──
//
//   ① **封面标题 ≤6 字**，竖排放不下更多。字号按字数三档，不做无级缩放 ——
//      统一大字号会让四字标题压住进度线（§七 渲染验证后的结论）。
//   ② **印章是落款位**：标题正下方同轴，标题＋印章作为一个整体垂直居中。
//      放左下角会跟竖排标题相撞，两字标题还会头重脚轻。
//   ③ **motif 定稿前必须缩到 320px 看一眼。** 大图好看小图认不出等于没有 ——
//      §七 记着两次翻车：井口第一版被看成气球，竹简第一版像相机镜头。
//
// ── 印章字 ──
//
// 「醒」是说书频道「醒木不响」的标识。§七 标着治愈频道要换成自己的字、
// 三条线统一替换，但那个字还没定。**现在先用「醒」**，定了改 SEAL_CHAR 一处。

import { resolveEp } from './zhiyu-ep.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const { dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));

/** §七 预设：video 带 hook 文案，square 不显示 hook（不破例） */
export const VW = 1280;
export const VH = 720;
export const SQ = 1400;

/** 待定项。定了改这一处，三条线统一 */
const SEAL_CHAR = '醒';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => Math.round(v * 100) / 100;

const FONT_DIR = fileURLToPath(new URL('../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/', import.meta.url));
const FONT_FILES = ['Black', 'Bold', 'SemiBold', 'Medium', 'Regular', 'Light', 'ExtraLight']
  .map((w) => `${FONT_DIR}NotoSerifCJKsc-${w}.otf`)
  .filter((f) => existsSync(f));
const SC = 'Noto Serif CJK SC';

// ── series：底色与朱砂全频道统一，各线靠主色 + 印形区分 ────────────────
//
// **这份骨架现在服务两条线**：心理洞察（`psychInsight`）和禅佛典
// （`zenParable`）。两条线的封面规范写的是同一套东西（和纸底 + 木格窗框 +
// 竖排标题 + 落款位印 + 底部细进度线 + 木刻线描 motif），所以不另起一个脚本 ——
// 差别只有下面这一组值和 motif，两样都按名字注册。
//
// 缩略图那么小，**形状比色温更容易分辨**：方印是观人，圆印是譬喻。

export interface Series {
  label: string;
  paper: string;
  ink: string;
  accent: string;
  accentSub: string;
  seal: string;
  sealShape: 'square' | 'round';
  motifTint: string;
}

export const SERIES: Record<string, Series> = {
  psychInsight: {
    label: '观人',
    paper: '#F4EFE6',
    ink: '#2E2A26',
    accent: '#4A5B66',
    accentSub: '#8A9AA3',
    seal: '#B33A28',
    sealShape: 'square',
    motifTint: '#4A5B66',
  },

  /** 禅佛典向。稿源 §七之二「本线 series 配置」，赭石主色 + 圆印（取钵与轮的意思） */
  zenParable: {
    label: '譬喻',
    paper: '#F4EFE6',
    ink: '#2E2A26',
    accent: '#8C6A4A',
    accentSub: '#C4A882',
    seal: '#B33A28',
    sealShape: 'round',
    motifTint: '#8C6A4A',
  },
};

// ── 版式（§七「版式（渲染验证后的结论）」）───────────────────────────
//
// **下面这组数全是按 video 预设的 1280 宽给的。** 别的画布要按 W/VW 缩放，
// 否则比例会散 —— 方版 1400×1400 第一版就是直接套这组数渲的：
// 竖排标题和印章相对画布小了一圈、窗子被拉成竖条、底部空出一大块。
// 缩放统一走 frame() 里的 k，**不要在这儿再写第二组常量**。

const L = {
  /** 竖排标题**固定左边距**，不按字号做中线定位 —— 字数一变整列就会左右跳 */
  titleX: 168,
  /** 字号按字数三档。统一大字号会让四字标题压住进度线 */
  size: { 2: 124, 3: 96, 4: 96, 5: 78, 6: 78 } as Record<number, number>,
  /** 字距 = 字号 × 这个系数 */
  gapK: 1.18,
  /** 印章边长 = 字号 × 这个系数。落款位，比正文小一圈 */
  sealK: 0.62,
  /** 标题末字到印章顶的间距 = 字号 × 这个系数 */
  sealGapK: 0.5,
  /** 木格窗框：格距 58px（46px 过密） */
  latticeGap: 58,
  frame: 14,
  /** motif 最大占窗内边长的比例 */
  motifMaxScale: 0.62,
  /** 底部细进度线左右各留多少 */
  barInset: 96,
  barH: 3,
  hookSize: 25,
  /**
   * 横排标题字号上限（按 1280 宽给）。
   * 七字一行在 768 宽的窗里最大能到 104，但**上限压到 92** ——
   * 再大就贴着窗框，缩略图里两边没有喘气的地方，反而显得挤。
   */
  headMax: 92,
  /**
   * 短标题（一行、四字以内）的字号上限。
   *
   * **92 那个数是按七字一行调的**，压到 92 是为了两边留出喘气的地方。
   * 但三个字的时候，两边本来就空着一大半 —— 再守 92 就不是「留白」，
   * 是「窗里没东西」。E01 的「镜中我」撞上过这个。
   *
   * 只在「一行 ＋ ≤4 字」时生效，所以已有的七字标题一个像素都不变。
   */
  headShort: 140,
};

// ── motif：统一木刻线描，笔画粗细恒定 ─────────────────────────────────
//
// **stroke-width 7 是恒定值**，不做渐变、不做阴影。现代物件也按这个笔法画，
// 不得改用 UI 图标风 —— 用刻经的笔法画一个对话气泡，比直接用图标
// 更像这个频道的东西，这个错位本身就是识别点（§七）。
//
// 每个 motif 画在 110×90 的自有坐标系里，由 motif() 统一缩放摆位。

const STROKE = 7;
const MOTIF_W = 126;
const MOTIF_H = 72;

type MotifFn = (tint: string) => string;

/**
 * E01「已读不回」：对话气泡 ＋ 气泡**外**右下两道勾。
 *
 * **勾必须在气泡外。** §七 记着：放里面会被当成气泡的内容（一句话），
 * 而它要表达的是「已读」这个回执 —— 那是气泡之外发生的事。
 *
 * 两版都是缩到 320 才发现问题的，**这个 motif 的难点全在小图上**：
 *
 *   v1  勾起笔在 x=58，压在气泡正下方紧挨尾巴 —— 气泡、尾巴、勾糊成一团
 *   v2  勾挪出气泡右边（左尾右勾各占一边），但两道勾只错开 12、各自宽 23，
 *       重叠一半，320px 下并成一个「W」，读不出是两个勾
 *   v3  气泡收小给勾让位，勾加宽到 28、错开 22（只叠 6）—— 成对但分得开
 *
 * 「两道」是这个 motif 的全部意思（双勾＝已读），并成一道就什么都没说了。
 */
const bubbleRead: MotifFn = (tint) => {
  const s = `fill="none" stroke="${tint}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  return `
    <rect x="2" y="6" width="64" height="46" rx="11" ${s}/>
    <path d="M 18 52 L 15 68 L 32 52" ${s}/>
    <path d="M 72 44 L 82 56 L 100 28" ${s}/>
    <path d="M 94 44 L 104 56 L 122 28" ${s}/>`;
};

/**
 * E02「第三个人」：三个竖条，前两条严格平行，第三条偏转。
 *
 * **偏的那一条是全部意思。** 前两条必须严格平行 —— 只有它们不动，
 * 第三条才读得出来是「偏了」，而不是「画歪了」。
 *
 * **§七 写的是 3°，渲出来缩到 320 完全看不见。** 56px 高的条子偏 3° 只挪 3px，
 * 跟抗锯齿的毛边分不开，三条读成三条平行线 —— 等于什么都没说。
 * 现在的 9° ＋ 右移 6 是在 check-320.png 上定的（§七：大图好看、小图认不出的等于没有）。
 * 两个数是一起调的，没有单独试过 9° 不加位移。
 *
 * 要改只动 TILT / SHIFT，条子的位置和长度别动 —— 前两条的间距（22 / 63）
 * 和第三条的落点（104）是按「等距三条」排的，动了就读不出第三条离了队。
 */
const threeBars: MotifFn = (tint) => {
  const st = `fill="none" stroke="${tint}" stroke-width="${STROKE}" stroke-linecap="round"`;
  /** 第三条偏转多少度。绕下端转，所以偏的是顶端 */
  const TILT = 9;
  /** 第三条整体再右移多少 */
  const SHIFT = 6;
  const bar = (x: number) => `<line x1="${x}" y1="8" x2="${x}" y2="64" ${st}/>`;
  const x3 = 104;
  return `
    ${bar(22)}
    ${bar(63)}
    <g transform="rotate(${TILT} ${x3} 64) translate(${SHIFT} 0)">${bar(x3)}</g>`;
};

/**
 * 禅佛典 E01「第七个饼」：一摞饼 ＋ 旁边立着的半块，切面朝外。
 *
 * **v1 缩到 320 是一条鱼。** 三张分开的椭圆读成了鱼身上的横纹，
 * 旁边那个半块的收口读成了鱼尾 —— 稿源 §七之二 记着的两次翻车
 * （井口被看成气球、竹简像相机镜头）是同一种：大图好看，小图认不出。
 *
 * v2 改了两处：
 *
 *   ① 一摞不画成三个分开的椭圆，画成**一个侧看的柱体**（顶面椭圆 ＋
 *      两条侧边 ＋ 底部的弧）再加一道分层弧。三个分开的椭圆在 320px 下
 *      笔画会并到一起，读成横纹；柱体加一道分层线才读得出「摞着好几张」。
 *   ② 半块跟一摞之间拉开 24 个单位的空。挨着就是一个整体，
 *      而「旁边还有半块」是这个 motif 的全部意思。
 *
 * **切面朝外**：平的那条边朝右（画面外侧），圆弧朝着一摞的方向。
 * 平放的话缩到 320 就是第四张饼。
 */
const cakeStack: MotifFn = (tint) => {
  const st = `fill="none" stroke="${tint}" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round"`;
  return `
    <ellipse cx="32" cy="20" rx="26" ry="8" ${st}/>
    <path d="M 6 20 L 6 52 A 26 8 0 0 0 58 52 L 58 20" ${st}/>
    <path d="M 6 36 A 26 8 0 0 0 58 36" ${st}/>
    <circle cx="100" cy="40" r="25" ${st}/>
    <path d="M 100 15 A 25 25 0 0 0 100 65 Z" fill="${tint}" stroke="none"/>`;
};

export const MOTIFS: Record<string, MotifFn> = {
  对话气泡: bubbleRead,
  三个竖条: threeBars,
  摞饼与半块: cakeStack,
};

// ── 骨架件 ────────────────────────────────────────────────────────────

/** 竖排一列。x 是中线，base 是首字基线 */
function vtext(t: string, x: number, base: number, gap: number, size: number, fill: string, weight: number) {
  const chars = [...t];
  const svg = chars
    .map(
      (ch, i) =>
        `<text x="${n(x)}" y="${n(base + i * gap)}" font-family="${SC}" font-weight="${weight}" ` +
        `font-size="${n(size)}" fill="${fill}" text-anchor="middle">${esc(ch)}</text>`
    )
    .join('\n    ');
  return { svg, bottom: base + (chars.length - 1) * gap };
}

/** 木格窗框：底 + 按 latticeGap 排的格栅 + 外框 */
function windowFrame(x: number, y: number, w: number, h: number, sr: Series, k: number): string {
  const bars: string[] = [];
  const gap = L.latticeGap * k;
  for (let gx = x + gap; gx < x + w - 1; gx += gap)
    bars.push(`<rect x="${n(gx)}" y="${n(y)}" width="2" height="${n(h)}" fill="${sr.paper}" opacity="0.85"/>`);
  for (let gy = y + gap; gy < y + h - 1; gy += gap)
    bars.push(`<rect x="${n(x)}" y="${n(gy)}" width="${n(w)}" height="2" fill="${sr.paper}" opacity="0.85"/>`);
  return `
  <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${sr.accentSub}" opacity="0.15"/>
  ${bars.join('\n  ')}
  <rect x="${n(x - (L.frame * k) / 2)}" y="${n(y - (L.frame * k) / 2)}" width="${n(w + L.frame * k)}" height="${n(h + L.frame * k)}"
        fill="none" stroke="${sr.accentSub}" stroke-width="${n(L.frame * k)}" opacity="0.45"/>`;
}

/** motif 摆到窗内正中，受 motifMaxScale 约束 */
function drawMotif(name: string, x: number, y: number, w: number, h: number, sr: Series): string {
  const fn = MOTIFS[name];
  if (!fn) throw new Error(`没有这个 motif：${name}\n可用：${Object.keys(MOTIFS).join(' / ')}`);
  const k = Math.min((w * L.motifMaxScale) / MOTIF_W, (h * L.motifMaxScale) / MOTIF_H);
  const tx = x + w / 2 - (MOTIF_W * k) / 2;
  const ty = y + h / 2 - (MOTIF_H * k) / 2;
  return `<g transform="translate(${n(tx)},${n(ty)}) scale(${n(k)})">${fn(sr.motifTint)}</g>`;
}

/** 标题 ＋ 落款印作为一个整体垂直居中 */
function titleBlock(title: string, sr: Series, H: number, k: number) {
  const chars = [...title];
  if (chars.length > 6)
    throw new Error(
      `封面标题「${title}」${chars.length} 字，上限 6（竖排放不下更多）。\n` +
        `在 发布.json 里加 coverTitle（2–4 字最佳），完整标题写 videoTitle。`
    );
  const base0 = L.size[chars.length];
  if (!base0) throw new Error(`封面标题至少 2 字：「${title}」`);
  const size = base0 * k;
  const titleX = L.titleX * k;
  const gap = size * L.gapK;
  const sealS = size * L.sealK;
  const textH = (chars.length - 1) * gap + size;
  const blockH = textH + size * L.sealGapK + sealS;
  const base = (H - blockH) / 2 + size;
  const t = vtext(title, titleX, base, gap, size, sr.ink, 600);
  const sealY = t.bottom + size * L.sealGapK;
  const rx = sr.sealShape === 'square' ? 3 : sealS / 2;
  const seal =
    `<rect x="${n(titleX - sealS / 2)}" y="${n(sealY)}" width="${n(sealS)}" height="${n(sealS)}" ` +
    `rx="${n(rx)}" fill="${sr.seal}"/>` +
    `<text x="${n(titleX)}" y="${n(sealY + sealS * 0.72)}" font-family="${SC}" font-weight="500" ` +
    `font-size="${n(sealS * 0.62)}" fill="${sr.paper}" text-anchor="middle">${SEAL_CHAR}</text>`;
  return { svg: t.svg + '\n    ' + seal, size, bottom: sealY + sealS };
}

export interface CoverSpec {
  series: string;
  coverTitle: string;
  motif: string;
  /** 底部 hook 文案。square 预设不显示，不破例 */
  hook: string;
  /**
   * 横排大标题。**给缩略图上要读得出的那种标题党用**，不填就是原来的版式。
   *
   * §七 原本的立场是「钩子由平台标题栏承担，封面只放 ≤6 字的图形化短词」，
   * 底部 hook 在 320px 下糊掉是预期之内。要把整句标题放上封面就得推翻这一条 ——
   * 所以填了它版式会变：**motif 缩到窗上部，标题占窗内下半**，
   * 竖排短题和印章留在左边（那是频道标识，不能让给标题）。
   *
   * 按「，」断成两行；没有逗号就按字数对半断。**最多两行** ——
   * 三行在 320px 下每行都太小，等于没写。
   */
  coverLine?: string;
}

/** 横排标题断行。最多两行，优先在逗号处断 */
function splitLine(t: string): string[] {
  const s = t.replace(/[｜|]/g, '').trim();
  const i = s.search(/[，,、]/);
  if (i > 0) return [s.slice(0, i), s.slice(i + 1)];
  const chars = [...s];
  if (chars.length <= 7) return [s];
  const h = Math.ceil(chars.length / 2);
  return [chars.slice(0, h).join(''), chars.slice(h).join('')];
}

function frame(s: CoverSpec, W: number, H: number, withHook: boolean): string {
  const sr = SERIES[s.series];
  if (!sr) throw new Error(`没有这个 series：${s.series}\n可用：${Object.keys(SERIES).join(' / ')}`);
  /**
   * 一切按画布宽缩放。**L 里那组数是按 VW=1280 给的**，别的画布不缩放比例就散：
   * 方版 1400×1400 第一版直接套那组数，竖排标题和印章相对画布小了一圈、
   * 窗子被拉成竖条、底部空出一大截。
   */
  const k = W / VW;
  const tb = titleBlock(s.coverTitle, sr, H, k);
  const barY = H - Math.round(H * 0.085);
  const winX = W * 0.3;
  const winW = W * 0.6;
  /**
   * 窗子高度：**横版按画布高取比例，方版按窗宽取比例。**
   * 方版画布高是横版的两倍多，照抄 H 的比例会把窗子拉成竖条。
   *
   * 有横排标题时窗子往下探一点：腾出的不是窗外的地方，是窗内下半 ——
   * 标题压在窗里跟 motif 是一组，不然读起来像两张图拼的。
   */
  const square = W === H;
  const winH = square ? winW * (s.coverLine ? 1.02 : 0.95) : H * (s.coverLine ? 0.66 : 0.6);
  /** 方版把窗子放在进度线以上居中，上下留白才匀 */
  const winY = square ? (barY - winH) / 2 : H * (s.coverLine ? 0.1 : 0.14);
  // 标题块不许压到进度线。§七 说统一大字号时四字标题就是这么压上去的
  if (s.coverLine && winY + winH > barY - 20)
    throw new Error(`窗子排到 y=${Math.round(winY + winH)}，压住了 y=${barY} 的进度线`);
  if (tb.bottom > barY - 24)
    throw new Error(
      `标题块排到 y=${Math.round(tb.bottom)}，压住了 y=${barY} 的进度线。\n` +
        `缩短 coverTitle，或调 L.size 那三档。`
    );
  // hook **不能放在标题那一列** —— 标题＋印章整体垂直居中，四字标题在 720 高里
  // 印章底就到 y=632，跟居中放在 y=623 的 hook 正好叠上。第一版就是这么撞的。
  // 挪到窗下、左对齐窗左沿，跟标题列彻底分开。
  const hookY = barY - 30 * k;
  if (withHook && hookY < tb.bottom && winX < (L.titleX + 60) * k)
    throw new Error(`hook 跟标题列撞上了：hook y=${Math.round(hookY)}，印章底 y=${Math.round(tb.bottom)}`);
  // 有横排标题就不出 hook —— 两处底部文字会打架，
  // 而且 hook 那一号字在 320px 下本来就糊，留着只是占地方
  const hook = withHook && !s.coverLine
    ? `<text x="${n(winX)}" y="${n(hookY)}" font-family="${SC}" font-weight="400" ` +
      `font-size="${n(L.hookSize * k)}" fill="${sr.accentSub}">${esc(s.hook)}</text>`
    : '';
  const barW = W - L.barInset * k * 2;

  // ── 横排标题：motif 让到窗上部，标题占窗内下半 ──
  let headline = '';
  let motifBox = { x: winX, y: winY, w: winW, h: winH };
  if (s.coverLine) {
    const rows = splitLine(s.coverLine);
    const longest = Math.max(...rows.map((r) => [...r].length));
    // 字号先按窗宽定，再压到不超过上限 —— 宁可留白，不要撑满贴边
    const cap = rows.length === 1 && longest <= 4 ? L.headShort : L.headMax;
    const size = Math.min(cap * k, (winW - 48 * k) / longest);
    const lead = size * 1.28;
    // 标题块底边贴窗底往上一点，往上排
    const bottom = winY + winH - size * 0.5;
    const base0 = bottom - (rows.length - 1) * lead;
    headline = rows
      .map(
        (r, i) =>
          `<text x="${n(winX + winW / 2)}" y="${n(base0 + i * lead)}" font-family="${SC}" ` +
          `font-weight="700" font-size="${n(size)}" fill="${sr.ink}" text-anchor="middle">${esc(r)}</text>`
      )
      .join('\n    ');
    // motif 缩到标题上方那一段里
    const mh = base0 - size - winY - size * 0.35;
    motifBox = { x: winX, y: winY + size * 0.15, w: winW, h: Math.max(mh, winH * 0.28) };
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${sr.paper}"/>
  ${windowFrame(winX, winY, winW, winH, sr, k)}
  ${drawMotif(s.motif, motifBox.x, motifBox.y, motifBox.w, motifBox.h, sr)}
    ${headline}
    ${tb.svg}
  ${hook}
  <rect x="${n(L.barInset * k)}" y="${barY}" width="${n(barW)}" height="${n(L.barH * k)}" rx="1.5"
        fill="${sr.accentSub}" opacity="0.5"/>
  <rect x="${n(L.barInset * k)}" y="${barY}" width="${n(barW * 0.34)}" height="${n(L.barH * k)}" rx="1.5" fill="${sr.accent}"/>
</svg>`;
}

export const coverSvg = (s: CoverSpec) => frame(s, VW, VH, true);
/** 方版**不显示 hook，不破例**（§七 封面骨架） */
export const coverSquareSvg = (s: CoverSpec) => frame(s, SQ, SQ, false);

function png(svg: string, w: number): Buffer {
  return new Resvg(svg, {
    font: { loadSystemFonts: FONT_FILES.length === 0, fontFiles: FONT_FILES, defaultFontFamily: SC },
    fitTo: { mode: 'width', value: w },
  })
    .render()
    .asPng();
}

interface PubDoc {
  coverTitle?: string;
  /** 横排大标题，见 CoverSpec.coverLine */
  coverLine?: string;
  series?: string;
  motif?: string;
  parts: { part: string; hook?: string }[];
}

function main() {
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;
  for (const p of doc.parts) {
    const spec: CoverSpec = {
      series: doc.series ?? 'psychInsight',
      coverTitle: doc.coverTitle ?? BOOK,
      motif: doc.motif ?? '对话气泡',
      coverLine: doc.coverLine,
      hook: p.hook ?? '',
    };
    const dir = `${PROJ}/cover/${p.part}`;
    mkdirSync(dir, { recursive: true });
    const svg = coverSvg(spec);
    const sq = coverSquareSvg(spec);
    writeFileSync(`${dir}/cover.svg`, svg);
    writeFileSync(`${dir}/upload-1280x720.png`, png(svg, VW));
    // 片头那一帧。**必须跟场景图同尺寸（1920×1080）** —— concat 碰上
    // 分辨率不一样的图会静默丢掉，不报错。
    writeFileSync(`${dir}/first-frame-1920x1080.png`, png(svg, 1920));
    writeFileSync(`${dir}/square-1400x1400.png`, png(sq, SQ));
    // §七 唯一必须做的检查：缩到 320 还认不认得出
    writeFileSync(`${dir}/check-320.png`, png(svg, 320));
    writeFileSync(`${dir}/check-square-200.png`, png(sq, 200));
    console.log(`${p.part}篇 → ${dir}/`);
    console.log(`  upload-1280x720 ＋ square-1400x1400 ＋ first-frame-1920x1080`);
    console.log(`  自检：check-320.png（**必看** —— 大图好看小图认不出等于没有）`);
  }
}

main();
