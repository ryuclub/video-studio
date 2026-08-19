import * as fs from 'node:fs';
import * as path from 'node:path';
import { run, encodeArgs, probeSvgSupport } from '../util/ffmpeg';
import type { EnterDir } from '../types';

/**
 * SVG 帧序列 → mp4。
 *
 * 这是整条管线里最省事的一招：不用 node-canvas、不用无头浏览器、不用任何原生模块。
 * 逐帧生成 SVG 字符串写盘，ffmpeg 自己光栅化（编译时带 --enable-librsvg 即可）。
 *
 * 好处：
 *  - 矢量渲染，任意分辨率都锐利，4K 输出不用改代码
 *  - 中日文字用系统字体正常排版，不会像 AI 视频那样把字画糊
 *  - 数据改了重跑一遍就行，完全可复现
 *
 * 兜底：Windows 上常见的 ffmpeg 构建（BtbN）不带 librsvg。
 * 检测不到就尝试用可选依赖 sharp 把 SVG 转 PNG 再喂给 ffmpeg。
 * 两条路都不通会给出明确的处置建议，而不是抛一个看不懂的 ffmpeg 错误。
 */

export type FrameFn = (t: number, index: number, total: number) => string;

export interface SvgRenderOpts {
  width: number;
  height: number;
  fps: number;
  duration: number;
  outFile: string;
  tmpDir: string;
  crf?: number;
  preset?: string;
  /**
   * 保留 alpha 通道。产物必须是 .mov —— mp4/h264 不能带透明。
   * 编码用 PNG-in-MOV：无损、有 alpha、编码快。
   * （qtrle 也能带 alpha，但 1080p RGBA 的 RLE 慢到不可用，实测过。）
   */
  alpha?: boolean;
}

export async function renderSvgSequence(frame: FrameFn, o: SvgRenderOpts): Promise<void> {
  const total = Math.max(1, Math.round(o.duration * o.fps));
  fs.mkdirSync(o.tmpDir, { recursive: true });

  const nativeSvg = await probeSvgSupport();
  const rasterizer = nativeSvg ? null : await loadSharp();

  if (!nativeSvg && !rasterizer) {
    throw new Error(
      [
        '当前 ffmpeg 不能解码 SVG，且没有找到可选依赖 sharp。二选一：',
        '  1) 换一个带 librsvg 的 ffmpeg 构建（Linux/macOS 的包管理器版本基本都带；',
        '     Windows 建议用 gyan.dev 的 full 版，或直接在 WSL 里跑这条管线）',
        '  2) npm i sharp   —— 有预编译二进制，Windows 也不需要编译工具链',
      ].join('\n'),
    );
  }

  const ext = nativeSvg ? 'svg' : 'png';
  const pad = 5;

  for (let i = 0; i < total; i++) {
    const t = i / o.fps;
    const svg = frame(t, i, total);
    const base = path.join(o.tmpDir, `f${String(i).padStart(pad, '0')}`);
    if (nativeSvg) {
      fs.writeFileSync(`${base}.svg`, svg, 'utf8');
    } else {
      const buf = await rasterizer!(svg, o.width, o.height);
      fs.writeFileSync(`${base}.png`, buf);
    }
  }

  if (o.alpha) {
    await run([
      '-y', '-loglevel', 'error',
      '-framerate', String(o.fps),
      '-i', path.join(o.tmpDir, `f%0${pad}d.${ext}`),
      '-vf', `scale=${o.width}:${o.height}:flags=lanczos,format=rgba`,
      '-r', String(o.fps),
      '-c:v', 'png',
      o.outFile,
    ]);
  } else {
    await run([
      '-y', '-loglevel', 'error',
      '-framerate', String(o.fps),
      '-i', path.join(o.tmpDir, `f%0${pad}d.${ext}`),
      '-vf', `scale=${o.width}:${o.height}:flags=lanczos,format=yuv420p`,
      '-r', String(o.fps),
      ...encodeArgs(o.crf ?? 18, o.preset ?? 'medium'),
      o.outFile,
    ]);
  }

  // 帧文件很占地方（4K SVG 序列几百 MB），渲完立刻清掉
  fs.rmSync(o.tmpDir, { recursive: true, force: true });
}

type Rasterizer = (svg: string, w: number, h: number) => Promise<Buffer>;

async function loadSharp(): Promise<Rasterizer | null> {
  try {
    // 可选依赖，用运行时 require 避免没装时编译/加载报错
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sharp = require('sharp');
    return async (svg, w, h) =>
      sharp(Buffer.from(svg), { density: 96 }).resize(w, h).png({ compressionLevel: 1 }).toBuffer();
  } catch {
    return null;
  }
}

// ── SVG 组装小工具 ──────────────────────────────────────────

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** easeOutCubic —— 动效的默认缓动。线性动画看起来很廉价，加个缓动立刻不一样 */
export function easeOut(p: number): number {
  const c = clamp01(p);
  return 1 - Math.pow(1 - c, 3);
}

export function easeInOut(p: number): number {
  const c = clamp01(p);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 入场：位移 + 淡入，返回可以直接塞进 <g> 的属性串。
 *
 * 把「一条」的所有元素（序号徽标 + 正文 + 小字）包在同一个 <g> 里一起动，
 * 比给每个元素单独算 dy 干净，也让「一条」在代码里成为一个整体。
 *
 * dist 由调用方给，因为各场景的字号不同：正文行用 24u，小字用 16~18u。
 * 方向的默认值写在各场景里，不写在这儿 —— 这里只负责算。
 */
export function enter(a: number, dir: EnterDir, dist: number): string {
  const d = 1 - clamp01(a);
  const [dx, dy] =
    dir === 'up' ? [0, d * dist]
    : dir === 'down' ? [0, -d * dist]
    : dir === 'left' ? [-d * dist, 0]
    : dir === 'right' ? [d * dist, 0]
    : [0, 0];
  return `transform="translate(${dx.toFixed(1)},${dy.toFixed(1)})" opacity="${clamp01(a).toFixed(3)}"`;
}

/** 把 0..1 的进度映射到「延迟 delay、持续 span」的局部进度，用来做交错入场 */
export function stagger(p: number, delay: number, span: number): number {
  return clamp01((p - delay) / span);
}
