import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG, ensureDir } from '../config.js';
import type { Script, Timeline, Shot, ShotClip, Orientation, ClipCredit } from '../types.js';
import { durationMs, log } from '../lib/util.js';

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  url: string;
  duration: number;
  user?: { name?: string; url?: string };
  video_files: PexelsVideoFile[];
}

/** 各朝向的目标分辨率，用来给检索结果打分 */
const TARGET: Record<Orientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

/** 小于这个体积的多半不是视频，而是被当成 mp4 存下来的错误页 */
const MIN_CLIP_BYTES = 100_000;

/** 一个镜头最多取这么多条素材，防止极短素材把镜头切成碎片 */
const MAX_CLIPS_PER_SHOT = 6;

export interface ShotGroup {
  keyword: string;
  startMs: number;
  endMs: number;
}

/**
 * 把行级时间轴折叠成镜头级：
 * 带 clip 的行开启一个新镜头，不带 clip 的行并入上一个镜头。
 *
 * 镜头必须无缝铺满整条音频 —— 音频（稿件）是主，画面是从。
 * 所以镜头的结束时间取「下一个镜头的开始时间」，而不是自己最后一行的 endMs：
 * 两者之间隔着该行的 pauseAfterMs，如果不吸收进来，每个镜头边界都会漏掉一段，
 * 累积起来画面总长比音频短好几秒，尾巴上的话就被切没了。
 */
export function groupShots(script: Script, timeline: Timeline): ShotGroup[] {
  if (timeline.lines.length !== script.lines.length) {
    throw new Error(
      `timeline 有 ${timeline.lines.length} 行、script 有 ${script.lines.length} 行，` +
        `script.json 改过之后要先重跑 tts`,
    );
  }

  const groups: ShotGroup[] = [];

  script.lines.forEach((line, i) => {
    const t = timeline.lines[i];
    if (line.clip && (groups.length === 0 || line.clip !== groups[groups.length - 1].keyword)) {
      groups.push({ keyword: line.clip, startMs: t.startMs, endMs: t.endMs });
    } else if (groups.length === 0) {
      groups.push({ keyword: 'abstract dark background', startMs: t.startMs, endMs: t.endMs });
    } else {
      groups[groups.length - 1].endMs = t.endMs;
    }
  });

  if (!groups.length) return groups;

  // 首镜头补到 0，中间每个镜头延长到下一个镜头开始，末镜头补到音频结束：
  // 铺满 [0, totalMs]，不留空洞
  groups[0].startMs = 0;
  for (let i = 0; i < groups.length - 1; i++) groups[i].endMs = groups[i + 1].startMs;
  groups[groups.length - 1].endMs = timeline.totalMs;
  return groups;
}

/**
 * 下载到临时文件，验完再改名。
 *
 * 之前这里是「fetch 完直接 writeFileSync」，没看状态码：403 或限流返回的 HTML
 * 会原样存成 mp4，而缓存只判断文件存在，于是这个关键词永久损坏、
 * 还跨项目污染，报错点漂到 ffmpeg 里非常难查。
 * 现在状态码、Content-Type、体积、能否被 ffprobe 解出时长，四道都过了才落盘。
 */
export async function download(url: string, dest: string, label: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${label}`);

  const type = res.headers.get('content-type') ?? '';
  if (!/^video\//.test(type)) throw new Error(`返回的不是视频（Content-Type: ${type}）${label}`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < MIN_CLIP_BYTES) throw new Error(`文件只有 ${buf.length}B，不像视频 ${label}`);

  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, buf);
  try {
    // 最后一道：ffprobe 解不出时长就是坏文件，绝不让它进缓存
    const ms = await durationMs(tmp);
    if (!Number.isFinite(ms) || ms <= 0) throw new Error('时长异常');
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`下载的文件无法解码 ${label}：${e instanceof Error ? e.message : e}`);
  }
  fs.renameSync(tmp, dest);
  return buf.length;
}

/**
 * 手动素材，分朝向、可多条：
 *   assets/manual/<keyword>.mp4            通用/横版第一条
 *   assets/manual/<keyword>_2.mp4          第二条，依次类推
 *   assets/manual/<keyword>_portrait.mp4   竖版专用
 *   assets/manual/<keyword>_portrait_2.mp4
 * 命中任何一组就整组使用，不再走检索。
 */
function manualFiles(keyword: string, orientation: Orientation): string[] {
  const stem = keyword.replace(/\s+/g, '_');
  const dir = path.join(CONFIG.assetsDir, 'manual');
  const bases = orientation === 'portrait' ? [`${stem}_portrait`, stem] : [stem];

  for (const base of bases) {
    const found: string[] = [];
    for (let i = 1; i <= MAX_CLIPS_PER_SHOT; i++) {
      const f = path.join(dir, i === 1 ? `${base}.mp4` : `${base}_${i}.mp4`);
      if (!fs.existsSync(f)) break;
      found.push(f);
    }
    if (found.length) return found;
  }
  return [];
}

/**
 * 每个「关键词 × 朝向」在缓存里有一份清单，记着已下载的素材、时长和出处。
 *
 * 用清单而不是按序号猜文件名：Pexels 的检索结果顺序会变，按序号缓存下次
 * 就对不上号了。清单还让「已经够了就完全不联网」成立 —— 缓存命中时
 * 一次 API 都不发。
 */
interface ClipManifest {
  keyword: string;
  orientation: Orientation;
  clips: ShotClip[];
}

function manifestPath(keyword: string, orientation: Orientation): string {
  const hash = crypto.createHash('md5').update(`${orientation}:${keyword}`).digest('hex').slice(0, 10);
  return path.join(CONFIG.cacheDir, `${hash}-${orientation}.json`);
}

function readManifest(keyword: string, orientation: Orientation): ClipManifest {
  const file = manifestPath(keyword, orientation);
  if (!fs.existsSync(file)) return { keyword, orientation, clips: [] };
  const m = JSON.parse(fs.readFileSync(file, 'utf8')) as ClipManifest;
  // 自愈：文件被删或是之前留下的中毒缓存，就从清单里剔除
  m.clips = m.clips.filter((c) => fs.existsSync(c.file) && fs.statSync(c.file).size >= MIN_CLIP_BYTES);
  return m;
}

const totalMsOf = (clips: ShotClip[]): number => clips.reduce((s, c) => s + c.durationMs, 0);

/**
 * 素材策略（三档）：
 *   A 免版权库（本文件实现）—— 空镜、人群、城市，占七成，零风险
 *   B AI 生成 —— 只用在 stack 组那几个情绪落点，手动放进 assets/manual/
 *   C 影视片段 —— 不用。Content ID 匹配日本影视素材很准，日更号被连续判定会废号
 *
 * 取够 needMs 为止：镜头有多长就配多少条素材，放完一条切下一条。
 */
async function resolveClips(
  keyword: string,
  orientation: Orientation,
  needMs: number,
): Promise<ShotClip[]> {
  const manual = manualFiles(keyword, orientation);
  if (manual.length) {
    const out: ShotClip[] = [];
    for (const file of manual) out.push({ file, durationMs: await durationMs(file) });
    return out;
  }

  ensureDir(CONFIG.cacheDir);
  const manifest = readManifest(keyword, orientation);
  if (totalMsOf(manifest.clips) >= needMs) return manifest.clips;

  if (!CONFIG.pexelsKey) {
    if (manifest.clips.length) return manifest.clips;
    throw new Error('缺少 PEXELS_API_KEY，且没有对应的手动素材');
  }

  const url =
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}` +
    `&orientation=${orientation}&size=medium&per_page=20`;
  const res = await fetch(url, { headers: { Authorization: CONFIG.pexelsKey } });
  if (!res.ok) throw new Error(`Pexels ${res.status} for "${keyword}"`);
  const data = (await res.json()) as { videos: PexelsVideo[] };
  if (!data.videos?.length) throw new Error(`没有找到素材: "${keyword}" (${orientation})`);

  // 每条视频挑一个最合规格的档位，再按「离目标画幅的距离」给视频排序。
  // 带着 video 一起传，否则选完就不知道这个文件属于哪位摄影师了
  const want = TARGET[orientation];
  const score = (f: PexelsVideoFile) =>
    Math.abs(f.width - want.width) + Math.abs(f.height - want.height);

  const ranked = data.videos
    .filter((v) => v.duration >= 3)
    .map((v) => {
      const best = v.video_files
        .filter(
          (f) =>
            f.file_type === 'video/mp4' &&
            f.width >= want.width * 0.6 &&
            f.height >= want.height * 0.6 &&
            (orientation === 'portrait' ? f.height > f.width : f.width > f.height),
        )
        .sort((a, b) => score(a) - score(b))[0];
      return best ? { video: v, file: best } : null;
    })
    .filter((x): x is { video: PexelsVideo; file: PexelsVideoFile } => x !== null)
    .sort((a, b) => score(a.file) - score(b.file));

  if (!ranked.length && !manifest.clips.length) {
    throw new Error(`素材不合规格: "${keyword}" (${orientation})`);
  }

  const have = new Set(manifest.clips.map((c) => c.credit?.id).filter(Boolean));
  for (const pick of ranked) {
    if (totalMsOf(manifest.clips) >= needMs) break;
    if (manifest.clips.length >= MAX_CLIPS_PER_SHOT) break;
    if (have.has(pick.video.id)) continue;

    // 按 Pexels 视频 id 命名：同一条素材被两个关键词选中时只存一份
    const dest = path.join(CONFIG.cacheDir, `pexels-${pick.video.id}-${orientation}.mp4`);
    const credit: ClipCredit = {
      id: pick.video.id,
      photographer: pick.video.user?.name ?? '未署名',
      photographerUrl: pick.video.user?.url,
      url: pick.video.url,
    };

    if (!fs.existsSync(dest) || fs.statSync(dest).size < MIN_CLIP_BYTES) {
      const bytes = await download(pick.file.link, dest, `"${keyword}" (${orientation})`);
      log('footage', `下载 "${keyword}" ${orientation} (${(bytes / 1e6).toFixed(1)}MB) © ${credit.photographer}`);
    }
    manifest.clips.push({ file: dest, durationMs: await durationMs(dest), credit });
    have.add(pick.video.id);
  }

  fs.writeFileSync(manifestPath(keyword, orientation), JSON.stringify(manifest, null, 2), 'utf8');

  if (!manifest.clips.length) throw new Error(`素材不合规格: "${keyword}" (${orientation})`);
  if (totalMsOf(manifest.clips) < needMs) {
    log(
      'footage',
      `⚠ "${keyword}" ${orientation} 素材共 ${(totalMsOf(manifest.clips) / 1000).toFixed(1)}s，` +
        `不足镜头所需 ${(needMs / 1000).toFixed(1)}s，尾部会重复`,
    );
  }
  return manifest.clips;
}

/**
 * 取某朝向的素材序列。
 * 缺了就退回已有的那个朝向 —— 画面会被裁切，但不该因此中断整次渲染。
 */
export function shotClips(shot: Shot, orientation: Orientation): ShotClip[] {
  const hit = shot.clips?.[orientation];
  if (hit?.length) return hit;

  const fallback = Object.values(shot.clips ?? {}).find((v) => v?.length);
  if (!fallback?.length) throw new Error(`镜头 "${shot.keyword}" 没有任何素材，请重跑 footage`);

  log('footage', `⚠ "${shot.keyword}" 缺 ${orientation} 素材，暂用其它朝向（会被裁切）`);
  return fallback;
}

/**
 * 导出可直接贴进视频简介的素材出处清单。
 * Pexels 的 API 使用指南要求给出处：显著位置链接 Pexels，并尽量标注摄影师。
 * 按 Pexels 视频 id 去重 —— 横竖版和相邻镜头常常来自同一条素材。
 */
export function writeCredits(dir: string, shots: Shot[]): string {
  const seen = new Map<number, ClipCredit>();
  for (const s of shots) {
    for (const list of Object.values(s.clips ?? {})) {
      for (const c of list ?? []) if (c.credit) seen.set(c.credit.id, c.credit);
    }
  }

  const lines = [
    '素材来源 / Footage',
    '',
    'Videos provided by Pexels — https://www.pexels.com',
    '',
    ...[...seen.values()].map((c) => `· ${c.photographer} — ${c.url}`),
  ];
  if (!seen.size) lines.push('（本片未使用 Pexels 素材，全部为手动素材）');

  const file = path.join(dir, 'credits.txt');
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  log('footage', `${seen.size} 条素材出处 → credits.txt`);
  return file;
}

export async function collectShots(
  dir: string,
  script: Script,
  timeline: Timeline,
  /** 要备齐素材的朝向；只出横版时别去下竖版，省一半带宽和配额 */
  orientations: Orientation[] = ['landscape', 'portrait'],
): Promise<Shot[]> {
  const groups = groupShots(script, timeline);

  const shots: Shot[] = [];
  for (const g of groups) {
    const clips: Shot['clips'] = {};
    for (const o of orientations) clips[o] = await resolveClips(g.keyword, o, g.endMs - g.startMs);
    shots.push({ keyword: g.keyword, clips, startMs: g.startMs, endMs: g.endMs });
  }

  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(shots, null, 2), 'utf8');
  const totalClips = shots.reduce((n, s) => n + (s.clips.landscape?.length ?? 0), 0);
  log('footage', `${shots.length} 个镜头 / ${totalClips} 条素材 × ${orientations.join('/')}`);
  writeCredits(dir, shots);
  return shots;
}
