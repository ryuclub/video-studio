// ── 老马长片的封面：16:9 横版，场景当底 + 贴纸式大字 ─────────────────────
//
// **这是封面的第四档**（前三档见 ../YouTube封面规范.md §〇之二：V3 横版、窗格版，
// 加上竖版三条线那套 `cover.ts`）。规范落在 封面设计规范-COVER.md §九。
//
// 一句话：**片子里是什么样，封面就是什么样，上面压一块单点式的贴纸大字。**
//
//   底      `horse/长片/longform.cjs` 的 `frame()` 直接出一帧 —— 场景、鱼缸、
//           灯光、色温差全是那边定的。**不抄一份过来**，抄一份就是第二个真相
//   大字    `cover.ts` 那套贴纸描边字（黄底墨边），跟单点式是同一只手写的
//   站位    角色站右、标题排左（或者反过来）。判据仍是 §七之三「绝不压脸」
//
// ── 为什么不并进 V3 那套（YouTube封面规范）──
//
// V3 是「两个大字 ＋ 一个实心图形」，画面是**抽象**的；长片这条线本来就有
// 一整套画好的场景和角色，做成两个字加一个色块，等于把片子的长相扔了。
// 而 §〇「缩略图与首帧是两回事」在这条线上也不成立 —— 长片首帧就是这一张，
// 一种版式一处维护（同 YouTube封面规范 §十三 说书线那笔账）。
//
// ── 跟竖版那三条线的关系 ──
//
// 段子 / 儿童故事 / 老马单点式是 1080×1920，走 `cover.ts`。**长片是 16:9**，
// 竖向那几个数（`baselineK` 0.22、`subMaxWK` 0.52）是为九宫格 3:4 裁切算的，
// 16:9 没有那条裁切线 —— **借的是笔法，不是版面**，纵向自己量。
//
// 用法：
//   npm run laoma:long-cover -- jokes/laoma-long-001.json
//   npm run laoma:long-cover -- jokes/laoma-long-001.json --title 最后半天 --sub 他写了十一页
//   npm run laoma:long-cover -- jokes/laoma-long-001.json --scene street_dusk --ma-x 640
//
// 缺省全部从稿件 json 的 `cover` 块来（`long-parse.mts` 写的，改稿重跑就跟着变）。

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { FONT, FONT_FILES, ACCOUNT_LAOMA } from './config.js';
import { P, makeInk } from './style/palette.js';
import { piece, tornRect, n } from './style/papercut.js';
import { escapeXml } from './subtitle.js';
import { T, units, splitTitle, inkedLine } from './cover.js';
import { projectDir } from './preview.js';
import type { JokeCfg } from './types.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const longform = require('../horse/长片/longform.cjs') as {
  frame(o: Record<string, unknown>): string;
  SCENES: Record<string, { bg: string }>;
};

// ── 画布 ────────────────────────────────────────────────────────────
//
// 1280×720，跟成片同一个尺寸 —— **封面就是第一帧**，不另做一个尺寸。
const CV = { W: 1280, H: 720 };

/** `longform.cjs` 那条地面线。角色的脚永远落在它上面，封面也不例外 */
const GROUND = 566;

/**
 * ⚠ **YouTube 时长角标的位置**（YouTube封面规范 §一）。
 * x ∈ [1080,1280]、y ∈ [640,720] 必须留空 —— 这一档也归它管，它是 16:9 缩略图。
 */
const SAFE = { x0: 1080, y0: 640, x1: 1280, y1: 720 };

const L = {
  /** 左右边距，占画布宽。**跟竖版同一条**（§七之一） */
  marginK: 0.062,
  /**
   * 字号上限。**不是竖版那个 182 按宽度换算过来的**（那样是 216）——
   * 216 的两行字在 720 高的画布上是 66% 的高度，场景就只剩一条边了。
   */
  maxFs: 150,
  /**
   * 字号**下限**。低于它就不排一行了，退回两行。
   *
   * ⚠ **这个数是 210px 那张验收图定的，不是审美定的。** 贴纸感的来源是
   * 描边 ＝ 字号 × 0.15；210 上那圈墨边要还看得见，描边至少 2.7px ——
   * 反推字号 ≥ 109。再往下那圈边糊进字里，就不是贴纸了，是普通粗体字。
   *
   * 109 换算成字数：整幅可用 1121px ÷ 109 ≈ **一行最多 10 个字**。
   * 实测 10 字那版 210 下字高 17.9px，认得出，**是边界不是舒适区**。
   */
  minFs: 109,
  /**
   * 标题块的垂直中线，占画布高。**竖版那个 `baselineK` 在这儿不成立** ——
   * 0.22 是为九宫格 `crop=1080:1440:0:240` 算的，16:9 没有那条裁切线。
   *
   * ⚠ **一行之后这个数不再是「随便居中」，它受约束**（2026-08-26）：
   * 一行的标题是一条**横带**（150px 字号下带高 161），而画面右边那两样东西
   * 中间的缝只有 110px（老马眼白量出来 y 173–213、鱼缸上沿 y 400）——
   * **装不下，必然压到其中一样**。
   *
   * | 中线 | 标题带 | 压到 |
   * |---|---|---|
   * | 0.40 | y 144–305 | **横过眼睛**，人和字互相吃（渲过，是反例） |
   * | **0.46** | y 187–348 | 下巴和胸口。眼睛擦到一点、鱼完好 ← 用户 2026-08-26 选的 |
   * | 0.50 | y 216–377 | 只压胸口，**眼睛和鱼都完好** |
   *
   * 0.46 是用户挑的那一版（候选「甲」）。想让开脸就写 `cover.long.centerK: 0.5`，
   * **一个字段的事** —— 但那是换构图，不是修 bug。
   *
   * ⚠ **改老马的站位或高度，这张表要重量。**
   */
  centerK: 0.46,
  /** 中日韩字面的下伸量（占字号）。上伸量用 `T.cjkAscent` */
  cjkDescent: 0.12,
};

/** 老马的缺省站位：右侧、贴着窗台那缸鱼。`maH` 比片里的 366 大一档，缩略图上才有分量 */
const MA = { x: 800, h: 470 };
/** `horse_only.svg` 的宽高比（viewBox 366.5 × 1028.1）。拿它把 `maH` 换成身宽 */
const MA_RATIO = 366.5 / 1028.1;
/** `longform.cjs` 的 `C_FISH`：**全片唯一的高饱和色**，所以拿颜色就能把鱼探出来 */
const FISH_RGB = [0xd9, 0x4f, 0x2b];

export interface LongCoverSpec {
  /** 主标题。**一行优先**，4 字起；压到 minFs 还排不下才退两行（一行约 10 字上限） */
  title: string;
  /** 副标题。**补充信息，不是重复** —— 大字抛问题，副标给一个具体细节 */
  sub?: string;
  /** 哪个场景当底。六个 key 见 horse/长片_出片方案.md §四之三 */
  scene: string;
  /** 角色站哪边。标题永远排对侧 */
  side: 'left' | 'right';
  /** 鱼在缸里的位置 0–1（0 左 1 右）。红点是全片唯一的高饱和色，位置就是故事线 */
  fish?: number;
  /** 老马站位 x。不写按 `side` 取缺省 */
  maX?: number;
  /** 老马多高。脚底永远在地面线上 */
  maH?: number;
  /** 右下角署名。'none' 关掉 */
  tag?: string;
  /** 版式库里的一档（`LAYOUTS` 的 key）。不写用 `DEFAULT_LAYOUT` */
  layout?: string;
  /** 单期覆盖版式里的垂直中线。**一般不用写** —— 要常用就往库里加一档 */
  centerK?: number;
  /** 单期覆盖版式里的署名位。同上，一般不写 */
  sig?: SigAnchor;
  /** 方版的字怎么摆：横排 / 竖排。**只管方版**，横版永远横排 */
  sqText?: SqText;
}

export interface LongCoverIssue {
  level: 'error' | 'warn';
  msg: string;
}

// ── 标题块 ──────────────────────────────────────────────────────────

/** 副标题一行的宽度单位（含字间距），跟竖版同一把尺 */
const subUnits = (t: string): number => units(t) + T.trackK * Math.max(0, [...t].length - 1);

/**
 * **附着字**：不能出现在第二行开头的字。
 *
 * 它们都得挂在前一个字后面才有意思 —— 「的」「了」「着」拎到行首，
 * 读者要往上一行找主人。**这跟排版好不好看无关，是读得动读不动。**
 */
const CLINGY = '的了着过地得们之';

/**
 * 折行。**竖版那支 `splitTitle` 是纯字数折半，会劈开词** ——
 * 「我一直以为他傻」断成「我一直以／为他傻」，把「以为」劈成两半；
 * 「老牛走的那天」断成「老牛走／的那天」，第二行顶着一个「的」。
 *
 * 这一档在折半的基础上加一条：**第二行开头不许是附着字，是就往后挪一格。**
 * 「老牛走的那天」→「老牛走的／那天」。
 *
 * ⚠ **只改了长片这一档。** 竖版那支（`cover.ts` 的 `splitTitle`）**一个字没动** ——
 * 改它会改掉以后所有 7 字竖版标题的断口，那条线已经出了十条片，
 * 要动得单独过一遍。001–010 都是 4–5 字，一次都没撞上这个坑。
 *
 * ⚠ 挪一格之后**前行仍旧不短于后行**（规范 §七之二 那条）—— 只往后挪、不往前。
 */
function splitTitleLong(title: string): string[] {
  const base = splitTitle(title);
  if (base.length < 2) return base;
  const ch = [...title];
  let head = [...base[0]].length;
  while (head + 1 < ch.length && CLINGY.includes(ch[head])) head++;
  return [ch.slice(0, head).join(''), ch.slice(head).join('')];
}

/**
 * 副标题排版：**先折行，再压字号**（跟竖版 `wrapSub` 同一个顺序）。
 * 分段符是**全角空格**，只折一次 —— 折两次是三行小字，那不叫封面叫说明书。
 */
function fitSub(sub: string, avail: number, fs: number): { lines: string[]; fs: number } {
  const one = [sub];
  const at = (ls: string[]) => {
    const widest = Math.max(...ls.map(subUnits));
    return Math.max(fs * T.subMinFsK, Math.min(fs * T.subFsK, avail / widest));
  };
  if (at(one) >= fs * T.subFsK) return { lines: one, fs: at(one) };
  const segs = sub.split(/\u3000+/).map((t) => t.trim()).filter(Boolean);
  if (segs.length < 2) return { lines: one, fs: at(one) };
  const two = [segs[0], segs.slice(1).join('\u3000')];
  return { lines: two, fs: at(two) };
}

interface Block {
  svg: string;
  /** 描边＋填充都涂成一个纯色的探针版，用来量真实外接框 */
  probe: string;
  /** 实际用的字号（一行排不下会掉档） */
  fs: number;
  /** 主标题排了几行 */
  rows: number;
  /** 墨迹的上下沿（绝对 y，含描边外沿）。方版拿它判标题带出没出上面那条带 */
  top: number;
  bot: number;
}

/**
 * 出标题块。
 *
 * @param side 角色站在哪边。**标题取对侧**，贴边距对齐 —— 贴边之后字数怎么变
 *             都只往画面里长，不会往外顶（§七之四 陷阱一）。
 */
function titleBlock(
  title: string,
  sub: string | undefined,
  side: 'left' | 'right',
  /** 标题块外接框的**垂直中点**，绝对像素。横版是画布中线，方版是上半那条带的中线 */
  centerY: number,
  /** 画布宽。边距和可用宽度都从它来 —— 方版 1080，横版 1280 */
  cvW = CV.W,
  /** 画布高，只给探针图用 */
  cvH = CV.H,
  /** 边距（像素）。不给就按 `L.marginK` 算 —— 方版传的是安全区，比边距宽一档 */
  marginPx?: number
): Block {
  const margin = marginPx ?? cvW * L.marginK;
  // ⚠ **整幅可用，不再是左栏**（2026-08-26，用户定「盖住右侧图也可以」）。
  // 663 → 1121，多出来的 458px 全是老马和鱼缸那块地方。
  const avail = cvW - margin * 2;

  // ── 一行优先 ──
  //
  // **≤7 字一行根本不用压字号**：1121 ÷ 7.18 ＝ 156，仍旧撞 150 的上限。
  // 所以「为了一行牺牲字号」这笔账 **8 个字才开始付**，
  // 而 001 这条 6 字标题是白赚一次放大（两行 150 → 一行 150，字一个像素没小）。
  //
  // 压到 `minFs` 还排不下才退两行 —— 两行也用整幅宽，所以上限是 20 字左右。
  const one = (t: string) => units(t) + T.trackK * Math.max(0, [...t].length - 1);
  let lines = [title];
  let fs = Math.min(L.maxFs, avail / one(title));
  if (fs < L.minFs) {
    lines = splitTitleLong(title);
    fs = Math.min(L.maxFs, avail / Math.max(...lines.map(one)));
  }
  const lh = fs * T.lineH;

  const s = sub && sub !== 'none' ? fitSub(sub, avail, fs) : { lines: [] as string[], fs: 0 };

  // 角色站右 → 标题在左，贴左边距左对齐；角色站左 → 反过来
  const onLeft = side === 'right';
  const anchor: 'start' | 'end' = onLeft ? 'start' : 'end';
  const x = onLeft ? margin : cvW - margin;

  // ── 纵向：整块垂直居中，不用竖版那个首行基线 ──
  //
  // 竖版是「首行基线钉在画布高 × 0.22」，因为它要躲九宫格的裁切线。
  // 16:9 没有那条线，钉首行基线的话**四字一行和七字两行的重心会差一大截**
  // （一个偏上、一个压到地面线上）。所以量出整块的外接高度再居中。
  const tOff = -fs * (T.cjkAscent + T.strokeK / 2);
  const lastMain = (lines.length - 1) * lh;
  const subY0 = lastMain + fs * T.subGapK + s.fs * T.cjkAscent;
  const lastSub = s.lines.length ? subY0 + (s.lines.length - 1) * s.fs * T.subLineH : lastMain;
  const bOff = s.lines.length
    ? lastSub + s.fs * (L.cjkDescent + T.subStrokeK / 2)
    : lastMain + fs * (L.cjkDescent + T.strokeK / 2);
  const y0 = centerY - (bOff - tOff) / 2 - tOff;

  const main = { fill: T.fill, line: T.line, strokeK: T.strokeK, anchor };
  const so = { fill: T.subFill, line: T.subLine, strokeK: T.subStrokeK, anchor };
  const rows: Array<{ t: string; y: number; fs: number; o: typeof main }> = [
    ...lines.map((t, i) => ({ t, y: y0 + i * lh, fs, o: main })),
    ...s.lines.map((t, i) => ({ t, y: y0 + subY0 + i * s.fs * T.subLineH, fs: s.fs, o: so })),
  ];

  // ⚠ **描边全画完，再画填充**（§七之四 陷阱二）。逐行「描边＋填充」交替的话，
  // 下一行的描边会啃掉上一行的填充 —— 行高 1.12、描边半宽 0.075 × 字号，够得着。
  const strokes = rows.map((r) => inkedLine(r.t, x, r.y, r.fs, 'stroke', r.o));
  const fills = rows.map((r) => inkedLine(r.t, x, r.y, r.fs, 'fill', r.o));

  // 探针：同样的排版全部涂成一个纯色，铺在纯黑上单渲一次，量外接框。
  // **不用公式反推** —— 公式是给「该多大」用的，「实际多大」得看像素（§九之四）。
  // **大字洋红、副标青**，两样分开量 —— 共用一个框的话，挂在左边的副标会
  // 跟着大字一起被算成「压到右边的角色」。
  const pc = (r: { o: typeof main }) => (r.o === main ? '#FF00FF' : '#00FFFF');
  const probe =
    `<rect width="${cvW}" height="${cvH}" fill="#000000"/>` +
    rows.map((r) => inkedLine(r.t, x, r.y, r.fs, 'stroke', { ...r.o, line: pc(r) })).join('\n') +
    rows.map((r) => inkedLine(r.t, x, r.y, r.fs, 'fill', { ...r.o, fill: pc(r) })).join('\n');

  return {
    svg: strokes.join('\n') + '\n' + fills.join('\n'),
    probe: `<svg xmlns="http://www.w3.org/2000/svg" width="${cvW}" height="${cvH}" viewBox="0 0 ${cvW} ${cvH}">${probe}</svg>`,
    fs,
    rows: lines.length,
    top: y0 + tOff,
    bot: y0 + bOff,
  };
}

// ── 版式库 ──────────────────────────────────────────────────────────
//
// **这一档不是一种版式，是一个库。** 一期挑一档，`cover.long.layout` 指名字。
// 库怎么长、加一档要交代什么，见 封面设计规范-COVER.md §九之七。
//
// ⚠ **两层库别混：**
//   跨线那层（哪条线用哪一档封面）在 `../YouTube封面规范.md` §〇之二；
//   **这儿是线内那层** —— 长片档内部的排法。
//
// ⚠ **退役的版式不进这个表，进文档的反例栏。** 表里每一项都是「现在能挑的」，
// 掺进不能挑的，下一个人得先读注释才知道哪些是活的。

/** 署名往哪儿挂 */
export type SigAnchor =
  /** 画布右下角，让开时长角标。**位置固定，不随角色动** */
  | 'canvas-br'
  /** 角色脚边的地面上（脚正下方，不压脚）。**跟着角色走** */
  | 'feet';

export interface CoverLayout {
  /** 一句话：这一档长什么样 */
  what: string;
  /** 标题块的垂直中线（占画布高） */
  centerK: number;
  /** 署名挂哪儿 */
  sig: SigAnchor;
  /** 立这一档的日子 ＋ 谁定的，方便回溯 */
  since: string;
  /** 代价。**每一档都得写** —— 没有代价的版式说明还没想清楚 */
  cost: string;
}

export const LAYOUTS: Record<string, CoverLayout> = {
  一行·右下签: {
    what: '主标题一行贴左边距，署名钉在画布右下角（让开时长角标）',
    centerK: 0.46,
    sig: 'canvas-br',
    since: '2026-08-26 用户选（候选「甲」）',
    cost:
      '署名孤零零挂在角落，跟画面没关系。好处是**位置固定** —— ' +
      '跟竖版 §二 同一个角，做到第十条观众认得出是同一个号。',
  },
  一行·脚边签: {
    what: '主标题一行贴左边距，署名摆在角色脚边的地面上（脚正下方，不压脚）',
    centerK: 0.46,
    sig: 'feet',
    since: '2026-08-26 用户选（候选「庚」），**现在的缺省**',
    cost:
      '⚠ **署名跟着角色走** —— 改 `maX`/`maH`/`side`，或者换一期换个站位，' +
      '署名就换个地方。攒台标要的是「每次都在同一个位置」，这一档拿不到那个。' +
      '换来的是署名落在画面里、跟角色有关系，不像一枚贴在角上的水印。',
  },
};

/** 缺省版式。改这儿等于改所有没写 `layout` 的期 */
export const DEFAULT_LAYOUT = '一行·脚边签';

/**
 * 署名。
 *
 * ⚠ **时长角标只占 x ≥ 1080 且 y ≥ 640 那个 200×80 的角**（`SAFE`），
 * 右下大部分是能放的 —— 早先写成「右下是角标的地盘」，把话说窄了。
 *
 * ⚠ **`feet` 这一档是知情地违反「署名要固定在画布坐标上」那条的**：
 * 它跟着角色走，位置每期会变。用户 2026-08-26 定，代价写在 `LAYOUTS` 里。
 */
/**
 * 画那张纸片，**中心点由调用方给**。
 *
 * 拆出来是为了方版：方版的坐标是横版乘了 0.84 再加一段偏移，
 * 位置那套算法不能共用，**但画法必须共用** —— 两处各画一遍的话，
 * 哪天改了纸片的倾角或者颜色，方版会留在上一版而且不报错。
 */
function sigPaper(
  tag: string,
  cx: number,
  cy: number
): { svg: string; box: { x0: number; y0: number; x1: number; y1: number } } {
  const ink = makeInk(0);
  const fs = 30;
  const padX = 20;
  const padY = 12;
  const boxW = [...tag].reduce((w, c) => w + (/[\x00-\xff]/.test(c) ? fs * 0.55 : fs), 0) + padX * 2;
  const boxH = fs * 1.3 + padY * 2;
  const x = cx - boxW / 2;
  const y = cy - boxH / 2;
  const svg = `<g transform="rotate(-6 ${n(cx)} ${n(cy)})">
  ${piece(tornRect(x, y, boxW, boxH, 909, 1.4, 12), ink(P.primary), { dx: 4, dy: 6, shadowAlpha: 0.2 })}
  <text x="${n(cx)}" y="${n(y + padY + fs * 0.88)}" font-family="${FONT}" font-size="${fs}"
    font-weight="700" fill="${ink(P.paper)}" text-anchor="middle">${escapeXml(tag)}</text>
</g>`;
  // 倾斜 −6° 之后四角会外扩，外接框按最长边估一档（宽的一半 × sin6° ≈ 0.06×boxW）
  const pad = boxW * 0.06;
  return { svg, box: { x0: x - pad, y0: y - pad, x1: x + boxW + pad, y1: y + boxH + pad } };
}

/** 这张纸片多大。摆位置之前得先知道 —— 跟 `sigPaper` 里那两行是同一把尺 */
function sigSize(tag: string): { w: number; h: number } {
  const fs = 30;
  return { w: [...tag].reduce((w, c) => w + (/[\x00-\xff]/.test(c) ? fs * 0.55 : fs), 0) + 40, h: fs * 1.3 + 24 };
}

/**
 * 把署名的中心点收进方版安全区。
 *
 * ⚠ **署名跟标题一样是字，一样要留安全距离。** `feet` 那一档跟着角色的脚走，
 * 而脚在画面底部 —— 换算到方版落在 y≈1010，**整块探出安全区 40px**。
 * 画面上看不出来（那儿是地板），缩到 200px 贴着下沿才显出来。
 *
 * 收的是**中心点**不是裁切：牌子整块往里挪，不变形、不缩小。
 * 倾斜 −6° 那点外扩按 6% 估进去（跟 `sigPaper` 的 `pad` 同一个数）。
 */
/**
 * 方版的署名。
 *
 * ⚠ **`feet` 那一档在方版里放不下，自动退回右下角。**
 *
 * 量出来的：画面沉底之后地面线落在 y=950，而排版安全区的下沿是 972 ——
 * **中间只有 22px，而牌子有 63px 高**。硬塞的话只有两种下场：
 * 探出安全区（贴着下沿），或者被收进来压在鞋上 —— **后者正是
 * 「己」那一版判掉的做法**（鞋 79×14、牌子 160×63，压上去人就浮起来了）。
 *
 * 所以不是收进来，是换个位置：**右下角顶到安全线**。
 * 横版仍旧是脚边签，两个尺寸的署名位置不一样 —— 这一条写在版式库那一档的 `cost` 里。
 */
function sqSig(tag: string, cx: number, cy: number, w: number, h: number, atFeet: boolean): string {
  const s = sqSafe();
  const p = w * 0.06;
  const fits = atFeet && cy + h / 2 + p <= s.y1;
  const c = fits
    ? clampSig(cx, cy, w, h)
    : { cx: s.x1 - w / 2 - p, cy: s.y1 - h / 2 - p, moved: false };
  return sigPaper(tag, c.cx, c.cy).svg;
}

function clampSig(cx: number, cy: number, w: number, h: number): { cx: number; cy: number; moved: boolean } {
  const s = sqSafe();
  const pad = w * 0.06;
  const x = Math.min(Math.max(cx, s.x0 + w / 2 + pad), s.x1 - w / 2 - pad);
  const y = Math.min(Math.max(cy, s.y0 + h / 2 + pad), s.y1 - h / 2 - pad);
  return { cx: x, cy: y, moved: Math.abs(x - cx) > 0.5 || Math.abs(y - cy) > 0.5 };
}

function signature(
  tag: string,
  anchor: SigAnchor,
  ma: { x: number; h: number }
): { svg: string; box: { x0: number; y0: number; x1: number; y1: number } } {
  const { w, h } = sigSize(tag);
  if (anchor === 'feet') {
    // 脚的正下方、地面线以下。34px 是量出来的：鞋底在 y≈553，
    // 牌子上沿落到 568 —— **贴着地面而不是踩在脚上**，中间还留得出那条地面线。
    return sigPaper(tag, ma.x + (ma.h * MA_RATIO) / 2, GROUND + 34 + h / 2);
  }
  /** 右端离角标左沿留 25px。倾斜 −6° 之后右上角先探出去，这点余量是给它的 */
  return sigPaper(tag, SAFE.x0 - 25 - w / 2, CV.H - 26 - h / 2);
}

// ── 方版（1:1）────────────────────────────────────────────────────
//
// **同一张封面的第二种排法，不是第二张封面**（2026-08-26 用户定）。
// 微信那一路（公众号列表、视频号）吃的是方图，16:9 传上去两边被裁 ——
// 裁掉的正好是左边那块标题。
//
// 排法：**竖着排开** —— 大字在上，16:9 那一帧整个缩进来在下。
//
// ⚠ **不裁画面。** 裁到 1:1 能让老马大一倍，但灯、桌子、鱼缸的相对位置全变了，
// 那就成了**两张不同的图**；缩进来是同一张图的两种排法。
// 而且 `side: 'left'` 的时候该裁哪边又是一套规则 —— 不裁就没有这个问题。
//
// ⚠ **上半那块底色取场景底色**，所以画面和标题之间**没有缝** ——
// 看着像画面往上长了一截，不像上下拼的两块。
//
// 字号照 §九之三 那套自己算一遍（可用宽度从 1121 掉到 946，**所以字会小一档** ——
// 用户 2026-08-26 说的「字体可以调小」就是这儿）。
const SQ = 1080;

/**
 * **方版的排版安全区**（2026-08-26 用户定：「文字太靠边了，要有安全距离，
 * 不需要担心压图问题，**首先确保排版安全**」）。
 *
 * 占画布的 10%，四边各 108px —— 比横版那个 0.062 的边距宽出一档。
 *
 * ── 为什么方版要单独放宽 ──
 *
 * 横版那个 0.062 是从竖版 1080×1920 借来的，它管的是「别顶出画布」。
 * **方版的问题不是顶出去，是贴边** —— 方图在微信列表、视频号封面位上会被
 * 各种圆角、遮罩、外框啃掉一圈，贴着边的字第一个遭殃。而且方版是缩到 200px 看的，
 * 那一圈在缩略图上只剩 20px，**看着就是「字快掉出去了」**。
 *
 * ⚠ **安全区只管字，不管画。** 画面照旧满幅出血（它是底，被啃掉一圈没关系）；
 * **字、副标、署名三样都必须落在框里** —— 排版安全优先于「别压到画」。
 */
const SQ_SAFE_K = 0.1;
const sqSafe = () => {
  const m = SQ * SQ_SAFE_K;
  return { x0: m, y0: m, x1: SQ - m, y1: SQ - m, w: SQ - m * 2, h: SQ - m * 2 };
};

/**
 * 方版的字怎么摆。**只管方版** —— 横版永远是横排（16:9 的空地在左边一条横带里）。
 *
 * `横排`：大字横着排在上面那条带里，画面沉底。
 * `竖排`：大字**竖着排成一列贴左边**，从上贯到下，穿过空白的上半和画面的左沿。
 */
export type SqText = '横排' | '竖排';

/**
 * 方版缺省**竖排**（2026-08-26 用户定）。
 *
 * 竖排比横排强在两处：一列字从画布顶走到底，**顺手把上半那块空白用掉了**；
 * 而且方图缩到 200px 的时候，一竖列的字比一横行占的视觉面积大 —— 更认得出。
 * 横排那一档留着（`sqText: '横排'`），它更规矩、字数多的时候更稳。
 */
export const DEFAULT_SQ_TEXT: SqText = '竖排';

/**
 * 竖排一列字。
 *
 * **一个字一行**，复用 `inkedLine` 那套两遍描边 —— 竖排不是另一种字，
 * 是同一种字换个摆法。中日韩是方块字，字身高就是字号，行距给 1.06 松一点点。
 *
 * ⚠ **描边仍旧要「整列画完再画填充」**（§七之四 陷阱二）：竖排的上下两个字
 * 挨得比横排的两行还近，下一个字的描边照样会啃掉上一个字的填充。
 */
function inkedColumn(
  chars: string[],
  cx: number,
  top: number,
  fs: number,
  o: { fill: string; line: string; strokeK: number },
  pass: 'stroke' | 'fill'
): string {
  const adv = fs * 1.06;
  return chars
    .map((c, i) =>
      inkedLine(c, cx - fs / 2, top + i * adv + fs * T.cjkAscent, fs, pass, { ...o, anchor: 'start' })
    )
    .join('\n');
}

/**
 * 把 `longform.frame()` 出的那张 1280×720 塞进方画布。
 *
 * 用**嵌套 `<svg>`** 而不是 `<g transform>`：`viewBox` 一写，缩放和定位是渲染器
 * 自己算的，不用我算一遍 —— rig 那两个人本来也是这么塞进场景里的。
 */
function inset(frameSvg: string, x: number, y: number, w: number, h: number): string {
  return frameSvg.replace(
    /^<svg[^>]*>/,
    `<svg x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${CV.W} ${CV.H}" preserveAspectRatio="xMidYMid meet">`
  );
}

/**
 * 方版 · 竖排。
 *
 * 大字一列贴左边距，字号由**列高**反推（不是列宽）—— 竖排的约束在纵向：
 * `字数 × 字号 × 1.06 ≤ 可用高度`。六个字正好把 1080 走满，
 * 字数越多字越小，这跟横排那边「越长越小」是同一条账，只是换了个方向量。
 */
function squareVertical(
  spec: LongCoverSpec,
  bareFrame: string,
  bg: string,
  maX: number,
  maH: number,
  sigAt: SigAnchor,
  tag: string | null,
  issues: LongCoverIssue[],
  s: number,
  bandH: number,
  bandY: number
): string {
  const safe = sqSafe();
  const chars = [...spec.title];
  // ⚠ **字号由安全区的高度反推，而且要把描边算进去。**
  //   一列的墨迹高 ＝ (n−1)×字号×1.06 ＋ 字号×(1 ＋ 描边比)
  //   —— 末尾那一项是**首尾两个字的字面加描边外沿**。漏掉它，一列字会正好
  //   探出安全区一个描边的宽度（150 的字号下是 22px），**而且看着就是「贴边了」**。
  const fs = Math.min(L.maxFs, safe.h / ((chars.length - 1) * 1.06 + 1 + T.strokeK));
  if (fs < L.minFs)
    issues.push({
      level: 'error',
      msg:
        `方版竖排字号压到 ${fs.toFixed(0)}px，低于下限 ${L.minFs}（竖排是**列高**反推：` +
        `${chars.length} 字要装进安全区的 ${safe.h.toFixed(0)}px）—— **砍标题**`,
    });
  const colInk = (chars.length - 1) * fs * 1.06 + fs * (1 + T.strokeK);
  // 墨迹在安全区里居中；`top` 是第一个字的**字面顶**，描边还要往上探半格
  const top = safe.y0 + (safe.h - colInk) / 2 + (fs * T.strokeK) / 2;
  // 角色站左的时候整套镜像：主列贴右边安全线，副标落在它左边
  const flip = spec.side === 'left';
  // 列心 = 安全线 ＋ 描边外沿 ＋ 半个字身。
  // ⚠ 变量别叫 `inset` —— 那是把画面塞进方画布那个函数的名字，局部同名会把它盖掉。
  const colInset = (fs * T.strokeK) / 2 + fs / 2;
  const cx = flip ? safe.x1 - colInset : safe.x0 + colInset;

  const main = { fill: T.fill, line: T.line, strokeK: T.strokeK };
  const so = { fill: T.subFill, line: T.subLine, strokeK: T.subStrokeK };
  const subFs = fs * T.subFsK;
  const subChars = spec.sub && spec.sub !== 'none' ? [...spec.sub.replace(/　/g, '')] : [];
  // ⚠ **副标落在主列的右边，不是左边。**
  //
  // 中文竖排是从右往左走的，按规矩副标该在主列左侧 —— **可这儿排不下**：
  // 主列已经贴着左边距（列心 x=142、列宽 150），左边只剩 67px 的边距，
  // 一列 75px 的字放进去要探出画布 24px。第一版就是这么渲的，
  // 「他写了十一页」在画布左沿被切成半个字，**而且不报错**。
  //
  // 换个方向的代价是读序变成左→右；换来的是它排得下。
  // **这一档的主列位置由角色站位定死（角色在右 → 标题在左），
  // 右起竖排的前提本来就不成立** —— 不是审美选择，是几何。
  const subCx = flip ? cx - fs / 2 - subFs * 0.72 : cx + fs / 2 + subFs * 0.72;
  const subTop = top + (colInk - (subChars.length * subFs * 1.06)) / 2;

  // ⚠ **整块描边画完再画填充。** 竖排上下两个字比横排两行还近，
  // 下一个字的描边照样啃得掉上一个字的填充。
  const text =
    inkedColumn(chars, cx, top, fs, main, 'stroke') +
    (subChars.length ? inkedColumn(subChars, subCx, subTop, subFs, so, 'stroke') : '') +
    inkedColumn(chars, cx, top, fs, main, 'fill') +
    (subChars.length ? inkedColumn(subChars, subCx, subTop, subFs, so, 'fill') : '');

  let sig = '';
  if (tag) {
    const { w, h } = sigSize(tag);
    sig =
      sigAt === 'feet'
        ? sqSig(tag, (maX + (maH * MA_RATIO) / 2) * s, bandY + (GROUND + 34) * s + h / 2, w, h, true)
        : sqSig(tag, sqSafe().x1 - w / 2, sqSafe().y1 - h / 2, w, h, false);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${SQ}" height="${SQ}" viewBox="0 0 ${SQ} ${SQ}">` +
    `<rect width="${SQ}" height="${SQ}" fill="${bg}"/>` +
    inset(bareFrame, 0, bandY, SQ, bandH) +
    text +
    sig +
    `</svg>`
  );
}

function squareSvg(
  spec: LongCoverSpec,
  bareFrame: string,
  bg: string,
  maX: number,
  maH: number,
  sigAt: SigAnchor,
  tag: string | null,
  issues: LongCoverIssue[]
): string {
  const s = SQ / CV.W; // 0.84375
  const bandH = CV.H * s; // 607.5
  const bandY = SQ - bandH; // 472.5，画面沉到底

  // ── 竖排：大字贴左边排成一列，从上贯到下 ──
  //
  // **画面照旧整帧沉底不裁** —— 竖排解决的正是横排那版「上半空一大块」的问题：
  // 一列字从画布顶走到底，**顺手把那块空白用掉了**，还不用动画面。
  //
  // ⚠ 副标也竖排，在大字左边一列（**中文竖排是从右往左走**，
  // 所以第二列在左；这跟横排版把副标放在大字下面是同一个「次一级」的位置）。
  if ((spec.sqText ?? DEFAULT_SQ_TEXT) === '竖排') return squareVertical(spec, bareFrame, bg, maX, maH, sigAt, tag, issues, s, bandH, bandY);

  // 标题块在**安全区上沿到画面顶边**之间居中 —— 不是「上半那条带里居中」。
  // 那样算出来块顶落在 y=92，比安全线（108）还靠边一档。
  const safe = sqSafe();
  const block = titleBlock(
    spec.title,
    spec.sub,
    spec.side,
    (safe.y0 + bandY) / 2,
    SQ,
    SQ,
    // ⚠ **可用宽度按安全区算，不是按边距。** 946 → 864，字会再小一档 ——
    // 用户 2026-08-26：「不需要担心压图问题，**首先确保排版安全**」。
    safe.x0
  );
  // ⚠ **方版可用宽度比横版窄一档**（946 对 1121），所以**同一个标题横版一行、
  // 方版可能两行** —— 两行更高，顶得出上面那条带。这条只在方版查得到，
  // 横版那几项检测一个都碰不着它。
  if (block.top < 0 || block.bot > bandY)
    issues.push({
      level: 'warn',
      msg:
        `方版标题块 y ${block.top.toFixed(0)}–${block.bot.toFixed(0)} 出了上面那条带（0–${bandY.toFixed(0)}）` +
        `${block.rows > 1 ? '（方版排了两行 —— 946 的可用宽度比横版窄一档）' : ''}，` +
        `会压到画面顶边。**砍标题**`,
    });
  // ⚠ **安全区那一条要查，而且要用量出来的墨迹框查。**
  // 「离边多少」是这一档栽过的地方 —— 第一版竖排的字距画布左沿只有 56px（5%），
  // 缩到 200px 就剩 10px，看着像要掉出去。**眼睛看不出「差一点」，像素能。**
  if (block.top < safe.y0 || block.bot > safe.y1)
    issues.push({
      level: 'error',
      msg:
        `方版标题块 y ${block.top.toFixed(0)}–${block.bot.toFixed(0)} 出了排版安全区` +
        `（${safe.y0}–${safe.y1}）—— **排版安全优先于压不压到画**（§九之三末）`,
    });
  // ⚠ **字号下限方版要单独查一遍。** 横版那条查的是横版的字号（1121 反推出来的），
  // 方版窄一档、算出来的是另一个数 —— 横版刚好卡在 109，方版可能已经掉到 92 了，
  // **而横版那条查不到它**。同一类的漏法上面刚栽过一次（副标跟大字共用外接框）。
  if (block.fs < L.minFs)
    issues.push({
      level: 'error',
      msg:
        `方版字号压到 ${block.fs.toFixed(0)}px，低于下限 ${L.minFs}（方版可用宽度 946，比横版窄一档）—— ` +
        `**改标题**：200px 下那圈墨边会糊进字里`,
    });
  // 署名：`feet` 那一档要跟着缩进去的那双脚走，所以坐标也乘 s 再加带偏移
  let sig = '';
  if (tag) {
    const { w, h } = sigSize(tag);
    sig =
      sigAt === 'feet'
        ? // 跟着缩进去的那双脚走：横版坐标乘 s，再加画面带的偏移，最后收进安全区
          sqSig(tag, (maX + (maH * MA_RATIO) / 2) * s, bandY + (GROUND + 34) * s + h / 2, w, h, true)
        : // 方版**没有时长角标**（那是 YouTube 的事），右下顶到安全线就行
          sqSig(tag, sqSafe().x1 - w / 2, sqSafe().y1 - h / 2, w, h, false);
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${SQ}" height="${SQ}" viewBox="0 0 ${SQ} ${SQ}">` +
    `<rect width="${SQ}" height="${SQ}" fill="${bg}"/>` +
    inset(bareFrame, 0, bandY, SQ, bandH) +
    block.svg +
    sig +
    `</svg>`
  );
}

// ── 出图 ────────────────────────────────────────────────────────────

const FONTS = [
  ...FONT_FILES,
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/msyh.ttc',
].filter((p) => existsSync(p));

function render(svg: string, width = CV.W): Buffer {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    // ⚠ **`loadSystemFonts` 必须开着。** 贴纸大字用的是 `FONT_HEAVY`
    // （Noto Sans SC Black 那一族），它在系统里，不在仓库 `fonts/` 下。
    // 关掉不报错，只是字变细 —— §七之六 自检表那条「渲出来明显变细＝没找到那个字族」。
    font: { fontFiles: FONTS, loadSystemFonts: true },
  })
    .render()
    .asPng();
}

export interface LongCoverOut {
  png: Buffer;
  /** 210px。**唯一的验收标准**（YouTube封面规范 §〇末），先看这张 */
  preview: Buffer;
  /** 1080×1080 方版。微信那一路吃方图，16:9 传上去两边被裁 */
  square: Buffer;
  /** 200px 方版自检 —— 微信列表里它就是这么大 */
  squareCheck: Buffer;
  svg: string;
  squareSvg: string;
  /** 标题块的实际外接框（探针图上量的，不是公式反推的） */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  issues: LongCoverIssue[];
}

/**
 * 那条鱼在哪儿 —— **渲一张没有标题的底，按颜色探。**
 *
 * 为什么不算：鱼的位置由 `fish`（0–1）在缸里左右游，缸的位置又由场景决定，
 * 推一遍等于把 `longform.cjs` 的画法抄一份过来 —— **抄一份就是第二个真相**。
 * 探针只多渲一张 1280 的图，几十毫秒。
 *
 * 场景里没有鱼缸（`corridor` / `dinner` / `office_day`）就返回 null，那时候不用查。
 */
function fishBox(bare: string): { x0: number; y0: number; x1: number; y1: number } | null {
  const px = new Resvg(bare, {
    fitTo: { mode: 'width', value: CV.W },
    font: { fontFiles: FONTS, loadSystemFonts: true },
  }).render().pixels;
  let x0 = CV.W,
    y0 = CV.H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < CV.H; y++)
    for (let x = 0; x < CV.W; x++) {
      const i = (y * CV.W + x) * 4;
      if (
        Math.abs(px[i] - FISH_RGB[0]) < 26 &&
        Math.abs(px[i + 1] - FISH_RGB[1]) < 26 &&
        Math.abs(px[i + 2] - FISH_RGB[2]) < 26
      ) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function renderLongCover(spec: LongCoverSpec): LongCoverOut {
  const issues: LongCoverIssue[] = [];
  const sc = longform.SCENES[spec.scene];
  if (!sc) {
    throw new Error(
      `没有这个场景：${spec.scene}\n可用：${Object.keys(longform.SCENES).join(' / ')}`
    );
  }

  // ① 字数闸。**上限不再是 7 了**（2026-08-26）：一行优先，字号自动往下收，
  //    收到 `minFs` 还排不下才退两行 —— 所以闸位由字号定，不由字数定。
  const k = [...spec.title].length;
  if (k < 4) issues.push({ level: 'error', msg: `大字只有 ${k} 字，撑不住画面（要 4 字起）` });

  const layoutName = spec.layout ?? DEFAULT_LAYOUT;
  const layout = LAYOUTS[layoutName];
  if (!layout)
    throw new Error(
      `版式库里没有「${layoutName}」\n现有：${Object.keys(LAYOUTS).join(' / ')}\n` +
        `加一档看 封面设计规范-COVER.md §九之七`
    );
  const centerK = spec.centerK ?? layout.centerK;
  const sigAt = spec.sig ?? layout.sig;

  const block = titleBlock(spec.title, spec.sub, spec.side, CV.H * centerK);
  if (block.rows > 1)
    issues.push({
      level: 'warn',
      msg:
        `大字 ${k} 字，一行排不下（要压到 ${Math.round((CV.W * (1 - L.marginK * 2)) / (k + T.trackK * (k - 1)))}px，` +
        `下限 ${L.minFs}），退回两行。**要一行就砍到 10 字以内**`,
    });
  if (block.fs < L.minFs)
    issues.push({
      level: 'error',
      msg:
        `字号压到 ${block.fs.toFixed(0)}px，低于下限 ${L.minFs} —— 两行也装不下。` +
        `**改标题**：210px 下那圈墨边会糊进字里，贴纸感就没了`,
    });
  const maX = spec.maX ?? (spec.side === 'right' ? MA.x : 300);
  const maH = spec.maH ?? MA.h;

  const sig =
    spec.tag === 'none' ? null : signature(spec.tag ?? ACCOUNT_LAOMA, sigAt, { x: maX, h: maH });
  if (sig) {
    // ⚠ **署名也要过安全区那一条。** `feet` 那一档跟着角色走 —— 老马一往右站，
    // 署名就跟着滑进时长角标底下，而**画面上一点都看不出来**（角标是平台叠上去的）。
    if (sig.box.x1 > SAFE.x0 && sig.box.y1 > SAFE.y0)
      issues.push({
        level: 'error',
        msg:
          `署名滑进了时长角标（署名 x ${sig.box.x0.toFixed(0)}–${sig.box.x1.toFixed(0)} · ` +
          `y ${sig.box.y0.toFixed(0)}–${sig.box.y1.toFixed(0)}，角标从 ${SAFE.x0},${SAFE.y0} 起）—— ` +
          `**跟着角色走的代价**。把老马往左挪（\`maX\`），或者这一期换 \`一行·右下签\``,
      });
    if (sig.box.x0 < 0 || sig.box.x1 > CV.W || sig.box.y1 > CV.H)
      issues.push({ level: 'error', msg: `署名有一角掉出画布（x ${sig.box.x0.toFixed(0)}–${sig.box.x1.toFixed(0)}）` });
  }

  // **没有标题的那张底**渲一次、两处共用：量鱼、方版。
  // 各渲各的等于同一张图渲两遍，而且改了参数只改一处就会有一处对不上。
  const bare = longform.frame({ scene: spec.scene, fish: spec.fish, maX, maH });

  const svg = longform.frame({
    scene: spec.scene,
    fish: spec.fish,
    maX,
    maH,
    overlay: block.svg + (sig ? '\n' + sig.svg : ''),
  });

  const png = render(svg);

  // ── ② 标题块的实际外接框：探针图上量，不用公式反推 ──
  //
  // ⚠ **大字和副标涂两种颜色，分开量。** 头一版整块一个色，于是「压到脸」那条
  // 拿的是**整块**的框 —— 而副标挂在左边、根本够不着右边的角色，
  // 却因为跟大字共用一个外接框，跟着一起被算成「压到了」。
  // 一个 6 字大字 ＋ 一行副标，整块框是 x 70–1010 × y 194–476；
  // 真正压在老马身上的只有大字那一条带（y 194–355）。
  const probe = new Resvg(block.probe, {
    fitTo: { mode: 'width', value: CV.W },
    font: { fontFiles: FONTS, loadSystemFonts: true },
  }).render();
  const pp = probe.pixels;
  const scan = (near: (r: number, g: number, b: number) => boolean) => {
    let a = CV.W,
      b = CV.H,
      c = -1,
      d = -1;
    for (let y = 0; y < CV.H; y++)
      for (let x = 0; x < CV.W; x++) {
        const i = (y * CV.W + x) * 4;
        if (near(pp[i], pp[i + 1], pp[i + 2])) {
          if (x < a) a = x;
          if (x > c) c = x;
          if (y < b) b = y;
          if (y > d) d = y;
        }
      }
    return c < 0 ? null : { x0: a, y0: b, x1: c, y1: d };
  };
  const bigBox = scan((r, g, b) => r > 90 && b > 90 && g < 90); // #FF00FF 大字
  const subBox = scan((r, g, b) => g > 90 && b > 90 && r < 90); // #00FFFF 副标
  const boxes = [bigBox, subBox].filter(Boolean) as Array<{ x0: number; y0: number; x1: number; y1: number }>;
  const x0 = Math.min(...boxes.map((b) => b.x0));
  const y0 = Math.min(...boxes.map((b) => b.y0));
  const x1 = Math.max(...boxes.map((b) => b.x1));
  const y1 = Math.max(...boxes.map((b) => b.y1));
  if (!boxes.length) {
    issues.push({ level: 'error', msg: '探针图上一个标题像素都没量到 —— 字族没找到？先看一眼 FONT_HEAVY' });
  } else {
    // ③ 高度：整块外接高度 ÷ 720 < 0.30 就报。跟 V3 §七.4 是同一条账，
    //    只是这一档量的是**整块**（标题＋副标），不是一个两字大字。
    const hK = (y1 - y0 + 1) / CV.H;
    if (hK < 0.3)
      issues.push({
        level: 'warn',
        msg: `标题块只占画面高的 ${(hK * 100).toFixed(0)}%（下限 30%）—— 210px 下会压不住场景`,
      });
    // ── ④ 压到了什么：**分级，不再是一条 error** ──
    //
    // 用户 2026-08-26 定「盖住右侧图也可以」，所以「越过左栏界」那条 error 撤了。
    // 但不能就此不查 —— 盖住身子和盖住脸、盖住鱼，是三件不同的事：
    //
    //   场景（墙、窗框）  不报　本来就是底
    //   老马的身子        不报　用户定的
    //   老马的脸          warn　眼睛是这条线的辨识点，黄条横过去人和字互相吃
    //   鱼                warn　红点是 210px 下唯一还在跳的颜色，盖掉等于把唯一的色相扔了
    //
    // ⚠ **脸和鱼用两种量法，因为可靠的量法不一样。**
    // 脸：从 rig 自己的几何推（`maX`/`maH` 是精确的，头占上面三分之一）——
    //     **不能靠颜色探针**，浅底场景（`office_dawn` 底色 #EFE7D8）的背景本身
    //     就跟眼白同色，探出来是一整片。
    // 鱼：靠颜色探针（`C_FISH` #D94F2B 是**全片唯一的高饱和色**，六个场景都不重样）——
    //     它的位置由 `fish` 参数在缸里左右游，**推不出来，只能量**。
    type Box = { x0: number; x1: number; y0: number; y1: number };
    const over = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    /** 大字和副标各自问一遍，报出来的是**哪一样**压到了 */
    const who = (b: Box): string[] =>
      [
        bigBox && over(bigBox, b) ? '大字' : '',
        subBox && over(subBox, b) ? '副标' : '',
      ].filter(Boolean);

    const face = { x0: maX, x1: maX + maH * MA_RATIO, y0: GROUND - maH, y1: GROUND - maH + maH * 0.33 };
    const onFace = who(face);
    if (onFace.length)
      issues.push({
        level: 'warn',
        msg:
          `${onFace.join('和')}压到老马的脸（脸带 y ${face.y0.toFixed(0)}–${face.y1.toFixed(0)}）。` +
          `**盖身子可以，盖脸是另一件事** —— 把 \`cover.long.centerK\` 往下挪（0.5 就让开了），` +
          `或者压矮老马（\`maH\`）`,
      });
    const fish = fishBox(bare);
    const onFish = fish ? who(fish) : [];
    if (fish && onFish.length)
      issues.push({
        level: 'warn',
        msg:
          `${onFish.join('和')}压到那条鱼（鱼在 x ${fish.x0}–${fish.x1} · y ${fish.y0}–${fish.y1}）。` +
          `**它是 210px 下唯一还在跳的颜色** —— 盖掉等于把缩略图唯一的色相扔了。` +
          `挪 \`centerK\`，或者用 \`fish\` 把鱼游到别处`,
      });
  }

  // ── ⑤ 右下安全区：非底色像素 > 5% 就报（YouTube 时长角标） ──
  const img = new Resvg(svg, {
    fitTo: { mode: 'width', value: CV.W },
    font: { fontFiles: FONTS, loadSystemFonts: true },
  }).render();
  const px = img.pixels;
  const bg = [1, 3, 5].map((i) => parseInt(sc.bg.slice(i, i + 2), 16));
  let dirty = 0;
  let total = 0;
  for (let y = SAFE.y0; y < SAFE.y1; y++)
    for (let x = SAFE.x0; x < SAFE.x1; x++) {
      const i = (y * CV.W + x) * 4;
      total++;
      if (Math.abs(px[i] - bg[0]) > 12 || Math.abs(px[i + 1] - bg[1]) > 12 || Math.abs(px[i + 2] - bg[2]) > 12)
        dirty++;
    }
  if (dirty / total > 0.05)
    issues.push({
      level: 'error',
      msg: `右下安全区被占了 ${((dirty / total) * 100).toFixed(0)}%（上限 5%）—— 那儿要留给 YouTube 的时长角标`,
    });

  // 方版：**同一帧，第二种排法**。`bare` 是没有标题的那张底，跟量鱼用的是同一个东西
  const sq = squareSvg(spec, bare, sc.bg, maX, maH, sigAt, spec.tag === 'none' ? null : spec.tag ?? ACCOUNT_LAOMA, issues);

  return {
    png,
    preview: render(svg, 210),
    square: render(sq, SQ),
    squareCheck: render(sq, 200),
    svg,
    squareSvg: sq,
    box: x1 < 0 ? null : { x0, y0, x1, y1 },
    issues,
  };
}

/**
 * ⑥ 剧透闸：**大字里不许出现说破段的字眼**（长片_出片方案.md §七 三条硬规矩之一）。
 *
 * 说破那几句在成品目录的 `发布文案.md`「中心思想」那一栏里 —— 那一栏本来就是
 * 「给写稿的人回头核的」，拿它当判据不用第二处数据。找不到那份就不查，只提一句：
 * **闸门宁可缺席，也不能编一个源出来。**
 */
function spoilerCheck(dir: string, title: string, sub?: string): LongCoverIssue[] {
  const f = `${dir}/发布文案.md`;
  if (!existsSync(f)) return [{ level: 'warn', msg: `${f} 不在，剧透那一条没查 —— 说破段的字眼要人自己核` }];
  const md = readFileSync(f, 'utf8');
  const after = md.split(/^##\s+中心思想/m)[1];
  if (!after) return [{ level: 'warn', msg: '发布文案.md 里没有「中心思想」那一栏，剧透那一条没查' }];
  // ⚠ **只取到下一个 `## ` 为止。** 头一版拿的是「中心思想」之后的**整份文件**，
  // 于是后面那节「封面」里抄的大字自己撞上了自己 —— 报「封面剧透」，而它剧透的是它自己。
  const sec = after.split(/^##\s+/m)[0];
  const said = [...sec.matchAll(/```([\s\S]*?)```/g)].map((m) => m[1]).join('\n');
  const out: LongCoverIssue[] = [];
  for (const [what, text] of [['大字', title], ['副标', sub]] as const) {
    if (!text || text === 'none') continue;
    const bare = [...text.replace(/[，。！？、…—「」　]/g, '')];
    // 三字以上的连续片段撞上说破句就算剧透。两字太短，「我就」「知道」那种误报没意义。
    // **一处只报一条**：六个字的标题能切出四个三字窗口，全报出来是四行说同一件事
    const hit: string[] = [];
    for (let i = 0; i + 3 <= bare.length; i++) {
      const seg = bare.slice(i, i + 3).join('');
      if (said.includes(seg)) hit.push(seg);
    }
    if (hit.length)
      out.push({
        level: 'error',
        msg:
          `${what}「${text}」里的「${hit.join('／')}」出现在说破段里 —— **封面剧透**，` +
          `那七句就白排了（§七 硬规矩一）`,
      });
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  const src = argv.find((a) => !a.startsWith('--'));
  if (!src) {
    console.log('用法：npm run laoma:long-cover -- jokes/laoma-long-001.json [--title 四到七字] [--sub 副标] [--scene office_night]');
    process.exit(1);
  }
  const arg = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const cfg = JSON.parse(readFileSync(src, 'utf8')) as JokeCfg;
  if (cfg.format !== 'long') {
    console.error(`${src} 不是长片（format 不是 "long"）—— 竖版三条线走 npm run cover`);
    process.exit(1);
  }
  const c = (cfg.cover ?? {}) as NonNullable<JokeCfg['cover']>;
  const long = c.long ?? {};
  const title = arg('title') ?? c.title;
  if (!title) {
    console.error('稿件里没有 cover.title，命令行也没给 --title —— 这一档不自动推标题：封面大字是人写的');
    process.exit(1);
  }
  const spec: LongCoverSpec = {
    title,
    sub: arg('sub') ?? c.sub,
    scene: arg('scene') ?? long.scene ?? 'office_night',
    side: (arg('side') as 'left' | 'right') ?? long.side ?? 'right',
    fish: long.fish,
    maX: arg('ma-x') ? Number(arg('ma-x')) : long.maX,
    maH: arg('ma-h') ? Number(arg('ma-h')) : long.maH,
    tag: arg('tag') ?? c.tag,
    layout: arg('layout') ?? long.layout,
    centerK: arg('center') ? Number(arg('center')) : long.centerK,
    sig: (arg('sig') as any) ?? long.sig,
    sqText: (arg('sq-text') as SqText) ?? long.sqText,
  };

  // 版式名／场景名写错是**手误**，不是崩溃 —— 打一行人话，别甩一屏栈
  let out: LongCoverOut;
  try {
    out = renderLongCover(spec);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
  const dir = `${projectDir(cfg)}/cover`;
  mkdirSync(dir, { recursive: true });
  const base = `${dir}/${cfg.id}`;
  writeFileSync(`${base}-16x9.png`, out.png);
  writeFileSync(`${base}-210.png`, out.preview);
  writeFileSync(`${base}-1x1.png`, out.square);
  writeFileSync(`${base}-200.png`, out.squareCheck);
  writeFileSync(`${base}.svg`, out.svg);
  writeFileSync(`${base}-1x1.svg`, out.squareSvg);

  console.log(`${base}-16x9.png　1280×720`);
  console.log(`${base}-210.png 　**先看这张** —— 210px 下读不出来的，1280 上再好看也没用`);
  console.log(`${base}-1x1.png 　1080×1080 方版（微信那一路）`);
  console.log(`${base}-200.png 　方版自检 —— 微信列表里它就是这么大`);
  console.log(`  版式「${spec.layout ?? DEFAULT_LAYOUT}」·方版${spec.sqText ?? DEFAULT_SQ_TEXT}　场景 ${spec.scene}　老马 x=${spec.maX ?? MA.x} h=${spec.maH ?? MA.h}　大字「${spec.title}」${spec.sub ? `　副标「${spec.sub}」` : ''}`);
  if (out.box)
    console.log(
      `  标题块 x ${out.box.x0}–${out.box.x1} · y ${out.box.y0}–${out.box.y1}` +
        `（占画面高 ${(((out.box.y1 - out.box.y0 + 1) / CV.H) * 100).toFixed(0)}%，地面线 ${GROUND}）`
    );

  const issues = [...out.issues, ...spoilerCheck(dirname(dir), spec.title, spec.sub)];
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '⚠'} ${i.msg}`);
  if (!issues.length) console.log('  ✓ 字数 / 高度 / 不压角色 / 右下安全区 / 不剧透说破段，五条都过');
  if (issues.some((i) => i.level === 'error')) process.exitCode = 1;
}

if (process.argv[1]?.includes('laoma-long-cover')) main();
