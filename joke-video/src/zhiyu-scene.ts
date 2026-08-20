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
//   窗框      片内**有**（五件固定构件之一），封面去掉
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
// 五件固定构件里有一条**底部细进度线**。静态图出片走 ffmpeg 的 concat，
// 一张图撑一段时长，所以进度线要动就得切成若干张。
// 每 `STEP` 秒一张，二十分钟约四十张 —— 平摊下来每张只前进 2.5%，
// 肉眼几乎察觉不到在动，但想知道还剩多久时低头就能看见。

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { resolveEp } from './zhiyu-ep.js';
import { mmss } from './zhiyu-audio.js';

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
 */
const C = {
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
};

/** 版式。1920×1080 */
const L = {
  win: { x: 430, y: 132, w: 1190, h: 742 },
  frame: 16,
  cols: 3, rows: 2,
  // 标题比规范折算的 54px 大、也更重。标题是这张图上唯一不变的东西 ——
  // 它不闪不动，大一点不会变成睁眼的理由。该压住的是会动的那个：进度线。
  titleCx: 268, titleBase: 322, titleGap: 88, titleSize: 72, titleWeight: 600,
  subCx: 268, subGap: 46, subSize: 34, subWeight: 500,
  sealX: 226, sealY: 852, sealS: 84, sealR: 7,
  bar: { x: 226, y: 1006, w: 1468, h: 3 },
};

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

export type Shot = '留白' | '远景' | '近景';

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

const SHOT: Record<Shot, (x: number, y: number, w: number, h: number) => string> = {
  留白: whitespace,
  远景: distant,
  近景: closeUp,
};

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
    ${SHOT[s.shot](x, y, w, h)}
    ${s.into && s.blend ? `<g opacity="${n(s.blend)}">${sky}${SHOT[s.into](x, y, w, h)}</g>` : ''}
    ${lattice()}
  </g>
  <rect x="${x - f}" y="${y - f}" width="${w + f * 2}" height="${h + f * 2}" fill="none"
        stroke="${C.frame}" stroke-width="${f * 2}"/>
    ${title}
    ${sub}
  <rect x="${L.sealX}" y="${L.sealY}" width="${L.sealS}" height="${L.sealS}" rx="${L.sealR}" fill="${C.seal}"/>
  <text x="${n(L.sealX + L.sealS / 2)}" y="${n(L.sealY + L.sealS * 0.69)}" font-family="${SC}" font-weight="500"
        font-size="46" fill="${C.sealInk}" text-anchor="middle">醒</text>
  <rect x="${L.bar.x}" y="${L.bar.y}" width="${L.bar.w}" height="${L.bar.h}" rx="1.5" fill="${C.track}"/>
  <rect x="${L.bar.x}" y="${L.bar.y}" width="${n(L.bar.w * p)}" height="${L.bar.h}" rx="1.5" fill="${C.fill}"/>
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

interface Manifest { duration: number; cues: { text: string; start: number }[] }
interface PubDoc {
  book: string;
  shot: Shot;
  parts: { part: string; scenes?: { at: string; shot: Shot }[] }[];
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

    const dir = `${partDir}/scenes`;
    // 全清再出：留着上一版的残图，concat 按清单拼不会用到它们，
    // 但人去翻目录会以为那是这一版的
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // ── 排图：常规每 STEP 秒一张；换镜位处插 BLEND_STEPS 张淡化 ──
    // 清单里带**每张的时长**，`zhiyu-video.ts` 照它拼，不再假设固定 STEP
    const shots: { file: string; dur: number; shot: Shot }[] = [];
    const shotAt = (t: number) => {
      let cur = plan[0].shot;
      for (const s of plan) if (s.t <= t) cur = s.shot;
      return cur;
    };
    const emit = (spec: SceneSpec, dur: number) => {
      const file = `${String(shots.length + 1).padStart(3, '0')}.png`;
      writeFileSync(`${dir}/${file}`, png(sceneSvg(spec)));
      shots.push({ file, dur, shot: spec.into ?? spec.shot });
    };

    let t = 0;
    while (t < m.duration - 0.05) {
      const cur = shotAt(t);
      const next = plan.find((s) => s.t > t && s.t <= t + STEP);
      if (next) {
        // 走到切点：先补齐切点前那一小段，再淡化过去（淡化跨在切点两侧）
        const lead = Math.max(0, next.t - t - BLEND_SEC / 2);
        if (lead > 0.05)
          emit({ title: doc.book, sub: `${p.part}篇`, progress: (t + lead) / m.duration, shot: cur }, lead);
        t += lead;
        for (let i = 1; i <= BLEND_STEPS; i++) {
          const d = BLEND_SEC / BLEND_STEPS;
          emit(
            { title: doc.book, sub: `${p.part}篇`, progress: (t + d) / m.duration, shot: cur, into: next.shot, blend: i / BLEND_STEPS },
            d
          );
          t += d;
        }
      } else {
        const d = Math.min(STEP, m.duration - t);
        emit({ title: doc.book, sub: `${p.part}篇`, progress: (t + d) / m.duration, shot: cur }, d);
        t += d;
      }
    }
    writeFileSync(`${dir}/scenes.json`, JSON.stringify({ duration: m.duration, step: STEP, shots }, null, 1));

    console.log(`${p.part}篇　${shots.length} 张 → ${dir}/`);
    for (const s of plan) console.log(`  ${mmss(s.t).padStart(6)}　${s.shot}`);
    console.log(
      plan.length === 1
        ? `  一景不换，只有底部那条线在走`
        : `  换 ${plan.length - 1} 次，每次 ${BLEND_SEC}s 交叉淡化（**不硬切** —— 深夜档一次硬切就是一次睁眼）`
    );
  }
}

if (process.argv[1]?.includes('zhiyu-scene')) main();
