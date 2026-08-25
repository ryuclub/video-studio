// ── 长片：把分场景的环境音铺到人声上 ──────────────────────────────────
//
// 用法：
//   npx tsx tools/long-ambience.mts jokes/laoma-long-001.json <干版.wav> <输出.wav>
//
// ── 这一层为什么在管线外面 ──
//
// `mixdown()`（`audio` 和 `build` 共用的那一步）只认三样：人声、`sfx.ts` 里那几个
// 合成音效、BGM。**它没有「分场景的床音」这回事** —— `cfg.ambience` 是写死的
// 草声 ＋ 蝉鸣两条，给不了「这一章是办公室、下一章是楼道」。
//
// 所以这一层是 mixdown 之后用 ffmpeg 叠的。**代价要说清楚**：
// `npm run build` 出的成片里**没有**这一层 —— 真出片的时候要么把它接进 mixdown，
// 要么在最后 mux 之前跑一遍这个脚本。**别以为出片时会自动带上。**
//
// ── 素材 ──
//
// `vidgen/voice/*.mp3`（仓库根，不是 `joke-video/voice/`）。**都不进 git**（`*.mp3` 被忽略）。
//
// ── 音量 ──
//
// 床音的活是「让静场不像断片」，不是让人听见环境。人声均值约 −22 dBFS，
// 床音压到 **−45 dBFS 上下**（比人声低二十多 dB）—— 听得出屋子里有东西，
// 但一句话进来就退到背后去。

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { buildTimeline } from '../src/beats/typeA.js';
import type { JokeCfg } from '../src/types.js';

const [cfgPath, dry, out] = process.argv.slice(2);
if (!cfgPath || !dry || !out) {
  console.log('用法：npx tsx tools/long-ambience.mts <稿件.json> <干版.wav> <输出.wav>');
  process.exit(1);
}

/** 素材目录：**仓库根**的 `voice/`，跟 `joke-video/voice/`（TTS 分句）不是一回事 */
const SFX = '../voice';

/**
 * 章 → 铺哪几段、各铺到多响（**目标 dBFS，不是相对偏移**）。
 *
 * 跟《完整出片方案》§二 的六个场景对齐：
 * 早上／老牛是谁／下午 = 工位，他为什么走 = 楼道，中午 = 饭桌，
 * 傍晚／然后 = 楼下街道，晚上 = 夜里的工位。
 *
 * ⚠ **晚上那一章要比白天更低**：稿子里那句「屋里挺静」是这一场的全部气氛，
 * 床音跟白天一样响就把它抵消了。
 */
const BED: Record<string, Array<{ file: string; db: number }>> = {
  '一、早上': [
    { file: '办公室.mp3', db: -46 },
    { file: '远处键盘.mp3', db: -50 },
  ],
  '二、老牛是谁': [
    { file: '办公室.mp3', db: -46 },
    { file: '远处键盘.mp3', db: -49 },
  ],
  '三、他为什么走': [{ file: '脚步回声.mp3', db: -46 }],
  '四、中午': [{ file: '听不清的说话声.mp3', db: -44 }],
  '五、下午': [
    { file: '办公室.mp3', db: -46 },
    { file: '远处键盘.mp3', db: -49 },
  ],
  '六、傍晚': [
    { file: '街道.mp3', db: -45 },
    { file: '风声.mp3', db: -48 },
  ],
  '七、然后': [
    { file: '街道.mp3', db: -45 },
    { file: '风声.mp3', db: -48 },
  ],
  '八、晚上': [{ file: '办公室.mp3', db: -50 }],
};
/**
 * 插入段：稿子 §五 那条「**⏸2.0 — 切窗外空镜，环境音从室内空调换成窗外车流，2 秒后切回**」。
 *
 * 认的是**那一句的字面**，不是句号 —— 句号会随改稿整体挪位，这句话本身不会变。
 * 找不到就报出来，**不静默跳过**（那样人会以为换过了）。
 */
const INSERT = {
  after: '那是我这三年里头一回看见他坐着不干活。',
  file: '车流.mp3',
  db: -38,
  fade: 0.35,
};

const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as JokeCfg & {
  _sections?: Array<{ name: string; from: number; to: number }>;
};
const sections = cfg._sections ?? [];
if (!sections.length) {
  console.error('稿件里没有 `_sections` —— 用新版 tools/long-parse.mts 重跑一遍');
  process.exit(1);
}

const tl = buildTimeline(cfg);
const segOf = (i: number) => tl.segments.find((s) => s.kind === 'line' && s.lineIndex === i)!;
const txt = (i: number) => (cfg.lines[i].say ?? []).map((s) => s.text).join('');

interface Bed {
  file: string;
  db: number;
  start: number;
  dur: number;
  label: string;
}
const beds: Bed[] = [];

for (const sec of sections) {
  const list = BED[sec.name];
  if (!list) {
    console.log(`  ⚠ 「${sec.name}」没有配床音，这一章是干的`);
    continue;
  }
  // 章的范围：第一句起头（含它的 padBefore）→ 最后一句那一段结束
  const a = Math.max(0, segOf(sec.from).start - (cfg.lines[sec.from].padBefore ?? 0));
  const b = segOf(sec.to).end;
  for (const x of list) beds.push({ ...x, start: a, dur: b - a, label: sec.name });
}

// 插入段：那 2 秒的窗外车流
{
  const i = cfg.lines.findIndex((_, k) => txt(k) === INSERT.after);
  if (i < 0) {
    console.log(`  ⚠ 找不到「…${INSERT.after}」，**窗外车流那 2 秒没铺** —— 稿子改过了？`);
  } else {
    const s = segOf(i);
    const pad = cfg.lines[i].padAfter ?? 0;
    beds.push({ file: INSERT.file, db: INSERT.db, start: s.end - pad, dur: pad, label: '插入 · 窗外车流' });
  }
}

/**
 * ⚠ **素材要先修一遍再循环，不能直接铺。**
 *
 * `办公室.mp3` 一共 10.08 秒，**内容到 8.4 秒就没了，尾巴上 1.7 秒是静音** ——
 * 直接 `-stream_loop` 铺出来，每转一圈就断 1.7 秒，听感是「房间的声音一会儿有一会儿没」。
 * 这种毛病量全片均值看不出来（均值几乎不动），只有**在句间的静默处逐点量**才露出来。
 *
 * 修法：掐掉首尾静音 ＋ 首尾各 10 毫秒淡入淡出（消掉循环接缝的咔哒声）。
 * 每个素材只修一次，落到临时文件，后面所有引用都用修过的那份。
 */
const CLEAN = `${tmpdir()}/laoma-amb`;
mkdirSync(CLEAN, { recursive: true });
const cleanCache = new Map<string, string>();
const cleanOf = (file: string): string => {
  const hit = cleanCache.get(file);
  if (hit) return hit;
  const dst = `${CLEAN}/${file.replace(/\.[^.]+$/, '')}.wav`;
  const r = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-y', '-i', `${SFX}/${file}`,
      '-af',
      // 掐首尾静音（−55 dB 以下算静音），再补两头各 10ms 的淡，接缝才不响
      'silenceremove=start_periods=1:start_threshold=-55dB:stop_periods=-1:stop_threshold=-55dB:stop_duration=0.2,' +
        'afade=t=in:st=0:d=0.01,areverse,afade=t=in:st=0:d=0.01,areverse',
      dst,
    ],
    { encoding: 'utf8' }
  );
  if (r.status !== 0) {
    console.error(`修不了「${file}」：\n${(r.stderr ?? '').split('\n').slice(-6).join('\n')}`);
    process.exit(1);
  }
  cleanCache.set(file, dst);
  return dst;
};

/**
 * 每段素材**自己多响**（mean dBFS）。表里给的是**目标电平**，
 * 实际要加的增益 = 目标 − 素材本身。
 *
 * ⚠ **不能用固定偏移。** 这批素材彼此差了二十多 dB
 *（风声 −21.7 / 街道 −26.6 / 听不清 −28.5 / 车流 −36.9 / 脚步 −39.8 / 办公室 −42.3 / 键盘 −44.0）——
 * 同一个 `-26dB` 铺出来，街道能听见、办公室是死的。
 * 量一遍再算，**换素材不用重调表**。
 */
const meanCache = new Map<string, number>();
const meanOf = (file: string): number => {
  const hit = meanCache.get(file);
  if (hit !== undefined) return hit;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', cleanOf(file), '-af', 'volumedetect', '-f', 'null', '-'], {
    encoding: 'utf8',
  });
  const m = (r.stderr ?? '').match(/mean_volume:\s*(-?[\d.]+) dB/);
  if (!m) {
    console.error(`量不出「${file}」的电平 —— ffmpeg 读不了这个文件？`);
    process.exit(1);
  }
  const v = Number(m[1]);
  meanCache.set(file, v);
  return v;
};

const missing = beds.filter((b) => !existsSync(`${SFX}/${b.file}`));
if (missing.length) {
  console.error('素材缺了，先补齐：');
  for (const m of new Set(missing.map((x) => x.file))) console.error(`  ${SFX}/${m}`);
  process.exit(1);
}

// ── 拼 ffmpeg ────────────────────────────────────────────────────
//
// 每段：**整段循环**（素材比片长短）→ 裁到需要的长度 → 首尾各 0.4 秒淡入淡出
// → 压到目标音量 → 挪到它该在的时刻。最后跟人声一起 amix，`normalize=0`
// 保证人声电平不被摊薄。
const FADE = 0.4;
const args: string[] = ['-hide_banner', '-y', '-i', dry];
for (const b of beds) args.push('-stream_loop', '-1', '-i', cleanOf(b.file));

const chain = beds.map((b, i) => {
  const d = b.dur.toFixed(3);
  const st = Math.max(0, b.dur - FADE).toFixed(3);
  const delay = Math.round(b.start * 1000);
  const gain = (b.db - meanOf(b.file)).toFixed(1);
  return (
    `[${i + 1}:a]atrim=0:${d},asetpts=N/SR/TB,` +
    `afade=t=in:st=0:d=${FADE},afade=t=out:st=${st}:d=${FADE},` +
    `volume=${gain}dB,adelay=${delay}|${delay}[b${i}]`
  );
});
const mixIn = beds.map((_, i) => `[b${i}]`).join('');
const filter =
  chain.join(';') +
  `;${mixIn}amix=inputs=${beds.length}:duration=longest:normalize=0[bed];` +
  `[0:a][bed]amix=inputs=2:duration=first:normalize=0[out]`;

args.push('-filter_complex', filter, '-map', '[out]', '-ac', '1', out);

console.log(`铺 ${beds.length} 段：`);
for (const b of beds)
  console.log(
    `  ${b.start.toFixed(1).padStart(6)}s +${b.dur.toFixed(1).padStart(5)}s  ` +
      `目标 ${b.db}dB（素材 ${meanOf(b.file).toFixed(1)} → 加 ${(b.db - meanOf(b.file)).toFixed(1)}）  ` +
      `${b.file}　（${b.label}）`
  );

const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr?.split('\n').slice(-12).join('\n'));
  process.exit(1);
}
console.log(`\n→ ${out}`);
