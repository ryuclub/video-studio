// ── 封面：取笑点后的彩色帧 + 大字纸片 ─────────────────────────────────
//
// 规则见 封面设计规范-COVER.md，三条铁律：
//   ① 绝不剧透笑点（大字里不许出现 highlight 那个词）
//   ② 大字和标题不重复（封面卖惨，标题追问，唱双簧）
//   ③ 用彩色帧不用定格灰帧（灰调在信息流里不跳眼）
//
// 这里只做①的机器校验——②③是人的判断，机器只能提醒。

import { W, H, FPS, FONT, FONT_HEAVY, GROUND, SLOT, SNAKE, SNAKE_DY, ACCOUNT, ACCOUNT_LAOMA } from './config.js';
import { P, makeInk } from './style/palette.js';
import { piece, tornRect, n } from './style/papercut.js';
import { escapeXml } from './subtitle.js';
import { renderFrame, toScreen, stageAt, type RenderCtx } from './render.js';
import { lineText, type JokeCfg } from './types.js';

export interface CoverOpts {
  /** 封面大字。不给就自动生成 */
  title?: string;
  /** 右下角署名，不给就按线分（见 `accountFor`），传 'none' 关掉 */
  tag?: string;
  /** 情绪符号，传 'none' 关掉 */
  mark?: string;
  /** 取帧时刻（秒）。默认笑点 + 0.6s */
  at?: number;
  cam?: { zoom: number; tx: number; ty: number };
}

/** 规范里的默认推镜：主角偏左中，配角只露半个头 */
export const COVER_CAM = { zoom: 1.9, tx: 170, ty: -740 };

const isWide = (ch: string) => /[⺀-鿿가-퟿＀-｠　-〿]/.test(ch);
const textWidth = (s: string, fs: number) =>
  [...s].reduce((w, ch) => w + (isWide(ch) ? fs : fs * 0.55), 0);

/**
 * 自动标题：没指定时从段子里推。
 *
 * 优先用第一句（提问句）——它建立了情境但不含答案，天然不剧透。
 * 去掉标点、截到 8 字以内。这只是个能用的兜底，**上线前应该手写一句**，
 * 规范第二节列了三种写法（第一人称卖惨 > 第三人称叙述 > 互动求助）。
 */
export function autoTitle(cfg: JokeCfg): string {
  const first = cfg.lines.find((l) => l.beat !== 'punch') ?? cfg.lines[0];
  const raw = (first ? lineText(first) : cfg.id).replace(/[，。！？、,.!?…—～~"'「」（）()]/g, '');
  const chars = [...raw];
  if (chars.length <= 8) return chars.join('');
  // 超了就砍到 7 字加省略号，别硬截出半个词
  return chars.slice(0, 7).join('') + '…';
}

/** ①的机器校验：大字里不能出现笑点词 */
export function checkTitle(cfg: JokeCfg, title: string): string[] {
  const warn: string[] = [];
  // 老马线走贴纸式描边大字，字数区间比通用规范窄：**4–7 字**。
  // 超了不该缩字号救 —— 字号一压，那个贴纸感就没了，该改标题（规范 §七之二）。
  if (isLaoma(cfg)) {
    const k = [...title].length;
    if (k > 7) warn.push(`大字 ${k} 字，老马线的上限是 7 —— **改标题，别硬塞**：字号会被压到贴纸感消失（§七之二）`);
    if (k < 4) warn.push(`大字只有 ${k} 字，老马线要 4–7 字`);
    // ⚠ **九宫格那一版会把标题裁掉。** `cli.ts` 出 3:4 用的是 `crop=1080:1440:0:240`，
    // 也就是只留 y ≥ 240；而 §七之三 定的首行基线是 H × 0.115 = 220.8，
    // 中日韩字面还要往基线**以上**长 0.88 × 字号 —— 182 的字号下字顶在 y≈61，
    // **整行都在裁切线外面**。规范 §一 写着「关键内容必须落在 3:4 区域里」，
    // 但 §七之六 的自检表没有这一条，于是没人拦。这儿把它算出来。
    for (const w of laomaTitleClip(title, cfg.cover?.titleLow === true)) warn.push(w);
  }
  const punch = cfg.lines.find((l) => l.beat === 'punch');
  const spoiler = punch?.highlight;
  if (spoiler && title.includes(spoiler)) {
    warn.push(`大字里出现了笑点词「${spoiler}」—— 封面剧透，片子就白做了`);
  }
  if (punch && title.replace(/[，。！？]/g, '') === lineText(punch).replace(/[，。！？]/g, '')) {
    warn.push('大字就是笑点句本身，等于把包袱写在封面上');
  }
  const pubTitle = cfg.title ?? cfg.hook;
  if (pubTitle && title.replace(/[，。！？…「」]/g, '') === pubTitle.replace(/[，。！？…「」]/g, '')) {
    warn.push(`大字和标题「${pubTitle}」是同一句 —— 浪费了唯一的视觉资源，两者该唱双簧`);
  }
  const len = [...title].length;
  if (len < 4) warn.push(`大字只有 ${len} 字，太短撑不住画面（建议 4–8 字）`);
  if (len > 10) warn.push(`大字 ${len} 字，信息流里的缩略图上会看不清（建议 4–8 字）`);
  return warn;
}

/** 大字纸片：字号自适应，最大 150px，最宽占画幅 82% */
function bigTitle(title: string, top = 320): string {
  const maxW = W * 0.82;
  let fs = 150;
  while (fs > 60 && textWidth(title, fs) > maxW - 80) fs -= 2;

  const padX = 40;
  const padY = 26;
  const boxW = textWidth(title, fs) + padX * 2;
  const boxH = fs * 1.28 + padY * 2;
  const x = (W - boxW) / 2;
  const ink = makeInk(0);

  return `<g transform="rotate(-2 ${n(W / 2)} ${n(top + boxH / 2)})">
  ${piece(tornRect(x, top, boxW, boxH, 4242, 2.2, 20), ink(P.light), { dx: 7, dy: 10, shadowAlpha: 0.2 })}
  <text x="${n(W / 2)}" y="${n(top + padY + fs * 0.92)}" font-family="${FONT}" font-size="${fs}"
    font-weight="800" fill="${ink(P.ink)}" text-anchor="middle" xml:space="preserve">${escapeXml(title)}</text>
</g>`;
}

// ── 老马线的封面标题：贴纸式描边大字 ──────────────────────────────────
//
// 规范全文在 封面设计规范-COVER.md §七。**这一套只给老马线**，别的线仍旧走
// `bigTitle()` 的米白纸片。判据跟 `accountFor()` 同一条（`rig === 'horse'`）。
//
// 规格（画布 1080×1920，别的尺寸按宽度等比换算）：
//
//   主标题  Noto Sans SC Black · 填充 #FFD400 · 描边 #1A1A1A 宽 = 字号 × 0.15
//   副标题  同族 · 填充 #1A1A1A · 描边 #FFFFFF 宽 = 副标题字号 × 0.26
//   行高    字号 × 1.12      字间距  字号 × 0.03
//   边距    画布宽 × 0.062   首行基线  画布高 × 0.115
//
const T = {
  fill: '#FFD400',
  line: '#1A1A1A',
  subFill: '#1A1A1A',
  subLine: '#FFFFFF',
  maxFs: 182,
  strokeK: 0.15,
  subStrokeK: 0.26,
  lineH: 1.12,
  trackK: 0.03,
  marginK: 0.062,
  /**
   * 主标题首行基线，占画布高的比例。
   *
   * **2026-08-22 从 0.115 改成 0.22。** 原来那个数只顾了 9:16：标题墨迹落在
   * y 55–243，而**个人主页九宫格裁的是 `crop=1080:1440:0:240`，只留 y ≥ 240** ——
   * 四字标题整行都在裁切线外面，`-3x4.png` 上主标题一个字都不剩，只剩副标题。
   * 规范 §一 早就写着「关键内容必须落在 3:4 区域里」，但 §七之六 的自检表漏了这条。
   *
   * 0.22 是量出来的：墨迹顶边 = 基线 − 字号 × (字面上伸 0.88 ＋ 描边外沿 0.075)，
   * 182 的字号下 = 基线 − 174。要让顶边落在 240 以下再留点余量，基线得 ≥ 419。
   *
   * ⚠ **不能靠「不碰到角色的任何墨迹」去反推，那样算出来是无解的。** 角色墨迹
   * 最上一行在 y=328（头发尖），按那个当上界，可用带只有 240→328 共 88px，
   * 装不下一个 182px 的字。但规范 §七之三 说的是**不压脸** —— 耳朵尖和头发不是脸。
   * 实测 0.22 的时候标题落在他耳朵旁边，离脸还远。
   *
   * 验过两种：4 字一行（007）与 5 字两行（005），3:4 里标题、副标题、角色、署名全在。
   * ⚠ 7 字标题拆成 4/3，第二行位置最低，左端会擦到他头右侧约 9px —— 写到时看一眼。
   */
  baselineK: 0.22,
  /** 需要避让画面上方元素（电梯楼层屏那类）时整体下移到这儿 */
  lowBaselineK: 0.4,
  subFsK: 0.5,
  subGapK: 0.4,
  /**
   * 中日韩字面的上伸量（占字号的比例，实测量的）。
   * 规范里的「副标题位置＝主标题末行基线下方 字号 × 0.4」按字面实现会**压在主标题上**：
   * 基线下方 0.4 × 182 ＝ 72.8px，而副标题自己的字面要往**基线以上**长
   * 0.88 × 91 ＝ 80px —— 它的顶边落在主标题基线上方 7px，正好啃进大字的下半截。
   * 渲出来一眼就看见（第一版「老马 · 一个人住」整条横在「按时不去」的腰上）。
   * 所以把 0.4 当作**间隙**用（主标题基线 → 副标题字面顶边），再补上这段上伸量。
   */
  cjkAscent: 0.88,
};

/** 宽度单位：中文字记 1.0，半角字符记 0.55（跟 textWidth 同一把尺） */
const units = (s: string) => [...s].reduce((w, ch) => w + (isWide(ch) ? 1 : 0.55), 0);

/**
 * 折行。**4–7 字**是规范给的区间：
 *   ≤4 字 不折；5–7 字 折两行，前行取 ceil(n/2)（前行不短于后行）。
 * 超 7 字不在这儿救 —— 字号会被压到贴纸感消失，该改标题。`checkTitle` 会报。
 */
function splitTitle(title: string): string[] {
  const ch = [...title];
  if (ch.length <= 4) return [title];
  const head = Math.ceil(ch.length / 2);
  return [ch.slice(0, head).join(''), ch.slice(head).join('')];
}

/**
 * 一行字画两遍：先只描边，再只填充。
 *
 * ⚠ **不能用单层 stroke，也不能指望 `paint-order`。** 描边是从字形轮廓的中线
 * 往两边长的，一半长在字面里 —— 字号 150 / 描边 22 的时候，「没」「看」这种
 * 笔画细的字中间会被啃糊。`paint-order` 在一部分渲染器上根本不生效。
 *
 * @param pass 'stroke' 只出描边，'fill' 只出填充。**整块的描边要全部画完再画填充** ——
 *             逐行「描边＋填充」交替的话，下一行的描边会啃掉上一行的填充
 *             （行高 1.12，描边半宽够得着）。
 */
function inkedLine(
  text: string,
  x: number,
  y: number,
  fs: number,
  pass: 'stroke' | 'fill',
  o: { fill: string; line: string; strokeK: number; anchor: 'start' | 'end' }
): string {
  const common =
    `x="${n(x)}" y="${n(y)}" font-family="${FONT_HEAVY}" font-size="${n(fs)}" font-weight="900" ` +
    `letter-spacing="${n(fs * T.trackK)}" text-anchor="${o.anchor}" xml:space="preserve"`;
  return pass === 'stroke'
    ? `<text ${common} fill="none" stroke="${o.line}" stroke-width="${n(fs * o.strokeK)}" ` +
        `stroke-linejoin="round" stroke-linecap="round">${escapeXml(text)}</text>`
    : `<text ${common} fill="${o.fill}">${escapeXml(text)}</text>`;
}

/** 九宫格 3:4 的裁切上沿。跟 `cli.ts` 的 `crop=1080:1440:0:240` 是同一个数 */
const CROP_3X4_TOP = 240;

/**
 * 算一算标题在 3:4 那一版里会不会被裁掉。**这是个量出来的判断，不是估的。**
 *
 * 复用 `laomaTitle` 的排版算法（字号反推、行高、上伸量），只是不出 svg，
 * 只回答「最上面那一行的字顶在哪儿」。两边要是各算一套，改了排版这儿就会失灵。
 */
export function laomaTitleClip(title: string, low = false): string[] {
  const margin = W * T.marginK;
  const avail = W - margin * 2;
  const lines = splitTitle(title);
  const widest = Math.max(...lines.map((l) => units(l) + T.trackK * Math.max(0, [...l].length - 1)));
  const fs = Math.min(T.maxFs, avail / widest);
  const y0 = H * (low ? T.lowBaselineK : T.baselineK);
  // 墨迹顶边 = 基线 − 字号 × (字面上伸 ＋ 描边往外那一半)。
  // ⚠ **描边那一项不能漏。** 描边宽是字号 × 0.15，骑在轮廓上、往外长一半 ——
  // 182 的字号下就是 13.7px。只按字面上伸算的话这道检查会偏乐观 13px 才报。
  const inkTop = y0 - fs * (T.cjkAscent + T.strokeK / 2);
  if (inkTop >= CROP_3X4_TOP) return [];
  const lastTop = y0 + (lines.length - 1) * fs * T.lineH - fs * (T.cjkAscent + T.strokeK / 2);
  const lost = lastTop >= CROP_3X4_TOP ? `第 1 行` : `整个标题`;
  return [
    `**九宫格封面（3:4）会把${lost}裁掉**：字顶在 y=${inkTop.toFixed(0)}，而 3:4 只留 y≥${CROP_3X4_TOP}。` +
      `规范 §一 说「关键内容必须落在 3:4 区域里」。` +
      `基线（§七之三，现在是 ${low ? T.lowBaselineK : T.baselineK}）要往下挪，或者字号上限往下压 —— 别只出 9:16 就发`,
  ];
}

/**
 * 出老马线的封面标题块。
 *
 * @param side 角色站位。**标题永远取角色的对侧，绝不压脸**：
 *             站左 → 右上贴右边距、右对齐；站右 → 左上贴左边距、左对齐；
 *             站中央 → 也走右上（不是正上方）。
 * @param low  画面上方有东西要避让（电梯楼层屏那类）时给 true，整体下移到 0.40
 */
export function laomaTitle(
  title: string,
  sub: string | undefined,
  side: 'left' | 'right' | 'center',
  low = false
): string {
  const margin = W * T.marginK;
  const avail = W - margin * 2;
  const lines = splitTitle(title);

  // 字号由**可用宽度反推**，不是写死的。
  //
  // ⚠ 规范给的式子是 `min(182, 可用宽度 / 最长行宽度单位)`，**这儿多算了一项字间距**：
  // 字间距是字号 × 0.03，n 个字有 n−1 个间隙，按原式反推出来的 6 字行会顶出边距约 23px，
  // 正好撞上自检表那条「最长那行到边距还有距离吗」。所以把间距一起放进分母。
  // 4–5 字的常见情形两种算法都会撞上 182 的上限，结果一模一样。
  const widest = Math.max(...lines.map((l) => units(l) + T.trackK * Math.max(0, [...l].length - 1)));
  const fs = Math.min(T.maxFs, avail / widest);
  const lh = fs * T.lineH;

  // 贴边对齐，**不是中心对齐**。中心定位在「画面宽度的 70%」那种做法，
  // 四个字看着没事，七个字直接出血到画面外。贴边之后字数怎么变都只往画面里长。
  const onRight = side !== 'right';
  const anchor: 'start' | 'end' = onRight ? 'end' : 'start';
  const x = onRight ? W - margin : margin;

  const y0 = H * (low ? T.lowBaselineK : T.baselineK);
  const main = { fill: T.fill, line: T.line, strokeK: T.strokeK, anchor };

  const strokes: string[] = [];
  const fills: string[] = [];
  lines.forEach((l, i) => {
    strokes.push(inkedLine(l, x, y0 + i * lh, fs, 'stroke', main));
    fills.push(inkedLine(l, x, y0 + i * lh, fs, 'fill', main));
  });

  if (sub && sub !== 'none') {
    // 副标题也要**反推一次宽度**，不能只拿主标题的一半就用。
    //
    // ⚠ 它是 `text-anchor="end"` 挂在右边距上的：写长了不会在右边被裁掉，
    // 而是**往左顶出画布**，看着像渲染坏了而不是「这句写太长」。
    // 主标题有 `checkTitle` 管字数，副标题一直没人管。
    // 0.5 是上限不是定值 —— 装不下就往下压，压到主标题的 0.32 为止（再小就读不清了）。
    const subUnits = units(sub) + T.trackK * Math.max(0, [...sub].length - 1);
    const subFs = Math.max(fs * 0.32, Math.min(fs * T.subFsK, avail / subUnits));
    const subY = y0 + (lines.length - 1) * lh + fs * T.subGapK + subFs * T.cjkAscent;
    const so = { fill: T.subFill, line: T.subLine, strokeK: T.subStrokeK, anchor };
    strokes.push(inkedLine(sub, x, subY, subFs, 'stroke', so));
    fills.push(inkedLine(sub, x, subY, subFs, 'fill', so));
  }

  // 描边全画完，再画填充。见 inkedLine 的注释。
  return strokes.join('\n') + '\n' + fills.join('\n');
}

/** 情绪符号：芥黄 + 米白描边，保证压在任何底色上都看得清 */
function emotionMark(mark: string, x: number, y: number): string {
  const ink = makeInk(0);
  const fs = 132;
  return `<g transform="rotate(9 ${n(x)} ${n(y)})">
  <text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${fs}" font-weight="800"
    text-anchor="middle" stroke="${ink(P.light)}" stroke-width="14" stroke-linejoin="round"
    fill="none">${escapeXml(mark)}</text>
  <text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${fs}" font-weight="800"
    text-anchor="middle" fill="${ink(P.accent)}">${escapeXml(mark)}</text>
</g>`;
}

/**
 * 这条稿件署哪个号。
 *
 * **判据跟 `yiye-publish.ts` 的 `isLaoma` 是同一条**（`rig === 'horse'`）——
 * 两处判得不一样的话，封面署一个号、发布文案署另一个号，而且不会报错。
 * 稿件里显式写了 `cover.tag` 的仍旧优先，这只是缺省。
 */
function isLaoma(cfg: JokeCfg): boolean {
  return cfg.characters.some((c) => c.rig === 'horse');
}

function accountFor(cfg: JokeCfg): string {
  return isLaoma(cfg) ? ACCOUNT_LAOMA : ACCOUNT;
}

/**
 * 右下角署名：账号名。做到第十条时观众会认出这是同一个号。
 *
 * **歪着贴，左低右高。** 原来是 `rotate(1.5)` —— 1.5 度肉眼看就是水平，
 * 而它是一张手撕纸片：纸片是「贴上去的」，正正地摆着反而露馅，
 * 像是在排版软件里对齐过的一个文本框。
 *
 * ⚠ **方向不能反。** SVG 的正角是顺时针，`rotate(1.5)` 是右边往下压；
 * 要左低右高得用**负角**。−6 度是量出来的：大字纸片是 −2 度，
 * 两张纸片同向才像同一只手贴的（原来一张 −2 一张 +1.5，是**对着歪**的，
 * 那不是随手，是别扭）。署名比大字小得多，同样的倾斜度在小块上看不出来，
 * 所以给到 −6：视觉倾斜感跟大字那张对得上，绝对角度不必相同。
 *
 * 再大就不行了：这块贴在右下、离画幅右边只剩 96px，
 * 倾角上去之后右上角先顶出安全区。
 */
function signature(tag: string): string {
  const ink = makeInk(0);
  const fs = 34;
  const padX = 24;
  const padY = 14;
  const boxW = textWidth(tag, fs) + padX * 2;
  const boxH = fs * 1.3 + padY * 2;
  // 右侧 15% 会被点赞栏盖住，所以往左让一点
  const x = W - boxW - 96;
  const y = H - boxH - 380;
  return `<g transform="rotate(-6 ${n(x + boxW / 2)} ${n(y + boxH / 2)})">
  ${piece(tornRect(x, y, boxW, boxH, 909, 1.4, 14), ink(P.primary), { dx: 4, dy: 6, shadowAlpha: 0.2 })}
  <text x="${n(x + boxW / 2)}" y="${n(y + padY + fs * 0.88)}" font-family="${FONT}" font-size="${fs}"
    font-weight="700" fill="${ink(P.paper)}" text-anchor="middle">${escapeXml(tag)}</text>
</g>`;
}

/** 出封面 SVG */
export function coverSvg(ctx: RenderCtx, opts: CoverOpts = {}): { svg: string; title: string; at: number } {
  const { tl } = ctx;
  const cfg = tl.cfg;
  const title = opts.title ?? cfg.cover?.title ?? autoTitle(cfg);
  const tag = opts.tag ?? cfg.cover?.tag ?? accountFor(cfg);
  const mark = opts.mark ?? cfg.cover?.mark ?? '?!';
  // 笑点后 0.6s：角色嘴张着、表情最夸张。定格之前，所以还是彩色的
  const at = opts.at ?? cfg.cover?.at ?? Math.min(tl.punchEnd + 0.6, tl.freezeStart - 0.05);
  const nChar = cfg.characters.length;
  // 两个角色要都进画，推镜得拉开；单角色才用规范里那个 1.9 的紧景
  const autoCam = nChar > 1 ? { zoom: 1.28, tx: 0, ty: -430 } : COVER_CAM;
  const cam = opts.cam ?? (cfg.cover?.cam as any) ?? autoCam;

  // 情绪符号浮在笑点说话者头部右上方。
  // 偏移量用舞台坐标算再换算到画面，这样改 cam.zoom 时相对关系不会跑掉；
  // 直接加画面像素的话，一改推镜符号就飞到脸上去了。
  const punchWho = cfg.lines.find((l) => l.beat === 'punch')?.who;
  const ch = cfg.characters.find((c) => c.id === punchWho) ?? cfg.characters[0];
  const snake = ch?.rig === 'serpentine';
  const px = snake
    ? ch?.side === 'left' ? SNAKE.left : SNAKE.right
    : ch?.side === 'left' ? SLOT.left : SLOT.right;
  const anchorY = GROUND + (snake ? (ch?.side === 'left' ? SNAKE_DY.left : SNAKE_DY.right) : 0);
  // 蛇头就在锚点上，人的头在锚点上方约 620（双脚中心量到头顶）
  const head = toScreen(cam, px + 130, anchorY - (snake ? 300 : 760));

  // 老马线的标题排版是另一套（贴纸式描边大字，见 laomaTitle / 规范 §七）。
  // `cover.top` 在这条路上不生效 —— 那套是给米白纸片定顶边的，
  // 这套的首行基线由规范定死（0.115，要避让上方元素时 `cover.titleLow: true` 下移到 0.40）。
  //
  // ⚠ **站位要按角色实际站在哪儿判，不能读 `side`。**
  // 这条线上 `side` 只管朝向要不要镜像，位置是 `x` ＋ `keepX` 定的 ——
  // laoma-003 的稿件注释写得明明白白：「side 用 left 只为了朝向不镜像，位置由 x 定」。
  // 按 `side` 判的话，一条把马放右边（`x: 790, keepX: true`）但仍写 `side: 'left'`
  // 的稿子会把标题排到右上 —— **正压在他脸上**，而这个函数的注释恰恰承诺了绝不压脸。
  // 所以按 x 算：落在画幅左半就把标题排右上，反之排左上。
  // （`sideText` 在 render.ts 里早就是按角色框的实际 x 判的，两处口径这才一致。）
  const laomaCh = cfg.characters.find((c) => c.rig === 'horse');
  const chX = laomaCh?.keepX && laomaCh.x != null ? laomaCh.x : W / 2;
  const overlay = [
    isLaoma(cfg)
      ? laomaTitle(
          title,
          cfg.cover?.sub,
          chX < W / 2 ? 'left' : 'right',
          cfg.cover?.titleLow === true
        )
      : bigTitle(title, cfg.cover?.top ?? 320),
    mark !== 'none' ? emotionMark(mark, head.x, head.y) : '',
    tag !== 'none' ? signature(tag) : '',
  ].join('\n');

  // 角色强制全员出场（封面要展示阵容），**道具只取取帧那一刻真正在场的**。
  //
  // 两者语义不同：把道具也全塞进来的话，蛋、碎蛋壳、锅、材料、炉子、蛋糕、
  // 蛋壳车会叠成一坨——它们本来就分属不同镜头，不该同时出现。
  const propsHere = stageAt(tl, Math.min(at, tl.freezeStart - 0.001)).filter((id) =>
    (cfg.props ?? []).some((p) => p.id === id)
  );
  const allOn: RenderCtx = {
    ...ctx,
    forceStage: [...cfg.characters.map((c) => c.id), ...propsHere],
  };
  const svg = renderFrame(allOn, Math.round(at * FPS), {
    cam,
    desat: 0, // 铁律③：封面必须是彩色帧
    hideSubtitle: true,
    hideHook: true,
    overlay,
  });
  return { svg, title, at };
}

/** 安全区辅助线：3:4 裁切框 + 抖音 UI 遮挡区 */
export function safeZoneOverlaySvg(): string {
  const cropH = 1440; // 九宫格裁 3:4
  const cropY = (H - cropH) / 2;
  return `<g>
  <rect x="0" y="${n(cropY)}" width="${W}" height="${n(cropH)}" fill="none"
    stroke="#00C2FF" stroke-width="6" stroke-dasharray="24 16"/>
  <text x="24" y="${n(cropY + 44)}" font-family="${FONT}" font-size="30" fill="#00C2FF" font-weight="700">3:4 九宫格裁切框</text>
  <rect x="0" y="${n(H * 0.8)}" width="${W}" height="${n(H * 0.2)}" fill="#000" opacity="0.42"/>
  <text x="24" y="${n(H * 0.8 + 50)}" font-family="${FONT}" font-size="30" fill="#fff" font-weight="700">底部 20%：昵称文案遮挡</text>
  <rect x="${n(W * 0.85)}" y="0" width="${n(W * 0.15)}" height="${H}" fill="#000" opacity="0.42"/>
  <text x="${n(W * 0.85 + 10)}" y="${n(H * 0.5)}" font-family="${FONT}" font-size="26" fill="#fff"
    font-weight="700" transform="rotate(90 ${n(W * 0.85 + 10)} ${n(H * 0.5)})">右侧 15%：点赞栏遮挡</text>
</g>`;
}
