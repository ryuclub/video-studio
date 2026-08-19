// ── 说书出片：静态图 + 时间轴 + 字幕 + 音轨 → mp4 ──────────────────────
//
// 用法：
//   npx tsx src/shuoshu-video.ts --ep E01            出全片
//   npx tsx src/shuoshu-video.ts --ep E01 --no-sub   不烧字幕
//   npx tsx src/shuoshu-video.ts --ep E01 --drift    加缓慢推镜（编码时间翻倍）
//   npx tsx src/shuoshu-video.ts --ep E01 --cover-sec 4   封面压 4 秒（默认 1.5，0 = 不放）
//
// **不走 joke-video 的逐帧管线。** 那条管线每帧都要渲一次 SVG，
// 12.5 分钟 = 22,500 帧 × 0.48s ≈ 3 小时。这里图是现成的 PNG，
// ffmpeg 的 concat 解复用器直接按时长拼，整片编码几分钟。
//
// 画面切点**不是另外标的**，直接从 `audio/<tag>.manifest.json` 来：
// scenes.json 里每张图写"从第几段开始"，那一段的 start 就是切点。
// 音频重出、时长变了，画面自动跟着走，不用重新对时。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { resolveEp } from './shuoshu-ep.js';
import { shiftSrt } from './shuoshu-srt.js';
import { SW, SH } from './shuoshu-scene.js';

interface Cue {
  no: number;
  sub: number;
  act: string;
  start: number;
  end: number;
}
interface SceneSpec {
  no: number;
  comp: string;
  title: string;
  act?: string;
}

/**
 * 字幕样式。两个坑：
 *
 * ① **宣纸底上要深色字。** 白字配米黄纸等于没有。
 * ② **FontSize / MarginV 不是像素。** libass 把 srt 转成 ass 时用默认的
 *    PlayRes 384×288，force_style 里的数值都在那个坐标系里，渲到 1080p
 *    要乘 3.75。第一版写 FontSize=21 出来是 79px 的巨字，MarginV=58
 *    把字顶到了画面 3/4 高的地方，压在画上。现在的数值是按 ÷3.75 反推的：
 *    FontSize 14 → 约 52px，MarginV 16 → 约 60px。
 * ③ 字体名要用**系统里真有的族名**。写 "Noto Serif CJK SC"（那是思源的旧名）
 *    匹配不上，libass 静默回退到黑体，跟题字的宋体对不上。
 */
const SUB_STYLE = [
  'FontName=Noto Serif SC',
  'FontSize=14',
  'PrimaryColour=&H00281A1A', // ABGR：深墨
  'OutlineColour=&HB0D2E4ED', // 纸色描边，半透明
  'BorderStyle=1',
  'Outline=1',
  'Shadow=0',
  'Alignment=2',
  'MarginV=16',
].join(',');

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv[i + 1];
  };
  const { id: EP, dir } = resolveEp(argv);
  const tag = '全片';
  const audioDir = `${dir}/audio`;
  const sceneDir = `${dir}/scenes`;

  const manifestPath = `${audioDir}/${tag}.manifest.json`;
  if (!existsSync(manifestPath)) throw new Error(`没有 ${manifestPath}，先跑 shuoshu-build.ts --ep ${EP}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { duration: number; cues: Cue[] };
  const spec = JSON.parse(readFileSync(`${dir}/scenes.json`, 'utf8')) as { scenes: SceneSpec[] };

  // 文件名**从 scenes.json 推**，不用 readdir 扫目录。
  // 扫目录的话，上一版残留的 png 会被一起收进来，排序之后还插在中间——
  // 画面全错位，而且不报错。清单是权威，目录只是产物。
  const pngs = spec.scenes.map((s, i) => `${String(i + 1).padStart(2, '0')}-${s.comp}.png`);
  const missing = pngs.filter((p) => !existsSync(`${sceneDir}/${p}`));
  if (missing.length)
    throw new Error(`少了 ${missing.length} 张场景图（${missing.slice(0, 3).join(', ')}…）
先跑：npx tsx src/shuoshu-scene.ts --ep ${EP}`);

  // ── 切点：每张图从"它那一段的第一个声部"开始 ──
  const startOf = (no: number) => {
    const c = manifest.cues.find((x) => x.no === no);
    if (!c) throw new Error(`manifest 里没有第 ${no} 段——scenes.json 写的段号超出这一版音频的范围了`);
    return c.start;
  };
  const cuts = spec.scenes.map((s) => startOf(s.no));
  if (cuts[0] > 0.001) cuts[0] = 0; // 第一张从头顶上
  for (let i = 1; i < cuts.length; i++)
    if (cuts[i] <= cuts[i - 1]) throw new Error(`scenes.json 的段号必须递增：第 ${i + 1} 张（第${spec.scenes[i].no}段）没有排在前一张后面`);

  const durs = cuts.map((c, i) => (i === cuts.length - 1 ? manifest.duration : cuts[i + 1]) - c);

  // ── concat 清单。**最后一张要写两遍** ──
  // concat 解复用器把 duration 理解成"这一条什么时候结束"，最后一条的 duration
  // 会被忽略，画面停在倒数第二张。重复一次末图才能撑到片尾。
  const listPath = `${audioDir}/_concat.txt`;
  const lines: string[] = [];

  // ── 封面：片头压住几秒，**看得见的那种** ──
  //
  // **每期必出，不是可选项**：平台抓缩略图取的就是第一帧，
  // 而缩略图决定点不点开。正片做得再好，封面糊了没人看见。
  //
  // 上一版只给了 1 帧（33ms），理由是"肉眼看不见、平台取得到"。
  // **那是错的**——打开文件根本看不到封面，等于没做。
  // 长视频的开头本来就该有一张定场的题图。默认 1.5 秒：看得清，又不至于
  // 让人在开场干等——2.5 秒试过，压在十七分钟的片子前面显得拖。
  //
  // 三样东西要一起挪，少一样就错位：
  //   ① 画面：封面占 coverHold 秒，后面的场景图时长不变
  //   ② 音轨：adelay 往后推同样的秒数（片头是静的，不是把开场白盖掉）
  //   ③ 字幕：整条时间轴平移，否则字幕比声音早出来几秒
  const coverPath = `${dir}/cover.png`;
  const coverHold = Number(flag('--cover-sec') ?? 1.5);
  if (!existsSync(coverPath))
    throw new Error(`没有封面 ${coverPath}\n先跑：npx tsx src/shuoshu-cover.ts --ep ${EP}`);
  if (coverHold > 0) {
    lines.push(`file '${resolve(coverPath).replace(/\\/g, '/')}'`);
    lines.push(`duration ${coverHold.toFixed(3)}`);
  }

  pngs.forEach((p, i) => {
    lines.push(`file '${resolve(sceneDir, p).replace(/\\/g, '/')}'`);
    lines.push(`duration ${durs[i].toFixed(3)}`);
  });
  lines.push(`file '${resolve(sceneDir, pngs[pngs.length - 1]).replace(/\\/g, '/')}'`);
  writeFileSync(listPath, lines.join('\n') + '\n');

  const drift = argv.includes('--drift');
  const sub = !argv.includes('--no-sub');
  const srt = `${tag}.srt`;
  const vf: string[] = [`scale=${SW}:${SH}`, 'fps=30'];
  if (drift)
    // 极缓慢的推镜。zoompan 是对已有位图做缩放，不重渲 SVG，所以代价只在编码
    vf.push(`zoompan=z='min(zoom+0.00012,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${SW}x${SH}`);
  let burnSrt = srt;
  if (sub) {
    if (!existsSync(`${audioDir}/${srt}`)) throw new Error(`没有 ${audioDir}/${srt}`);
    if (coverHold > 0) {
      // 音轨被推后了，字幕得跟着推。烧的是平移过的副本，
      // `audio/全片.srt` 保持跟**音频**对齐（那是音频的产物），
      // 跟**成片**对齐的那份另外落一个，放在 mp4 旁边给平台传字幕用
      burnSrt = '_burn.srt';
      const shifted = shiftSrt(readFileSync(`${audioDir}/${srt}`, 'utf8'), coverHold);
      writeFileSync(`${audioDir}/${burnSrt}`, shifted);
      writeFileSync(`${dir}/${EP}.srt`, shifted);
    }
    // **相对路径 + cwd**：subtitles 滤镜里的 Windows 盘符冒号要三重转义，
    // 与其跟转义较劲，不如把工作目录切到音频目录，只传文件名
    vf.push(`subtitles=${burnSrt}:force_style='${SUB_STYLE}'`);
  }

  const out = `${dir}/${EP}.mp4`;
  const args = [
    '-y', '-v', 'warning', '-stats',
    '-f', 'concat', '-safe', '0', '-i', resolve(listPath).replace(/\\/g, '/'),
    '-i', `${tag}.wav`,
    '-vf', vf.join(','),
    ...(coverHold > 0 ? ['-af', `adelay=${Math.round(coverHold * 1000)}:all=1`] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    resolve(out).replace(/\\/g, '/'),
  ];

  console.log(`《${EP}》　${pngs.length} 张画面　${manifest.duration.toFixed(1)}s`);
  spec.scenes.forEach((s, i) => {
    const m = Math.floor(cuts[i] / 60);
    console.log(
      `  ${String(i + 1).padStart(2)}  ${m}:${(cuts[i] - m * 60).toFixed(0).padStart(2, '0')}  ` +
        `${durs[i].toFixed(0).padStart(3)}s  ${s.comp.padEnd(5)} ${s.title}`
    );
  });
  console.log(`\n字幕 ${sub ? '烧进画面' : '不烧'}　推镜 ${drift ? '开' : '关'}\n编码中…`);

  const t0 = Date.now();
  const r = spawnSync('ffmpeg', args, { cwd: resolve(audioDir), encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg 退出码 ${r.status}`);

  const size = (readFileSync(out).length / 1024 / 1024).toFixed(1);
  console.log(`\n→ ${out}　${size} MB　（编码 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
}

main();
