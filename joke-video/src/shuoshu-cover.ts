// ── 说书封面：视频第一帧，也是平台抓的缩略图 ──────────────────────────
//
// 用法：npx tsx src/shuoshu-cover.ts --ep E01
//
// **每期必出，不是可选项。** 缩略图决定点不点开——正片做得再好，封面糊了没人看见。
//
// ── 这一版的来历 ──
//
// 第一版是拿正片那套宣纸水墨直接改大字号做的，出来是"浅底淡墨"，
// 缩到手机信息流里整张发白，什么都看不出。**封面和正片是两个东西**：
// 正片求耐看（十七分钟连着看），封面求一眼抓住（0.5 秒，指甲盖大小）。
//
// 现在这版把 `liaozhai-cover` 那个原型的思路整套搬过来：
//
//   · **夜靛青底 + 朱砂**，不是宣纸白。深底才压得住，缩小了也不糊
//   · **篇名用繁体竖排巨字**占满左三分之一（畫皮 / 聶小倩）
//   · **一笔画的主体符号**穿过画面中央（E01 是画到一半的侧脸）
//   · 右侧一栏：书系名 / 细线 / 两行钩子 / 期号
//   · 右上角一方朱印
//
// ── 四条铁律（照搬，不要自作主张改）──
//
//   ① **元素不超过四个**：篇名、符号、钩子、印章。想加东西之前先删一个
//   ② **强调色只用在一个地方**。缩到 320px 读者只来得及看一个焦点，
//      同一张图两处强调 = 两处都失效
//   ③ **标题按左缘定位，不按中心线**。两字和三字字号不同，按中心排会
//      让边距忽宽忽窄
//   ④ **先看 320 那张再上传**。在 1280 上好看不算数
//
// ── 影响范围 ──
//
// **只有说书线。** 段子视频的封面在 `cover.ts`，那条线一个字没动；
// 这里的配色也自成一套，不碰 `style/palette.ts` 和 `style/inkwash.ts`
// （后者是正片画面的，浅底；封面是深底，两码事）。

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { resolveEp } from './shuoshu-ep.js';

/** 视频是 1920×1080，封面同尺寸才能直接当第一帧用 */
export const CW = 1920;
export const CH = 1080;

/** 微信那张的边长。1:1，发公众号 / 视频号用 */
export const SQ = 1080;

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => Math.round(v * 100) / 100;

/** 版式：全是相对画布的比例，改尺寸不用重排 */
const LAYOUT = {
  titleLeft: 0.05,
  titleLineGap: 1.05,
  textLeft: 0.66,
  textRight: 0.955,
  labelY: 0.245,
  ruleY: 0.335,
  hook1Y: 0.4,
  hook2Y: 0.53,
  epY: 0.7,
  sealX: 0.892,
  sealY: 0.062,
  sealSize: 0.115,
};

/** 字号（相对画布高度）。篇名按字数查表，不同长度占据相近的高度 */
const FONT = {
  titleByLength: { 2: 0.335, 3: 0.245, 4: 0.196, 5: 0.162, 6: 0.138 } as Record<number, number>,
  label: 0.052,
  hook: 0.088,
  ep: 0.045,
  seal: 0.34,
};

// ── 字体 ──────────────────────────────────────────────────────────────
//
// **静态字重的字体文件放在仓库 `fonts/` 下，不依赖系统装了什么。**
// resvg 对可变字体的 weight 轴支持有限：机器上只有 NotoSerifSC-VF.ttf 时，
// 写 font-weight="900" 渲出来其实是 Regular。换成这一套静态 OTF 之后，
// 900 拿到的是真 Black、500 拿到的是真 Medium，标题在 320 自检图上才立得住。
//
// 七个文件的 typographic family 都是 `Noto Serif CJK SC`，
// fontdb 按 OS/2 的 weight 值分字重，所以**族名只写一个**，靠 font-weight 选。

const FONT_DIR = fileURLToPath(new URL('../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/', import.meta.url));
const FONT_WEIGHTS = ['Black', 'Bold', 'SemiBold', 'Medium', 'Regular', 'Light', 'ExtraLight'];
const FONT_FILES = FONT_WEIGHTS.map((w) => `${FONT_DIR}NotoSerifCJKsc-${w}.otf`).filter((f) => existsSync(f));

const FONT_FAMILY =
  process.env.SHUOSHU_COVER_FONT ||
  (FONT_FILES.length ? 'Noto Serif CJK SC' : 'Noto Serif SC, Noto Serif CJK SC, SimSun, serif');

export interface Palette {
  inkTop: string;
  inkBottom: string;
  accent: string;
  light: string;
  dim: string;
}

/**
 * 书系 = 一套配色 + 栏目名 + 印章形制。**版式骨架全频道统一，换书只换这里。**
 *
 * 为什么不全系列共用一套色：靛青+朱砂是很正的中式志怪调子，
 * 用在西方哥特上会张冠李戴。丛书的通行做法是骨架统一、按类别换色。
 */
export const SERIES: Record<string, { label: string; sealShape: 'square' | 'circle'; palette: Palette }> = {
  liaozhai: {
    label: '聊齋志異',
    sealShape: 'square',
    palette: {
      inkTop: '#0e1b29',
      inkBottom: '#193448',
      accent: '#c5381c', // 朱砂
      light: '#fdf3e4', // 米白
      dim: '#a8b2bc',
    },
  },
  kaidan: {
    label: '日本怪談',
    sealShape: 'square',
    palette: { inkTop: '#12100f', inkBottom: '#2a2320', accent: '#b7402a', light: '#f2ece0', dim: '#a89e92' },
  },
  gothic: {
    label: 'GOTHIC TALES',
    sealShape: 'circle',
    palette: { inkTop: '#0d1512', inkBottom: '#1d2b24', accent: '#b8893f', light: '#f0ead9', dim: '#9aa79c' },
  },
};

// ── 可变线宽 ──────────────────────────────────────────────────────────
//
// **SVG 单条 path 的 stroke-width 是常量**，做不出笔锋。
// 所以把曲线切成十几段，每段给自己的宽度和颜色，round 端点让接缝看不出来。

type Pt = [number, number];

export function catmullSegments(pts: Pt[]): { d: string; t: number }[] {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const segs: { d: string; t: number }[] = [];
  for (let i = 0; i < P.length - 3; i++) {
    const [p0, p1, p2, p3] = [P[i], P[i + 1], P[i + 2], P[i + 3]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    segs.push({
      d: `M${n(p1[0])},${n(p1[1])} C${n(c1[0])},${n(c1[1])} ${n(c2[0])},${n(c2[1])} ${n(p2[0])},${n(p2[1])}`,
      t: (i + 0.5) / (P.length - 3),
    });
  }
  return segs;
}

export function strokePath(
  segs: { d: string; t: number }[],
  width: (t: number) => number,
  paint: (t: number) => { color: string; opacity: number }
): string {
  return segs
    .map((s) => {
      const { color, opacity } = paint(s.t);
      return `<path d="${s.d}" fill="none" stroke="${color}" stroke-opacity="${n(opacity)}" stroke-width="${n(width(s.t))}" stroke-linecap="round"/>`;
    })
    .join('\n');
}

/** 米白 → 朱砂的插值，给"画到一半"的笔锋用 */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a);
  const [br, bg, bb] = p(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * Math.min(Math.max(t, 0), 1));
  return `#${[m(ar, br), m(ag, bg), m(ab, bb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * **描边补字重——只在没有字体文件时才用的退路。**
 *
 * `fonts/` 里有 Black 静态字重时，font-weight="900" 拿到的就是真 Black，
 * 不必再描边。描边本来就是次优解：它把「畫」这种密笔画的字内白往死里糊，
 * 缩略图上容易变成一团黑。**有真字重就关掉。**
 *
 * 退路留着（换台机器、字体没跟着走）：描一圈同色边撑粗笔画，字号的 2% 封顶。
 */
const BOLDEN = FONT_FILES.length ? 0 : 0.021;

/** 竖排：逐字定位。writing-mode 在各渲染器下表现不一，逐字最稳 */
function vText(chars: string, cx: number, top: number, size: number, color: string, gap: number): string {
  return [...chars]
    .map(
      (ch, i) =>
        `<text x="${n(cx)}" y="${n(top + size * gap * i + size * 0.82)}" font-family="${FONT_FAMILY}" font-weight="900" font-size="${n(size)}" fill="${color}" fill-opacity="0.99" stroke="${color}" stroke-width="${n(size * BOLDEN)}" stroke-opacity="0.99" text-anchor="middle">${esc(ch)}</text>`
    )
    .join('\n');
}

/** 横排钩子，指定的字用强调色 */
function hookText(line: string, x: number, y: number, size: number, base: string, accent: string, accentChars: string): string {
  let cx = x;
  const out: string[] = [];
  for (const ch of line) {
    const fill = accentChars && accentChars.includes(ch) ? accent : base;
    out.push(
      `<text x="${n(cx)}" y="${n(y)}" font-family="${FONT_FAMILY}" font-weight="900" font-size="${n(size)}" fill="${fill}" stroke="${fill}" stroke-width="${n(size * BOLDEN)}">${esc(ch)}</text>`
    );
    cx += size;
  }
  return out.join('\n');
}

function commonDefs(C: Palette): string {
  return `
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${C.inkTop}"/>
  <stop offset="1" stop-color="${C.inkBottom}"/>
</linearGradient>
<filter id="grain" x="0" y="0" width="100%" height="100%">
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="7" result="n"/>
  <feColorMatrix in="n" type="matrix"
    values="0 0 0 0 0.99  0 0 0 0 0.95  0 0 0 0 0.89  0.055 0.055 0.055 0 0"/>
</filter>
<filter id="sealAged">
  <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" seed="11" result="t"/>
  <feDisplacementMap in="SourceGraphic" in2="t" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
</filter>`;
}

// ── 主体符号 ──────────────────────────────────────────────────────────

type Motif = (C: Palette) => { defs: string; body: string };

/**
 * E01《画皮》—— 一笔画到一半的侧脸。
 *
 * 额头起笔是米白（皮已经成形），到唇下转朱砂并渐渐化空（**正在被画出来**）。
 * 整张封面的意思全在这一笔上：那张脸是画的。
 */
const PROFILE: Pt[] = [
  [0.36, 0.03], [0.22, 0.08], [0.145, 0.17], [0.118, 0.26],
  [0.138, 0.315], [0.098, 0.365], [0.108, 0.415], [0.03, 0.515],
  [0.116, 0.552], [0.112, 0.592], [0.14, 0.628], [0.126, 0.658],
  [0.148, 0.698], [0.142, 0.742], [0.196, 0.798], [0.3, 0.852],
  [0.45, 0.882],
];

const motifFace: Motif = (C) => {
  const ox = CW * 0.415;
  const oy = -CH * 0.075; // 上端顶出画面，缩略图里更满
  const fh = CH * 1.22;
  const fw = fh * 0.86;
  const pts: Pt[] = PROFILE.map(([x, y]) => [ox + x * fw, oy + y * fh]);
  const segs = catmullSegments(pts);

  // 笔锋：起笔轻、鼻唇段饱满、收笔提起
  const k = CH / 720; // 参考原型是 720 高，线宽跟着缩放
  const width = (t: number) => (4.0 + 7.4 * Math.pow(Math.sin(Math.PI * Math.min(t * 1.15, 1)), 0.8)) * k;
  const paint = (t: number) => {
    if (t < 0.62) return { color: C.light, opacity: 0.94 };
    const q = (t - 0.62) / 0.38;
    return { color: mixHex(C.light, C.accent, Math.min(q * 1.6, 1)), opacity: 0.94 * Math.pow(1 - q, 0.75) + 0.09 };
  };

  const eyeX = ox + 0.175 * fw;
  const eyeY = oy + 0.404 * fh;
  return {
    defs: '',
    body: `<g>
${strokePath(segs, width, paint)}
<line x1="${n(eyeX)}" y1="${n(eyeY)}" x2="${n(eyeX + fw * 0.085)}" y2="${n(eyeY)}" stroke="${C.light}" stroke-opacity="0.76" stroke-width="${n(6 * k)}" stroke-linecap="round"/>
</g>`,
  };
};

/** E02《聂小倩》—— 兰若寺的孤灯。焰被风吹得向左偏，暗示门外有人 */
const motifLamp: Motif = (C) => {
  const k = CH / 720;
  const cx = CW * 0.47;
  const tipX = cx - CW * 0.036;
  const tipY = CH * 0.232;
  const bl = cx - CW * 0.023;
  const br = cx + CW * 0.023;
  const by0 = CH * 0.48;
  const flame =
    `M${n(bl)},${n(by0)} ` +
    `C${n(bl - CW * 0.019)},${n(by0 - (by0 - tipY) * 0.45)} ${n(tipX - CW * 0.014)},${n(tipY + (by0 - tipY) * 0.3)} ${n(tipX)},${n(tipY)} ` +
    `C${n(tipX + CW * 0.02)},${n(tipY + (by0 - tipY) * 0.3)} ${n(br + CW * 0.022)},${n(by0 - (by0 - tipY) * 0.45)} ${n(br)},${n(by0)} Z`;
  return {
    defs: `<radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${C.accent}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${C.accent}" stop-opacity="0"/>
    </radialGradient>`,
    body: `<g>
<ellipse cx="${n(cx)}" cy="${n(CH * 0.38)}" rx="${n(CW * 0.13)}" ry="${n(CH * 0.24)}" fill="url(#halo)"/>
<path d="${flame}" fill="${C.light}" fill-opacity="0.9"/>
<path d="M${n(cx - CW * 0.05)},${n(CH * 0.5)} L${n(cx + CW * 0.05)},${n(CH * 0.5)} L${n(cx + CW * 0.032)},${n(CH * 0.56)} L${n(cx - CW * 0.032)},${n(CH * 0.56)} Z" fill="${C.light}" fill-opacity="0.5"/>
<line x1="${n(cx)}" y1="${n(CH * 0.56)}" x2="${n(cx)}" y2="${n(CH * 0.86)}" stroke="${C.light}" stroke-opacity="0.45" stroke-width="${n(3.6 * k)}"/>
</g>`,
  };
};

export const MOTIFS: Record<string, Motif> = { 侧脸: motifFace, 孤灯: motifLamp };

// ── 拼图 ──────────────────────────────────────────────────────────────

export interface CoverSpec {
  /** 书系 key，见 SERIES。默认 liaozhai */
  series?: string;
  /** 篇名，2~6 字。**用繁体**，跟栏目名一致 */
  title: string;
  /** 钩子两行，各 6 字最整齐。**写故事里最反常的那个动作，不写形容词** */
  hook1: string;
  hook2: string;
  /** 用强调色的字。**一个就够**，多了就不叫重点 */
  accent: string;
  /** 右上角印章，竖排两字 */
  seal: string;
  /** 期号那一行 */
  epLabel: string;
  /** 主体符号，见 MOTIFS */
  motif: string;
}

export function coverSvg(spec: CoverSpec): string {
  const series = SERIES[spec.series ?? 'liaozhai'];
  if (!series) throw new Error(`没有这个书系：${spec.series}\n可用：${Object.keys(SERIES).join(' / ')}`);
  const motif = MOTIFS[spec.motif];
  if (!motif) throw new Error(`没有这个封面符号：${spec.motif}\n可用：${Object.keys(MOTIFS).join(' / ')}`);
  const C = series.palette;
  const m = motif(C);

  const chars = [...spec.title];
  const size = CH * (FONT.titleByLength[chars.length] ?? FONT.titleByLength[6]);
  // **按左缘定位**：字数变了边距不变
  const cx = CW * LAYOUT.titleLeft + size / 2;
  const top = (CH - chars.length * size * LAYOUT.titleLineGap) / 2;

  const textX = CW * LAYOUT.textLeft;
  // ── 钩子超宽就整体缩字号 ──────────────────────────────────────────
  //
  // 钩子从 textLeft 起横排、每字前进一个字号，右边界是 textRight（那条细线的右端）。
  // 1280 宽上算下来**最多六个字**：第七个字会顶出画外。
  //
  // **E04《促织》两行钩子各被切掉一个字**（「一隻蟲值多少錢」的錢、
  // 「一個九歲的孩子」的子），出片、上传之后才用眼睛看出来 ——
  // 又是一次"跑完了、文件都在、但东西是错的"。已出片的不回改，代码要堵住。
  //
  // 两行取同一个字号（按长的那行算）。分别缩会出现上行大下行小，比切字还难看。
  const hookMaxW = CW * LAYOUT.textRight - textX;
  const hookLen = Math.max([...spec.hook1].length, [...spec.hook2].length);
  const hookSize = Math.min(CH * FONT.hook, hookMaxW / hookLen);
  const spacing = /[A-Z]/.test(series.label) ? 4 : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CW}" height="${CH}" viewBox="0 0 ${CW} ${CH}">
<defs>
${commonDefs(C)}
${m.defs}
</defs>
<rect width="${CW}" height="${CH}" fill="url(#bg)"/>
${m.body}
<!-- 颗粒盖在符号之上、文字之下 -->
<rect width="${CW}" height="${CH}" filter="url(#grain)"/>
${vText(spec.title, cx, top, size, C.light, LAYOUT.titleLineGap)}
<text x="${n(textX)}" y="${n(CH * LAYOUT.labelY + CH * FONT.label * 0.82)}" font-family="${FONT_FAMILY}" font-weight="500" font-size="${n(CH * FONT.label)}" fill="${C.dim}" fill-opacity="0.84" letter-spacing="${spacing}">${esc(series.label)}</text>
<line x1="${n(textX)}" y1="${n(CH * LAYOUT.ruleY)}" x2="${n(CW * LAYOUT.textRight)}" y2="${n(CH * LAYOUT.ruleY)}" stroke="${C.dim}" stroke-opacity="0.37" stroke-width="${n(2 * (CH / 720))}"/>
${hookText(spec.hook1, textX, CH * LAYOUT.hook1Y + hookSize * 0.82, hookSize, C.light, C.accent, spec.accent)}
${hookText(spec.hook2, textX, CH * LAYOUT.hook2Y + hookSize * 0.82, hookSize, C.light, C.accent, spec.accent)}
<text x="${n(textX)}" y="${n(CH * LAYOUT.epY + CH * FONT.ep * 0.82)}" font-family="${FONT_FAMILY}" font-weight="500" font-size="${n(CH * FONT.ep)}" fill="${C.dim}" fill-opacity="0.75">${esc(spec.epLabel)}</text>
${sealMark(spec.seal, series)}
</svg>`;
}

// ── 1:1（微信）──────────────────────────────────────────────────────
//
// **不是把 16:9 裁成方的。** 横版的版式是横着长的：篇名占左三分之一、
// 符号穿过中间、右边一整栏是书系名/细线/两行钩子/期号。裁成方的，右边那栏就没了。
// 所以方版是**另排一版**，共用配色、符号和篇名，版式重新来。
//
// ── 方版为什么元素更少 ──
//
// 微信列表里这张图显示出来大约 120–200px，比 320 的自检图还小一半。
// 铁律②（强调色只用在一个地方）在这个尺寸上变成更狠的一条：
// **来得及看的只有一样东西**。所以两行钩子、书系名、细线全部拿掉——
// 那些字在 150px 上是噪点，不是信息。剩下四样：篇名 · 符号 · 朱印 · 期号。
//
// 钩子不是丢了：微信里这张图**旁边就是文章标题**，钩子由标题那行字去承担。
//
// 符号直接复用横版的（同一个 MOTIFS），套一层 transform 搬进方画布——
// 这样横版的输出一个像素都不会动。

const SQ_LAYOUT = {
  titleLeft: 0.07,
  titleLineGap: 1.05,
  sealX: 0.795,
  sealY: 0.055,
  sealSize: 0.132,
  epX: 0.40,
  epY: 0.935,
  /**
   * 符号**不缩放**，只做横向重定位。
   *
   * 方画布和横画布一样高（都是 1080），所以原样搬过来，每个符号自己的
   * 纵向构图就原封不动——侧脸照旧顶出画面上沿，孤灯的杆子照旧落到画面下部。
   * 试过缩到 0.78 居中，结果灯杆悬在半空中间，像根棍子上插了个火苗。
   *
   * 两个符号的重心横坐标都在 x≈950 附近（侧脸 ox=797 起、孤灯 cx=902），
   * 按这一个点对位就够，不用每加一个符号调一次。
   */
  motifRefX: 950,
  motifCX: 0.66,
};

export function coverSquareSvg(spec: CoverSpec): string {
  const series = SERIES[spec.series ?? 'liaozhai'];
  if (!series) throw new Error(`没有这个书系：${spec.series}`);
  const motif = MOTIFS[spec.motif];
  if (!motif) throw new Error(`没有这个封面符号：${spec.motif}`);
  const C = series.palette;
  const m = motif(C);

  const chars = [...spec.title];
  const size = SQ * (FONT.titleByLength[chars.length] ?? FONT.titleByLength[6]);
  const cx = SQ * SQ_LAYOUT.titleLeft + size / 2;
  const top = (SQ - chars.length * size * SQ_LAYOUT.titleLineGap) / 2;

  const dx = SQ * SQ_LAYOUT.motifCX - SQ_LAYOUT.motifRefX;

  const epSize = SQ * 0.038;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SQ}" height="${SQ}" viewBox="0 0 ${SQ} ${SQ}">
<defs>
${commonDefs(C)}
${m.defs}
</defs>
<rect width="${SQ}" height="${SQ}" fill="url(#bg)"/>
<g transform="translate(${n(dx)},0)">
${m.body}
</g>
<rect width="${SQ}" height="${SQ}" filter="url(#grain)"/>
${vText(spec.title, cx, top, size, C.light, SQ_LAYOUT.titleLineGap)}
<text x="${n(SQ * SQ_LAYOUT.epX)}" y="${n(SQ * SQ_LAYOUT.epY)}" font-family="${FONT_FAMILY}" font-weight="500" font-size="${n(epSize)}" fill="${C.dim}" fill-opacity="0.7">${esc(spec.epLabel)}</text>
${sealMark(spec.seal, series, SQ * SQ_LAYOUT.sealX, SQ * SQ_LAYOUT.sealY, SQ * SQ_LAYOUT.sealSize)}
</svg>`;
}

/** 期号章：中式书系用方印（白文），西式用圆章（描边） */
function sealMark(
  chars: string,
  series: (typeof SERIES)[string],
  xIn = CW * LAYOUT.sealX,
  yIn = CH * LAYOUT.sealY,
  sizeIn = CH * LAYOUT.sealSize
): string {
  const C = series.palette;
  const circle = series.sealShape === 'circle';
  const s = sizeIn;
  const x = xIn;
  const y = yIn;
  const fs = s * FONT.seal;
  const shape = circle
    ? `<circle cx="${n(x + s / 2)}" cy="${n(y + s / 2)}" r="${n(s / 2)}" fill="none" stroke="${C.accent}" stroke-width="${n(s * 0.07)}" stroke-opacity="0.95"/>`
    : `<rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}" rx="${n(s * 0.1)}" fill="${C.accent}" fill-opacity="0.94"/>`;
  const glyphs = [...chars]
    .map(
      (ch, i) =>
        `<text x="${n(x + s / 2)}" y="${n(y + (s * (i + 0.5)) / chars.length + fs * 0.35)}" font-family="${FONT_FAMILY}" font-weight="900" font-size="${n(fs)}" fill="${circle ? C.accent : '#fff8f0'}" text-anchor="middle">${esc(ch)}</text>`
    )
    .join('\n');
  return `<g filter="url(#sealAged)">${shape}${glyphs}</g>`;
}

function png(svg: string, width: number): Buffer {
  return new Resvg(svg, {
    font: {
      // 有仓库字体就只认仓库字体：系统里的同名族会抢，渲出来的字重不可控
      loadSystemFonts: FONT_FILES.length === 0,
      fontFiles: FONT_FILES,
      defaultFontFamily: FONT_FAMILY.split(',')[0].trim(),
    },
    fitTo: { mode: 'width', value: width },
  })
    .render()
    .asPng();
}

function main() {
  const { dir } = resolveEp(process.argv.slice(2));
  const specPath = `${dir}/scenes.json`;
  if (!existsSync(specPath)) throw new Error(`没有 ${specPath}`);
  const doc = JSON.parse(readFileSync(specPath, 'utf8')) as { cover?: CoverSpec };
  if (!doc.cover)
    throw new Error(
      `${specPath} 里没有 cover 字段。加一段：\n` +
        `  "cover": { "title": "畫皮", "hook1": "他明知她是鬼", "hook2": "還是帶她回家",\n` +
        `             "accent": "鬼", "seal": "其一", "epLabel": "夜聽說書 · 第一則", "motif": "侧脸" }`
    );

  const svg = coverSvg(doc.cover);
  mkdirSync(`${dir}/cover`, { recursive: true });
  writeFileSync(`${dir}/cover/cover.svg`, svg);
  writeFileSync(`${dir}/cover.png`, png(svg, CW)); // 1920：视频第一帧
  writeFileSync(`${dir}/cover/upload-1280x720.png`, png(svg, 1280)); // 平台上传
  // 320 = 手机信息流里的实际大小。**先看这张再上传**，在 1280 上好看不算数
  writeFileSync(`${dir}/cover/check-320.png`, png(svg, 320));

  // 1:1，微信公众号 / 视频号。**先看 200 那张**——微信列表里就那么大
  const sq = coverSquareSvg(doc.cover);
  writeFileSync(`${dir}/cover/wechat-1080x1080.png`, png(sq, SQ));
  writeFileSync(`${dir}/cover/check-square-200.png`, png(sq, 200));
  writeFileSync(`${dir}/cover/cover-square.svg`, sq);

  console.log(`《${doc.cover.title}》${doc.cover.epLabel}`);
  console.log(`  ${doc.cover.hook1} / ${doc.cover.hook2}　强调「${doc.cover.accent}」`);
  console.log(`\n→ ${dir}/cover.png（1920，视频第一帧）`);
  console.log(`→ ${dir}/cover/upload-1280x720.png`);
  console.log(`→ ${dir}/cover/check-320.png　**先看这张**`);
  console.log(`→ ${dir}/cover/cover.svg（矢量源，出专辑封面/印刷尺寸时不用重画）`);
  console.log(`→ ${dir}/cover/wechat-1080x1080.png（1:1，微信）`);
  console.log(`→ ${dir}/cover/check-square-200.png　**方版先看这张**`);
  console.log(`→ ${dir}/cover/cover-square.svg`);
}

if (process.argv[1]?.includes('shuoshu-cover')) main();
