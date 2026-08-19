import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { morph, durationOf, MorphParams } from "./chain";

export const CACHE_DIR = path.resolve(__dirname, "..", ".cache");
export const OUT_DIR = path.resolve(__dirname, "..", "out");
fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const escapeSSML = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * 文本 → 基础人声（走 Edge 朗读接口，免 key，需联网）
 * 服务端只接受 mp3/opus，所以基础音是 mp3，后面 ffmpeg 一步转 wav。
 */
export async function synthesize(
  text: string,
  voice: string,
  prosody?: { rate?: string; pitch?: string },
): Promise<string> {
  const key = hash(["tts", text, voice, JSON.stringify(prosody ?? {})]);
  const file = path.join(CACHE_DIR, `base-${key}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1024) return file;

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeSSML(text), prosody as any);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (c: Buffer) => chunks.push(c));
      audioStream.on("end", resolve);
      audioStream.on("error", reject);
      setTimeout(() => reject(new Error("TTS 超时（30s）—— 检查网络或代理")), 30_000);
    });
    const buf = Buffer.concat(chunks);
    if (buf.length < 1024) throw new Error(`Edge 返回的音频为空，音色名可能不对：${voice}`);
    fs.writeFileSync(file, buf);
    return file;
  } finally {
    try {
      tts.close();
    } catch {}
  }
}

export type RenderRequest = {
  text: string;
  voice: string;
  params: MorphParams;
  prosody?: { rate?: string; pitch?: string };
  /** 落到 out/ 而不是 .cache/，并用这个名字 */
  outName?: string;
};

export type RenderResult = {
  file: string;
  duration: number;
  degraded: boolean;
  cached: boolean;
};

/** 完整链路：文本 → 基础人声 → 变声 */
export async function render(req: RenderRequest): Promise<RenderResult> {
  const base = await synthesize(req.text, req.voice, req.prosody);
  const key = hash(["morph", base, JSON.stringify(req.params)]);
  const file = req.outName ? path.join(OUT_DIR, `${req.outName}.wav`) : path.join(CACHE_DIR, `mix-${key}.wav`);

  if (!req.outName && fs.existsSync(file) && fs.statSync(file).size > 1024) {
    return { file, duration: await durationOf(file), degraded: false, cached: true };
  }
  const { degraded } = await morph(base, file, req.params);
  return { file, duration: await durationOf(file), degraded, cached: false };
}

function hash(parts: string[]): string {
  return createHash("sha1").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}
