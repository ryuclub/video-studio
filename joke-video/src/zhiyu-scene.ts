// ── 治愈档片内画面：镜位轮换 + 底部进度线 ────────────────────────────
//
// 用法：npx tsx src/zhiyu-scene.ts --ep makura
//       npx tsx src/zhiyu-scene.ts --ep makura --part 上
//
// ── 这套东西跟封面是反的，别拿封面参数糊过来 ──
//
// 封面要在一屏十二个视频里被点开，所以去窗框、主体放大一倍、色阶四层以上。
// **片内的任务正相反：让人不想切走。** 二十分钟盯着同一张图，
// 任何一处高对比、任何一处「有内容」的地方，都会变成一个让人睁眼的点。
//
//   窗框      片内**有**（固定构件之一），封面去掉
//   主体占比  片内近景不超过画面高 60%，留白档更小；封面放大约一倍
//   色阶      片内同色相 2–3 层、柔和；封面 4 层以上、明暗拉开
//   文字      片内竖排标题 72px SemiBold；封面主位 132px @1280
//
// ── 镜位轮换：《枕草子》逼出来的能力 ──
//
// 《方丈记》画面可承载度 ★★☆☆☆（全书目最低），全程锁「留白」一景不换。
// 《枕草子》是 ★★★★★，选题稿件写着「镜位在远景与近景之间轮换即可」。
//
// 但**轮换不等于勤换**。这是助眠档，规范里反复写着「几乎不动」。
// 所以有一条硬约束：**每个镜位至少撑 `MIN_DWELL` 秒**，排密了直接报错。
// 一期换三四次就够了 —— 换的意义是「这一节翻篇了」，不是「让画面热闹点」。
//
// ── 换镜位不能硬切 ──
//
// 深夜档里一次硬切就是一次睁眼。所以换镜位时插一段**交叉淡化**：
// `BLEND_SEC` 秒切成 `BLEND_STEPS` 张，每张把新旧两景按比例叠一次。
// 淡完再回到常规的 `STEP` 秒一张。
//
// ── 为什么是一叠图而不是一张 ──
//
// 固定构件里有一条**底部细进度线**。静态图出片走 ffmpeg 的 concat，
// 一张图撑一段时长，所以进度线要动就得切成若干张。
// 每 `STEP` 秒一张，二十分钟约四十张 —— 平摊下来每张只前进 2.5%，
// 肉眼几乎察觉不到在动，但想知道还剩多久时低头就能看见。
//
// ── 右边那一栏：章节名 ──
//
// 「现在讲到哪儿了」原先只写在发布页的章节列表里，画面上没有。
// 深夜档中途醒过来一下，抬眼看不出自己在第几节 —— 这一栏补的就是那一眼。
//
// 位置在窗框右边的空白带：**左边书名、右边章节，一重一轻**。
// 它是次要信息，所以比书名小一号（46px vs 72px）、淡一档（`inkDim`）——
// 跟蜗牛同一条道理：会变的那个不能比不动的东西更抢眼。
// **但也别小到读不出来**：34px 那一版（《枕草子》重出的那支片子）反馈是「调大加粗」。
//
// 名字从 `发布.json` 的 `chapters` 来，跟发布页章节列表**同一份数据、同一种定位**
// （那一段的开头几个字）。屏上只取 `｜` 前那半，后半是给发布页看的说明句。
//
// 换章节也不硬切：**先淡出旧的，淡完再淡入新的**，中间空一小下。
// 两条名字在同一个位置交叠是一团糊字，比硬切更糟。

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { resolveEp, DEF, LINE } from './zhiyu-ep.js';
import { mmss } from './zhiyu-audio.js';
import { midPeriodToComma } from './shuoshu-srt.js';

const { dir: PROJ } = resolveEp(process.argv.slice(2));

/** 成片尺寸 */
export const SW = 1920;
export const SH = 1080;
/** 常规每张撑多少秒。进度线每张前进一格 */
export const STEP = 30;
/** 换镜位的交叉淡化：多长、切成几张 */
export const BLEND_SEC = 4;
export const BLEND_STEPS = 8;
/**
 * 一个镜位至少撑多少秒。**这是助眠档的护栏，不是建议。**
 * 排密了直接报错 —— 画面勤换在别的线是丰富，在这条线是把人吵醒。
 */
export const MIN_DWELL = 150;

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v: number) => Math.round(v * 100) / 100;

const FONT_DIR = fileURLToPath(new URL('../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/', import.meta.url));
const FONT_FILES = ['Black', 'Bold', 'SemiBold', 'Medium', 'Regular', 'Light', 'ExtraLight']
  .map((w) => `${FONT_DIR}NotoSerifCJKsc-${w}.otf`)
  .filter((f) => existsSync(f));
const SC = 'Noto Serif CJK SC';

/**
 * 片内色板。**跟封面不是一套** —— 封面那套明暗拉得开，搬过来会在深夜刺眼。
 * 这里同色相只走 2–3 层，最深的主体跟背景差不到两档。
 *
 * 基准是治愈档。**心理线只覆盖要变的那几个**（下面 PALETTES），
 * 不重抄一份 —— 重抄的话骨架色（窗框、格栅、和纸）迟早分叉。
 */
const BASE = {
  paper: '#F6F2E8',
  paperEdge: '#EFEADA',
  frame: '#DCD3BF',
  muntin: '#E4DDCB',
  skyTop: '#F1ECDE',
  skyBottom: '#E9E5D5',
  far: '#E2E5DC',
  ridge: '#DCE1D6',
  ground: '#CBD4C8',
  subject: '#B3C0B4',
  ink: '#5A6E66',
  inkDim: '#8A9184',
  seal: '#BE7060',
  sealInk: '#F6F2E8',
  track: '#E6DFCD',
  fill: '#9CC3BF',
  /** 进度线上的蜗牛。比标题浅一档 —— 它是会动的那个，不能比不动的东西更抢眼 */
  snail: '#8A9184',
};

// 色板差量搬到了 zhiyu-lines.ts —— 那是三条线全部差异的唯一出处。
//
// **导出去是给文字层用的**（`xinli-text.ts` 的字要跟景同色）。
// 那边原来把 `#3F4A52` / `#F4F1EA` 抄成了两个常量，注释还写着
// 「改那边这儿要跟着改」—— 那句话就是分叉的预告。换条线立刻兑现：
// 禅佛典是赭石，抄来的那两个值会在暖色的景上写出一行冷灰的字。
export const C = { ...BASE, ...DEF.palette };

/** 版式。1920×1080 */
const L = {
  win: { x: 430, y: 132, w: 1190, h: 742 },
  frame: 16,
  cols: 3, rows: 2,
  // 标题比规范折算的 54px 大、也更重。标题是这张图上唯一不变的东西 ——
  // 它不闪不动，大一点不会变成睁眼的理由。该压住的是会动的那个：进度线。
  titleCx: 268, titleBase: 322, titleGap: 88, titleSize: 72, titleWeight: 600,
  subCx: 268, subGap: 46, subSize: 34, subWeight: 500,
  // 章节名那一栏：窗框右沿 1636 到画布右边 1920，正中 1778。
  // **顶对齐，不是居中** —— 换章节时字只在下边收放，上边那一头始终不动。
  // 居中的话每换一次名字整块都要挪一挪，而「挪」在这条线上就是一次睁眼。
  // 46px / SemiBold 是 2026-08-21 反馈「调大加粗」之后的值，上一版是 34px / 500。
  // **仍旧压在书名（72px）之下、且用 inkDim 不用 ink** —— 大归大，
  // 它还是会变的那个，不能比不动的东西更抢眼。
  chap: { cx: 1778, top: 196, size: 46, weight: 600, maxH: 660, ruleY: 134, ruleH: 36 },
  sealX: 226, sealY: 852, sealS: 84, sealR: 7,
  bar: { x: 226, y: 1006, w: 1468, h: 3 },
  /** 蜗牛露在线上方多高（px）。宽度按素材比例跟着走，约 1.3 倍 */
  snail: { h: 34 },
};

// ── 进度线上的蜗牛 ────────────────────────────────────────────────────
//
// 它同时是标记和装饰：想知道还剩多久，低头看它爬到哪儿了。
//
// **素材里的蜗牛头朝左，这儿镜像过来。** 进度是往右走的，
// 让它背对着走的方向看着别扭。镜像只在这一处做，素材本身不动。
//
// **var() 必须在这儿换成真值。** 素材写的是 var(--mark, #7B8C7E)，
// 而 resvg 不支持 CSS 自定义属性 —— 直接喂进去那两处颜色会丢，
// 渲出来是黑蜗牛，而且不报错。

const SNAIL_FILE = fileURLToPath(new URL('../../zhiyu/pictures/snail.svg', import.meta.url));

/** 素材坐标系里的三个数：脚底 y、壳顶 y、脚的前端 x */
const SNAIL_FOOT = 88;
const SNAIL_TOP = 37;
const SNAIL_NOSE = 10;

const SNAIL = loadSnail();

function loadSnail(): string {
  if (!existsSync(SNAIL_FILE))
    throw new Error(
      `缺蜗牛素材：${SNAIL_FILE}\n` +
        '它是进度线上的标记，不是可选装饰。少了直接炸 —— ' +
        '静默跳过会出一版没有标记的片子，而这种片子看起来一切正常。'
    );
  const raw = readFileSync(SNAIL_FILE, 'utf8');
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return inner
    .replace(/var\(--mark,\s*[^)]*\)/g, C.snail)
    .replace(/var\(--paper,\s*[^)]*\)/g, C.paper);
}

/** 蜗牛踩在填充的前沿上，身子压在已经走过的那一段 */
function snail(p: number): string {
  const k = L.snail.h / (SNAIL_FOOT - SNAIL_TOP);
  // 整只不越过轨道左端：第一张图的 p 已经有 2-3%，但别指望它永远是
  const tail = (SNAIL_FOOT - SNAIL_NOSE) * k;
  const nose = Math.max(L.bar.x + L.bar.w * p, L.bar.x + tail);
  // 镜像后 x 是反的：素材里 x 越大，画面上越靠左
  const tx = nose + SNAIL_NOSE * k;
  const ty = L.bar.y + L.bar.h - SNAIL_FOOT * k;
  return `<g transform="translate(${n(tx)},${n(ty)}) scale(${n(-k)},${n(k)})">${SNAIL}</g>`;
}

// ── 三种镜位 ──────────────────────────────────────────────────────────
//
// 都只画在窗内，**共用同一套色阶**，差别在「看多远」：
//
//   留白  主体极小，大片空天。内容越接近减法，饱和度越低（方丈记是下限锚点）
//   远景  层层退远的山脊，主体是天和地的分界
//   近景  一枝东西探进画面，占画面高不超过六成
//
// 三个都**不画人、不画事件、不画冲突** —— 这套画风接不住那些，
// 选题稿件「明确画不了的段落」那一节就是为此写的。

/** 治愈线的三个镜位 */
export type ZhiyuShot = '留白' | '远景' | '近景';
/** 心理线的五个镜位。稿源 §七之二 点名的那五样 */
export type XinliShot = '工位' | '电梯' | '会议室' | '屏幕' | '车厢';
/** 禅佛典线的镜位。**古景，不是现代空镜** —— 一期一景，按故事里的东西起名 */
export type ChanShot = '饼摊' | '空墙根';
export type Shot = ZhiyuShot | XinliShot | ChanShot;

function whitespace(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  const cx = x + w * 0.38;
  const gy = y + h * 0.7;
  const rw = w * 0.072, rh = h * 0.062;
  return `
    <path d="M ${X(-0.02)} ${Y(0.6)} Q ${X(0.28)} ${Y(0.55)} ${X(0.58)} ${Y(0.6)}
             T ${X(1.02)} ${Y(0.58)} L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.ridge}"/>
    <path d="M ${X(-0.02)} ${Y(0.78)} Q ${X(0.4)} ${Y(0.74)} ${X(1.02)} ${Y(0.77)}
             L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.ground}"/>
    <path d="M ${n(cx - rw / 2 - w * 0.008)} ${n(gy - rh)} L ${n(cx)} ${n(gy - rh - h * 0.032)}
             L ${n(cx + rw / 2 + w * 0.008)} ${n(gy - rh)} Z" fill="${C.subject}"/>
    <rect x="${n(cx - rw / 2)}" y="${n(gy - rh)}" width="${n(rw)}" height="${n(rh)}" fill="${C.subject}"/>`;
}

/** 远景：三层山脊往里退，天占大半 */
function distant(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  return `
    <ellipse cx="${X(0.74)}" cy="${Y(0.5)}" rx="${n(w * 0.28)}" ry="${n(h * 0.045)}" fill="#F3E9D4" opacity="0.5"/>
    <path d="M ${X(-0.02)} ${Y(0.62)} L ${X(0.16)} ${Y(0.5)} L ${X(0.3)} ${Y(0.6)}
             L ${X(0.52)} ${Y(0.46)} L ${X(0.7)} ${Y(0.61)} L ${X(0.86)} ${Y(0.53)}
             L ${X(1.02)} ${Y(0.63)} L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.far}"/>
    <path d="M ${X(-0.02)} ${Y(0.72)} L ${X(0.22)} ${Y(0.63)} L ${X(0.44)} ${Y(0.71)}
             L ${X(0.66)} ${Y(0.62)} L ${X(0.88)} ${Y(0.72)} L ${X(1.02)} ${Y(0.68)}
             L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.ridge}"/>
    <path d="M ${X(-0.02)} ${Y(0.84)} Q ${X(0.5)} ${Y(0.8)} ${X(1.02)} ${Y(0.83)}
             L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.ground}"/>`;
}

/** 近景：一枝从右上探进来。占画面高不超过六成（规范第一节） */
function closeUp(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  const leaf = (fx: number, fy: number, s: number, rot: number) =>
    `<ellipse cx="${X(fx)}" cy="${Y(fy)}" rx="${n(w * 0.026 * s)}" ry="${n(h * 0.012 * s)}" ` +
    `fill="${C.subject}" opacity="0.85" transform="rotate(${rot} ${X(fx)} ${Y(fy)})"/>`;
  const bud = (fx: number, fy: number, s: number) =>
    `<circle cx="${X(fx)}" cy="${Y(fy)}" r="${n(w * 0.011 * s)}" fill="#E8DCC8"/>`;
  // 中间那条薄雾不是装饰：只有枝子的话，画面下三分之二是空的，
  // 看着像没画完而不是留白。加一层比地面更淡的横带，把空的地方变成「远」
  return `
    <path d="M ${X(-0.02)} ${Y(0.63)} Q ${X(0.45)} ${Y(0.6)} ${X(1.02)} ${Y(0.62)}
             L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.far}"/>
    <path d="M ${X(-0.02)} ${Y(0.76)} Q ${X(0.5)} ${Y(0.73)} ${X(1.02)} ${Y(0.75)}
             L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.ridge}"/>
    <path d="M ${X(-0.02)} ${Y(0.88)} Q ${X(0.5)} ${Y(0.86)} ${X(1.02)} ${Y(0.87)}
             L ${X(1.02)} ${Y(1.02)} L ${X(-0.02)} ${Y(1.02)} Z" fill="${C.ground}"/>
    <path d="M ${X(1.02)} ${Y(0.06)} C ${X(0.78)} ${Y(0.14)} ${X(0.6)} ${Y(0.24)} ${X(0.34)} ${Y(0.3)}"
          stroke="${C.subject}" stroke-width="${n(h * 0.012)}" fill="none" stroke-linecap="round"/>
    <path d="M ${X(0.72)} ${Y(0.17)} C ${X(0.68)} ${Y(0.28)} ${X(0.66)} ${Y(0.36)} ${X(0.62)} ${Y(0.45)}"
          stroke="${C.subject}" stroke-width="${n(h * 0.007)}" fill="none" stroke-linecap="round" opacity="0.9"/>
    ${leaf(0.86, 0.13, 1.1, -18)}${leaf(0.7, 0.21, 1, -8)}${leaf(0.55, 0.27, 0.9, 6)}
    ${leaf(0.64, 0.38, 0.8, 24)}${leaf(0.42, 0.3, 0.85, 12)}
    ${bud(0.79, 0.18, 1)}${bud(0.6, 0.32, 0.9)}${bud(0.48, 0.29, 0.8)}`;
}


// ── 心理线的五个镜位：现代实景空镜 ────────────────────────────────────
//
// 稿源 §七之二：工位、电梯、会议室的空桌、亮着的屏幕、通勤车厢。
// **不出现人脸，不出现可辨认的品牌与公司名。**
//
// 画法跟治愈那三个是同一套纪律，不是同一套内容：
// 色阶 2–3 层、没有焦点、主体不超过窗高六成、全是平涂没有渐变。
// **「现代」指的是画的东西，不是画法。** 一旦用上 UI 图标那种描边和圆角，
// 这张图就从「一间没人的办公室」变成「一张示意图」，深夜里那是两回事。
//
// 五个都刻意留了大片空 —— 空的地方比画的地方多，是这条线的正脸。

/** 工位：一张桌面、一块背对着的屏、一个杯子。人不在 */
function desk(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  return `
    <rect x="${X(0)}" y="${Y(0.62)}" width="${n(w)}" height="${n(h * 0.38)}" fill="${C.ground}"/>
    <rect x="${X(0.28)}" y="${Y(0.24)}" width="${n(w * 0.34)}" height="${n(h * 0.3)}" rx="4" fill="${C.subject}"/>
    <rect x="${X(0.43)}" y="${Y(0.54)}" width="${n(w * 0.04)}" height="${n(h * 0.06)}" fill="${C.subject}"/>
    <rect x="${X(0.37)}" y="${Y(0.6)}" width="${n(w * 0.16)}" height="${n(h * 0.022)}" rx="3" fill="${C.subject}"/>
    <rect x="${X(0.3)}" y="${Y(0.66)}" width="${n(w * 0.3)}" height="${n(h * 0.045)}" rx="3" fill="${C.ridge}"/>
    <rect x="${X(0.68)}" y="${Y(0.645)}" width="${n(w * 0.05)}" height="${n(h * 0.065)}" rx="3" fill="${C.ridge}"/>`;
}

/** 电梯：两扇合着的门、一列按钮、门上方的楼层条 */
function elevator(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  const dots = Array.from({ length: 6 }, (_, i) =>
    `<circle cx="${X(0.79)}" cy="${Y(0.4 + i * 0.075)}" r="${n(w * 0.013)}" fill="${i === 2 ? C.subject : C.ridge}"/>`
  ).join('\n    ');
  return `
    <rect x="${X(0.1)}" y="${Y(0.12)}" width="${n(w * 0.56)}" height="${n(h * 0.88)}" fill="${C.ridge}"/>
    <rect x="${X(0.377)}" y="${Y(0.12)}" width="${n(w * 0.006)}" height="${n(h * 0.88)}" fill="${C.ground}"/>
    <rect x="${X(0.1)}" y="${Y(0.12)}" width="${n(w * 0.56)}" height="${n(h * 0.018)}" fill="${C.ground}"/>
    <rect x="${X(0.26)}" y="${Y(0.05)}" width="${n(w * 0.24)}" height="${n(h * 0.045)}" rx="3" fill="${C.subject}"/>
    <rect x="${X(0.745)}" y="${Y(0.33)}" width="${n(w * 0.09)}" height="${n(h * 0.5)}" rx="6" fill="${C.ridge}"/>
    ${dots}`;
}

/** 会议室：一张长桌、几把椅背。椅子都空着，且没有一把是正对的 */
function meeting(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  const chairs = [0.2, 0.36, 0.52, 0.68]
    .map((f, i) =>
      `<rect x="${X(f)}" y="${Y(i % 2 ? 0.44 : 0.46)}" width="${n(w * 0.08)}" height="${n(h * 0.11)}" rx="4" fill="${C.subject}"/>`
    )
    .join('\n    ');
  return `
    <rect x="${X(0)}" y="${Y(0.72)}" width="${n(w)}" height="${n(h * 0.28)}" fill="${C.ground}"/>
    ${chairs}
    <ellipse cx="${X(0.47)}" cy="${Y(0.63)}" rx="${n(w * 0.36)}" ry="${n(h * 0.1)}" fill="${C.subject}"/>
    <ellipse cx="${X(0.47)}" cy="${Y(0.615)}" rx="${n(w * 0.34)}" ry="${n(h * 0.085)}" fill="${C.ridge}"/>
    <rect x="${X(0.42)}" y="${Y(0.6)}" width="${n(w * 0.06)}" height="${n(h * 0.014)}" rx="2" fill="${C.subject}"/>`;
}

/** 亮着的屏幕：屋里暗，只有那一块比周围亮。这条线的正题镜位 */
function screen(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  const lines = Array.from({ length: 4 }, (_, i) =>
    `<rect x="${X(0.4)}" y="${Y(0.36 + i * 0.06)}" width="${n(w * (i === 3 ? 0.1 : 0.2 - i * 0.02))}" height="${n(h * 0.018)}" rx="2" fill="${C.ridge}"/>`
  ).join('\n    ');
  return `
    <rect x="${X(0)}" y="${Y(0.68)}" width="${n(w)}" height="${n(h * 0.32)}" fill="${C.ground}"/>
    <rect x="${X(0.34)}" y="${Y(0.26)}" width="${n(w * 0.32)}" height="${n(h * 0.38)}" rx="5" fill="${C.subject}"/>
    <rect x="${X(0.355)}" y="${Y(0.28)}" width="${n(w * 0.29)}" height="${n(h * 0.34)}" rx="3" fill="${C.skyTop}"/>
    ${lines}
    <rect x="${X(0.46)}" y="${Y(0.64)}" width="${n(w * 0.08)}" height="${n(h * 0.03)}" fill="${C.subject}"/>
    <rect x="${X(0.4)}" y="${Y(0.67)}" width="${n(w * 0.2)}" height="${n(h * 0.016)}" rx="3" fill="${C.subject}"/>`;
}

/** 通勤车厢：一排车窗、一条扶手、几个吊环、下面的长椅 */
function carriage(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  const wins = [0.06, 0.3, 0.54, 0.78]
    .map((f) => `<rect x="${X(f)}" y="${Y(0.2)}" width="${n(w * 0.16)}" height="${n(h * 0.22)}" rx="3" fill="${C.skyBottom}"/>`)
    .join('\n    ');
  const straps = [0.16, 0.34, 0.52, 0.7, 0.88]
    .map(
      (f) =>
        `<rect x="${X(f)}" y="${Y(0.5)}" width="${n(w * 0.004)}" height="${n(h * 0.09)}" fill="${C.subject}"/>` +
        `<circle cx="${X(f + 0.002)}" cy="${Y(0.605)}" r="${n(w * 0.016)}" fill="none" stroke="${C.subject}" stroke-width="${n(w * 0.006)}"/>`
    )
    .join('\n    ');
  return `
    <rect x="${X(0)}" y="${Y(0.14)}" width="${n(w)}" height="${n(h * 0.86)}" fill="${C.ridge}"/>
    ${wins}
    <rect x="${X(0)}" y="${Y(0.485)}" width="${n(w)}" height="${n(h * 0.012)}" fill="${C.subject}"/>
    ${straps}
    <rect x="${X(0)}" y="${Y(0.72)}" width="${n(w)}" height="${n(h * 0.1)}" fill="${C.ground}"/>
    <rect x="${X(0)}" y="${Y(0.82)}" width="${n(w)}" height="${n(h * 0.18)}" fill="${C.subject}"/>`;
}

// ── 禅佛典线的镜位：古景空镜 ──────────────────────────────────────────
//
// 纪律跟前两条线同一套：色阶 2–3 层、平涂无渐变、主体不过窗高六成、
// **不画人**。这条线的画面档比治愈档高（稿源 §八：故事有物件、有动作），
// 但「高」指的是**画面里有东西**，不是画面里有情节 ——
// 一个人正在吃饼是情节，一口凉了的鏊子是物件。深夜听众要的是后者。
//
// 一期一景，景按这一期故事里的东西起名，不做通用镜位库。

/**
 * 饼摊：土灶上一口铁鏊子，旁边案板上一摞盖着布的饼，墙根一块石头。人不在。
 *
 * **v1 渲出来什么都看不见**：灶身用了 `ridge`，跟墙的 `far` 只差一档，
 * 1920 上就是一块几乎不存在的浅方块，鏊子那个椭圆浮在半空像一张桌子。
 *
 * 明度阶梯是 far > ridge > ground > subject，四档。这条线的画面档比治愈档高
 * （稿源 §八），所以**物件用 ground、物件上的东西用 subject** ——
 * 墙是最浅的那一档，东西压在它前面才立得住。
 * 再深就越界了：`inkDim` 是文字那一档，画进景里深夜会跳出来。
 */
function stall(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  return `
    <rect x="${X(0)}" y="${Y(0.1)}" width="${n(w)}" height="${n(h * 0.9)}" fill="${C.far}"/>
    <rect x="${X(0)}" y="${Y(0.63)}" width="${n(w)}" height="${n(h * 0.03)}" fill="${C.ridge}"/>
    <rect x="${X(0)}" y="${Y(0.66)}" width="${n(w)}" height="${n(h * 0.34)}" fill="${C.ground}"/>
    <path d="M ${X(0.15)} ${Y(0.71)} L ${X(0.185)} ${Y(0.45)} L ${X(0.375)} ${Y(0.45)}
             L ${X(0.41)} ${Y(0.71)} Z" fill="${C.ground}"/>
    <path d="M ${X(0.235)} ${Y(0.71)} L ${X(0.245)} ${Y(0.58)} L ${X(0.315)} ${Y(0.58)}
             L ${X(0.325)} ${Y(0.71)} Z" fill="${C.subject}"/>
    <ellipse cx="${X(0.28)}" cy="${Y(0.445)}" rx="${n(w * 0.125)}" ry="${n(h * 0.026)}" fill="${C.subject}"/>
    <rect x="${X(0.55)}" y="${Y(0.6)}" width="${n(w * 0.22)}" height="${n(h * 0.028)}" fill="${C.ground}"/>
    <rect x="${X(0.585)}" y="${Y(0.628)}" width="${n(w * 0.018)}" height="${n(h * 0.082)}" fill="${C.ground}"/>
    <rect x="${X(0.717)}" y="${Y(0.628)}" width="${n(w * 0.018)}" height="${n(h * 0.082)}" fill="${C.ground}"/>
    <path d="M ${X(0.575)} ${Y(0.6)} Q ${X(0.66)} ${Y(0.525)} ${X(0.745)} ${Y(0.6)} Z" fill="${C.subject}"/>
    <ellipse cx="${X(0.87)}" cy="${Y(0.735)}" rx="${n(w * 0.055)}" ry="${n(h * 0.028)}" fill="${C.subject}"/>`;
}

/**
 * 空墙根：摊子收走以后的同一处。墙、地、那块石头，
 * 加上灶留下的一片印子和地上那块布 —— **饼不画**。
 *
 * 换到这一景的时候正好念到「他要的不是那半个饼」。
 * 画面里要是还留着那半个饼，说破那句就成了配图说明。
 */
function bareWall(x: number, y: number, w: number, h: number): string {
  const X = (f: number) => n(x + w * f);
  const Y = (f: number) => n(y + h * f);
  return `
    <rect x="${X(0)}" y="${Y(0.1)}" width="${n(w)}" height="${n(h * 0.9)}" fill="${C.far}"/>
    <rect x="${X(0)}" y="${Y(0.63)}" width="${n(w)}" height="${n(h * 0.03)}" fill="${C.ridge}"/>
    <rect x="${X(0)}" y="${Y(0.66)}" width="${n(w)}" height="${n(h * 0.34)}" fill="${C.ground}"/>
    <ellipse cx="${X(0.28)}" cy="${Y(0.73)}" rx="${n(w * 0.115)}" ry="${n(h * 0.032)}" fill="${C.ridge}"/>
    <path d="M ${X(0.56)} ${Y(0.75)} L ${X(0.75)} ${Y(0.74)} L ${X(0.74)} ${Y(0.775)}
             L ${X(0.565)} ${Y(0.782)} Z" fill="${C.ridge}"/>
    <ellipse cx="${X(0.87)}" cy="${Y(0.735)}" rx="${n(w * 0.055)}" ry="${n(h * 0.028)}" fill="${C.subject}"/>`;
}

type ShotFn = (x: number, y: number, w: number, h: number) => string;

/**
 * 每条线自己的镜位集。**镜位名不跨线复用** ——
 * 发布.json 里写「远景」而当前是心理线的话，这儿查不到直接炸，
 * 好过默默画成另一个镜位（那种错要等到看片才发现）。
 */
const SHOTS: Record<string, Record<string, ShotFn>> = {
  治愈: { 留白: whitespace, 远景: distant, 近景: closeUp },
  心理: { 工位: desk, 电梯: elevator, 会议室: meeting, 屏幕: screen, 车厢: carriage },
  禅佛典: { 饼摊: stall, 空墙根: bareWall },
};

const SHOT = SHOTS[LINE];

/** 查不到就报出这条线有哪些，别让人去翻代码 */
function shotFn(name: string): ShotFn {
  const fn = SHOT[name];
  if (!fn)
    throw new Error(
      `${LINE}线没有「${name}」这个镜位
可选：${Object.keys(SHOT).join(" / ")}`
    );
  return fn;
}

/** 木格窗的格条。**画在景之上**，所以看起来是隔着窗看出去 */
function lattice(): string {
  const { x, y, w, h } = L.win;
  const bars: string[] = [];
  for (let i = 1; i < L.cols; i++)
    bars.push(`<rect x="${n(x + (w * i) / L.cols - 3)}" y="${n(y)}" width="6" height="${n(h)}" fill="${C.muntin}"/>`);
  for (let i = 1; i < L.rows; i++)
    bars.push(`<rect x="${n(x)}" y="${n(y + (h * i) / L.rows - 3)}" width="${n(w)}" height="6" fill="${C.muntin}"/>`);
  return bars.join('\n    ');
}

export interface SceneSpec {
  /** 左侧竖排标题。用书名，不是期标题 —— 片内不需要卖，需要的是「我在听哪本」 */
  title: string;
  sub: string;
  /** 0–1 */
  progress: number;
  shot: Shot;
  /** 交叉淡化：往 `shot` 上叠这个镜位，`blend` 是它的不透明度 */
  into?: Shot;
  blend?: number;
  /** 题句卡。见 quoteCard() */
  quote?: { text: string; alpha: number; layout: '竖' | '横'; 注?: string };
  /** 右侧竖排章节名。见 chapterCol() */
  chapter?: { text: string; alpha: number };
}

// ── 题句卡：把一句话写到画面上 ───────────────────────────────────────
//
// 用在两种句子上：**引的那句古文**，和**一期的落点句**。
// 别的句子不要上 —— 这条线的画面纪律是「几乎不动」，
// 字每多出现一次，「这一句要紧」这个信号就弱一分。
//
// ── 为什么是盖一层宣纸而不是直接写字 ──
//
// 直接把字压在景上，字和景会互相咬（窗格条正好穿过字）。
// 所以先在窗里盖一层跟纸同色的半透明，把景压下去，再写字 ——
// 看着像窗前落了一张纸。景没被换掉，淡出之后原样回来。
//
// ── 竖排还是横排 ──
//
//   竖排  古文引句、短落点句。断在标点上，一句一列，从右往左
//   横排  长句。竖排超过两列就开始像对联，不像一句话
//
// 默认按字数自己挑，`layout` 能压过它。

/**
 * 尾标点一律不留（频道规范，跟字幕同一条）。
 *
 * **竖排不受影响** —— `cardCols` 本来就按标点切列、切完把标点丢掉，
 * 竖排卡上从来没有标点。这个和下面的句中句号规则只对横排卡起作用。
 */
const CARD_TAIL = /[。，、；：！？…—\s]+$/u;

/** 拼 SVG 片段用的换行 + 缩进，只为生成物好读 */
const NL = '\n    ';

/**
 * 落款：机制名／出处那一行。竖排在正文左边，小一号、淡一档。
 *
 * **它是落款不是正文**，所以不跟正文一样居中 —— 从正文顶端往下错一截起排，
 * 像题完字在旁边署名。跟正文一边高会读成两句并列的话。
 */
function sign(text: string, cx: number, wy: number, wh: number, mainSize: number, a: number): string {
  const size = Math.round(mainSize * 0.46);
  const gap = size * 1.24;
  // 縦中横：连着的数字挤成一格横着排，不是一行一个数字。
  // 落款上必然带年份（「库利　1902」），拆成 1/9/0/2 四行占掉半列，
  // 而且读起来不像一个数 —— 竖排里西文数字本来就该横着放。
  const units = (text.replace(CARD_TAIL, '').match(/\d+|[\s\S]/g) ?? []).filter((u) => u.trim() || u === '　');
  const top = wy + wh / 2 - ((units.length - 1) * gap) / 2 + mainSize * 1.1;
  return units
    .map((u, i) => {
      const num = /^\d+$/.test(u) && u.length > 1;
      const fs = num ? Math.round(size * 0.78) : size;
      return (
        `<text x="${n(cx)}" y="${n(top + i * gap + fs * 0.35)}" font-family="${SC}" font-weight="500" ` +
        `font-size="${fs}" fill="${C.inkDim}" text-anchor="middle" opacity="${n(a)}"` +
        (num ? ` letter-spacing="-1"` : '') +
        `>${esc(u)}</text>`
      );
    })
    .join(NL);
}

/** 竖排的列：断在标点上，太长的列硬拆 */
function cardCols(text: string, max: number): string[] {
  const out: string[] = [];
  for (const seg of text.split(/[，、；：。！？]/).filter(Boolean)) {
    const c = [...seg];
    for (let i = 0; i < c.length; i += max) out.push(c.slice(i, i + max).join(''));
  }
  return out;
}

function quoteCard(q: NonNullable<SceneSpec['quote']>): string {
  const { x, y, w, h } = L.win;
  const a = Math.max(0, Math.min(1, q.alpha));
  if (a <= 0.001) return '';
  const text = q.text.replace(CARD_TAIL, '');
  // 纸压景。0.86 是试出来的：再淡窗格条会从字里透出来，再浓就不像窗前的纸了
  const wash = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.paper}" opacity="${n(0.86 * a)}"/>`;

  if (q.layout === '竖') {
    // 每列最多 11 字；列高吃满窗高的 78%
    const cols = cardCols(text, 11);
    const longest = Math.max(...cols.map((c) => [...c].length));
    const size = Math.min(66, Math.floor((h * 0.78) / longest / 1.2));
    const gap = size * 1.2;
    const colGap = size * 1.95;
    // 有落款时正文整体右移半列，给左边让出位置 —— 不让的话落款会顶到窗框
    const shift = q.注 ? colGap * 0.5 : 0;
    const cx0 = x + w / 2 + ((cols.length - 1) * colGap) / 2 + shift; // 从右往左
    const body = cols
      .map((c, ci) => {
        const cx = cx0 - ci * colGap;
        const top = y + h / 2 - ([...c].length - 1) * gap / 2;
        return [...c]
          .map(
            (ch, i) =>
              `<text x="${n(cx)}" y="${n(top + i * gap + size * 0.35)}" font-family="${SC}" font-weight="500" ` +
              `font-size="${size}" fill="${C.ink}" text-anchor="middle" opacity="${n(a)}">${esc(ch)}</text>`
          )
          .join(NL);
      })
      .join(NL);
    return wash + NL + body + (q.注 ? NL + sign(q.注, cx0 - cols.length * colGap, y, h, size, a) : '');
  }

  // 横排：先定字号再折行，折出来超过四行就再降一号
  let size = 54;
  let lines: string[] = [];
  for (let k = 0; k < 4; k++) {
    const per = Math.floor((w * 0.82) / size);
    lines = [];
    let cur = '';
    for (const ch of [...text]) {
      cur += ch;
      // 标点后优先断，读起来才像一句话而不是一块字
      if ([...cur].length >= per || (/[，、；：]/.test(ch) && [...cur].length >= per * 0.6)) {
        lines.push(cur);
        cur = '';
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= 4) break;
    size -= 6;
  }
  const lh = size * 1.75;
  const top = y + h / 2 - ((lines.length - 1) * lh) / 2;
  const body = lines
    .map(
      (t, i) =>
        `<text x="${n(x + w / 2)}" y="${n(top + i * lh + size * 0.35)}" font-family="${SC}" font-weight="500" ` +
        `font-size="${size}" fill="${C.ink}" text-anchor="middle" opacity="${n(a)}">${esc(midPeriodToComma(t.replace(CARD_TAIL, '')))}</text>`
    )
    .join(NL);
  if (!q.注) return wash + NL + body;
  const ss = Math.round(size * 0.5);
  const sy = top + lines.length * lh + ss * 0.6;
  const sg =
    `<text x="${n(x + w * 0.86)}" y="${n(sy)}" font-family="${SC}" font-weight="500" ` +
    `font-size="${ss}" fill="${C.inkDim}" text-anchor="end" opacity="${n(a)}">${esc(q.注.replace(CARD_TAIL, ''))}</text>`;
  return wash + NL + body + NL + sg;
}

/** 没写 layout 时按字数挑：竖排超过两列就开始像对联 */
export function cardLayout(text: string): '竖' | '横' {
  const t = text.replace(CARD_TAIL, '');
  return cardCols(t, 11).length <= 2 && [...t].length <= 22 ? '竖' : '横';
}

// ── 右边那一栏：章节名 ───────────────────────────────────────────────

/**
 * 屏上只取 `｜` 前那半。
 *
 * 后半（「天一点点白起来，山的边缘先亮」）是发布页章节列表里的说明句 ——
 * 那儿是一份列表，一行一句读得过来；挂到屏上就成了第二行字幕。
 */
export function chapterName(text: string): string {
  return text.split(/[｜|]/)[0].trim().replace(CARD_TAIL, '');
}

/**
 * 断列：先按标点断，**太长的那一段均分**，不是切满一列再溢出一小截。
 *
 * 13 个字、一列放得下 10 个的时候，切成 10+3 是难看的
 * （右边那列长长一条，左边挂三个字）；均分成 7+6 才像一块。
 * 题句卡那个 `cardCols` 是切满即溢出 —— 那儿一列 11 字、句子长，
 * 溢出去的也是一整列，没有这个问题，所以两边不共用。
 */
function chapterCols(text: string, perCol: number): string[] {
  const out: string[] = [];
  for (const seg of text.split(/[，、；：。！？]/).filter(Boolean)) {
    const cs = [...seg];
    const k = Math.max(1, Math.ceil(cs.length / perCol));
    const per = Math.ceil(cs.length / k);
    for (let i = 0; i < cs.length; i += per) out.push(cs.slice(i, i + per).join(''));
  }
  return out;
}

/**
 * 章节名竖排在窗框右边。
 *
 * 上面那一小道竖线是这一栏的起头，**始终在**（章节淡掉的那一秒也在）：
 * 一个会自己出现又消失的构件，比一个一直杵在那儿的构件招眼得多。
 */
function chapterCol(c: NonNullable<SceneSpec['chapter']>): string {
  const { cx, top, maxH } = L.chap;
  const rule = `<rect x="${n(cx - 1.5)}" y="${L.chap.ruleY}" width="3" height="${L.chap.ruleH}" fill="${C.frame}"/>`;
  const a = Math.max(0, Math.min(1, c.alpha));
  // 每列放得下几个字，是**按目标字号算出来的**，不是写死的：
  // 字号一改这个数要跟着变，否则长名字会去缩字号，而缩回去正好抵消了「调大」。
  const perCol = Math.floor(maxH / (L.chap.size * 1.35));
  let cols = chapterCols(c.text, perCol);
  if (a <= 0.001 || !cols.length) return rule;
  // **最多两列。** 右边这条窄栏只有 284px，第三列会压到窗框上。
  // 标点断出三列以上的名字（少见）就不按标点断了，忽略标点均分成两列。
  if (cols.length > 2) {
    const t = [...c.text.replace(/[，、；：。！？]/g, '')];
    const half = Math.ceil(t.length / 2);
    cols = [t.slice(0, half).join(''), t.slice(half).join('')];
  }
  const longest = Math.max(...cols.map((t) => [...t].length));
  // 兜底：真排不下才降字号（`CHAP_MAX` 之内两列够用，正常走不到这儿）
  const size = Math.min(L.chap.size, Math.floor(maxH / longest / 1.35));
  const gap = size * 1.35;
  const colGap = size * 1.8;
  // **第一列钉死在 cx，多出来的列往左长** —— 不居中。
  // 居中的话，两列的名字跟一列的名字起头不在一条线上，
  // 换过去的那一下会看见整块字往旁边挪了一点。竖排本来也是从右往左。
  const cx0 = cx;
  const body = cols
    .map((t, ci) =>
      [...t]
        .map(
          (ch, i) =>
            `<text x="${n(cx0 - ci * colGap)}" y="${n(top + size + i * gap)}" font-family="${SC}" ` +
            `font-weight="${L.chap.weight}" font-size="${size}" fill="${C.inkDim}" ` +
            `text-anchor="middle" opacity="${n(a)}">${esc(ch)}</text>`
        )
        .join(NL)
    )
    .join(NL);
  return rule + NL + body;
}

export function sceneSvg(s: SceneSpec): string {
  const { x, y, w, h } = L.win;
  const f = L.frame;
  const col = (t: string, cx: number, base: number, gap: number, size: number, fill: string, weight: number) =>
    [...t]
      .map(
        (ch, i) =>
          `<text x="${cx}" y="${n(base + i * gap)}" font-family="${SC}" font-weight="${weight}" ` +
          `font-size="${size}" fill="${fill}" text-anchor="middle">${esc(ch)}</text>`
      )
      .join('\n    ');
  const title = col(s.title, L.titleCx, L.titleBase, L.titleGap, L.titleSize, C.ink, L.titleWeight);
  const subBase = L.titleBase + [...s.title].length * L.titleGap + 40;
  const sub = col(s.sub, L.subCx, subBase, L.subGap, L.subSize, C.inkDim, L.subWeight);
  const p = Math.max(0, Math.min(1, s.progress));
  const sky = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sky)"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.skyTop}"/><stop offset="1" stop-color="${C.skyBottom}"/>
    </linearGradient>
    <radialGradient id="paper" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0" stop-color="${C.paper}"/><stop offset="1" stop-color="${C.paperEdge}"/>
    </radialGradient>
    <clipPath id="win"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>
  </defs>
  <rect width="${SW}" height="${SH}" fill="url(#paper)"/>
  <g clip-path="url(#win)">
    ${sky}
    ${shotFn(s.shot)(x, y, w, h)}
    ${s.into && s.blend ? `<g opacity="${n(s.blend)}">${sky}${shotFn(s.into)(x, y, w, h)}</g>` : ''}
    ${lattice()}
    ${s.quote ? quoteCard(s.quote) : ''}
  </g>
  <rect x="${x - f}" y="${y - f}" width="${w + f * 2}" height="${h + f * 2}" fill="none"
        stroke="${C.frame}" stroke-width="${f * 2}"/>
    ${title}
    ${sub}
    ${s.chapter ? chapterCol(s.chapter) : ''}
  <rect x="${L.sealX}" y="${L.sealY}" width="${L.sealS}" height="${L.sealS}" rx="${L.sealR}" fill="${C.seal}"/>
  <text x="${n(L.sealX + L.sealS / 2)}" y="${n(L.sealY + L.sealS * 0.69)}" font-family="${SC}" font-weight="500"
        font-size="46" fill="${C.sealInk}" text-anchor="middle">醒</text>
  <rect x="${L.bar.x}" y="${L.bar.y}" width="${L.bar.w}" height="${L.bar.h}" rx="1.5" fill="${C.track}"/>
  <rect x="${L.bar.x}" y="${L.bar.y}" width="${n(L.bar.w * p)}" height="${L.bar.h}" rx="1.5" fill="${C.fill}"/>
  ${snail(p)}
</svg>`;
}

function png(svg: string): Buffer {
  return new Resvg(svg, {
    font: { loadSystemFonts: FONT_FILES.length === 0, fontFiles: FONT_FILES, defaultFontFamily: SC },
    fitTo: { mode: 'width', value: SW },
  })
    .render()
    .asPng();
}

/**
 * 题句卡淡入淡出各 `QFADE` 秒，切成 `QSTEPS` 张。
 *
 * 比镜位那次淡化（4 秒）快一点：镜位换的是背景，慢一点没人注意；
 * 题句要跟着话走，太慢的话字还没浮出来那句已经念完了。
 * **但也不能快到像弹幕** —— 1.6 秒是让人在半睡状态下「看见它出现」而不是「被它弹一下」。
 */
const QFADE = 1.6;
const QSTEPS = 8;
/** 一张卡至少留这么久。短于这个就是闪一下，比不上更糟 */
const QUOTE_MIN = 5;
/** 两张卡之间至少隔这么久。密了就不是「这一句要紧」，是字幕 */
const QUOTE_GAP = 20;

interface Manifest { duration: number; cues: { text: string; start: number; end: number }[] }
interface PubDoc {
  book: string;
  shot: Shot;
  parts: {
    part: string;
    /**
     * 片内和封面上那一行小字。不写就是 `${part}篇`。
     *
     * 一本切成上下两篇的书（《方丈记》《枕草子》）用缺省的就对。
     * **一期一题的连载**（《陶庵梦忆》）part 只能叫「全」，
     * 拼出来的「全篇」既不是分卷也不是期号 —— 那种书在这儿写「第一期」。
     */
    partName?: string;
    /** 期标题。心理线这一栏就是机制名（「镜中我」），命名卡要用 */
    epTitle?: string;
    /** 免掉命名卡这条硬要求，值写理由。**只给已出片的老期用** */
    免命名卡?: string;
    scenes?: { at: string; shot: Shot }[];
    /** 免掉「新片必须带章节」这条。值写理由。**只给已出片的老期用** */
    免章节?: string;
    /**
     * 章节。**屏上右边那一栏和发布页的章节列表是同一份数据** ——
     * `text` 写「章节名｜说明句」，屏上只上前半，发布页两半都要。
     * `屏` 能单给画面另写一个短名字（发布页那条不动）。
     */
    chapters?: { at: string; text: string; 屏?: string }[];
    /** 题句卡。见 planQuotes() */
    quotes?: {
      at: string;
      to?: string;
      layout?: '竖' | '横';
      文?: string;
      前?: number;
      后?: number;
      /** 稿子里有多段以 at 开头时，取第几段（1 起）。不写而又不止一段的话直接报错 */
      第?: number;
      /** 落款：机制名的出处（「库利　1902」）。小一号、淡一档，排在正文旁边 */
      注?: string;
    }[];
  }[];
}

/**
 * 排出「从第几秒起是哪个镜位」。
 * 切点写的是**那一段的开头几个字**，跟章节用同一套定位 ——
 * 改稿之后重跑一次，切点自动跟着走。定位不到直接炸，不静默跳过。
 *
 * 没排 `scenes` 的书就是全程一景（《方丈记》那样）。
 */
function schedule(m: Manifest, base: Shot, scenes: { at: string; shot: Shot }[] | undefined) {
  const out = [{ t: 0, shot: base }];
  for (const s of scenes ?? []) {
    const cue = m.cues.find((c) => c.text.startsWith(s.at));
    if (!cue)
      throw new Error(`镜位切点「${s.at}」定位不到：稿子里没有以它开头的段落。改稿之后这一条要跟着改。`);
    out.push({ t: cue.start, shot: s.shot });
  }
  out.sort((a, b) => a.t - b.t);
  for (let i = 1; i < out.length; i++) {
    const dwell = (i + 1 < out.length ? out[i + 1].t : m.duration) - out[i].t;
    if (dwell < MIN_DWELL)
      throw new Error(
        `镜位「${out[i].shot}」（${mmss(out[i].t)} 起）只撑了 ${Math.round(dwell)} 秒，低于下限 ${MIN_DWELL} 秒。\n` +
          `这是助眠档 —— 画面勤换在别的线是丰富，在这条线是把人吵醒。切点排稀一点。`
      );
    if (out[i].shot === out[i - 1].shot)
      throw new Error(`${mmss(out[i].t)} 处切到了同一个镜位「${out[i].shot}」，这一刀没有意义`);
  }
  return out;
}

export interface QuotePlan { t0: number; t1: number; text: string; layout: '竖' | '横'; 注?: string }

/**
 * 排题句卡。定位跟镜位、章节同一套：写那一段的开头几个字。
 *
 * `to` 给的是最后一段的开头几个字（含），不给就只有 `at` 那一段。
 * 引句通常是两段（正文一段、出处一段），出处那段不该上屏，所以默认只取一段。
 *
 * `文` 能改写上屏的字 —— 念出来的和写出来的不必逐字一样：
 * 「也就是说，对面那个人，很可能同时在做一模一样的推算」念着顺，
 * 写在画面上「对面那个人，很可能在做一模一样的推算」更像一句题词。
 * **但意思不许变** —— 屏上和耳朵里对不上，观众会以为自己听错了。
 */
export function planQuotes(m: Manifest, qs: NonNullable<PubDoc['parts'][number]['quotes']>): QuotePlan[] {
  const out: QuotePlan[] = [];
  for (const q of qs) {
    // 首尾回扣同一句引文是这条线的常规写法，所以「开头几个字」会撞车。
    // **撞了就报错，不许默默取第一处** —— 尾引句的卡挂到片头去，
    // 画面上看不出任何异样，只有时间轴对不上，而没人会去核时间轴。
    const all = m.cues.map((c, k) => (c.text.startsWith(q.at) ? k : -1)).filter((k) => k >= 0);
    if (all.length === 0)
      throw new Error(`题句「${q.at}」定位不到：稿子里没有以它开头的段落。改稿之后这一条要跟着改。`);
    if (all.length > 1 && !q.第)
      throw new Error(
        `题句「${q.at}」在稿子里有 ${all.length} 段以它开头（${all.map((k) => mmss(m.cues[k].start)).join('、')}）。
` +
          `加 "第": 1..${all.length} 指明是哪一段。`
      );
    const i = all[(q.第 ?? 1) - 1];
    if (i === undefined) throw new Error(`题句「${q.at}」没有第 ${q.第} 段，只有 ${all.length} 段`);
    let j = i;
    if (q.to) {
      j = m.cues.findIndex((c) => c.text.startsWith(q.to!));
      if (j < 0) throw new Error(`题句的 to「${q.to}」定位不到`);
      if (j < i) throw new Error(`题句「${q.at}」的 to 排在 at 前面`);
    }
    const text = q.文 ?? m.cues.slice(i, j + 1).map((c) => c.text).join('');
    // 前后各留一点：卡要在话出口之前就浮出来，念完之后再停一会儿。
    // 不留的话字和声音同时到，像字幕；留了才像「这句话被写下来了」。
    const t0 = Math.max(0, m.cues[i].start - (q.前 ?? 1.2));
    const t1 = Math.min(m.duration, m.cues[j].end + (q.后 ?? 2.0));
    if (t1 - t0 < QUOTE_MIN)
      throw new Error(
        `题句「${q.at}」只有 ${(t1 - t0).toFixed(1)} 秒，短于下限 ${QUOTE_MIN} 秒。
` +
          `闪一下比不上更糟 —— 要么用 前/后 撑开，要么用 to 多带一段。`
      );
    out.push({ t0, t1, text, layout: q.layout ?? cardLayout(text), 注: q.注 });
  }
  out.sort((a, b) => a.t0 - b.t0);
  for (let i = 1; i < out.length; i++)
    if (out[i].t0 - out[i - 1].t1 < QUOTE_GAP)
      throw new Error(
        `两张题句卡只隔了 ${(out[i].t0 - out[i - 1].t1).toFixed(1)} 秒（下限 ${QUOTE_GAP}）：
` +
          `  ${mmss(out[i - 1].t0)} 「${out[i - 1].text.slice(0, 14)}」
` +
          `  ${mmss(out[i].t0)} 「${out[i].text.slice(0, 14)}」
` +
          `排密了就不是「这一句要紧」，是字幕。`
      );
  return out;
}

/** 章节名淡出/淡入各多长、各切成几张。跟题句卡同一个颗粒度（0.2s 一档） */
const CFADE = 1.2;
const CSTEPS = 6;
/**
 * 一个章节至少撑多久。
 *
 * 比镜位那道 150 秒的闸松得多 —— 换的是右边一栏小字，不是整片背景，
 * 而且章节本来就是跟着内容走的，一期十几到二十条是常态。
 * 但短到十几秒就没有意义了：读的人只看见字在动，看不清写的是什么。
 * 《枕草子》下篇收尾那一节 20 秒，是现有稿子里最短的一条。
 */
const MIN_CHAP = 15;
/** 屏上章节名最多几个字。右边那条是窄栏，超了用 `屏` 另写一个短的 */
const CHAP_MAX = 16;

export interface ChapterPlan { t0: number; t1: number; text: string }

/**
 * 排章节。**定位方式跟 zhiyu-publish.ts 一模一样**：
 * 那一段的开头几个字，取第一处匹配。
 *
 * 屏上这一条和发布页章节列表那一条必须指同一段 —— 分叉了的话，
 * 观众照简介里的时间戳跳过去，画面上写着另一节的名字，
 * 而这种错没人核得出来是哪边错的。
 *
 * 第一条从 0 起（发布页也把第一条钉在 0:00），最后一条走到片尾。
 */
export function planChapters(
  m: Manifest,
  cs: NonNullable<PubDoc['parts'][number]['chapters']>
): ChapterPlan[] {
  const out: ChapterPlan[] = [];
  const raw: number[] = [];
  for (const c of cs) {
    const cue = m.cues.find((x) => x.text.startsWith(c.at));
    if (!cue)
      throw new Error(
        `章节「${c.text}」定位不到：稿子里没有以「${c.at}」开头的段落。改稿之后这一条要跟着改。`
      );
    const text = chapterName(c.屏 ?? c.text);
    if (!text) throw new Error(`章节「${c.text}」取不出屏上的名字：｜ 前那半是空的`);
    if ([...text].length > CHAP_MAX)
      throw new Error(
        `章节名「${text}」${[...text].length} 字，超过屏上的 ${CHAP_MAX} 字。\n` +
          `右边是一条窄栏，长了会顶到窗底。加 "屏": "短名字" 单给画面用，发布页那条不动。`
      );
    if (raw.length && cue.start <= raw[raw.length - 1])
      throw new Error(`章节顺序乱了：「${text}」排在了前一条之前`);
    raw.push(cue.start);
    out.push({ t0: out.length === 0 ? 0 : cue.start, t1: 0, text });
  }
  for (let i = 0; i < out.length; i++) out[i].t1 = i + 1 < out.length ? out[i + 1].t0 : m.duration;
  for (const c of out)
    if (c.t1 - c.t0 < MIN_CHAP)
      throw new Error(
        `章节「${c.text}」（${mmss(c.t0)} 起）只有 ${Math.round(c.t1 - c.t0)} 秒，低于下限 ${MIN_CHAP} 秒。\n` +
          `一闪就换掉的章节，读的人只看见字在动 —— 并到相邻那一节里去。`
      );
  return out;
}

/**
 * **新片必须带章节。**
 *
 * 2026-08-21 定：章节不再只是简介里的一行，它要上画面 ——
 * 深夜档中途醒一下，右边那一栏是唯一能回答「现在讲到哪儿了」的东西。
 *
 * 所以放在这儿而不是写进文档：没有 `chapters` 就出不了图。
 * 这个仓库里几处闸门都是同一条理由 —— **规则不进机器等于只防君子**。
 * 已出片的老期不回改，用 `免章节` 写明理由豁免，让例外看得见。
 */
function requireChapters(p: PubDoc['parts'][number]): void {
  if (p.chapters?.length) return;
  if (p.免章节) {
    console.log(`  ⚠ 免了章节：${p.免章节}`);
    return;
  }
  throw new Error(
    `${p.part}篇没有 chapters —— 画面右边那一栏会是空的，发布页也没有章节列表。

` +
      `  2026-08-21 起章节是必出件：同一份数据出两处，` +
      `简介里的时间戳，和屏上「现在讲到哪儿了」那一眼。

` +
      `  在 发布.json 的 parts[] 里加（at 写那一段的开头几个字，改稿之后时间自动跟着走）：

` +
      `    "chapters": [
` +
      `      { "at": "春天最好的是拂晓", "text": "春是拂晓｜天一点点白起来，山的边缘先亮" },
` +
      `      …
` +
      `    ]

` +
      `  屏上只上「｜」前那半；后半只进发布页。
` +
      `  已出片不回改的老期，写 "免章节": "理由" 豁免。`
  );
}

/**
 * 心理线：**机制名必须有一张卡。**
 *
 * 这条线的硬规则 2 写着「机制必须有名字」，因为名字是听众能带走的东西之一。
 * 那它就比两句古文更该上屏 —— 古文是解释层，机制名才是这一期的题目。
 *
 * E01 出片之后才发现只上了三处引句、没上「镜中我」。
 * **写进文档说「下期注意」是拦不住的**，所以放在这儿：没有就出不了图。
 * 已出片的老期不回改，用 `免命名卡` 写明理由豁免 —— 让例外看得见，而不是没人记得。
 */
function requireMingCard(p: PubDoc['parts'][number], quotes: QuotePlan[]): void {
  if (LINE !== '心理') return;
  const name = p.epTitle;
  if (!name) return;
  if (p.免命名卡) {
    console.log(`  ⚠ 免了命名卡：${p.免命名卡}`);
    return;
  }
  const got = quotes.some((q) => q.text.includes(name) || (q.注 ?? '').includes(name));
  if (!got)
    throw new Error(
      `没有一张题句卡带上机制名「${name}」。
` +
        `  这条线的硬规则 2 是「机制必须有名字」—— 名字才是听众带得走的东西，
` +
        `  古文引句是解释层。命名段那一句要上屏，出处写进「注」：

` +
        `    { "at": "1902 年，一个叫库利的美国人", "文": "${name}", "注": "库利　1902" }

` +
        `  已出片不回改的老期，写 "免命名卡": "理由" 豁免。`
    );
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.indexOf('--part') >= 0 ? argv[argv.indexOf('--part') + 1] : null;
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as PubDoc;

  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    const partDir = `${PROJ}/成片/${p.part}`;
    const mPath = `${partDir}/manifest.json`;
    if (!existsSync(mPath))
      throw new Error(`没有 ${mPath}\n先跑：npx tsx src/zhiyu-episode.ts --ep <书> --part ${p.part}`);
    const m = JSON.parse(readFileSync(mPath, 'utf8')) as Manifest;
    const plan = schedule(m, doc.shot, p.scenes);
    const quotes = planQuotes(m, p.quotes ?? []);
    requireChapters(p);
    const chaps = planChapters(m, p.chapters ?? []);
    requireMingCard(p, quotes);

    const dir = `${partDir}/scenes`;
    // 全清再出：留着上一版的残图，concat 按清单拼不会用到它们，
    // 但人去翻目录会以为那是这一版的
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // ── 排图 ──
    //
    // 画面上有三件各走各的事：**镜位**（背景，慢，4 秒淡化）、
    // **题句卡**（前景，1.6 秒淡入淡出）、**右边的章节名**（1.2 秒淡出再淡入）。
    // 三件可以叠在一起发生。
    //
    // 一版的循环是「走一步 STEP，撞上切点就插淡化」，只够处理一件事。
    // 加了题句之后改成：**先把所有必须落到的时刻算出来，再逐段渲**。
    // 落点 = 常规网格 ∪ 镜位淡化的每一小步 ∪ 题句淡入淡出的每一小步。
    // 每一段的参数按它的中点算，进度线还是按段末算（跟一版一致）。
    const shots: { file: string; dur: number; shot: Shot }[] = [];
    const emit = (spec: SceneSpec, dur: number) => {
      const file = `${String(shots.length + 1).padStart(3, '0')}.png`;
      writeFileSync(`${dir}/${file}`, png(sceneSvg(spec)));
      shots.push({ file, dur, shot: spec.into ?? spec.shot });
    };

    const stops = new Set<number>([0, m.duration]);
    const add = (x: number) => {
      if (x > 0.001 && x < m.duration - 0.001) stops.add(Math.round(x * 1000) / 1000);
    };
    for (let x = STEP; x < m.duration; x += STEP) add(x);
    for (const c of plan.slice(1))
      for (let i = 0; i <= BLEND_STEPS; i++) add(c.t - BLEND_SEC / 2 + (BLEND_SEC * i) / BLEND_STEPS);
    for (const q of quotes)
      for (let i = 0; i <= QSTEPS; i++) {
        add(q.t0 + (QFADE * i) / QSTEPS);
        add(q.t1 - QFADE + (QFADE * i) / QSTEPS);
      }
    for (const c of chaps)
      for (let i = 0; i <= CSTEPS; i++) {
        add(c.t0 + (CFADE * i) / CSTEPS);
        add(c.t1 - CFADE + (CFADE * i) / CSTEPS);
      }
    const times = [...stops].sort((a, b) => a - b);

    /** 某一刻的镜位。淡化窗口里返回「从哪到哪、到了几成」 */
    const shotAt = (t: number): { shot: Shot; into?: Shot; blend?: number } => {
      let cur = plan[0].shot;
      for (const c of plan) {
        const a = c.t - BLEND_SEC / 2;
        if (t >= a + BLEND_SEC) cur = c.shot;
        else if (t >= a) return { shot: cur, into: c.shot, blend: (t - a) / BLEND_SEC };
      }
      return { shot: cur };
    };

    /**
     * 某一刻的章节名。首尾各 `CFADE` 秒淡入淡出，
     * 所以换名字时中间必然空一小下 —— 那一下是有意的，见顶上那段。
     */
    const chapterAt = (t: number): SceneSpec['chapter'] => {
      if (!chaps.length) return undefined;
      let cur = chaps[0];
      for (const c of chaps) if (t >= c.t0) cur = c;
      return { text: cur.text, alpha: Math.min((t - cur.t0) / CFADE, (cur.t1 - t) / CFADE) };
    };

    /** 某一刻的题句卡 */
    const quoteAt = (t: number): SceneSpec['quote'] => {
      for (const q of quotes) {
        if (t < q.t0 || t >= q.t1) continue;
        const alpha =
          t < q.t0 + QFADE ? (t - q.t0) / QFADE : t > q.t1 - QFADE ? (q.t1 - t) / QFADE : 1;
        return { text: q.text, alpha, layout: q.layout, 注: q.注 };
      }
      return undefined;
    };

    for (let i = 0; i + 1 < times.length; i++) {
      const t = times[i];
      const d = times[i + 1] - t;
      if (d < 0.01) continue;
      const mid = t + d / 2;
      emit(
        {
          title: doc.book,
          sub: p.partName ?? `${p.part}篇`,
          progress: (t + d) / m.duration,
          ...shotAt(mid),
          quote: quoteAt(mid),
          chapter: chapterAt(mid),
        },
        d
      );
    }
    writeFileSync(`${dir}/scenes.json`, JSON.stringify({ duration: m.duration, step: STEP, shots }, null, 1));

    console.log(`${p.part}篇　${shots.length} 张 → ${dir}/`);
    for (const s of plan) console.log(`  ${mmss(s.t).padStart(6)}　${s.shot}`);
    for (const q of quotes)
      console.log(`  ${mmss(q.t0).padStart(6)}　题句·${q.layout}排　${(q.t1 - q.t0).toFixed(0)}s　「${q.text.slice(0, 18)}」`);
    for (const c of chaps)
      console.log(`  ${mmss(c.t0).padStart(6)}　章节　${String(Math.round(c.t1 - c.t0)).padStart(4)}s　${c.text}`);
    console.log(
      plan.length === 1
        ? `  一景不换，只有底部那条线在走`
        : `  换 ${plan.length - 1} 次，每次 ${BLEND_SEC}s 交叉淡化（**不硬切** —— 深夜档一次硬切就是一次睁眼）`
    );
  }
}

if (process.argv[1]?.includes('zhiyu-scene')) main();
