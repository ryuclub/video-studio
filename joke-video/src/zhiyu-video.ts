// ── 治愈档出片：静态图 + 进度线 + 音轨 → mp4 ──────────────────────────
//
// 用法：npx tsx src/zhiyu-video.ts                  上下两期都出
//       npx tsx src/zhiyu-video.ts --part 上
//       npx tsx src/zhiyu-video.ts --burn-sub       把字幕烧进画面（**默认不烧，见下**）
//       npx tsx src/zhiyu-video.ts --cover-sec 3    片头封面压几秒（默认 2）
//
// 走 concat 解复用器，不走 joke-video 的逐帧管线：
// 21 分钟 = 3.8 万帧，逐帧渲 SVG 按实测 60ms/帧要 38 分钟，而且毫无意义 ——
// 这条线的画面本来就是静止的。这里图是现成的 PNG，ffmpeg 按时长拼，几分钟出片。
//
// ── 为什么默认**不烧**字幕 ──
//
// 说书线是烧的，那条线要人看。这条线是**助眠档**，规范里反复写着「几乎不动」：
// 片内所有参数都在往「无聊」上调，就是为了不给人一个睁眼的理由。
// 烧进去的字幕每几秒换一次，**它会成为这张图上最活跃的东西** ——
// 花了整章功夫把画面压到低对比、把主体缩到看不见，再往上贴一行跳动的字，
// 前面全白做。
//
// 所以 `.srt` 照出（平台软字幕、检索、听障可访问性都要它），但默认不烧进画面。
// 真要烧再传 `--burn-sub`，出来的是另一个文件，不覆盖默认那份。

import { resolveEp } from './zhiyu-ep.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { packLines, toSrt, shiftSrt, type SrtCue } from './shuoshu-srt.js';
import { SW, SH, STEP } from './zhiyu-scene.js';
import { mmss } from './zhiyu-audio.js';

const { id: EP, dir: PROJ, book: BOOK } = resolveEp(process.argv.slice(2));

interface Cue { no: number; act: string; text: string; start: number; end: number }
interface Manifest { part: string; epTitle: string; acts: string[]; duration: number; cues: Cue[] }

/** 只数字，标点不占时间 */
const weigh = (s: string) => (s.match(/[一-龥a-zA-Z0-9]/g) ?? []).length;

/**
 * 把每一段拆成字幕条，段内按字数**比例**分时间。
 *
 * 不去做音频对齐（说书线那套 `snapToDip` 是为了卡在停顿上）：
 * 这条线段与段之间本来就有 1.25 秒的空白，段内又都是短句，
 * 按比例分已经够准，多引一层依赖不划算。
 */
function subtitles(cues: Cue[]): SrtCue[] {
  const out: SrtCue[] = [];
  for (const c of cues) {
    const lines = packLines(c.text);
    const total = lines.reduce((s, l) => s + weigh(l), 0) || 1;
    let t = c.start;
    lines.forEach((l, i) => {
      const share = ((c.end - c.start) * weigh(l)) / total;
      // 最后一条吃掉舍入误差，免得字幕比声音早收
      const end = i === lines.length - 1 ? c.end : t + share;
      out.push({ start: t, end, text: l });
      t = end;
    });
  }
  return out;
}

function build(part: string, coverHold: number, burn: boolean) {
  const dir = `${PROJ}/成片/${part}`;
  const mPath = `${dir}/manifest.json`;
  if (!existsSync(mPath)) throw new Error(`没有 ${mPath}\n先跑：npx tsx src/zhiyu-episode.ts --part ${part}`);
  const m = JSON.parse(readFileSync(mPath, 'utf8')) as Manifest;

  const wav = `${dir}/${part}篇.wav`;
  if (!existsSync(wav)) throw new Error(`没有 ${wav}`);

  // ── 场景图。**清单是权威，不 readdir 扫目录** ──
  // 扫目录的话上一版残留的 png 会被一起收进来，排序之后插在中间，
  // 画面全错位而且不报错。
  //
  // **张数和每张的时长都从 `scenes/scenes.json` 来，不再自己按 STEP 推** ——
  // 换镜位那几秒是交叉淡化，一张只有半秒；按固定 STEP 推会整条错位，
  // 而且照样不报错，只是画面跟声音越走越偏。
  const planPath = `${dir}/scenes/scenes.json`;
  if (!existsSync(planPath))
    throw new Error(`没有 ${planPath}\n先跑：npx tsx src/zhiyu-scene.ts --ep <书> --part ${part}`);
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as { shots: { file: string; dur: number }[] };
  const pngs = plan.shots.map((s) => `${dir}/scenes/${s.file}`);
  const count = pngs.length;
  const missing = pngs.filter((p) => !existsSync(p));
  if (missing.length)
    throw new Error(
      `少了 ${missing.length} 张场景图（${missing.slice(0, 2).map((x) => x.split('/').pop()).join(', ')}…）\n` +
        `先跑：npx tsx src/zhiyu-scene.ts --ep <书> --part ${part}`
    );

  // ── 字幕。**平台软字幕用，默认不烧** ──
  const srt = toSrt(subtitles(m.cues));
  writeFileSync(`${dir}/${part}篇.srt`, coverHold > 0 ? shiftSrt(srt, coverHold) : srt);

  // ── concat 清单 ──
  // 最后一张要写两遍：concat 解复用器把 duration 理解成「这一条什么时候结束」，
  // 末条的 duration 会被忽略，画面会停在倒数第二张
  // **片头用 1920 那张，不是上传用的 1280 那张。**
  // concat 解复用器碰上分辨率不一样的图会**静默丢掉**——不报错、不警告，
  // 封面就是没进片子。第一版踩过，是逐帧量亮度才发现前 3 秒画面没变。
  const cover = `${PROJ}/cover/${part}/first-frame-1920x1080.png`;
  if (coverHold > 0 && !existsSync(cover))
    throw new Error(`没有片头封面 ${cover}\n先跑：npx tsx src/zhiyu-cover.ts --part ${part}`);
  const abs = (p: string) => resolve(p).replace(/\\/g, '/');
  const lines: string[] = [];
  if (coverHold > 0) {
    lines.push(`file '${abs(cover)}'`, `duration ${coverHold.toFixed(3)}`);
  }
  pngs.forEach((p, i) => {
    lines.push(`file '${abs(p)}'`, `duration ${Math.max(0.05, plan.shots[i].dur).toFixed(3)}`);
  });
  lines.push(`file '${abs(pngs[count - 1])}'`);
  const listPath = `${dir}/_concat.txt`;
  writeFileSync(listPath, lines.join('\n') + '\n');

  // ── 尺寸必须全一致，否则 concat 会**静默丢图** ──
  // 这道检查是补上面那个坑的：ffmpeg 不会为此报错，人也看不出来
  // （成片时长照样对得上，只是少了一张画面），只能自己拦。
  const size = (f: string) =>
    spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim();
  const want = `${SW},${SH}`;
  const odd = [...(coverHold > 0 ? [cover] : []), ...pngs].filter((f) => size(f) !== want);
  if (odd.length)
    throw new Error(
      `这些图不是 ${want}，concat 会把它们静默丢掉：\n` +
        odd.slice(0, 4).map((f) => `  ${size(f)}　${f}`).join('\n')
    );

  const vf = [`scale=${SW}:${SH}`, 'fps=25'];
  if (burn) {
    // 相对路径 + cwd：subtitles 滤镜里 Windows 盘符的冒号要三重转义，
    // 与其跟转义较劲，不如把工作目录切到片子目录，只传文件名
    vf.push(
      `subtitles=${part}篇.srt:force_style='FontName=Noto Serif SC,FontSize=13,` +
        `PrimaryColour=&H00665A4A,OutlineColour=&HC0E8F2F6,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=18'`
    );
  }
  const out = `${dir}/${EP}_${part}.mp4${burn ? '' : ''}`;
  const args = [
    '-y', '-v', 'warning', '-stats',
    '-f', 'concat', '-safe', '0', '-i', abs(listPath),
    '-i', abs(wav),
    '-vf', vf.join(','),
    // 片头封面是静的，音轨整体后推，不是把开场那句盖掉
    ...(coverHold > 0 ? ['-af', `adelay=${Math.round(coverHold * 1000)}:all=1`] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-tune', 'stillimage',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    abs(burn ? out.replace('.mp4', '_烧字幕.mp4') : out),
  ];

  console.log(`${part}篇《${m.epTitle}》　${count} 张画面　${mmss(m.duration)}${coverHold > 0 ? ` + 封面 ${coverHold}s` : ''}`);
  const r = spawnSync('ffmpeg', args, { cwd: resolve(dir), encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg 出片失败（退出码 ${r.status}）`);
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (k: string) => { const i = argv.indexOf(`--${k}`); return i < 0 ? undefined : argv[i + 1]; };
  const only = flag('part') ?? null;
  const coverHold = Number(flag('cover-sec') ?? 2);
  const burn = argv.includes('--burn-sub');
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as { parts: { part: string }[] };

  const made: string[] = [];
  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    made.push(build(p.part, coverHold, burn));
  }
  console.log('');
  for (const f of made) console.log(`→ ${f}`);
  if (!burn) console.log(`字幕另出 .srt，**没烧进画面** —— 助眠档，跳动的字幕会成为唯一在动的东西。要烧传 --burn-sub`);
}

main();
