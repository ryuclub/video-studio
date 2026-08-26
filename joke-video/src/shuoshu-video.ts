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
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEp } from './shuoshu-ep.js';
import { shiftSrt } from './shuoshu-srt.js';
import { SW, SH, resolveScenes } from './shuoshu-scene.js';
import { buildWave, WAVE_POS } from './wave.js';

interface Cue {
  no: number;
  sub: number;
  act: string;
  start: number;
  end: number;
}

/**
 * 字幕样式。几个坑：
 *
 * ① **宣纸底上白字要靠描边立住。** 白字配米黄纸本身等于没有 ——
 *    2026-08-24 改成白字黑边（`Outline=2` ≈ 7.5px），撑住的是那圈黑，不是白。
 *    原来是深墨字配纸色描边，那一版的道理写在这儿留个底：底色浅就用深字。
 * ② **FontSize / MarginV 不是像素。** libass 把 srt 转成 ass 时用的是自己的
 *    PlayRes 坐标系，force_style 里的数都在那个坐标系里。
 *    ⚠ 这儿原来写着「乘 3.75」，**那个数是错的**：2026-08-24 在成片上量了
 *    字幕块的外接框，`FontSize=15` 出来一个汉字宽 **39.5px**、30 出来 **79px**，
 *    真实倍率是 **≈2.63**，不是 3.75（16:9 的画面配 4:3 的脚本，libass 还做了
 *    一次横向补偿，两下叠起来就不是那个整数了）。
 *    **要知道多大就去量，别按公式推。**
 *    现在：FontSize 30 → 字宽 79px（2026-08-24 从 15 翻倍），MarginV 16 → 约 60px。
 *    一行最多 **24 个字**（1920 ÷ 79）。E05 中位数 13 字，最长一条 23 字，
 *    左右各剩 30px 正好塞下；再长就折成两行，字块往上长到 200px 高。
 * ③ 字体名要用**当时真取得到的族名**：喂了 `fontsdir` 就写仓库那几个 otf 的族名
 *    `Noto Serif CJK SC`，没喂就只能写系统装了的 `Noto Serif SC` —— 写错那一边，
 *    libass 静默回退到黑体，跟题字的宋体对不上。
 * ④ **字幕不再受题字压制**（2026-08-24 改）。以前的规矩是「字幕必须比题字小一档」，
 *    现在字幕 79px、题字 60px，主次改由颜色和描边分：
 *    字幕白底黑边（前景），题字白字黑边但细一圈、且贴在右栏边上（背景）。
 *    **这是知情的取舍**：字幕现在是画面上最大的东西。
 * ⑤ **`Bold=1` 光写没用。** 系统里装的是 `NotoSerifSC-VF.ttf`（可变字体），
 *    libass 拿到它只有默认实例，**加粗静默失效**：实测 `Bold=0` 和 `Bold=1`
 *    烧出来的 PNG **字节数一模一样**。所以这里要连 `fontsdir` 一起给，
 *    指到仓库的 `fonts/NotoSerifCJKsc/OTF/`（一档一个文件的静态字重）。
 *    这跟场景图那头是同一个坑、同一个解法（`inkwash.ts` 的 `INK_FONT_FILES`），
 *    只是一个走 resvg 一个走 libass，两处要各喂一次。
 *    加粗要解决的是：宣纸底 + 深墨细宋体，缩到手机上笔画会糊进纸纹里。
 */
function subStyle(realBold: boolean): string {
  return [
    `FontName=${realBold ? 'Noto Serif CJK SC' : 'Noto Serif SC'}`,
    'FontSize=30',
    'Bold=1',
    'PrimaryColour=&H00FFFFFF', // ABGR：纯白
    'OutlineColour=&H00000000', // 纯黑描边，不透明——白字全靠它
    'BorderStyle=1',
    'Outline=2',
    'Shadow=0',
    'Alignment=2',
    'MarginV=16',
  ].join(',');
}

/**
 * 字重文件在哪儿。**传给滤镜的是相对路径** —— subtitles 滤镜里的 Windows 盘符冒号
 * 要三重转义，跟 srt 那个文件名同一个理由：切了工作目录，只传相对路径就没这回事。
 */
const FONT_DIR = fileURLToPath(new URL('../../fonts/NotoSerifCJKsc/OTF/SimplifiedChinese', import.meta.url));

function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv[i + 1];
  };
  const { id: EP, dir, slug } = resolveEp(argv);
  const tag = '全片';
  const audioDir = `${dir}/audio`;
  const sceneDir = `${dir}/scenes`;

  const manifestPath = `${audioDir}/${tag}.manifest.json`;
  if (!existsSync(manifestPath)) throw new Error(`没有 ${manifestPath}，先跑 shuoshu-build.ts --ep ${EP}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { duration: number; cues: Cue[] };
  // **走 resolveScenes，不自己解析。** 带 anchor 的场景表在这里才拿到真段号 ——
  // 三处（场景图 / 体检 / 这儿）各写一套解析，迟早出现「图渲对了、切点切错了」。
  const spec = resolveScenes(dir);

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

  // ── 音波层 ──
  // 二十分钟一张静图配音，最怕「像张图不像个片子」。这一条跟着声音跳的柱子
  // 是四条静态线共用的解药（`wave.ts`）。**它吃的是整期那条 wav**，
  // 所以音频重出之后波形自动跟着变，不用对时。
  const wave = argv.includes('--no-wave')
    ? null
    : buildWave({
        wavPath: `${audioDir}/${tag}.wav`,
        outDir: `${audioDir}/_wave`,
        delay: coverHold,
        dur: manifest.duration,
      });
  if (wave) console.log(`音波　${wave.frames} 帧（真渲 ${wave.unique} 张）　${wave.w}×${wave.h} @ ${WAVE_POS.x},${WAVE_POS.y}`);

  // ── 滤镜串 ──
  // **用 filter_complex 不用 -vf**：音波是第二路输入，-vf 只吃得下一路。
  const chain: string[] = [];
  let vlab = 'bg';
  chain.push(
    `[0:v]scale=${SW}:${SH},fps=30` +
      // 极缓慢的推镜。zoompan 是对已有位图做缩放，不重渲 SVG，所以代价只在编码
      (drift ? `,zoompan=z='min(zoom+0.00012,1.06)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${SW}x${SH}` : '') +
      `[bg]`
  );
  if (wave) {
    // eof_action=pass：音波比画面短一点点也不掐掉画面
    chain.push(`[bg][1:v]overlay=${WAVE_POS.x}:${WAVE_POS.y}:eof_action=pass[wv]`);
    vlab = 'wv';
  }
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
      writeFileSync(`${dir}/${slug}.srt`, shifted);
    }
    // **相对路径 + cwd**：subtitles 滤镜里的 Windows 盘符冒号要三重转义，
    // 与其跟转义较劲，不如把工作目录切到音频目录，只传文件名
    const realBold = existsSync(FONT_DIR);
    if (!realBold)
      console.log(
        '! 没找到 fonts/NotoSerifCJKsc/OTF/ —— 字幕的加粗会静默失效（烧出来是常规字重）。\n' +
          '  下载方式见 fonts/README.md'
      );
    const fontsdir = realBold ? `:fontsdir=${relative(resolve(audioDir), FONT_DIR).replace(/\\/g, '/')}` : '';
    chain.push(`[${vlab}]subtitles=${burnSrt}${fontsdir}:force_style='${subStyle(realBold)}'[sub]`);
    vlab = 'sub';
  }

  // 音轨那一路也放进 filter_complex：-af 跟 -map 混用容易出「滤镜没接上还不报错」，
  // 片头的静音推迟写在这儿一目了然
  const ai = wave ? 2 : 1;
  if (coverHold > 0) chain.push(`[${ai}:a]adelay=${Math.round(coverHold * 1000)}:all=1[aout]`);

  // **按 slug 命名，不按 EP** —— EP 的前缀是档期，挪档就变；slug 是身份，永不变
  const out = `${dir}/${slug}.mp4`;
  const args = [
    '-y', '-v', 'warning', '-stats',
    '-f', 'concat', '-safe', '0', '-i', resolve(listPath).replace(/\\/g, '/'),
    ...(wave ? ['-f', 'concat', '-safe', '0', '-i', resolve(wave.list).replace(/\\/g, '/')] : []),
    '-i', `${tag}.wav`,
    '-filter_complex', chain.join(';'),
    '-map', `[${vlab}]`,
    '-map', coverHold > 0 ? '[aout]' : `${ai}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    resolve(out).replace(/\\/g, '/'),
  ];

  console.log(`《${EP}》　${pngs.length} 张画面　${manifest.duration.toFixed(1)}s`);
  spec.scenes.forEach((s, i) => {
    // **先把秒取整再拆分钟**。原来是 floor(t/60) 配 (t-m*60).toFixed(0)，
    // 秒数落在 59.5–59.99 时 toFixed 进位成 60，打出来是「16:60」——
    // E04 排片表上就出现过一次。数字只是打给人看的，但看的人会拿它去对时间轴。
    const total = Math.round(cuts[i]);
    const m = Math.floor(total / 60);
    console.log(
      `  ${String(i + 1).padStart(2)}  ${m}:${String(total - m * 60).padStart(2, '0')}  ` +
        `${durs[i].toFixed(0).padStart(3)}s  ${s.comp.padEnd(5)} ${s.title}`
    );
  });
  console.log(`\n字幕 ${sub ? '烧进画面' : '不烧'}　推镜 ${drift ? '开' : '关'}　音波 ${wave ? '开' : '关'}\n编码中…`);

  const t0 = Date.now();
  const r = spawnSync('ffmpeg', args, { cwd: resolve(audioDir), encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg 退出码 ${r.status}`);

  const size = (readFileSync(out).length / 1024 / 1024).toFixed(1);
  console.log(`\n→ ${out}　${size} MB　（编码 ${((Date.now() - t0) / 1000).toFixed(0)}s）`);
}

main();
