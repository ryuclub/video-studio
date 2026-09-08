#!/usr/bin/env node
/**
 * tts-match —— 配音试配台
 *
 * 拿一份稿子逐行过 Edge TTS，量出每行真实时长，报出总长和实测语速。
 * 用来在正式出片之前把「稿子多长 / 语速多少 / 时间轴对不对」这三件事定死，
 * 而不是靠字数估。
 *
 *   node tts-match.mjs --file 稿子.txt --pick zh-CN-YunjianNeural --rate +20% --pitch -10Hz
 *
 * 稿子一行一段，空行和 # 开头的行跳过。
 * 输出：out/<name>/seg1.mp3 … + manifest.json（时间轴，可直接喂给出片脚本）
 *
 * 常用参数
 *   --file    稿件路径（必填）
 *   --pick    音色，默认 zh-CN-YunjianNeural（云健·浑厚，主讲员）
 *   --rate    语速，Edge 语法：+20% / -4% / 默认 -4%
 *   --pitch   音高，Edge 语法：-10Hz / +5% / 默认不改
 *   --out     输出目录，默认 out/tts-match
 *   --target  期望总长（秒），给了就报偏差
 *   --dry     只算不合成（拿上次的 manifest 重算时间轴）
 *   --配音    配音层 JSON（见下）。给了它就**不能**再给 --pick/--rate/--pitch
 *
 * ## 两个后端
 *
 *   --backend edge      默认。Edge 朗读接口，上面那些参数都是它的。
 *   --backend sovits    石老板的克隆音，走本地 GPT-SoVITS 的 api_v2.py。
 *
 * 走 sovits 时**必给** `--ref` 和 `--ref-text`（参考音频及其文本，5~10 秒，
 * 它定的是**语气**不是音色）；`--pitch` 在这条路上不存在，给了直接停。
 *
 *   node tts-match.mjs --file 稿子.txt --backend sovits \
 *     --ref "E:/ryu/石总/音色模型/参考音频.wav" --ref-text "房子空着是要花钱的。"
 *
 *   --host        api_v2.py 的地址，默认 http://127.0.0.1:9880
 *   --seed        默认 42。**别改成 -1** —— 随机 seed 会让同一句话每跑一次时长都不同
 *   --sovits-ver  写进 manifest 的版本名，默认 v2proplus。换版本必须跟着改
 *
 * ⚠ **换后端 = 换人。** 时长会变、同一个标点停多久也会变，所以整期要重跑
 * `tts-match → envelope → shoot → build`，动作表重核，标点停顿表整张重测。
 * 详见 voice-clone/音色克隆方案.md §五、§九。
 *
 * ## 配音层：送给 TTS 的文本 ≠ 屏幕上的文本
 *
 * 稿子是**观众看到的**那份 —— 它同时是字幕的源（出片脚本直接拿 `segments[].text` 上屏）。
 * 所以「念的时候在这儿停一下」「这个字念成那个音」**不能写进稿子**，写进去就上屏了。
 * 这些写在配音层里，只改送给 TTS 的那一份。
 *
 *   {
 *     "音色": "zh-CN-YunxiNeural", "语速": "+6%", "音高": null,
 *     "逐句": {
 *       "4": { "停": [["一套", 0.4]], "音": [["量", "良"]], "重": ["贵一点"] }
 *     }
 *   }
 *
 * | 字段 | 干什么 | 谁消费 |
 * |---|---|---|
 * | `停` | 在某个词后面加个停顿。**给秒数就挑最接近的标点**，也可以直接写标点 | TTS |
 * | `音` | 同音字替身（多音字念错时用）。⚠ 必须**完全同音、且替身本身不是多音字** | TTS |
 * | `重` | 哪几个词该重读 | **没人消费，以后也不会有** —— 后续走的是克隆音，同样是 TTS、同样没有重音控制 |
 *
 * ⚠ **停顿只能靠标点。** `<break>` 和 `<mstts:express-as>` 在 Edge 这个端点上是**被拒**的
 * （2026-09-06 实测：连接直接断在 `Stream closed before the synthesis completed`，
 * 不是「不生效」而是「合不出来」）。Azure Speech Service 那个订阅端点支持，但我们不在那上面。
 * 所以配音层存的是**意图**（停多久），落地方式按端点来 —— 哪天换 Azure，同一份 JSON 出真 SSML。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const exec = promisify(execFile);

/* ---------- 参数 ---------- */
function argv(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const FILE = argv('file');
// ⚠ 这三个给了 --配音 之后会被配音层覆盖，所以是 let
let VOICE = argv('pick', 'zh-CN-YunjianNeural');
let RATE = argv('rate', '-4%');
let PITCH = argv('pitch', null);
const OUTDIR = argv('out', 'out/tts-match');
const TARGET = argv('target', null);
const DRY = argv('dry', false);
const PLAN_FILE = argv('配音', null);

/**
 * TTS 后端。`edge`（默认，排片阶段的占位音）／ `sovits`（石老板的克隆音，正式出片）。
 * 两条都跑通并出过片，全链路命令见 voice-clone/音色克隆方案.md §二十。
 *
 * ⚠ **后端要写进 manifest。** 换后端会改变时长、也会改变「一个逗号停多久」——
 * 也就是说 `vo/` 里的音频和「用什么后端出的」是绑死的。不记的话，
 * **两个后端混着出的一期片子在任何一步都不会报错**，只是听起来像两个人。
 * 换 GPT-SoVITS 的版本也算换后端（v2 训的模型 v4 不能用，韵律也不一样），
 * 所以这个字段记的是 `sovits-v2` 这种带版本的名字，不是光秃秃一个 `sovits`。
 * 判据和升级纪律见 voice-clone/音色克隆方案.md §九。
 */
const BACKEND = argv('backend', 'edge');

/* ---------- sovits 后端的参数（--backend edge 时全部用不上） ---------- */
const HOST = String(argv('host', 'http://127.0.0.1:9880')).replace(/\/$/, '');
const REF = argv('ref', null);            // 参考音频（服务端路径）
const REF_TEXT = argv('ref-text', null);  // 参考音频念的是什么
const SEED = parseInt(argv('seed', '42'), 10);
/**
 * ⚠ **这个字符串是人工维护的**，脚本没法查服务端到底跑的是哪一版。
 * 它写进 `manifest.backend`，用来事后回答「这期是哪个后端出的」。
 * **换了 GPT-SoVITS 的版本，这里必须跟着改** —— 忘了改的话，
 * manifest 会理直气壮地记一个错的版本号，比不记还糟。
 * 版本纪律见 voice-clone/音色克隆方案.md §九。
 */
const SOVITS_VER = argv('sovits-ver', 'v2proplus');

if (!FILE) {
  console.error('要给 --file 稿件路径。跑 `node tts-match.mjs` 看用法。');
  process.exit(1);
}
if (!['edge', 'sovits'].includes(BACKEND)) {
  console.error(`--backend ${BACKEND} 不认识。只有 edge / sovits。`);
  process.exit(1);
}
if (BACKEND === 'sovits') {
  // 参考音频定的是**语气**，不是音色。缺了它 GPT-SoVITS 根本不合成，
  // 所以宁可在这儿停，也别让人跑完一整期才发现给的是默认参考音。
  if (!REF || !REF_TEXT) {
    console.error('--backend sovits 要同时给 --ref 和 --ref-text。');
    console.error('  --ref       参考音频路径（5~10 秒，**服务端**读得到的路径）');
    console.error('  --ref-text  这段参考音频念的是什么');
    console.error('参考音频定语气不定音色，选定就别再换 —— 见 voice-clone/音色克隆方案.md §五。');
    process.exit(1);
  }
  if (PITCH) {
    console.error('--pitch 是 Edge 的参数，sovits 后端没有。要改音高只能重训或换参考音频。');
    process.exit(1);
  }
  // 参考音频 3~10 秒是 GPT-SoVITS 的硬约束，超出直接 400。
  // 在这儿拦一下，省得跑到第一句才炸。
  if (typeof REF === 'string' && fs.existsSync(REF)) {
    try {
      const d = parseFloat(
        execFileSync('ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', REF],
          { encoding: 'utf8' }).trim());
      if (d < 3 || d > 10) {
        console.error(`参考音频 ${d.toFixed(1)}s，超出 GPT-SoVITS 的 3~10 秒硬区间，服务端会直接 400。`);
        console.error('  跑 node voice-clone/录音体检.mjs <文件> --参考 看还差什么。');
        process.exit(1);
      }
    } catch (e) {
      // ffprobe 不在就算了，让服务端去报。但**别静默** ——
      // 这个 catch 第一版把 execFileSync 没导入的 ReferenceError 也吞了，
      // 结果预检看着在、其实一次都没跑过。
      if (e instanceof ReferenceError || e instanceof TypeError) throw e;
      console.log('（ffprobe 没跑通，参考音频时长这一关交给服务端去拦）');
    }
  }
}

/* ---------- 稿件 ---------- */
const lines = fs
  .readFileSync(FILE, 'utf8')
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith('#'));

if (!lines.length) {
  console.error('稿件里没有可用行。一行一段，空行和 # 开头的会跳过。');
  process.exit(1);
}

const hanzi = (s) => [...s].filter((c) => /[一-龥]/.test(c)).length;

/* ---------- 配音层 ---------- */

/**
 * **标点值多少秒**（2026-09-06 实测，音色 `zh-CN-YunxiNeural`、rate `+6%`）。
 * 同一句话只换中间那个标点，量出来的净增：
 *
 * ⚠ **换音色或换语速要重量。** 这张表是那一组参数下的数，不是普适常数。
 * ⚠ **省略号比逗号还短**（0.29 < 0.38），这条反直觉，别照「视觉上更长」猜。
 * ⚠ 停顿长短只是一半 —— 句号会把语调收下去、问号会挑上去。**要的是停顿就别用句号问号**。
 */
const 标点值 = [
  ['……', 0.29], ['、', 0.38], ['，', 0.38], ['——', 0.38],
  ['：', 0.41], ['；', 0.50], ['。', 0.79], ['！', 0.79], ['？', 0.91],
];

/** 稿子里出现 `<` 就当场停 —— 有人把 SSML 写进稿子了，那玩意会**原样烧进字幕** */
function 查标签(lines) {
  const 中 = lines.filter((l) => l.includes('<'));
  if (!中.length) return;
  console.error('稿子里有 `<` —— 看着像 SSML：');
  中.slice(0, 3).forEach((l) => console.error('  ' + l));
  console.error('');
  console.error('  **稿子是观众看到的那份，它同时是字幕的源** —— 标签会原样烧进画面。');
  console.error('  停顿／正音／重音写到配音层里（--配音 配音.json），那份只改送给 TTS 的文本。');
  console.error('  另外：<break> 和 <mstts:express-as> 在 Edge 这个端点上是被拒的，合不出来。');
  process.exit(1);
}

/** 把一行稿子变成「念的那一份」。屏上那份原样不动 */
function 念法(行, 条) {
  if (!条) return 行;
  let 念 = 行;
  for (const [原, 替] of 条.音 || []) {
    if (!念.includes(原)) { console.error(`配音层：这句里没有「${原}」，替不了 —— ${行}`); process.exit(1); }
    念 = 念.split(原).join(替);
  }
  for (const [词, 停] of 条.停 || []) {
    if (!念.includes(词)) { console.error(`配音层：这句里没有「${词}」，停不了 —— ${行}`); process.exit(1); }
    let 点 = 停;
    if (typeof 停 === 'number') {
      // 给秒数就挑最接近的标点。**挑完要打出来** —— 粒度只有九档，别让人以为是连续的
      点 = 标点值.reduce((a, b) => (Math.abs(b[1] - 停) < Math.abs(a[1] - 停) ? b : a))[0];
      console.log(`      停 ${停}s → 「${点}」(${标点值.find((x) => x[0] === 点)[1]}s)　在「${词}」后`);
    } else if (!标点值.some((x) => x[0] === 点)) {
      console.error(`配音层：「${点}」不在量过的标点表里。只能用 ${标点值.map((x) => x[0]).join(' ')}`);
      process.exit(1);
    }
    // ⚠ **词后面已经有标点就换掉它，没有才追加。**
    // 这才是「调音」——「顺序你定，锚就定不下来」想让落点沉下去，
    // 要的不是在逗号后面再加一个，是把那个逗号**换成句号**（0.38 → 0.79，而且语调收下去）。
    // 只会追加的话就写成了「顺序你定，。锚…」，念出来是个磕巴
    const 后 = 念[念.indexOf(词) + 词.length];
    if (后 && /[，。、；：！？]/.test(后)) {
      念 = 念.replace(词 + 后, 词 + 点);
      console.log(`      调音　「${词}」后　${后} → ${点}`);
    } else {
      念 = 念.replace(词, 词 + 点);
    }
  }
  return 念;
}

/**
 * **高危多音字，整条汇总提醒。**
 *
 * ⚠ **只提醒不拦。** 哪个读音对是**听**出来的，脚本判不了 —— 拦了只会被无脑跳过。
 * 表抄自老马线（`joke-video/src/laoma-diction.ts`）**再加一个「行」**：
 * 2026-09-07 用户在 01-B 里听出「一句话就行」被念成 háng，而老马那张表里没有「行」。
 * 在那之前，老石这条线**一次多音字检查都没过**。
 *
 * 改法在配音层的 `音`：**同音字替身**，只换送给 TTS 的文本，屏上还是原字。
 * ⚠ 替身必须**完全同音（含声调）、而且它本身不是多音字**。
 */
const 多音字 = [...'都得了着干会差还好少长重分中转空数应便落行'];
function 报多音字(lines) {
  const 计 = new Map();
  lines.forEach((x, i) => [...x].forEach((c, j) => {
    if (!多音字.includes(c)) return;
    if (!计.has(c)) 计.set(c, []);
    计.get(c).push(`句${i + 1} …${x.slice(Math.max(0, j - 3), j)}【${c}】${x.slice(j + 1, j + 4)}…`);
  }));
  if (!计.size) return;
  const 总 = [...计.values()].reduce((a, b) => a + b.length, 0);
  console.log(`\n⚠ 高危多音字 ${总} 处 —— **听一遍核这几个**，读错了在配音层的「音」里放同音字替身：`);
  for (const [c, xs] of 计) console.log(`   ${c}  ${xs.join('　')}`);
}

/**
 * **漏停：一个气口段太长了。**
 *
 * 判据抄老马线（`用语规范.md` §十一「句长 >10 且无逗号无句号」），**阈值抬到 13**：
 * 老石的语速实测 230–243 字/分 ≈ 每字 0.25 秒，13 字 ≈ 3.4 秒 ——
 * 正常说话一个气口段 2–4 秒，10 字（2.5 秒）对这条线偏短，会把好好的句子切碎。
 * 13 正好也是**字幕每行的字数**：巧合，但好记 —— **一个气口 ≈ 一行字幕**。
 *
 * ⚠ **改在配音层的 `停`，不改稿子。** 往稿子里加逗号会跟着上屏 ——
 * 屏上那句「这套房上一位租客什么时候搬走的」是一口气问出来的，
 * 中间蹦个逗号反而碎；要的只是**念的时候**有个气口。
 *
 * ⚠ 只提醒不拦：气口该不该有、加在哪儿，得看句子结构，脚本判不了。
 */
const 气口上限 = 13;
function 报漏停(lines) {
  const 中 = [];
  lines.forEach((x, i) => {
    for (const g of x.split(/[，。、；：！？…—]/)) {
      const n = [...g].length;
      if (n > 气口上限) 中.push(`句${i + 1}  ${n} 字  「${g}」`);
    }
  });
  if (!中.length) return;
  console.log(`
⚠ 气口段超过 ${气口上限} 字 ${中.length} 处 —— 念起来会憋，考虑在配音层的「停」里加个气口：`);
  中.forEach((x) => console.log('   ' + x));
}

查标签(lines);

let PLAN = null;
if (PLAN_FILE) {
  if (process.argv.includes('--pick') || process.argv.includes('--rate') || process.argv.includes('--pitch')) {
    console.error('给了 --配音 就别再给 --pick/--rate/--pitch —— 两个地方说了算，迟早对不上。');
    console.error('  参数写在配音层里，命令行只给 --配音。');
    process.exit(1);
  }
  PLAN = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
  if (!PLAN.音色 || !PLAN.语速) { console.error(`${PLAN_FILE} 里要有「音色」和「语速」`); process.exit(1); }
  VOICE = PLAN.音色; RATE = PLAN.语速; PITCH = PLAN.音高 || null;
  // 逐句的键是句号，越界了多半是稿子改过而配音层没跟着改 —— 那是会静默走偏的
  for (const k of Object.keys(PLAN.逐句 || {})) {
    if (!(+k >= 1 && +k <= lines.length)) {
      console.error(`配音层写了第 ${k} 句，但稿子只有 ${lines.length} 句 —— 稿子改了配音层没跟上？`);
      process.exit(1);
    }
  }
}

/* ---------- 合成 ---------- */
fs.mkdirSync(OUTDIR, { recursive: true });

async function durationSec(f) {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f,
  ]);
  return parseFloat(stdout.trim());
}

/**
 * 长连接跑几十行之后服务端会掐掉，之后 toStream 安静地返回空流 —— 不报错，
 * 只写出 0 字节。所以空音频要当成「连接死了」处理，重新握手再来。
 * 这个坑仓库的 src/steps/tts.ts 里已经踩过，这里照抄它的处理。
 */
let client = null;
async function ttsEdge(text, outFile) {
  for (let attempt = 1; ; attempt++) {
    try {
      if (!client) {
        client = new MsEdgeTTS();
        await client.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      }
      const prosody = { rate: RATE };
      if (PITCH) prosody.pitch = PITCH;
      const { audioStream } = client.toStream(text, prosody);
      await new Promise((res, rej) => {
        const w = fs.createWriteStream(outFile);
        audioStream.pipe(w);
        w.on('finish', res);
        w.on('error', rej);
        audioStream.on('error', rej);
      });
      if (fs.statSync(outFile).size === 0) throw new Error('返回空音频');
      return;
    } catch (e) {
      client = null;
      if (attempt >= 3) throw e;
    }
  }
}

/**
 * GPT-SoVITS 后端（石老板的克隆音）。走本地起的 `api_v2.py`，POST /tts。
 *
 * ⚠ **接口的两个默认值对我们是错的，必须显式盖掉**：
 *
 *   `text_split_method` 默认 `cut5`（按标点再切一刀）→ 我们改 **`cut0`（不切）**。
 *     我们是**逐行合成**的，manifest 的时间轴精确到行。让它再切一次，
 *     它会按自己的规矩插停顿，`seg{i}.mp3` 就不再等于「第 i 行」了 ——
 *     而这件事**不报错**，只是字幕跟声音对不上。
 *
 *   `seed` 默认 `-1`（每次随机）→ 我们**钉死**。
 *     不钉的话同一句话每跑一次时长都不一样，整条链路「改了什么要重跑哪一步」
 *     那张表就失效了：什么都没改，重跑一次时间轴也会飘。
 *
 * ⚠ `ref_audio_path` 是**服务端**读的路径。服务在本机就用绝对路径；
 *    哪天服务挪到别的机器（`--host`），这个路径要是那台机器上的。
 *
 * ⚠ 语速走 `speed_factor`，跟 Edge 的 `rate` **不是同一套机制**。
 *    这里把 `+6%` 折成 `1.06` 只是让 `配音.json` 的字段不用改，
 *    **不代表出来的时长一样** —— 换后端时间轴必须整期重量。
 */
async function ttsSovits(text, outFile) {
  const speed = 1 + (parseFloat(String(RATE).replace('%', '')) || 0) / 100;
  const body = {
    text,
    text_lang: 'zh',
    ref_audio_path: REF,
    prompt_text: REF_TEXT,
    prompt_lang: 'zh',
    text_split_method: 'cut0', // 不切，见上
    seed: SEED,                // 钉死，见上
    speed_factor: +speed.toFixed(3),
    media_type: 'wav',
    streaming_mode: false,
    batch_size: 1,
  };
  const wav = outFile.replace(/\.mp3$/, '.tmp.wav');
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(`${HOST}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) throw new Error('返回空音频');
      fs.writeFileSync(wav, buf);
      /**
       * ⚠ **必须转成 mp3，参数要跟 Edge 那条路一致 —— 而且 `-write_xing 0` 不能省。**
       *
       * 出片时 `shi-2d/build.mjs` 是 `ffmpeg -f concat -c copy` 把 seg 拼成 vo.mp3。
       * 24kHz / 96kbps / mono 是对齐 msedge-tts 的 AUDIO_24KHZ_96KBITRATE_MONO_MP3，
       * 但**光对齐这三样还不够**：
       *
       * libmp3lame 会写一个 Xing/LAME 头，里面记着编码器延迟和末尾补白。
       * ffprobe 读单个文件时按这个头报「真实时长」（把补白扣掉），
       * 而 `concat -c copy` 是**照搬帧**的，补白照样进去 ——
       * 于是 **manifest 的时间轴比拼出来的 vo.mp3 短**。
       * 2026-09-07 实测：01-B 十句累积差 **0.52 秒**（每段约 52ms），
       * 而 Edge 那条路拼出来是 40.320 对 40.32，分毫不差。
       *
       * `-write_xing 0` 之后 ffprobe 改按帧数算，逐段和 ＝ 拼接后，误差归零。
       * 代价是每段多出几十毫秒的静音补白 —— 句间多这么点空隙无所谓，
       * **时间轴对不上才是要命的**。
       */
      await exec('ffmpeg', ['-v', 'error', '-y', '-i', wav,
        '-ar', '24000', '-ac', '1', '-b:a', '96k', '-c:a', 'libmp3lame',
        '-write_xing', '0', outFile]);
      fs.unlinkSync(wav);
      return;
    } catch (e) {
      if (attempt >= 3) {
        throw new Error(`GPT-SoVITS 合成失败（${HOST}）：${e.message}\n` +
          `  服务起了吗：python api_v2.py -a 127.0.0.1 -p 9880\n` +
          `  参考音频在服务端存在吗：${REF}`);
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

const tts = BACKEND === 'edge' ? ttsEdge : ttsSovits;

console.log(`稿件 ${FILE}　${lines.length} 段`);
console.log(
  BACKEND === 'edge'
    ? `音色 ${VOICE}　rate ${RATE}${PITCH ? `　pitch ${PITCH}` : ''}\n`
    : `后端 sovits-${SOVITS_VER} @ ${HOST}　参考 ${REF}　seed ${SEED}　rate ${RATE}\n`,
);

/**
 * 换到 sovits 之后，配音层里有哪些「停」白写了 —— **开跑前就说，别等跑完**。
 *
 * GPT-SoVITS 的中文前端会归一化标点（2026-09-07 实测，判据是输出音频的 md5）：
 *   `——`        → **整个删掉**，音频跟不加标点的字节完全一致
 *   `、：；，,`  → 全部合并成 `,`，五种写法共用同一份音频
 *   `……`        → `…`；`。.` → `.`；`！` → `!`；`？` → `?`
 *
 * 所以配音层里「在这儿加个破折号顶一档停顿」这种写法，在克隆音上是**无效动作**，
 * 而且**一步都不报** —— 声音照出，只是那口气没了。01-B 的句3、句5 就是这么写的。
 *
 * 这是前端行为，跟哪个模型无关，微调之后照样成立。
 * 详见 voice-clone/音色克隆方案.md §十一。
 */
const 归一 = { '——': '删掉', '、': ',', '：': ',', '；': ',', '，': ',', ',': ',', '……': '…', '。': '.', '.': '.', '！': '!', '？': '?' };
if (BACKEND === 'sovits' && PLAN?.逐句) {
  const 没了 = [], 合并 = [];
  for (const [句, 条] of Object.entries(PLAN.逐句)) {
    for (const [词, 值] of 条.停 || []) {
      if (typeof 值 !== 'string') continue;
      if (归一[值] === '删掉') 没了.push(`句${句}「${词}」后面的 ${值}`);
      else if (值 !== '，' && 归一[值] === ',') 合并.push(`句${句}「${词}」后面的 ${值} → 跟逗号没区别`);
    }
  }
  if (没了.length) {
    console.log(`⚠ 配音层里有 ${没了.length} 处停顿在克隆音上**会被整个删掉**（前端不认破折号）：`);
    for (const s of 没了) console.log(`   ${s}`);
    console.log('   想要那口气，改成断句（拆成两行），不要指望标点。见 音色克隆方案.md §十一。\n');
  }
  if (合并.length) {
    console.log(`⚠ 配音层里有 ${合并.length} 处停顿在克隆音上**跟逗号是同一个东西**：`);
    for (const s of 合并) console.log(`   ${s}`);
    console.log('');
  }
}

const segs = [];
let t0 = 0;
let 报过停顿警告 = false;
let 改了 = 0;
for (let i = 0; i < lines.length; i++) {
  const file = path.join(OUTDIR, `seg${i + 1}.mp3`);
  const 条 = PLAN?.逐句?.[String(i + 1)];
  /**
   * ⚠ **「停」给秒数这套做法，在 sovits 后端上是无效动作。**
   *
   * 它的原理是拿 `标点值` 那张表反查「哪个标点值这么多秒」。那张表在 Edge 上成立，
   * 因为 Edge 是拼接式 TTS，标点约等于「插多长静音」的规则，是个常数。
   * GPT-SoVITS 的韵律是 GPT 模型看着整句自回归生成的 —— 2026-09-07 拿三个载句实测，
   * 同一个 `？` 的净增是 0.00 / 0.76 / 0.04 秒。**没有那个常数，也就没法反查。**
   *
   * 所以这里不是「数要重量」，是**这个动作本身不成立**，得当场说清楚，
   * 不然写稿的人会以为自己控制住了停顿。详见 voice-clone/音色克隆方案.md §十一。
   */
  if (条?.停?.some((x) => typeof x[1] === 'number')) {
    if (BACKEND === 'sovits') {
      if (!报过停顿警告) {
        console.log('⚠ 配音层里有「停」按秒数写的条目 —— sovits 后端上这是无效动作。');
        console.log('   停顿由 GPT 模型看整句决定，同一个标点在不同句子里停多久是不一样的。');
        console.log('   要停顿就改断句（拆成两行），不要指望挑标点。见 音色克隆方案.md §十一。');
        报过停顿警告 = true;
      }
      console.log(`   第 ${i + 1} 句`);
    } else {
      console.log(`  第 ${i + 1} 句`);
    }
  }
  const 念 = 念法(lines[i], 条);
  // ⚠ **合成喂的是「念」，manifest 的 text 仍旧是屏上那份** —— 字幕读的是 text
  if (!DRY) await tts(念, file);
  const dur = await durationSec(file);
  const seg = {
    index: i + 1, text: lines[i], file: file.replace(/\\/g, '/'),
    chars: hanzi(lines[i]), start: +t0.toFixed(3), duration: +dur.toFixed(3),
    end: +(t0 + dur).toFixed(3),
  };
  if (念 !== lines[i]) { seg.念 = 念; 改了++; }
  segs.push(seg);
  t0 += dur;
}
if (PLAN) {
  const 重 = Object.entries(PLAN.逐句 || {}).filter(([, v]) => v.重?.length);
  console.log(`
配音层 ${PLAN_FILE}　${改了} 句的念法跟屏上不一样`);
  if (重.length) {
    console.log(`⚠ 「重」这一栏有 ${重.length} 句，**现在没人消费** —— Edge 做不了重音。`);
    console.log('   写稿时的备忘而已 —— 想标重音就说明那句该改结构。');
  }
}

/* ---------- 报表 ---------- */
const total = t0;
const chars = segs.reduce((a, s) => a + s.chars, 0);
const cpm = (chars / total) * 60;

console.log('段   字数     时长        起—止           节选');
for (const s of segs) {
  const head = [...s.text].slice(0, 14).join('') + ([...s.text].length > 14 ? '…' : '');
  console.log(
    ` ${String(s.index).padStart(2)}  ${String(s.chars).padStart(4)}  ` +
    `${(s.duration.toFixed(2) + 's').padStart(7)}  ` +
    `${(s.start.toFixed(2) + '–' + s.end.toFixed(2)).padStart(14)}   ${head}`,
  );
}
console.log(`\n合计 ${total.toFixed(2)}s　汉字 ${chars}　实测语速 ${cpm.toFixed(0)} 字/分`);

if (TARGET) {
  const t = parseFloat(TARGET);
  const d = total - t;
  console.log(
    `目标 ${t}s　偏差 ${(d > 0 ? '+' : '') + d.toFixed(2)}s　` +
    `压到目标需 ${((chars / t) * 60).toFixed(0)} 字/分，或砍到 ${Math.round(chars * (t / total))} 字`,
  );
}

const manifest = {
  script: FILE, 配音层: PLAN_FILE || null,
  backend: BACKEND === 'edge' ? 'edge' : `sovits-${SOVITS_VER}`,
  // sovits 那几个参数改了，声音就变了 —— 记下来，事后才回答得了「这期是怎么出的」
  ...(BACKEND === 'sovits' ? { sovits: { host: HOST, ref: REF, refText: REF_TEXT, seed: SEED } } : {}),
  voice: VOICE, rate: RATE, pitch: PITCH || null,
  total: +total.toFixed(3), chars, cpm: +cpm.toFixed(1),
  generatedAt: new Date().toISOString(), segments: segs,
};
const mf = path.join(OUTDIR, 'manifest.json');
fs.writeFileSync(mf, JSON.stringify(manifest, null, 2));
报多音字(lines);
报漏停(lines);
console.log(`\n音频 ${OUTDIR}/seg*.mp3\n时间轴 ${mf.replace(/\\/g, '/')}`);
