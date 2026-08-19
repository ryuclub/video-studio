import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

let VERBOSE = false;
export function setVerbose(v: boolean) {
  VERBOSE = v;
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly args: string[],
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

/**
 * 执行 ffmpeg。stderr 全量捕获，失败时把最后 40 行连同完整参数抛出去 ——
 * ffmpeg 的滤镜链一旦写错，报错信息藏在 stderr 中段，只看 exit code 根本查不出问题。
 */
export function run(args: string[], bin = FFMPEG): Promise<string> {
  return new Promise((resolve, reject) => {
    if (VERBOSE) console.error(`  $ ${bin} ${args.map(quote).join(' ')}`);
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) =>
      reject(new FfmpegError(`无法启动 ${bin}：${e.message}（PATH 里有 ffmpeg 吗？）`, args, '')),
    );
    p.on('close', (code) => {
      if (code === 0) return resolve(out);
      const tail = err.trim().split('\n').slice(-40).join('\n');
      reject(new FfmpegError(`${bin} 退出码 ${code}`, args, tail));
    });
  });
}

function quote(s: string) {
  return /[\s"'|;&$*?()[\]]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/** 读取媒体文件的时长（秒） */
export async function probeDuration(file: string): Promise<number> {
  const out = await run(
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    FFPROBE,
  );
  const d = parseFloat(out.trim());
  if (!isFinite(d)) throw new Error(`无法读取时长：${file}`);
  return d;
}

/** 读取视频尺寸 */
export async function probeSize(file: string): Promise<{ width: number; height: number }> {
  const out = await run(
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      file,
    ],
    FFPROBE,
  );
  const parts = out.trim().split(',');
  return { width: parseInt(parts[0] ?? '0', 10), height: parseInt(parts[1] ?? '0', 10) };
}

/**
 * 探测当前 ffmpeg 是否能直接解码 SVG（需要编译时带 --enable-librsvg）。
 * Linux/macOS 的发行版包通常有；Windows 的 BtbN 构建通常没有。
 * 没有的话 renderer 会自动降级到 PNG 光栅化路径。
 */
let svgSupport: boolean | null = null;
export async function probeSvgSupport(): Promise<boolean> {
  if (svgSupport !== null) return svgSupport;
  const tmp = path.join(os.tmpdir(), `svgprobe-${process.pid}.svg`);
  const png = tmp.replace(/\.svg$/, '.png');
  fs.writeFileSync(
    tmp,
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
  );
  try {
    await run(['-y', '-v', 'error', '-i', tmp, '-frames:v', '1', '-update', '1', png]);
    svgSupport = fs.existsSync(png);
  } catch {
    svgSupport = false;
  } finally {
    for (const f of [tmp, png]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
  return svgSupport;
}

/** 通用的 x264 输出参数。crf 18 对解说片足够，再高看不出差别但体积翻倍 */
export function encodeArgs(crf = 18, preset = 'medium'): string[] {
  return [
    '-c:v', 'libx264',
    '-crf', String(crf),
    '-preset', preset,
    '-pix_fmt', 'yuv420p',
    // 关键帧密一点，方便后续 xfade / 剪辑时精确定位
    '-g', '60',
    '-movflags', '+faststart',
  ];
}
