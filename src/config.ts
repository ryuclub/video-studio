import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

export const CONFIG = {
  root: ROOT,
  /**
   * 这条线（记者读稿）的成品目录。
   *
   * **仓库里代码和成品是分开的**：代码在各条线自己的目录（`src/`、`joke-video/src/`），
   * 成品全部落在根级 `projects/<类型>/`。四条线各占一个子目录，
   * 别再往 `projects/` 根上直接写 —— 那儿现在只放类型文件夹和一份 README。
   *
   * joke-video 那三条线的出口在 `joke-video/src/paths.ts`，改路径要两边一起改。
   */
  projectsDir: path.join(ROOT, 'projects', '记者读稿'),
  assetsDir: path.join(ROOT, 'assets'),
  /** 素材缓存：同一个关键词只下载一次，跨项目复用 */
  cacheDir: path.join(ROOT, 'assets', 'cache'),
  lutFile: path.join(ROOT, 'assets', 'cold.cube'),
  lexiconFile: path.join(ROOT, 'assets', 'lexicon.json'),
  bgmFile: path.join(ROOT, 'assets', 'bgm.mp3'),

  anthropicKey: process.env.ANTHROPIC_API_KEY ?? '',
  /** 写稿模型。Sonnet 5 在长文写作上性价比最好；要更强可换 claude-opus-5 */
  model: process.env.VG_MODEL ?? 'claude-sonnet-5',

  pexelsKey: process.env.PEXELS_API_KEY ?? '',
  /** TTS 音色。zh-CN-YunjianNeural 偏叙事沉稳，适合这类解说 */
  voice: process.env.VG_VOICE ?? 'zh-CN-YunjianNeural',
  /** 语速，Edge TTS 的百分比写法 */
  rate: process.env.VG_RATE ?? '-4%',

  fps: 30,
  /** 中日文字体，需系统已安装 */
  fontName: process.env.VG_FONT ?? 'Noto Sans CJK SC',

  /**
   * 成片画质。x264 的 CRF，越大文件越小，合理区间 18–28。
   * 23 对「免版权空镜 + 字幕」这类素材肉眼几乎看不出与 20 的差别，体积少三成多。
   * 各家平台上传后都会二压，这里给太高的码率是白给。
   */
  crf: process.env.VG_CRF ?? '23',
  /** x264 预设。medium → slow 只省 3% 体积却翻倍耗时，不值 */
  preset: process.env.VG_PRESET ?? 'medium',
  /** 成片音频码率。人声是单声道升的立体声，128k 已经过剩 */
  audioBitrate: process.env.VG_AUDIO_BITRATE ?? '128k',
};

export function projectDir(name: string): string {
  return path.join(CONFIG.projectsDir, name);
}

export function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/** 把标题变成安全的目录名 */
export function slugify(title: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const safe = title
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${date}_${safe}`;
}
