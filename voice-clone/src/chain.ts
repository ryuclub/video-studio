import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export const SR = 48000;

export type MorphParams = {
  pitch: number;
  formant: number;
  tempo: number;
  tone?: string[];
};

let rubberbandCache: boolean | null = null;

/** rubberband 是编译期可选滤镜，很多 ffmpeg 发行版没带 */
export async function hasRubberband(): Promise<boolean> {
  if (rubberbandCache !== null) return rubberbandCache;
  try {
    const { stdout } = await exec("ffmpeg", ["-hide_banner", "-filters"], { maxBuffer: 1 << 24 });
    rubberbandCache = /\brubberband\b/.test(stdout);
  } catch {
    rubberbandCache = false;
  }
  return rubberbandCache;
}

export async function ffmpegVersion(): Promise<string> {
  const { stdout } = await exec("ffmpeg", ["-version"]);
  return stdout.split("\n")[0] ?? "";
}

/**
 * atempo 单级只接受 0.5–100，超出范围要拆成多级串联。
 */
function atempoChain(factor: number): string[] {
  const out: string[] = [];
  let f = factor;
  if (!isFinite(f) || f <= 0) return [];
  while (f < 0.5) {
    out.push("atempo=0.5");
    f /= 0.5;
  }
  while (f > 2) {
    out.push("atempo=2.0");
    f /= 2;
  }
  if (Math.abs(f - 1) > 1e-4) out.push(`atempo=${f.toFixed(6)}`);
  return out;
}

/**
 * 构造滤镜链。
 *
 * 有 rubberband 时分两级，实现 pitch 与 formant 解耦：
 *   ① asetrate + atempo 把音高和共振峰一起推到 formant 倍率，时长复原
 *   ② rubberband 只把音高拉回目标值（formant=preserved 保住①推上去的共振峰）
 * 结果：共振峰 = formant，音高 = pitch，两者独立。
 *
 * 没有 rubberband 时退化成单级重采样，pitch 与 formant 锁死在一起
 * （取 pitch 值，忽略 formant），角色区分度会打折。
 */
export async function buildFilter(p: MorphParams): Promise<{ filter: string; degraded: boolean }> {
  const pitch = clamp(p.pitch, 0.4, 2.6);
  const formant = clamp(p.formant, 0.4, 2.0);
  const tempo = clamp(p.tempo, 0.5, 2.0);
  const rb = await hasRubberband();
  const parts: string[] = [];

  // asetrate 是「改写采样率标记」，实际速度倍率 = 目标值 / 输入真实采样率。
  // 基础音是 24kHz 的 mp3，不先归一化到 SR，后面每个 asetrate 都会白送
  // 48000/24000 = 2 倍的加速。必须放在链首。
  parts.push(`aresample=${SR}`);

  if (rb) {
    if (Math.abs(formant - 1) > 1e-3) {
      parts.push(`asetrate=${Math.round(SR * formant)}`, `aresample=${SR}`, ...atempoChain(1 / formant));
    }
    const residual = pitch / formant;
    if (Math.abs(residual - 1) > 1e-3) {
      parts.push(`rubberband=pitch=${residual.toFixed(6)}:formant=preserved:pitchq=quality:channels=together`);
    }
  } else if (Math.abs(pitch - 1) > 1e-3) {
    parts.push(`asetrate=${Math.round(SR * pitch)}`, `aresample=${SR}`, ...atempoChain(1 / pitch));
  }

  parts.push(...atempoChain(tempo));
  if (p.tone?.length) parts.push(...p.tone);
  // 统一响度，方便 A/B 试听时不被音量大小误导
  parts.push("loudnorm=I=-18:TP=-2:LRA=9", `aformat=sample_rates=${SR}:channel_layouts=mono`);

  return { filter: parts.join(","), degraded: !rb };
}

export async function morph(inputWav: string, outputWav: string, p: MorphParams): Promise<{ degraded: boolean }> {
  const { filter, degraded } = await buildFilter(p);
  await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inputWav, "-af", filter, "-ar", String(SR), "-ac", "1", outputWav], {
    maxBuffer: 1 << 24,
  });
  return { degraded };
}

export async function durationOf(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
  return Number(stdout.trim()) || 0;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, Number(v)));
}
