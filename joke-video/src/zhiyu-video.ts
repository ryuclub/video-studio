// ── 治愈档出片：静态图 + 进度线 + 音轨 → mp4 ──────────────────────────
//
// 用法：npx tsx src/zhiyu-video.ts                  上下两期都出
//       npx tsx src/zhiyu-video.ts --part 上
//       npx tsx src/zhiyu-video.ts --burn-sub       把字幕烧进画面（默认不烧，见下）
//       npx tsx src/zhiyu-video.ts --cover-sec 3    片头封面压几秒（默认 2）
//       npx tsx src/zhiyu-video.ts --text-layer     烧一层正文文字（**另一档产品，见下**）
//
// 走 concat 解复用器，不走 joke-video 的逐帧管线：
// 21 分钟 = 3.8 万帧，逐帧渲 SVG 按实测 60ms/帧要 38 分钟，而且毫无意义 ——
// 这条线的画面本来就是静止的。这里图是现成的 PNG，ffmpeg 按时长拼，几分钟出片。
//
// ── 字幕：默认不烧，但**烧是允许的** ──
//
// 2026-08-21 之前这是一条禁令（「助眠档不烧字幕」）。**现在不是了** ——
// 是一个取舍，由命令行决定，不由这条线的规范决定。
//
// 顾虑照旧成立：这条线的片内参数全在往「无聊」上调，就是为了不给人一个睁眼的理由，
// 而烧进去的字幕每几秒换一次，**它会成为这张图上最活跃的东西**。
// 另一头也成立：静音刷到这条片子的人，没有字就没有任何东西可读。
//
// 所以三种出法并存、文件名各不相同、谁也不覆盖谁：
//
//   （不带 flag）   只有画面，`.srt` 另出
//   `--burn-sub`   底部烧一条字幕
//   `--text-layer` 正文逐句上浮（另一档产品，见下）
//
// `.srt` 三种都照出 —— 平台软字幕、检索、听障可访问性都要它。
//
// ── `--text-layer`：文字版 ──
//
// 上面那一整段讲的是助眠档。**文字版是另一档产品**，服务的是静音看的人：
// 正文逐句从下方浮入，落在窗内一张纸条上（`src/xinli-text.ts` 先出 `文字.ass`）。
// 它跟「几乎不动」是反着的，所以**不覆盖常规版**，出的是另一个文件名。
// 不带这个 flag 的时候，这个脚本的行为一个字节都没变。
//
// 两个坑，都是这条路上必踩的：
//   ① 时间轴要加片头封面那几秒。`文字.ass` 里写着 `; cover-sec: N`，
//      跟这儿的 `--cover-sec` 对不上就报错 —— 偏了的片子看起来完全正常。
//   ② filtergraph 里 **Windows 盘符的冒号会把滤镜串解析炸掉**。
//      跟字幕那条一样的解法：cwd 切到片子目录，只传相对路径。

import { resolveEp } from './zhiyu-ep.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * 正文文字层。返回塞进 `-vf` 的那一段，没开就返回 null。
 *
 * **字体走 fontsdir，不靠系统装没装。** libass 匹配不上 family 名的时候
 * 会静默 fallback 到系统黑体 —— 画面上有字，但不是这个频道的字，也不报错。
 * （`--burn-sub` 那条路写的是 `FontName=Noto Serif SC` 且没给 fontsdir，
 * 大概率一直在用系统字体。那个 flag 平时不用，所以没人发现。）
 */
function textLayer(dir: string, coverHold: number): string | null {
  const ass = `${dir}/文字.ass`;
  if (!existsSync(ass))
    throw new Error(
      `没有 ${ass}\n先跑：npx tsx src/xinli-text.ts --line <线> --ep <期>`
    );
  const head = readFileSync(ass, 'utf8').slice(0, 800);
  const got = /^;\s*cover-sec:\s*([\d.]+)\s*$/m.exec(head);
  if (!got)
    throw new Error(`${ass} 里没有 "; cover-sec: N" 那一行 —— 它是旧版本或者被手改过，重新生成一次`);
  if (Number(got[1]) !== coverHold)
    throw new Error(
      `文字层是按片头 ${got[1]} 秒排的，这次出片给的是 ${coverHold} 秒。\n` +
        `两边差多少，字就比声音早/晚多少 —— 而成片看起来完全正常，没人会去核。\n` +
        `重跑：npx tsx src/xinli-text.ts --line <线> --ep <期> --cover-sec ${coverHold}`
    );

  // 字体目录只能给相对路径：filtergraph 里 E: 的冒号会把滤镜串解析炸掉。
  // cwd 是片子目录（见下面 spawnSync 的 cwd），所以从那儿往上数。
  const fontDir = fileURLToPath(new URL('../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese', import.meta.url));
  if (!existsSync(fontDir)) throw new Error(`没有字体目录 ${fontDir}\n见 fonts/README.md`);
  const rel = relative(resolve(dir), fontDir).replace(/\\/g, '/');
  if (rel.includes(':'))
    throw new Error(
      `字体和成片不在同一个盘上（${rel}），filtergraph 里带盘符的路径会解析失败。\n` +
        `把 fonts/ 挪到跟 projects/ 同一个盘，或者把字体装进系统。`
    );
  return `ass=文字.ass:fontsdir=${rel}`;
}

function build(part: string, coverHold: number, burn: boolean, textVer: boolean) {
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

  // ── 字幕。平台软字幕用；烧不烧由 --burn-sub 决定 ──
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
  // 文字层排在字幕之后：真要两个一起烧的话，字幕在最上层
  const tl = textVer ? textLayer(dir, coverHold) : null;
  if (tl) vf.push(tl);

  // 产物名带上版本后缀，**常规版永远不被覆盖**
  const suffix = textVer ? '_文字版' : burn ? '_烧字幕' : '';
  const out = `${dir}/${EP}_${part}${suffix}.mp4`;
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
    abs(out),
  ];

  console.log(
    `${part}篇《${m.epTitle}》　${count} 张画面　${mmss(m.duration)}` +
      `${coverHold > 0 ? ` + 封面 ${coverHold}s` : ''}${tl ? '　＋ 文字层' : ''}`
  );
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
  const textVer = argv.includes('--text-layer');
  // 两个一起开是自找的：正文已经整段在屏上了，再叠一行字幕就是同一句话写两遍
  if (burn && textVer)
    throw new Error(
      '--burn-sub 和 --text-layer 一起开，同一句话会在屏上出现两次（正文一次、字幕一次）。\n' +
        '文字版本来就是「正文都在画面上」，字幕那一层是给不看画面的人准备的，两个不叠。'
    );
  const doc = JSON.parse(readFileSync(`${PROJ}/发布.json`, 'utf8')) as { parts: { part: string }[] };

  const made: string[] = [];
  for (const p of doc.parts) {
    if (only && p.part !== only) continue;
    made.push(build(p.part, coverHold, burn, textVer));
  }
  console.log('');
  for (const f of made) console.log(`→ ${f}`);
  if (textVer)
    console.log(
      `文字版（正文逐句上浮）。**常规版没被覆盖** —— 那份还在，文件名不带 _文字版。\n` +
        `字幕照旧另出 .srt，但文字版不要开平台软字幕：屏上已经有同一句话了`
    );
  else if (!burn)
    console.log(`字幕另出 .srt，这一版没烧进画面。要烧传 --burn-sub，要正文上屏传 --text-layer —— 三版文件名不同，谁也不覆盖谁`);
}

main();
