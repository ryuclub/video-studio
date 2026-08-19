import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { CONFIG } from '../config.js';

const execFileAsync = promisify(execFile);

export async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await runCapture(cmd, args);
  return stdout;
}

/** ffmpeg 的分析类滤镜（volumedetect / astats）把结果写在 stderr，得单独拿 */
export async function runCapture(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, { maxBuffer: 64 * 1024 * 1024 });
}

export async function ffmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

/** 读取媒体文件时长（毫秒） */
export async function durationMs(file: string): Promise<number> {
  const out = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return Math.round(parseFloat(out.trim()) * 1000);
}

/**
 * 读音词典：TTS 读中文文本时，日语人名/机构名/专有名词经常出错。
 * 送进 TTS 前做整词替换（只影响发音，不影响屏幕上的字）。
 */
let lexiconCache: Array<[string, string]> | null = null;

export function applyLexicon(text: string): string {
  if (lexiconCache === null) {
    lexiconCache = [];
    if (fs.existsSync(CONFIG.lexiconFile)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG.lexiconFile, 'utf8')) as Record<string, string>;
      // 长词优先，避免短词先命中把长词切碎
      lexiconCache = Object.entries(raw).sort((a, b) => b[0].length - a[0].length);
    }
  }
  let out = text;
  for (const [from, to] of lexiconCache) {
    out = out.split(from).join(to);
  }
  return out;
}

export function log(step: string, msg: string): void {
  console.log(`  [${step}] ${msg}`);
}
