// ── 治愈档封面：横版 1280×720 + 微信方版 1080×1080 ────────────────────
//
// 用法：npx tsx src/zhiyu-cover.ts          两期一起出
//       npx tsx src/zhiyu-cover.ts --part 上
//
// 版式、坐标、色值、字号全部照 `zhiyu/治愈档封面设计规范.md` 落的，
// **这里不发明设计**。改样式先改规范，再改这里，否则两边会各说各话。
//
// ── 一句话记住这套东西的前提 ──
//
// **封面和片内画面职能相反。** 片内要无聊、低对比、几乎不动（让人不想切走）；
// 封面要在一屏十二个视频里被点开，必须显眼。所以同一套插画语言在三处拉开：
// 封面去掉窗框、主体放大一倍、色阶加到四层以上。
// 拿片内那套参数糊封面是这条线最容易犯的错。
//
// ── 三条硬约束（规范第一节，不要绕过）──
//
//   ① 右下角 240×100 留空 —— YouTube 时长角标压在那里。
//      下面有断言在守，文字或印章伸进去会直接报错。
//   ② 不放人脸、箭头、红圈、夸张表情。那套刺激型缩略图语法会招来错的观众，
//      点进来两分钟就走，对完播的伤害比没人点更大。
//   ③ 元素总数不超过三个（插画 / 书名 / 印章）。手机首页缩略图实际只有
//      约 210px 宽，第四个元素必糊。
//
// ── 唯一必须做的检查 ──
//
// **看 check-210.png**（微信方版看 check-square-200.png）。
// 在 1280 上好看不算数 —— 手机信息流里就那么大。

import { resolveEp } from './zhiyu-ep.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const { id: EP, dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));

/** 成品尺寸。规范里所有坐标都按这一组给 */
export const CW = 1280;
export const CH = 720;
/** 微信方版边长。1:1，公众号 / 视频号用 */
export const SQ = 1080;

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => Math.round(v * 100) / 100;

// ── 字体 ──────────────────────────────────────────────────────────────
//
// 仓库自带静态字重，不依赖系统装了什么（resvg 对可变字体的 weight 轴支持有限，
// 只有 VF 时写 500 拿到的其实是 Regular，书名在 210px 自检图上就立不住）。

const FONT_DIR = fileURLToPath(new URL('../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/', import.meta.url));
const FONT_FILES = ['Black', 'Bold', 'SemiBold', 'Medium', 'Regular', 'Light', 'ExtraLight']
  .map((w) => `${FONT_DIR}NotoSerifCJKsc-${w}.otf`)
  .filter((f) => existsSync(f));
const SC = 'Noto Serif CJK SC';

/**
 * 日文书名要走 JP 字形，**这不是讲究是必须**：「蔵」「記」「絵」在 SC 和 JP
 * 里字形不同，用 SC 排日文书名会出字形错误，日本观众一眼看得出。
 * 仓库现在只有 SC，所以 titleLang: "jp" 的期先炸出来，别默默排错。
 */
const JP_DIR = fileURLToPath(new URL('../../fonts/NotoSerifCJKjp/OTF/Japanese/', import.meta.url));
const HAS_JP = existsSync(JP_DIR);

// ── 规范第三节的坐标表，原样抄下来 ────────────────────────────────────

const L = {
  bandW: 384,
  ruleX: 384,
  titleCx: 192,
  /**
   * 主位按字数查表：基线、字距、字号。**字号下限 92px**，低于这个缩到 210 会并笔画。
   *
   * 分期封面用这一档 —— 主位是期标题，旁边还要给 56px 的书名让出一列，
   * 96px 是这个版式下的上限，再大两列就挤了。
   */
  title: {
    3: { base: 212, gap: 124, size: 104 },
    4: { base: 186, gap: 118, size: 96 },
    5: { base: 160, gap: 112, size: 92 },
  } as Record<number, { base: number; gap: number; size: number }>,
  /**
   * **总封面单独一档，比分期大约 27%。**
   *
   * 总封面旁边只有一列 30px 的作者名，横向余量比分期封面大得多
   * （3 字 132px 占 126–258，作者列在 305 起，中间还空 47px），
   * 竖向到朱砂印之间也还有一百多像素。分期封面吃不下这个尺寸 ——
   * 它那一列 56px 的书名要占 292–348。
   *
   * 用途也不一样：总封面进的是播放列表、专辑、频道橱窗，
   * 那些位置常常被缩成小方块，主位大一档更认得出。
   */
  titleBook: {
    3: { base: 180, gap: 156, size: 132 },
    4: { base: 150, gap: 148, size: 122 },
    5: { base: 122, gap: 140, size: 116 },
  } as Record<number, { base: number; gap: number; size: number }>,
  authorCx: 320, authorBase: 220, authorGap: 40, authorSize: 30,
  hookCx: 320, hookBase: 400, hookGap: 34, hookSize: 26,
  /**
   * 分期封面上的书名 —— **降级但不缩水**。
   *
   * 规范原本只有一种封面，主位固定给书名。实际发的是分期视频，
   * 观众要先看见「这一期讲什么」，所以主位让给期标题，书名退到第二列。
   *
   * 56px 是量出来的下限：再小就跟副题（26px）拉不开层级，书名会被读成又一行注释。
   * 主位的期标题是 96px，56 差不多是它的六成 —— 一眼分得出主次，又不至于沦为小字。
   *
   * 更管用的其实不是字号是**颜色**：副题是灰（`#A8A294`），书名用**墨色**，
   * 跟主位同一个色，只压到 0.74 不透明度。先试的 0.62 偏淡，读着像水印，
   * 「醒目」这一条就不成立了。
   *
   * 缩到 210px 只有期标题读得出，这是没办法的事 ——
   * 规范自己也写了「第四个元素必糊」。书名在手机播放页那个尺寸读得出就够了。
   */
  bookCx: 320, bookBase: 166, bookGap: 68, bookSize: 56, bookOpacity: 0.74,
  sealX: 48, sealY: 608, sealS: 72, sealR: 6,
  sealCx: 84, sealBase: 658, sealSize: 40,
  labelX: 152, labelBase: 648, labelLine: 32, labelSize: 24,
  bandY: 708, bandH: 12,
  /** 时长角标位。任何文字/印章不得进入 */
  keepOut: { x: 1040, y: 620, w: 240, h: 100 },
};

/** 规范第五节：固定色 */
const C = {
  paper: '#F6F2E8',
  rule: '#E0D9C6',
  seal: '#C0503C',
  sealInk: '#FDF6EC',
  author: '#8A9184',
  hook: '#A8A294',
  label: '#9AA294',
};

/** 规范第五节：按镜位变的两色 */
export const SHOTS: Record<string, { ink: string; band: string }> = {
  远景: { ink: '#2F4A3F', band: '#E8A95E' },
  林中路: { ink: '#2F4A37', band: '#6FB063' },
  水景: { ink: '#33534F', band: '#7FB8B4' },
  近景: { ink: '#3A5A42', band: '#8CC194' },
  留白: { ink: '#365550', band: '#7FB8B4' },
};

/**
 * 两种封面，主位放的东西不一样：
 *
 *   `book`    整本一张。**书名占主位**，作者在侧。
 *             用在播放列表封面、专辑封面、频道橱窗 —— 那些地方要认的是「哪本书」。
 *    `episode` 每期一张。**期标题占主位**，书名退到第二列（56px 墨色，见 L.book*）。
 *             视频列表里观众先要知道「这一期讲什么」，书名是归属不是主语。
 *
 * 两种共用同一套骨架（竖条宽度、分隔线、印章、色带、留空区），
 * 只换主位放谁 —— 换了骨架就不是一个系列了。
 */
export interface CoverSpec {
  kind: 'book' | 'episode';
  book: string;
  author: string;
  shot: keyof typeof SHOTS | string;
  titleLang?: 'sc' | 'jp';
  hook: string;
  /** episode 专用：这一期的标题，占主位 */
  epTitle?: string;
  /** episode 专用：上 / 下 */
  part?: string;
  /** 档位标第一行。规范第七节那条待定定了：只留档位，去掉时长（YouTube 自带角标已经给了） */
  slot?: string;
  /** 档位标第二行。episode 是「上篇」，book 是「全两期」 */
  label?: string;
}

/** 主位放什么：book 放书名，episode 放期标题 */
const leadOf = (s: CoverSpec) => (s.kind === 'book' ? s.book : s.epTitle ?? s.book);

// ── 竖排 ──────────────────────────────────────────────────────────────

/** 竖排一列字。x 是中线，`base` 是首字基线，往下按 gap 排 */
function vtext(
  s: string,
  x: number,
  base: number,
  gap: number,
  size: number,
  fill: string,
  weight: number,
  family = SC
): { svg: string; bottom: number } {
  const chars = [...s];
  const svg = chars
    .map(
      (ch, i) =>
        `<text x="${n(x)}" y="${n(base + i * gap)}" font-family="${family}" font-weight="${weight}" ` +
        `font-size="${n(size)}" fill="${fill}" text-anchor="middle">${esc(ch)}</text>`
    )
    .join('\n    ');
  return { svg, bottom: base + (chars.length - 1) * gap };
}

/** 文字/印章不许进时长角标位。规范第一节的硬约束，用断言守住而不是靠记性 */
function assertClear(name: string, x: number, y: number, w: number, h: number) {
  const k = L.keepOut;
  if (x < k.x + k.w && x + w > k.x && y < k.y + k.h && y + h > k.y) {
    throw new Error(
      `「${name}」伸进了右下角 ${k.w}×${k.h} 的留空区（时长角标位）：` +
        `元素 ${Math.round(x)},${Math.round(y)} ${Math.round(w)}×${Math.round(h)}`
    );
  }
}

// ── 插画：五种镜位，《方丈记》只要「留白」这一种 ──────────────────────

/**
 * 「留白」镜位。规范说这一期是**饱和度下限锚点**：
 * 内容越接近无常、越接近减法，饱和度越低、主体占比越小。
 *
 * 所以草庵画得很小，大部分面积是空的天。**这是设计，不是没画完** ——
 * 规范第七节自己也标了这是风险项：缩略图网格里「空」可能被读成「没内容」，
 * 也可能因为一片满当当里唯一的留白而最显眼。**要单独 A/B，别跟着系列一起定**。
 *
 * 色阶四层以上（远脊 / 中坡 / 近地 / 草庵），比片内那套拉得开。
 */
function inkWhitespace(x: number, y: number, w: number, h: number, id: string): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  // 草庵压在左三分之一，**避开右下角**：那儿是时长角标位，主体挪过去会被压住
  const hutCx = x + w * 0.34;
  const groundY = y + h * 0.76;
  const roofW = w * 0.2;
  const roofH = h * 0.1;
  return `
  <defs>
    <clipPath id="clip-${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/></clipPath>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F7F3EA"/>
      <stop offset="0.55" stop-color="#EFEADB"/>
      <stop offset="1" stop-color="#E6E3D2"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#clip-${id})">
    <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#sky-${id})"/>
    <circle cx="${X(0.7)}" cy="${Y(0.3)}" r="${n(h * 0.135)}" fill="#F2E4C6" opacity="0.75"/>
    <path d="M ${X(-0.05)} ${Y(0.66)} Q ${X(0.2)} ${Y(0.6)} ${X(0.46)} ${Y(0.645)}
             T ${X(1.05)} ${Y(0.62)} L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z"
          fill="#CBD4C7"/>
    <path d="M ${X(-0.05)} ${Y(0.735)} Q ${X(0.3)} ${Y(0.7)} ${X(0.62)} ${Y(0.745)}
             T ${X(1.05)} ${Y(0.72)} L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z"
          fill="#AEBFB0"/>
    <path d="M ${X(-0.05)} ${Y(0.86)} Q ${X(0.4)} ${Y(0.82)} ${X(1.05)} ${Y(0.85)}
             L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z"
          fill="#92A697"/>
    <g>
      <path d="M ${n(hutCx - roofW / 2 - w * 0.018)} ${n(groundY - roofH)}
               L ${n(hutCx)} ${n(groundY - roofH - h * 0.055)}
               L ${n(hutCx + roofW / 2 + w * 0.018)} ${n(groundY - roofH)} Z"
            fill="#4C6157"/>
      <rect x="${n(hutCx - roofW / 2)}" y="${n(groundY - roofH)}"
            width="${n(roofW)}" height="${n(roofH)}" fill="#6E8074"/>
      <rect x="${n(hutCx - roofW * 0.16)}" y="${n(groundY - roofH * 0.62)}"
            width="${n(roofW * 0.32)}" height="${n(roofH * 0.62)}" fill="#3F534A"/>
    </g>
    ${[0.12, 0.19, 0.55, 0.62, 0.68, 0.86]
      .map(
        (f) =>
          `<path d="M ${X(f)} ${n(groundY + h * 0.035)} q ${n(w * 0.008)} ${n(-h * 0.045)} ${n(w * 0.022)} ${n(-h * 0.062)}"
                 stroke="#7E9184" stroke-width="${n(h * 0.006)}" fill="none" stroke-linecap="round" opacity="0.7"/>`
      )
      .join('\n    ')}
  </g>`;
}

/**
 * 「远景」镜位的封面。《枕草子》开场就是「山的边缘先亮」，是远景。
 *
 * **跟片内那张不是一个东西**（`zhiyu-scene.ts` 里也有个远景）：
 * 那张要无聊 —— 三层山脊、色阶差不到两档、没有焦点；
 * 这张要在缩略图里被认出来，所以山脊拉到四层、天空压出层次、
 * 日轮加大并放到山脊线上，让明暗有个交界。
 *
 * 拿片内那张来当封面，缩到 210px 就是一片糊。
 */
function inkDistant(x: number, y: number, w: number, h: number, id: string): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  return `
  <defs>
    <clipPath id="clip-${id}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"/></clipPath>
    <linearGradient id="sky-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F7F3EA"/>
      <stop offset="0.5" stop-color="#F0E7D6"/>
      <stop offset="1" stop-color="#E4E2D2"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#clip-${id})">
    <rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="url(#sky-${id})"/>
    <circle cx="${X(0.68)}" cy="${Y(0.52)}" r="${n(h * 0.15)}" fill="#F2E2BE" opacity="0.85"/>
    <path d="M ${X(-0.05)} ${Y(0.6)} L ${X(0.14)} ${Y(0.44)} L ${X(0.3)} ${Y(0.58)}
             L ${X(0.5)} ${Y(0.4)} L ${X(0.72)} ${Y(0.59)} L ${X(0.88)} ${Y(0.47)}
             L ${X(1.05)} ${Y(0.6)} L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z" fill="#D2DBD1"/>
    <path d="M ${X(-0.05)} ${Y(0.72)} L ${X(0.2)} ${Y(0.61)} L ${X(0.44)} ${Y(0.71)}
             L ${X(0.68)} ${Y(0.6)} L ${X(0.9)} ${Y(0.72)} L ${X(1.05)} ${Y(0.67)}
             L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z" fill="#AEBFB0"/>
    <path d="M ${X(-0.05)} ${Y(0.85)} Q ${X(0.5)} ${Y(0.8)} ${X(1.05)} ${Y(0.84)}
             L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z" fill="#8FA697"/>
    <path d="M ${X(-0.05)} ${Y(0.94)} Q ${X(0.5)} ${Y(0.91)} ${X(1.05)} ${Y(0.93)}
             L ${X(1.05)} ${Y(1.05)} L ${X(-0.05)} ${Y(1.05)} Z" fill="#7B927F"/>
  </g>`;
}

function illustration(shot: string, x: number, y: number, w: number, h: number, id: string): string {
  if (shot === '留白') return inkWhitespace(x, y, w, h, id);
  if (shot === '远景') return inkDistant(x, y, w, h, id);
  throw new Error(
    `镜位「${shot}」的封面插画还没画。现在有「留白」（方丈记）和「远景」（枕草子）。\n` +
      `其余三种见 治愈档封面设计规范.md 第五节，画之前先看那儿的色值 ——\n` +
      `**别拿 zhiyu-scene.ts 里同名的那张来顶**，那是片内的，要无聊；封面要被点开。`
  );
}

// ── 横版 1280×720 ─────────────────────────────────────────────────────

export function coverSvg(s: CoverSpec): string {
  const shot = SHOTS[s.shot];
  if (!shot) throw new Error(`没有这个镜位：${s.shot}　可用：${Object.keys(SHOTS).join(' / ')}`);
  if (s.titleLang === 'jp' && !HAS_JP)
    throw new Error(
      `书名标了 titleLang: "jp"，但仓库里没有 Noto Serif CJK JP。\n` +
        `「記」「蔵」「絵」这类字 SC 和 JP 字形不同，用 SC 排会出字形错误。\n` +
        `要么装 JP 字体到 fonts/NotoSerifCJKjp/，要么把书名改成简体、titleLang 改回 sc。`
    );

  const lead = leadOf(s);
  const chars = [...lead].length;
  // 总封面比分期大一档，见 L.titleBook 的注释
  const t = (s.kind === 'book' ? L.titleBook : L.title)[chars];
  if (!t)
    throw new Error(
      `主位文字「${lead}」${chars} 字，规范只给了 3/4/5 字的坐标。\n` +
        `**不要缩字号**（下限 92px，再小缩到 210 会并笔画）——` +
        (s.kind === 'book'
          ? `书名超 5 字改用简称，全称放副题位。`
          : `期标题（epTitle）改短，4 字最稳。`)
    );

  const title = vtext(lead, L.titleCx, t.base, t.gap, t.size, shot.ink, 500);

  // 第二列。book 放作者，episode 放书名 —— 书名让出主位但保住墨色和 52px
  const second =
    s.kind === 'book'
      ? vtext(s.author, L.authorCx, L.authorBase, L.authorGap, L.authorSize, C.author, 400)
      : vtext(s.book, L.bookCx, L.bookBase, L.bookGap, L.bookSize, shot.ink, 500);
  const secondSvg =
    s.kind === 'book' ? second.svg : `<g opacity="${L.bookOpacity}">${second.svg}</g>`;

  // ── 副题的起点跟着第二列走 ──
  //
  // 第二列和副题共用 x=320 这一列，撞上就是两段字叠在一起。
  // 原来 `hookBase` 是写死的 400，**只经得起三个字的书名**：
  // 《陶庵梦忆》四个字排到 y=370，直接压到 400 上，分期封面就出不来了。
  // 方版那边早就是 `Math.max(400, second.bottom + 92)`，横版这儿照它改。
  const hookBase = Math.max(L.hookBase, second.bottom + L.hookSize * 2);
  const hook = vtext(s.hook, L.hookCx, hookBase, L.hookGap, L.hookSize, C.hook, 400);

  // 硬约束①：文字和印章都不许碰右下角。竖条在最左边，正常排不到，
  // 但主位一长就会往下跑，断言比记性可靠
  assertClear('主标题', L.titleCx - t.size / 2, t.base - t.size, t.size, title.bottom - t.base + t.size);
  assertClear('副题', L.hookCx - L.hookSize / 2, hookBase - L.hookSize, L.hookSize, hook.bottom - hookBase + L.hookSize);
  assertClear('朱砂印', L.sealX, L.sealY, L.sealS, L.sealS);
  // 往下让也有尽头：让到压上底部那条色带就得改字。
  // **不拿朱砂印当底** —— 印在 x=48 那一列，副题在 x=320，两者根本不同列，
  // 副题排过 y=608 也碰不到它（《枕草子》的八字副题一直就排到 638）。
  if (hook.bottom > L.bandY - L.hookSize)
    throw new Error(
      `副题排到 y=${Math.round(hook.bottom)}，压到底部色带（y=${L.bandY}）上了。\n` +
        `副题（hook）改短，或者第二列（${s.kind === 'book' ? '作者' : '书名'}）改短。`
    );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
  <rect width="${CW}" height="${CH}" fill="${C.paper}"/>
  ${illustration(s.shot, L.bandW, 0, CW - L.bandW, CH, 'h')}
  <rect x="0" y="0" width="${L.bandW}" height="${CH}" fill="${C.paper}"/>
  <rect x="${L.ruleX}" y="0" width="2" height="${CH}" fill="${C.rule}"/>
    ${title.svg}
    ${secondSvg}
    ${hook.svg}
  <rect x="${L.sealX}" y="${L.sealY}" width="${L.sealS}" height="${L.sealS}" rx="${L.sealR}" fill="${C.seal}"/>
  <text x="${L.sealCx}" y="${L.sealBase}" font-family="${SC}" font-weight="500" font-size="${L.sealSize}"
        fill="${C.sealInk}" text-anchor="middle">醒</text>
  <text x="${L.labelX}" y="${L.labelBase - L.labelLine}" font-family="${SC}" font-weight="400"
        font-size="${L.labelSize}" fill="${C.label}">${esc(s.slot ?? '深夜档')}</text>
  <text x="${L.labelX}" y="${L.labelBase}" font-family="${SC}" font-weight="400"
        font-size="${L.labelSize}" fill="${C.label}">${esc(s.label ?? '')}</text>
  <rect x="0" y="${L.bandY}" width="${CW}" height="${L.bandH}" fill="${shot.band}"/>
</svg>`;
}

// ── 微信方版 1080×1080 ────────────────────────────────────────────────

/**
 * 方版不是把横版裁一刀 —— 896 宽的插画区裁成方的会把草庵切掉。
 * 版式语言（左竖条 + 竖排书名 + 朱砂印 + 底部色带）照搬，比例重排：
 * 竖条占 37%（横版是 30%），插画区还剩 680×1080，草庵仍在左三分之一。
 */
export function coverSquareSvg(s: CoverSpec): string {
  const shot = SHOTS[s.shot];
  const lead = leadOf(s);
  const chars = [...lead].length;
  // 方版同样分两档。总封面这一档比分期大约 15%，跟横版那边的取舍是一回事
  const size = (s.kind === 'book' ? { 3: 136, 4: 124, 5: 114 } : { 3: 118, 4: 108, 5: 100 })[chars] ?? 100;
  const gap = size * 1.2;
  const bandW = 400;
  const base = (SQ - (chars - 1) * gap) / 2 - size * 0.1;
  const col2 = bandW - 68;

  const title = vtext(lead, bandW / 2, base, gap, size, shot.ink, 500);
  // 跟横版同一个道理：episode 的第二列是书名，墨色、约主位一半大
  const second =
    s.kind === 'book'
      ? vtext(s.author, col2, 150, 44, 32, C.author, 400)
      : vtext(s.book, col2, 150, 70, 58, shot.ink, 500);
  const secondSvg = s.kind === 'book' ? second.svg : `<g opacity="${L.bookOpacity}">${second.svg}</g>`;
  const hook = vtext(s.hook, col2, Math.max(400, second.bottom + 92), 38, 28, C.hook, 400);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SQ}" height="${SQ}" viewBox="0 0 ${SQ} ${SQ}">
  <rect width="${SQ}" height="${SQ}" fill="${C.paper}"/>
  ${illustration(s.shot, bandW, 0, SQ - bandW, SQ, 'sq')}
  <rect x="0" y="0" width="${bandW}" height="${SQ}" fill="${C.paper}"/>
  <rect x="${bandW}" y="0" width="2" height="${SQ}" fill="${C.rule}"/>
    ${title.svg}
    ${secondSvg}
    ${hook.svg}
  <rect x="56" y="${SQ - 152}" width="84" height="84" rx="7" fill="${C.seal}"/>
  <text x="98" y="${SQ - 94}" font-family="${SC}" font-weight="500" font-size="47"
        fill="${C.sealInk}" text-anchor="middle">醒</text>
  <text x="168" y="${SQ - 116}" font-family="${SC}" font-weight="400" font-size="27" fill="${C.label}">${esc(s.slot ?? '深夜档')}</text>
  <text x="168" y="${SQ - 82}" font-family="${SC}" font-weight="400" font-size="27" fill="${C.label}">${esc(s.label ?? '')}</text>
  <rect x="0" y="${SQ - 14}" width="${SQ}" height="14" fill="${shot.band}"/>
</svg>`;
}

function png(svg: string, width: number): Buffer {
  return new Resvg(svg, {
    font: { loadSystemFonts: FONT_FILES.length === 0, fontFiles: FONT_FILES, defaultFontFamily: SC },
    fitTo: { mode: 'width', value: width },
  })
    .render()
    .asPng();
}

interface PubDoc {
  book: string;
  author: string;
  shot: string;
  titleLang?: 'sc' | 'jp';
  cover: { hook: string; label: string };
  parts: { part: string; partName?: string; epTitle: string; hook: string; title: string; duration: string }[];
}

/** 出一套四张：横版上传 + 微信方版 + 两张缩略图自检 */
function emit(dir: string, spec: CoverSpec, headline: string) {
  mkdirSync(dir, { recursive: true });
  const svg = coverSvg(spec);
  writeFileSync(`${dir}/cover.svg`, svg);
  writeFileSync(`${dir}/upload-1280x720.png`, png(svg, CW));
  // 片头那一帧。**必须跟场景图同尺寸（1920×1080）**：concat 解复用器碰上
  // 分辨率不一样的图会**静默丢掉**，不报错 —— 第一版用 1280 的那张，
  // 封面根本没进片子，是逐帧量亮度才发现的。
  writeFileSync(`${dir}/first-frame-1920x1080.png`, png(svg, 1920));
  // 210 = 手机首页缩略图的实际宽度。**先看这张再上传**
  writeFileSync(`${dir}/check-210.png`, png(svg, 210));

  const sq = coverSquareSvg(spec);
  writeFileSync(`${dir}/cover-square.svg`, sq);
  writeFileSync(`${dir}/wechat-1080x1080.png`, png(sq, SQ));
  writeFileSync(`${dir}/check-square-200.png`, png(sq, 200));

  console.log(`${headline}`);
  console.log(`  主位「${leadOf(spec)}」　副题「${spec.hook}」`);
  console.log(`  → ${dir}/upload-1280x720.png　＋ wechat-1080x1080.png（微信 1:1）`);
  console.log(`  → ${dir}/check-210.png　**先看这张**，主位笔画分不分得开`);
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.indexOf('--part') >= 0 ? argv[argv.indexOf('--part') + 1] : null;
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;
  const common = { book: doc.book, author: doc.author, shot: doc.shot, titleLang: doc.titleLang };

  // 总封面：整本一张，书名占主位。播放列表 / 专辑 / 频道橱窗用
  if (!only || only === '总')
    emit(
      `${PROJ}/cover/总`,
      { ...common, kind: 'book', hook: doc.cover.hook, label: doc.cover.label },
      `《${doc.book}》总封面（整本，书名占主位）`
    );

  // 分期封面：期标题占主位，书名退到第二列
  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    emit(
      `${PROJ}/cover/${p.part}`,
      { ...common, kind: 'episode', epTitle: p.epTitle, hook: p.hook, part: p.part, label: p.partName ?? `${p.part}篇` },
      `《${doc.book}》${p.part}篇（期标题占主位，书名第二列）`
    );
  }
}

if (process.argv[1]?.includes('zhiyu-cover')) main();
