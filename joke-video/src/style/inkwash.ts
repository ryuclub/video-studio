// ── 水墨基元：给说书用的静态画面 ────────────────────────────────────────
//
// 为什么不能沿用剪纸风：剪纸是**平涂色块 + 明亮配色**，做儿童向段子对，
// 做聊斋就是灾难——鬼故事配上朱红嫩绿的色块，气质当场垮掉。
//
// 水墨这一套的三条规矩：
//   ① **留白是主角。** 画面七成是空的宣纸，主体只占一角
//   ② **只有一个颜色** —— 墨。深浅靠透明度，不靠色相。唯一的例外是印章的朱红
//   ③ **边缘要湿。** 干净的矢量边看着像 PPT 剪贴画；墨在纸上会洇开，
//      靠 feTurbulence + feDisplacementMap 把边推乱，这一步是像不像的分水岭
//
// 跟剪纸风的另一个不同：**这里用 SVG 滤镜**。剪纸风刻意不用（每帧都要渲，
// 滤镜慢 10 倍），但说书是静态画面，一期只渲二十来张，慢十倍也就几秒钟。

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const INK = {
  /** 宣纸。偏黄，不要用纯白——白纸配墨是打印稿，不是画 */
  paper: '#EDE4D2',
  paperDeep: '#DFD3BC',
  /** 浓墨。带一点蓝比纯黑更像墨 */
  ink: '#1A2028',
  /** 淡墨（远景） */
  wash: '#4A5560',
  /** 朱砂，只给印章和唯一的那点血 */
  cinnabar: '#A62A21',
};

/**
 * 题字的静态字重文件。**要粗体就必须喂它。**
 *
 * ⚠ 系统里装的是 `NotoSerifSC-VF.ttf`（可变字体），resvg 只认它的默认实例：
 * 写 `font-weight="700"` 渲出来跟 400 **一模一样，而且不报错**——
 * 实测同一段字两个字重的 PNG **字节数完全相同**（`fonts/README.md` 警告过同一件事）。
 * 仓库里 `fonts/NotoSerifCJKsc/OTF/` 是一档一个文件的静态字重，喂进去才真的变粗。
 *
 * 路径按**本文件**算，不按 cwd —— 场景图既可能从 `joke-video/` 跑，
 * 也可能被 `shuoshu-ship.ts` 拉起来跑。
 */
export const INK_FONT_FILES: string[] = ['Bold', 'SemiBold', 'Medium', 'Regular']
  .map((w) =>
    fileURLToPath(new URL(`../../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/NotoSerifCJKsc-${w}.otf`, import.meta.url))
  )
  .filter(existsSync);

/**
 * 题字用宋体族。黑体太现代，聊斋要衬线。
 *
 * 有静态字重文件就认 `Noto Serif CJK SC`（那是那几个 otf 的族名），
 * 没有才退回系统的思源宋 —— 退回去之后**粗体是假的**（见上）。
 */
export const INK_FONT =
  process.env.SHUOSHU_FONT ||
  (INK_FONT_FILES.length
    ? 'Noto Serif CJK SC, Noto Serif SC, SimSun, serif'
    : 'Noto Serif SC, Source Han Serif SC, SimSun, STSong, Songti SC, Microsoft YaHei, serif');

/** 字重文件缺了要吼一声。静默变细是这条线最难发现的那类问题 */
export function warnIfNoWeights(): void {
  if (INK_FONT_FILES.length) return;
  console.log(
    '! 没找到 fonts/NotoSerifCJKsc/OTF/ —— 题字和幕名的加粗会静默失效（渲出来是常规字重）。\n' +
      '  下载方式见 fonts/README.md'
  );
}

export const n = (v: number) => Math.round(v * 100) / 100;

/** 可复现随机：同一 seed 每次渲出来一模一样，改稿时 diff 才有意义 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function path(pts: [number, number][], close = true): string {
  if (!pts.length) return '';
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += ` L${n(pts[i][0])} ${n(pts[i][1])}`;
  return close ? d + ' Z' : d;
}

/**
 * 湿边滤镜。**这是整套风格的核心。**
 * @param scale 边缘被推乱的幅度。远景大（墨洇得开），近景小（笔锋清楚）
 */
export function wetFilter(id: string, seed: number, scale = 14, freq = 0.028, blur = 1.1): string {
  return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="3" seed="${seed}" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/>
    <feGaussianBlur stdDeviation="${blur}"/>
  </filter>`;
}

/** 飞白：笔画中间露出的纸。用一层带孔的噪声盖在墨上 */
export function drySweepFilter(id: string, seed: number): string {
  return `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.9 0.02" numOctaves="2" seed="${seed}" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1.6 0 0 0 -0.42" result="m"/>
    <feComposite in="SourceGraphic" in2="m" operator="out"/>
  </filter>`;
}

/** 宣纸底：底色 + 纤维 + 几处陈年水渍 */
export function paperBg(w: number, h: number, seed = 7): string {
  const r = rng(seed);
  let stains = '';
  for (let i = 0; i < 5; i++) {
    const cx = r() * w;
    const cy = r() * h;
    const rr = 90 + r() * 220;
    stains += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rr)}" ry="${n(rr * (0.5 + r() * 0.5))}" fill="${INK.paperDeep}" opacity="${n(0.1 + r() * 0.12)}" filter="url(#stainBlur)"/>`;
  }
  return `<rect width="${w}" height="${h}" fill="${INK.paper}"/>
  <g>${stains}</g>
  <rect width="${w}" height="${h}" fill="#8a7a5e" opacity="0.16" filter="url(#fiber)"/>`;
}

/** 纸纹和水渍要用的滤镜，跟 paperBg 配套 */
export function paperDefs(): string {
  return `<filter id="fiber" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.4" numOctaves="3" seed="3" result="t"/>
    <feColorMatrix in="t" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.22  0.5 0.5 0.5 0 -0.42"/>
  </filter>
  <filter id="stainBlur" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="26"/>
  </filter>`;
}

/**
 * 山脊。一条起伏的折线，右端沉下去收尾。
 * 远山用大 alpha 小 opacity，层数越多越有纵深。
 */
export function ridge(w: number, baseY: number, amp: number, seed: number, steps = 26): [number, number][] {
  const r = rng(seed);
  const pts: [number, number][] = [[-40, baseY + amp * 1.4]];
  let y = baseY;
  for (let i = 0; i <= steps; i++) {
    const x = (-40 + (w + 80) * i) / steps;
    // 前三分之一抬起来做主峰，后面缓缓落下去
    const shape = Math.sin((i / steps) * Math.PI * 0.85 + 0.3);
    y = baseY - shape * amp * (0.6 + r() * 0.5);
    pts.push([x, y]);
  }
  pts.push([w + 40, baseY + amp * 1.4]);
  return pts;
}

/**
 * 一笔。给一串骨架点生成有粗细变化的笔触轮廓（起笔重、收笔轻）。
 * 直接画 stroke 得到的是等宽线，那是钢笔不是毛笔。
 */
export function brush(pts: [number, number][], w0: number, w1 = w0 * 0.25): string {
  if (pts.length < 2) return '';
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[Math.min(i + 1, pts.length - 1)];
    const o = pts[Math.max(i - 1, 0)];
    const dx = q[0] - o[0];
    const dy = q[1] - o[1];
    const len = Math.hypot(dx, dy) || 1;
    const t = i / (pts.length - 1);
    const wid = (w0 + (w1 - w0) * t) / 2;
    const nx = (-dy / len) * wid;
    const ny = (dx / len) * wid;
    left.push([p[0] + nx, p[1] + ny]);
    right.push([p[0] - nx, p[1] - ny]);
  }
  return path([...left, ...right.reverse()]);
}

/** 墨点／飞溅 */
export function splatter(cx: number, cy: number, spread: number, count: number, seed: number, size = 5): string {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.6) * spread;
    const rr = size * (0.25 + r() * 1.1);
    out += `<ellipse cx="${n(cx + Math.cos(a) * d)}" cy="${n(cy + Math.sin(a) * d * 0.7)}" rx="${n(rr)}" ry="${n(rr * (0.6 + r() * 0.6))}" fill="${INK.ink}" opacity="${n(0.25 + r() * 0.5)}"/>`;
  }
  return out;
}

/**
 * 竖排题字。resvg 的 writing-mode 支持不可靠，所以一个字一个 <text>，
 * 自己算 y。**这是画面里唯一的"信息"**，其余全是氛围。
 */
/**
 * 竖排文字。`outline` 给了就是**描边字**：一个字画两遍。
 *
 * ⚠ **描边不能只画一遍。** SVG 的 stroke 是**骑在轮廓线上**的，一半宽度落在字里面，
 * 描粗一点宋体那些细横就被吃光了。所以先画一遍只有 stroke 的（在下面），
 * 再画一遍只有 fill 的盖上去 —— 露出来的就只剩外面那一半。
 * 宽度取字号的 7%（60px 的字 ≈ 4.2px，进到字里 2.1px），再粗就开始糊字内白。
 */
export function vtext(
  x: number,
  y: number,
  text: string,
  size: number,
  o: {
    fill?: string;
    opacity?: number;
    gap?: number;
    weight?: number;
    /** 描边色。给了就画两遍 */
    outline?: string;
    /** 描边宽度，缺省 = 字号 × 0.07 */
    outlineWidth?: number;
  } = {}
): string {
  const gap = o.gap ?? size * 1.18;
  const common = (i: number) =>
    `x="${n(x)}" y="${n(y + i * gap)}" font-family="${INK_FONT}" font-size="${size}" font-weight="${o.weight ?? 400}" text-anchor="middle"`;
  const op = o.opacity ?? 0.92;
  return text
    .split('')
    .map((ch, i) => {
      const g = escapeXml(ch);
      const face = `<text ${common(i)} fill="${o.fill ?? INK.ink}" opacity="${op}">${g}</text>`;
      if (!o.outline) return face;
      const w = o.outlineWidth ?? size * 0.07;
      return (
        `<text ${common(i)} fill="none" stroke="${o.outline}" stroke-width="${n(w)}" stroke-linejoin="round" opacity="${op}">${g}</text>` +
        face
      );
    })
    .join('');
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 朱红印章。**画面里唯一的彩色**，位置固定在题字下方。
 * 有它和没它差别极大——一方红印立刻把"抽象墨块"变成"一张画"。
 */
export function seal(x: number, y: number, size: number, chars: string): string {
  const pad = size * 0.16;
  const font = chars.length <= 2 ? size * 0.42 : size * 0.33;
  const cols = chars.length <= 2 ? 1 : 2;
  const per = Math.ceil(chars.length / cols);
  let text = '';
  for (let c = 0; c < cols; c++) {
    const cx = cols === 1 ? x + size / 2 : x + size * (cols === 2 ? (c === 0 ? 0.72 : 0.28) : 0.5);
    for (let i = 0; i < per; i++) {
      const ch = chars[c * per + i];
      if (!ch) continue;
      const cy = y + pad + font * 0.92 + i * font * 1.16;
      text += `<text x="${n(cx)}" y="${n(cy)}" font-family="${INK_FONT}" font-size="${n(font)}" fill="${INK.paper}" text-anchor="middle">${escapeXml(ch)}</text>`;
    }
  }
  return `<g filter="url(#sealWet)">
    <rect x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" rx="${n(size * 0.06)}" fill="${INK.cinnabar}" opacity="0.88"/>
    ${text}
  </g>`;
}

/** 印章也要湿边，锐利的红方块看着像贴纸 */
export function sealDefs(): string {
  return `<filter id="sealWet" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="11" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
}
