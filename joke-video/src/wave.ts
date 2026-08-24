// ── 音波层：一条跟着声音跳的方块柱 ────────────────────────────────────
//
// 来源是 `E:\ryu\醒木不响\waveanim6.mjs` 的原型，整合进管线时改了四处，
// 每一处都在下面写了为什么。**四条静态画面的线共用**：说书 / 治愈 /
// 小故事大道理（禅佛典）/ 心理洞察 —— 它们的画面都是静止的 PNG 拼接，
// 十几二十分钟一张脸不动的画最怕「像张图不像个片子」，这一条动的东西就是解药。
//
// ── 为什么不是逐帧渲染整片 ──
//
// 20 分钟 × 20fps = 25000 帧。但柱子的高度是**整数个方块**（1～8 块），
// 所以真正不同的画面只有几千张。按「每根柱子几块 + 进度切到第几根」做 key 缓存，
// 渲的张数掉一个数量级，重复的帧在 concat 清单里指回同一个文件。
//
// ── 用法 ──
//
//   const w = buildWave({ wavPath, outDir, delay: 1.5 });
//   ffmpeg -f concat -safe 0 -i w.list …  再 overlay 到画面上
//
// 出来的清单是**按 20fps 排好时长的**，跟画面那条 concat 各走各的，
// overlay 会自己对齐时间轴。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

export interface WaveSpec {
  /** 算闸门用的音轨。**要整期那一条**，不是分段的 */
  wavPath: string;
  /** 帧缓存目录（会先清空） */
  outDir: string;
  /** 片头封面几秒 —— 那几秒音波不出来，压一张全透明的帧 */
  delay?: number;
  /** 只画前 N 秒（默认整条音轨） */
  dur?: number;
  fps?: number;
  /** 深色（已经过去的那截） */
  accent?: string;
  /** 浅色（还没到的那截） */
  sub?: string;
  /**
   * 几根柱子（画布宽度跟着算）。默认 22 根 = 640px。
   *
   * **不是缩放，是减根数。** 画面塞不下的时候第一反应是把整块缩小，
   * 那会把方块从 11px 缩成 5px —— 木刻活字的块感就没了，看着像一排噪点。
   * 少画几根，块还是那么大。
   */
  bars?: number;
}

export interface WaveOut {
  /** concat 清单路径 */
  list: string;
  w: number;
  h: number;
  /** 排了多少帧 */
  frames: number;
  /** 真渲了多少张（缓存之后） */
  unique: number;
  seconds: number;
}

const C = {
  fps: 20,
  /** 循环长度。柱子的随机是**无缝循环**的，10 秒一轮，看不出接缝 */
  loopSec: 10,
  W: 640,
  H: 150,
  accent: '#8C6A4A',
  sub: '#C4A882',
  n: 22,
  barW: 16,
  barGap: 13,
  maxH: 104,
  block: 11,
  gap: 3,
};

/**
 * 进度扫描：深色从左往右吃过去，看得出「听到哪儿了」。
 *
 * ⚠ **原型里这一段是坏的**：`draw(row, C.W*(0.12+0.76*f/N))` 传进去的已经是
 * 「比例 × 画布宽」，函数里又乘了一次 `C.W`，切点永远在画布外面，
 * 结果整条柱子从头到尾都是深色 —— 进度这件事等于没做。
 * 这里按它**本来的意思**实现（传比例）。不想要两截颜色就把这个关掉。
 */
const PROGRESS = true;

// ── 柱子的高度：多个正弦叠加，频率取整数倍，保证首尾无缝 ──────────────
//
// **不用 Math.random。** 随机一次一个样，改一行代码重出的片子跟上一版对不上，
// diff 就没意义了（管线里别处也是这个规矩）。

function makeBars(n: number): number[][] {
  const L = C.loopSec * C.fps;
  const rng = ((s: number) => () => ((s = (s * 1103515245 + 12345) & 0x7fffffff), s / 0x7fffffff))(77003);
  const specs: { k: number; ph: number; a: number }[][] = [];
  for (let i = 0; i < n; i++)
    specs.push([1, 2, 3].map(() => ({ k: 1 + Math.floor(rng() * 5), ph: rng() * Math.PI * 2, a: rng() })));

  const out: number[][] = [];
  for (let f = 0; f < L; f++) {
    const row: number[] = [];
    for (let i = 0; i < n; i++) {
      let v = 0, sum = 0;
      for (const s of specs[i]) {
        v += s.a * Math.sin((2 * Math.PI * s.k * f) / L + s.ph);
        sum += s.a;
      }
      row.push(Math.max(0.06, (v / sum) * 0.5 + 0.5) ** 1.5);
    }
    out.push(row);
  }
  return out;
}

// ── 音量闸门 ──────────────────────────────────────────────────────────

/** 16bit PCM 单声道。**不接别的格式** —— 静默读错比报错难查一百倍 */
function readWavMono(p: string): { pcm: Int16Array; sr: number } {
  const b = readFileSync(p);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`${p} 不是 WAV`);
  let pos = 12, fmt: { ch: number; sr: number; bits: number } | null = null;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    if (id === 'data') {
      if (!fmt) throw new Error(`${p} 的 data 块在 fmt 之前`);
      if (fmt.bits !== 16) throw new Error(`${p} 是 ${fmt.bits} bit，音波层只读 16bit PCM`);
      const n = Math.floor(Math.min(size, b.length - body) / 2);
      const all = new Int16Array(n);
      for (let i = 0; i < n; i++) all[i] = b.readInt16LE(body + i * 2);
      if (fmt.ch === 1) return { pcm: all, sr: fmt.sr };
      // 多声道就取左声道，不做混合：闸门只要包络，混不混听不出来
      const mono = new Int16Array(Math.floor(n / fmt.ch));
      for (let i = 0; i < mono.length; i++) mono[i] = all[i * fmt.ch];
      return { pcm: mono, sr: fmt.sr };
    }
    pos = body + size + (size & 1);
  }
  throw new Error(`${p} 里没有 data 块`);
}

/**
 * 每帧一个 0.12–1 的开度。
 *
 * 两处跟原型不一样：
 *
 * ① **增益自动定，不写死 ×6。** 原型那个 6 是配着它自己合成的测试音（幅度 0.2）
 *    调出来的。真音轨各条线响度不同（说书 −17.2 LUFS、治愈更轻），写死的话
 *    要么整条贴顶不动、要么整条趴着不动 —— **两种坏法都不报错**。
 *    现在按「说话帧的 90 分位 ≈ 0.9 开度」反推增益。
 * ② 静音帧不参与定标（p90 只在有声的帧里取），否则长停顿多的一期会被抬爆。
 *
 * 平滑是不对称的：起得快（0.5）落得慢（0.09），跟真嘴一样 —— 对称平滑看着像呼吸机。
 */
function gate(pcm: Int16Array, sr: number, fps: number, frames: number): number[] {
  const w = Math.floor(sr / fps);
  const rms: number[] = [];
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const v = (pcm[f * w + i] ?? 0) / 32768;
      s += v * v;
    }
    rms.push(Math.sqrt(s / w));
  }
  const voiced = rms.filter((v) => v > 0.004).sort((a, b) => a - b);
  const p90 = voiced.length ? voiced[Math.floor(voiced.length * 0.9)] : 0.15;
  const gain = 0.9 / Math.max(0.02, p90);

  let c = 0;
  return rms.map((v) => {
    const t = Math.min(1, v * gain);
    c += (t - c) * (t > c ? 0.5 : 0.09);
    return 0.12 + 0.88 * c;
  });
}

// ── 画 ────────────────────────────────────────────────────────────────

/** 画布宽度按根数算：两边各留 24px */
function canvasW(n: number): number {
  return n * C.barW + (n - 1) * C.barGap + 48;
}

/** 柱子由小方块堆起来，不是一根实心条 —— 呼应木刻活字的质感 */
function draw(counts: number[], cutBar: number, accent: string, sub: string): string {
  const n = counts.length;
  const W = canvasW(n);
  const total = n * C.barW + (n - 1) * C.barGap;
  const x0 = (W - total) / 2;
  const base = C.H - 6;
  let g = '';
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (C.barW + C.barGap);
    const on = i < cutBar;
    const col = on ? accent : sub;
    const op = on ? 0.88 : 0.45;
    for (let b = 0; b < counts[i]; b++) {
      const y = base - (b + 1) * (C.block + C.gap);
      g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${C.barW}" height="${C.block}" rx="2.5" fill="${col}" fill-opacity="${op}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${C.H}" viewBox="0 0 ${W} ${C.H}">${g}</svg>`;
}

/** 高度 → 方块数。**缓存的 key 就是这一串整数**，所以量化要在这儿做 */
function blocks(v: number): number {
  const h = Math.max(C.block, v * C.maxH);
  return Math.max(1, Math.round(h / (C.block + C.gap)));
}

export function buildWave(s: WaveSpec): WaveOut {
  const fps = s.fps ?? C.fps;
  const accent = s.accent ?? C.accent;
  const sub = s.sub ?? C.sub;
  const delay = s.delay ?? 0;

  const bars = s.bars ?? C.n;
  const { pcm, sr } = readWavMono(s.wavPath);
  const seconds = s.dur ?? pcm.length / sr;
  const frames = Math.max(1, Math.floor(seconds * fps));

  const loop = makeBars(bars);
  const gt = gate(pcm, sr, fps, frames);

  // maxRetries：上一次出片被掐断的话，Windows 上那个目录会短暂锁着，
  // 直接 rm 会 **EPERM**（实测遇到过一次，整条出片就停在这儿）
  rmSync(s.outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  mkdirSync(s.outDir, { recursive: true });

  const cache = new Map<string, string>();
  // ⚠ **`loadSystemFonts: false` 是性能命门，不是洁癖。** resvg 默认会去扫系统字体，
  // 这台机器上一次扫要 0.5 秒 —— 而这里要渲上万张。第一版没关，实测**每秒只出 2 张**，
  // 二十分钟的片子得跑四个钟头。音波层一个字都没有，字体一个都不用加载。
  const png = (svg: string, name: string) => {
    const p = `${s.outDir}/${name}.png`;
    writeFileSync(p, new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng());
    return p;
  };
  const abs = (p: string) => resolve(p).replace(/\\/g, '/');

  const lines: string[] = [];
  if (delay > 0) {
    // 片头封面那几秒：压一张全透明的帧。**不能直接不给** ——
    // overlay 的两条输入错开起点，后面整条会跟着偏
    const blank = png(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW(bars)}" height="${C.H}"/>`, 'blank');
    lines.push(`file '${abs(blank)}'`, `duration ${delay.toFixed(3)}`);
  }

  let last = '';
  for (let f = 0; f < frames; f++) {
    const row = loop[f % loop.length];
    const counts = row.map((v) => blocks(v * gt[f]));
    const cutBar = PROGRESS ? Math.round((0.12 + 0.76 * (f / frames)) * bars) : bars;
    const key = `${counts.join('')}-${cutBar}`;
    let file = cache.get(key);
    if (!file) {
      file = png(draw(counts, cutBar, accent, sub), `w${String(cache.size).padStart(5, '0')}`);
      cache.set(key, file);
    }
    lines.push(`file '${abs(file)}'`, `duration ${(1 / fps).toFixed(4)}`);
    last = file;
  }
  // concat 解复用器忽略最后一条的 duration，末帧要再写一遍才撑得到片尾
  lines.push(`file '${abs(last)}'`);

  const list = `${s.outDir}/_wave.txt`;
  writeFileSync(list, lines.join('\n') + '\n');
  return { list, w: canvasW(bars), h: C.H, frames, unique: cache.size, seconds };
}

/**
 * 说书线：**左上角**，22 根 640px。
 * 右栏整条是题字和幕名，底下整条是字幕（字幕两倍大之后更挤），
 * 剩下的大片留白在左上。
 */
export const WAVE_POS = { x: 72, y: 58 };

/**
 * 治愈 / 小故事大道理 / 心理洞察：**贴着画面下沿占满一整行**，字幕排在它上面
 * （2026-08-24 用户定）。
 *
 * 65 根柱子正好是 1920：`65×16 + 64×13 + 48 = 1920`。**用加根数占满，不是把 640 那版拉宽** ——
 * 拉宽会把 16px 的方块拉成 48px 的长条，木刻活字的块感当场没了。
 *
 * 柱子从画布底往上长，最高 8 块 = 112px，所以**画面上真正被占住的是 y 962–1074**。
 * 字幕的 `MarginV` 要躲开这一段（见 `zhiyu-video.ts`）。
 *
 * ⚠ 它盖住了进度线和蜗牛（那条线在 y≈1000）。音波自己带进度（深浅两截），
 * 两个东西说的是同一件事，先这么放着；真要留蜗牛，把 y 抬到 800 上下。
 */
export const WAVE_POS_ZHIYU = { x: 0, y: 930 };
/** 治愈那一档占满一行要几根 */
export const WAVE_BARS_ZHIYU = 65;
