// ── 老马：段子独白线的角色 rig ────────────────────────────────────────
//
// 原稿是 `horse/horse_only.svg`（美术给的，透明背景，带驱动分组）。
// 这一层只做一件事：**把 CharState 翻译成原稿上那几个分组的 transform**。
//
// ── 跟别的 rig 不一样的地方：这个不画，只改 ──
//
// serpentine / turtle / mouse 都是代码画出来的，形状全在 rig 里。
// 老马是**一张画好的 svg**，rig 做的是替换四处属性：
//
//   pupil-l / pupil-r   眼珠位移
//   mouth-*             口型（先全关，再开指定的那个）
//   head                扭头（水平压缩模拟转动）
//   face                扭头时脸相对头壳的视差横移
//
// 所以形象要改**先改 svg**，代码这层改不了长相 —— 跟 `roster.ts` 顶上
// 那条「原稿是唯一真源」是同一条。
//
// ⚠ **`horse/horse-pose.mjs` 里有同样的四处替换。** 那份是给摆拍工具
// （`horse/render.mjs --demo` 出静帧挑图）用的，跑在纯 .mjs 环境里、
// 导不进这边的 TS。两边的三个常量（HEAD_CX / DEPTH / 口型 id）必须一致，
// **改一处记得改另一处**。
//
// ── 眼睛是这条线唯一的表演 ──
//
// 人设是「不愤怒、累到平静、不表演」，脸上不能有戏。可 30 秒一条片子，
// 一张不动的脸会闷死。出口是眼珠：
//
//   扫视 ＋ 固视：瞬间跳到一点、钉住不动、再瞬间跳走
//   眨眼：只在停顿处，一次 4–5 帧
//   闭目：超过 0.5 秒的闭眼是另一回事（忍耐/认命），全片最多一次
//
// 稿件规范 §五 写着「五分之一的时长没有声音，画面是这五分之一里唯一在发生的事」。
// 这段代码就是那句话的实现。
//
// **人的眼球没有匀速运动这回事。** 漂移也好、画圈也好，都是匀速的，
// 看着像游魂不像人。真实的眼动是一串「跳 → 钉住 → 跳」，
// 一次扫视只占 2 帧，剩下的时间眼珠是**不动的**。
//
// 所以这一层不算眼动，只负责画：轨在 render.ts 里排（它才看得到 beat
// 和停顿的边界），这儿收 s.gaze 直接用。

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CharState } from './state.js';

/** 扭头的垂直轴（原稿坐标系）。跟 horse-pose.mjs 必须一致 */
const HEAD_CX = 352;
/** 视差量：扭头时脸相对头壳的横移系数。跟 horse-pose.mjs 必须一致 */
const DEPTH = 46;

/**
 * 渲染高度（px）。
 *
 * 1120 是 `horse/scenes.mjs` 的参考人高 U —— 场景里所有家具都按
 * 「距地多少个人高」摆的（桌面 0.43、沙发靠背 0.5…），
 * **马必须正好这么高，家具的高度才是对的**。改这个数等于改整套场景的比例。
 */
const HEIGHT = 1120;

const FILE = fileURLToPath(new URL('../../horse/horse_only.svg', import.meta.url));

interface Art {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  style: string;
  body: string;
}

let cache: Art | null | undefined;

function load(): Art | null {
  if (cache !== undefined) return cache;
  if (!existsSync(FILE)) {
    cache = null;
    return null;
  }
  const raw = readFileSync(FILE, 'utf8');
  const vb = raw.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/);
  if (!vb) throw new Error(`${FILE} 没有 viewBox`);
  const [vx, vy, vw, vh] = vb.slice(1).map(Number);
  const style = (raw.match(/<style[^>]*>[\s\S]*?<\/style>/) || [''])[0];
  const body = raw
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/, '');
  cache = { vx, vy, vw, vh, style, body };
  return cache;
}

/**
 * 两个眼珠在原稿坐标系里的中心（光栅化量的，直径 19）。
 * **瞪大是绕这两个点缩放** —— 绕 (0,0) 缩放会把眼珠甩到脸外面去。
 * 原稿换了要重量。
 */
const PUPIL = { l: { x: 293.0, y: 266.5 }, r: { x: 408.2, y: 266.5 } };

/**
 * 眼神预设：**定住的视线**，不是漂移。
 *
 * 平时眼珠是自动的（说话时定住、停顿时转一圈），但有几种表情必须由稿子指定 ——
 * 它们是**表演**，不是待机动作，而待机动作永远碰不出表演。
 *
 * 坐标是原稿坐标系里的位移，安全范围 ±26 / ±22（超了顶出眼白，
 * 眼白是画死的、不跟着动）。
 *
 * **不屑要往上偏。** 往侧面看是「在看别处」，往斜上看才是「懒得看你」——
 * 差别全在那十几个像素的 y 上。配合嘴闭着：不屑不张嘴，一张嘴就成了抱怨，
 * 而老马这条线最忌讳的就是滑成抱怨（人设禁忌第一条）。
 */
export interface Look {
  /** 眼珠位移。安全范围 ±26 / ±22 */
  x?: number;
  y?: number;
  /** 眼珠放大倍率。绕各自的中心缩放 */
  zoom?: number;
  /** 眯成一条线：藏掉眼白和眼珠，画两道上弯的弧 */
  squint?: boolean;
}

export const LOOKS: Record<string, Look> = {
  /** 眼珠往左上定住。**往斜上看才是「懒得看你」**，往侧面看只是「在看别处」 */
  不屑: { x: -19, y: -15 },
  /**
   * 心虚：眼珠偏到一侧**并且往下**。
   * 往下是关键 —— 往上是走神，往下才是躲。幅度比不屑小一档，
   * 心虚是「不敢看」，不是「不想看」，动作要小。
   */
  心虚: { x: -13, y: 11 },
  /** 笑眯眯：眼睛眯成一条线。见 squintEyes() */
  笑眯眯: { squint: true },
  /** 瞪：眼珠放大并归位。1.45 是上限，再大顶到眼白上就成了白内障 */
  瞪: { zoom: 1.45 },
  斜视: { x: -19, y: 0 },
  望天: { x: 0, y: -18 },
  低头: { x: 0, y: 16 },
};

/**
 * 两只眼白的位置与大小（光栅化量的）。**眯眼的弧按它画**，原稿换了要重量。
 */
const EYE = {
  l: { x: 282.5, y: 257.0, w: 94.1, h: 101.0 },
  r: { x: 421.7, y: 257.0, w: 92.1, h: 99.0 },
};

/**
 * 眯成一条线的眼睛。
 *
 * **不是把眼珠缩小，是把整只眼睛换掉** —— 眼白留着的话，
 * 上面压一道弧只会看成「睁着眼但有根线」。所以眼白和眼珠一起藏，
 * 原地画两道上弯的弧。
 *
 * 弧要**上弯**（笑），不是下弯（哭）。宽度取眼白的 0.62 ——
 * 满宽会顶到眼眶的轮廓线上，看着像眼睛被划了一刀。
 */
function squintEyes(ink: (c: string) => string): string {
  const col = ink('#3B322B');
  return (['l', 'r'] as const)
    .map((side) => {
      const e = EYE[side];
      const w = e.w * 0.62;
      const lift = e.h * 0.17;
      return (
        `<path d="M ${n(e.x - w / 2)} ${n(e.y + lift * 0.5)} Q ${n(e.x)} ${n(e.y - lift)} ${n(e.x + w / 2)} ${n(e.y + lift * 0.5)}" ` +
        `fill="none" stroke="${col}" stroke-width="9" stroke-linecap="round"/>`
      );
    })
    .join('');
}

/** 口型三态 → 原稿里的口型分组。原稿有 A/I/O/E 四个，三态只用得上两个 */
const MOUTH: Record<0 | 1 | 2, string | null> = { 0: null, 1: 'I', 2: 'A' };

/**
 * 闭着的眼睛（眨眼 / 闭目共用一张画法）。
 *
 * **跟「笑眯眯」不是一回事。** 笑眯眯的弧朝上，读作笑；
 * 闭眼要**基本平**（只留一点点下垂），读作「闭上了」。同样是两道线，
 * 弯的方向一变意思就全变了 —— 上弯是笑，下弯是哭，平的才是闭。
 */
function closedEyes(ink: (c: string) => string): string {
  const col = ink('#3B322B');
  return (['l', 'r'] as const)
    .map((side) => {
      const e = EYE[side];
      const w = e.w * 0.70;
      const sag = e.h * 0.055; // 一点点下垂就够，多了就成哭了
      return (
        `<path d="M ${n(e.x - w / 2)} ${n(e.y - sag * 0.5)} Q ${n(e.x)} ${n(e.y + sag)} ${n(e.x + w / 2)} ${n(e.y - sag * 0.5)}" ` +
        `fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round"/>`
      );
    })
    .join('');
}

/** 藏掉眼白和眼珠。闭眼/眯眼都要先做这一步 —— 留着眼白只会读成「睁着眼但有根线」 */
function hideEyes(body: string): string {
  for (const id of ['eye-white-l', 'eye-white-r', 'pupil-l', 'pupil-r'])
    body = body.replace(new RegExp(`<g id="${id}"( transform="[^"]*")?>`), `<g id="${id}" style="display:none">`);
  return body;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const n = (v: number) => Math.round(v * 100) / 100;

/**
 * 马在画布上占的框（漫符按它定位）。
 *
 * **跟 horse() 用同一套换算** —— 分两处算的话，改了渲染比例而漫符没跟着改，
 * 符号就会飘到头以外的地方去，而且不报错。
 */
export function horseBox(s: CharState): { x: number; y: number; w: number; h: number } {
  const art = load();
  if (!art) return { x: s.x, y: s.y, w: 0, h: 0 };
  const k = ((s.scale || 1) * HEIGHT) / art.vh;
  const w = art.vw * k;
  const h = art.vh * k;
  return { x: s.x - w / 2, y: s.y - h, w, h };
}

export function horse(s: CharState, ink: (c: string) => string, seed: number): string {
  const art = load();
  if (!art) return '';

  let body = art.body;

  // ── 眼睛 ──
  //
  // 四档，优先级从高到低：
  //   ① 闭着（`eyes === 'closed'`）—— 眨眼或闭目，render.ts 排的
  //   ② 眯眼（`look.squint`）—— 笑眯眯，稿子点名
  //   ③ 稿子点名的表情（`look`）—— 按表情定住。**这是表演**
  //   ④ 自动扫视（`gaze`）—— render.ts 排好的一串固视点
  //
  // **待机动作永远碰不出表演**，所以 ③ 必须由稿子指定，不能指望 ④ 撞出来。
  // 安全范围 ±26 / ±22，超了顶出眼白 —— 眼白是画死的，不跟着动。
  const look: Look | undefined = s.look ? LOOKS[s.look] : s.eyes === 'wide' ? LOOKS['瞪'] : undefined;
  if (s.look && !LOOKS[s.look])
    throw new Error(`没有这个表情：${s.look}\n可选：${Object.keys(LOOKS).join(' / ')}`);

  if (s.eyes === 'closed') {
    // 闭着：眨眼（4–5 帧）和闭目（0.8–1.5 秒）画法一样，差别只在挂多久
    body = hideEyes(body);
    body = body.replace('<g id="nostrils">', `${closedEyes(ink)}<g id="nostrils">`);
  } else if (look?.squint) {
    // 眯眼：眼白和眼珠一起藏掉，原地画两道**上弯**的弧
    body = hideEyes(body);
    body = body.replace('<g id="nostrils">', `${squintEyes(ink)}<g id="nostrils">`);
  } else {
    // **稿子点名的表情压过自动扫视。** 一边不屑一边眼珠自己乱跳，
    // 那是走神不是不屑 —— 表演和待机动作不能同时占着眼睛。
    const g = look ? { x: 0, y: 0 } : (s.gaze ?? { x: 0, y: 0 });
    const ex = clamp((look?.x ?? 0) + g.x, -26, 26);
    const ey = clamp((look?.y ?? 0) + g.y, -22, 22);
    for (const side of ['l', 'r'] as const) {
      const c = PUPIL[side];
      // 先绕自己的中心放大，再整体挪 —— 顺序反了眼珠会飞出脸外
      const zoom = look?.zoom ? ` translate(${c.x},${c.y}) scale(${look.zoom}) translate(${-c.x},${-c.y})` : '';
      body = body.replace(
        new RegExp(`<g id="pupil-${side}" transform="[^"]*">`),
        `<g id="pupil-${side}" transform="translate(${n(ex)},${n(ey)})${zoom}">`
      );
    }
  }

  // ── 口型 ──
  // mouthShape 压过三态：闭 ↔ 大张之间垫的那一帧 E 就是靠它指名的
  const m = s.mouthShape ?? MOUTH[s.mouth];
  if (m) {
    body = body.replace('<g id="mouth-closed">', '<g id="mouth-closed" style="display:none">');
    body = body.replace(`<g id="mouth-${m}" style="display:none">`, `<g id="mouth-${m}">`);
  }

  // ── 扭头 ──
  // 水平压缩（cos）模拟转动，脸再按 sin 横移做视差。±25 度以内可信，
  // 再大就该换一张头了 —— 这是二维假三维的极限，不是参数没调好
  const turn = clamp(s.turn ?? 0, -25, 25);
  const a = (turn * Math.PI) / 180;
  // bob 是说话节拍的上下偏移，直接喂给头 —— 整只马不动，只有头点
  const headY = s.bob * 0.7;
  body = body.replace(
    /<g id="head" transform="[^"]*">/,
    `<g id="head" transform="translate(${HEAD_CX},${n(headY)}) scale(${n(Math.cos(a))},1) translate(${-HEAD_CX},0)">`
  );
  body = body.replace(
    /<g id="face" transform="[^"]*">/,
    `<g id="face" transform="translate(${n(DEPTH * Math.sin(a))},0)">`
  );

  // ── 颜色过 ink()，定格去色才生效 ──
  // 原稿的颜色**大部分在 <style> 的 class 里**（.st0{fill:#F4F0E6}），
  // 不是写在标签上的。所以两处都要换 —— 只换标签属性的话，
  // 定格那一下马还是彩色的，而背景已经灰了。
  const recolor = (t: string) => t.replace(/#[0-9a-fA-F]{6}\b/g, (c) => ink(c));

  const k = ((s.scale || 1) * HEIGHT) / art.vh;
  const mirror = s.facing === -1 ? -1 : 1;

  return (
    `<g opacity="${s.opacity}" transform="translate(${n(s.x + s.shakeX)},${n(s.y + s.shakeY)}) ` +
    `scale(${n(k * mirror)},${n(k * s.breath)}) rotate(${n(-s.lean * 0.4)}) ` +
    `translate(${n(-art.vx - art.vw / 2)},${n(-art.vy - art.vh)})">` +
    recolor(art.style) +
    recolor(body) +
    `</g>`
  );
}
