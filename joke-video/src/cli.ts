#!/usr/bin/env node
// ── 命令行入口 ───────────────────────────────────────────────────────
//   npm run sfx                     试听全部合成音效 + BGM
//   npm run still -- <cfg> [秒...]  出静帧，快速看画面
//   npm run draft -- <cfg>          无配音草片（时长用估算值）
//   npm run cast                    看角色音色表
//   npm run try -- <音色> [台词]    试听角色音色
//   npm run voice -- <cfg>          生成配音（Edge 合成 + 变声）
//   npm run align -- <cfg>          读 voice/ 下的配音，去静音并回填真实时长
//   npm run build -- <cfg>          正式出片（用回填后的真实时长）

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { FPS, SR, OUT } from './config.js';
import { writeWav, readWav, resample } from './audio/wav.js';
import { sfx, type SfxName } from './audio/sfx.js';
import { makeBgm } from './audio/bgm.js';
import { trimSilence, frameEnvelope } from './audio/align.js';
import { mixdown } from './audio/mix.js';
import { buildTimeline, estimateDur, openSpan } from './beats/typeA.js';
import { renderFrame, type RenderCtx, type VoiceTrack } from './render.js';
import { svgToPng, renderVideo } from './video.js';
import { lineText, type JokeCfg } from './types.js';
import { add, normalize } from './audio/dsp.js';
import { synthesizeJoke, listVoices, resolveLineVoice } from './tts.js';
import { CASTS, CAST_NAMES, DELIVERIES, resolveCast } from './cast.js';
import { morphToWav, isIdentity } from './audio/morph.js';
import { filmFile, draftFile, audioFile, coverFile } from './preview.js';
import { renderStills, jokeSection, page, navEntry, navPanel, projectDir, findProjectDir, syncProjects, buildVoiceSamples } from './preview.js';
import { coverSvg, checkTitle, safeZoneOverlaySvg } from './cover.js';
import { buildVoiceDoc } from './voicedoc.js';
import { unfilled, ensurePlan } from './plan.js';
import { report } from './preflight.js';
import { gate as laomaGate } from './laoma-check.js';
import { buildShotDoc } from './shotdoc.js';
import { SCENE_NAMES, getScene } from './scenes/index.js';
import { report as layoutReport, solve as layoutSolve } from './layout.js';

import { makeInk } from './style/palette.js';

/** 空场预览不去色 */
const makeInkPlain = makeInk(0);

const argv = process.argv.slice(2);
const cmd = argv[0];

function loadCfg(p?: string): { cfg: JokeCfg; path: string } {
  if (!p) throw new Error('请指定配置文件，例如 jokes/snake-poison.json');
  return { cfg: JSON.parse(readFileSync(p, 'utf8')) as JokeCfg, path: p };
}

/**
 * 老马线的稿件体检闸。**只对老马线生效**，别的线一个字都不变。
 *
 * ── 为什么要接进来 ──
 *
 * `laoma-check.ts` 顶上抄了心理线那句「**文档拦不住人，体检才拦得住**」，
 * 可它自己在 2026-08-22 之前只是个要人**记得跑**的独立命令 ——
 * 治愈线的 `zhiyu-check` 被 `zhiyu-episode` 调、拦在 TTS 之前，老马这条没有。
 * 于是同一句话反过来也成立：**要人记得跑的体检，一样拦不住人。**
 * 写完稿不跑体检直接 voice → build，一条带硬伤的稿子能一路出片。
 *
 * ── 为什么拦在这两处 ──
 *
 * `voice`：TTS 之前。稿子有硬伤就得改，改完配音全作废，先拦住省一轮。
 * `build`：渲染之前。四分钟的渲染，不值得为一条已知有硬伤的稿子花。
 *
 * **`draft` / `still` / `layout` 不拦** —— 那几个是看画面的工具，
 * 稿子还在改的时候正该用它们，拦了等于逼人先把文字弄干净才能看构图。
 */
function laomaOk(cfg: JokeCfg, argv: string[], act: string): boolean {
  if (!cfg.characters?.some((c) => c.rig === 'horse')) return true;
  // ⚠ **长片不进这道闸。** 它查的全是短片的东西 —— 落点、铺垫几句、物件、
  // 日子牌、片长 18–45 秒。拿去判一条五分钟的稿子，报出来的每一条都是错的，
  // 而**天天报错的闸门，人只会学会加 `--anyway`**（那才是真正的损失：
  // 累积式和单点式那两道有用的闸也跟着不被当回事了）。
  //
  // 长片自己的规范还没写（素材包里那份方案只到「先录音」那一步），
  // 有了再往这儿接一道 —— **在那之前，它是没有闸的，写稿的人心里得有数。**
  if (cfg.format === 'long') {
    console.log('\n长片：不走短片那道体检（落点／铺垫／物件／日子牌／片长全是短片的判据）。');
    console.log('长片自己的规范还没写 —— **这条线现在没有闸**，稿子对不对只能靠人看。\n');
    return true;
  }
  console.log('\n稿件体检（老马线）');
  if (laomaGate(cfg)) return true;
  console.log('');
  console.log(`改完再${act}。要强行${act}加 --anyway。`);
  console.log('');
  return argv.includes('--anyway');
}

function voiceDir(cfg: JokeCfg) {
  return `voice/${cfg.id}`;
}

/** 找第 i 句的配音文件：支持 1-who.wav / 1.wav / 01.wav */
function findVoice(cfg: JokeCfg, i: number): string | null {
  // ⚠ **无声字幕必须在这儿就挡掉。** 下面那个「按文件名排序取第 i 个 wav」的兜底
  // 会让编号错位 —— 静音句没有 wav，第 i 个 wav 是它**邻居**的配音，
  // 而拿邻居的音频当自己的**不报错**：出来是一条口型对不上、时间轴整体前移的片子。
  if (cfg.lines[i]?.silent) return null;
  const dir = voiceDir(cfg);
  if (!existsSync(dir)) return null;
  const who = cfg.lines[i].who;
  const cands = [`${i + 1}-${who}.wav`, `${i + 1}.wav`, `${String(i + 1).padStart(2, '0')}.wav`];
  for (const c of cands) if (existsSync(`${dir}/${c}`)) return `${dir}/${c}`;
  // 兜底：目录里按文件名排序取第 i 个 wav
  const all = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).sort();
  return all[i] ? `${dir}/${all[i]}` : null;
}

function loadVoices(cfg: JokeCfg): { raw: Map<number, Float32Array>; tracks: Map<number, VoiceTrack> } {
  const raw = new Map<number, Float32Array>();
  const tracks = new Map<number, VoiceTrack>();
  cfg.lines.forEach((line, i) => {
    const p = line.audio && existsSync(line.audio) ? line.audio : findVoice(cfg, i);
    if (!p) return;
    const a = readWav(p);
    const data = resample(a, SR);
    raw.set(i, data);
    tracks.set(i, { env: frameEnvelope(data, SR, FPS), dur: data.length / SR });
  });
  return { raw, tracks };
}

/** 给花名册每个角色出一句试听，塞进 projects/段子与儿童故事/_assets/ */
async function sampleVoices() {
  await buildVoiceSamples(async (id, cast, text) => {
    await synthesizeJoke({
      id,
      type: 'A',
      scene: 'abstract',
      characters: [{ id: '_', rig: 'human', side: 'left', cast }],
      lines: [{ who: '_', text, beat: 'reply' }],
    });
    return `voice/${id}/1-_.wav`;
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  // ── 试听音效 ──
  if (cmd === 'sfx') {
    mkdirSync(`${OUT}/sfx`, { recursive: true });
    const names: SfxName[] = ['thud', 'wood', 'hiss', 'grass', 'slide', 'cicada', 'whoosh', 'pop', 'gulp'];
    for (const n of names) {
      writeWav(`${OUT}/sfx/${n}.wav`, normalize(sfx(n, n === 'cicada' ? 3 : undefined), -3), SR);
      console.log(`  ${OUT}/sfx/${n}.wav`);
    }
    writeWav(`${OUT}/sfx/bgm-happy.wav`, makeBgm(12, undefined, 'happy'), SR);
    writeWav(`${OUT}/sfx/bgm-cheeky.wav`, makeBgm(12, undefined, 'cheeky'), SR);
    // 串起来的试听条：每个音效之间隔 0.6s
    const reel = new Float32Array(Math.ceil(28 * SR));
    let at = 0;
    for (const n of names) {
      const b = sfx(n, n === 'cicada' ? 2 : undefined);
      add(reel, b, at, 0.9);
      at += b.length + Math.floor(0.6 * SR);
    }
    writeWav(`${OUT}/sfx/_reel.wav`, normalize(reel, -2), SR);
    console.log(`  ${OUT}/sfx/_reel.wav  ← 一条听完所有音效`);
    console.log(`  ${OUT}/sfx/bgm-happy.wav, bgm-cheeky.wav`);
    return;
  }

  // ── 选角表：看有哪些角色音色可用 ──
  if (cmd === 'cast') {
    console.log('角色音色（填到角色的 cast 字段）：\n');
    for (const [name, c] of Object.entries(CASTS)) {
      const m = c.morph;
      const tag = m.pitch === 1 && m.formant === 1 ? '原声' : `pitch ${m.pitch} / formant ${m.formant}`;
      console.log(`  ${name.padEnd(8)} ${c.base.padEnd(32)} ${(c.rate ?? '0%').padEnd(6)} ${tag.padEnd(28)} ${c.note}`);
    }
    console.log('\n念法（填到台词的 delivery 字段，punch 句几乎总要变调）：\n');
    for (const [name, d] of Object.entries(DELIVERIES)) {
      console.log(`  ${name.padEnd(8)} ${JSON.stringify(d)}`);
    }
    console.log('\n想微调参数：npm run try -- <音色名> "一句台词"');
    console.log('要在网页上拖着调，用 voice-clone 的试听台（npm run lab，音色地图那个）。');
    return;
  }

  // ── 生成调音手册：跑一遍所有音色和念法，把实测数字写成表 ──
  if (cmd === 'shotdoc') {
    buildShotDoc();
    return;
  }

  if (cmd === 'voicedoc') {
    await buildVoiceDoc();
    return;
  }

  // ── 空场预览：只渲场景，不放角色。新场景做完先看这个 ──
  if (cmd === 'scene') {
    const name = argv[1];
    if (!name) {
      console.log('用法：npm run scene -- shore');
      console.log(`可用：${SCENE_NAMES.join(' / ')}`);
      return;
    }
    const layers = getScene(name)(makeInkPlain, 41);
    mkdirSync(`${OUT}/scenes`, { recursive: true });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
<rect width="1080" height="1920" fill="#F4EDE2"/>${layers.far}${layers.mid}${layers.near}</svg>`;
    const p = `${OUT}/scenes/${name}.png`;
    writeFileSync(p, svgToPng(svg));
    console.log(`  ${p}`);
    console.log('确认构图和配色没问题，再往里放角色写台词。');
    return;
  }

  if (cmd === 'voices') {
    await listVoices(argv[1] ?? 'zh');
    return;
  }

  // ── 试听单个角色音色：不用建 json，直接出 wav ──
  if (cmd === 'try') {
    const names = (argv[1] ?? '').split(',').filter(Boolean);
    const text = argv[2] ?? '大哥，我们有毒吗？我咬到了自己的舌头。';
    if (!names.length) {
      console.log('用法：npm run try -- 童声 "台词"');
      console.log('      npm run try -- 童声,老爷爷,大块头 "台词"   ← 逗号分隔，一次出多个对比');
      console.log(`\n可用：${CAST_NAMES.join(' / ')}`);
      return;
    }
    mkdirSync(`${OUT}/try`, { recursive: true });
    // 试听句一定要用真实会用到的句子。"测试测试"听不出差别，
    // 音色的区分度体现在长句的语调起伏里。
    for (const name of names) {
      const cast = resolveCast(name);
      await synthesizeJoke({
        id: `_try/${name}`,
        type: 'A',
        scene: 'abstract',
        characters: [{ id: '_', rig: 'human', side: 'left', cast: name }],
        lines: [{ who: '_', text, beat: 'reply' }],
      });
      const src = `voice/_try/${name}/1-_.wav`;
      const dst = `${OUT}/try/${name}.wav`;
      if (existsSync(src)) {
        writeFileSync(dst, readFileSync(src));
        const a = readWav(dst);
        console.log(`  ${dst}   ${(a.data.length / a.sampleRate).toFixed(2)}s   ${cast.note}`);
      }
    }
    console.log(`\n听 ${OUT}/try/ 下的文件。要拖着调参数用 voice-clone 的试听台：`);
    console.log('  cd ../voice-clone && npm run lab   → http://localhost:5178');
    console.log('调满意了把 pitch / formant 抄回 src/cast.ts。');
    return;
  }

  // ── 汇总预览：所有稿件一页，按稿件分组 ──
  if (cmd === 'preview' && !argv[1]) {
    await sampleVoices();
    const n = syncProjects((c) => loadVoices(c).tracks);
    console.log(`
${n} 条稿件，汇总页：projects/段子与儿童故事/index.html`);
    return;
  }

  // ── 批量：对 jokes/ 下所有 json 依次执行子命令（日更用）──
  if (cmd === 'batch') {
    const sub = argv[1];
    if (!['voice', 'align', 'build', 'draft', 'still', 'lines', 'preview', 'cover'].includes(sub ?? '')) {
      console.log('用法：npm run batch -- voice|align|build|draft|still|lines|preview|cover [额外参数]');
      return;
    }
    const files = readdirSync('jokes').filter((f) => f.endsWith('.json')).sort();
    console.log(`共 ${files.length} 条段子，依次执行 ${sub}\n`);
    for (const f of files) {
      console.log(`── ${f} ──`);
      // 继承 tsx 的 loader 参数，子进程才认得 .ts
      const r = spawnSync(
        process.execPath,
        [...process.execArgv, process.argv[1], sub, `jokes/${f}`, ...argv.slice(2)],
        { stdio: 'inherit' }
      );
      if (r.status !== 0) console.log(`  ${f} 失败，跳过`);
      console.log('');
    }
    return;
  }

  const { cfg, path } = loadCfg(argv[1]);

  // ── 台词 × 音色对照表：出片前核对"谁用什么音色念" ──
  if (cmd === 'lines') {
    const rows = cfg.lines.map((l, i) => {
      const c = cfg.characters.find((x) => x.id === l.who);
      const v = resolveLineVoice(c, l);
      const tag = isIdentity(v.morph) ? '原声' : `p${v.morph.pitch.toFixed(2)} f${v.morph.formant.toFixed(2)}`;
      const clause = l.say?.length
        ? l.say.map((s) => {
            const cv = resolveLineVoice(c, l, s.delivery);
            return `
     ├ 「${s.text}」 ${cv.delivery} ${cv.rate ?? '0%'} ${cv.pitch ?? '0Hz'}`;
          }).join('')
        : '';
      return `${i + 1}. 【${l.who}】${lineText(l)}
   音色 ${v.castName} · 念法 ${v.delivery} · ${v.base} ${v.rate ?? '0%'} · ${tag}${clause}${
     l.beat === 'punch' ? '   ← 笑点句' : ''
   }`;
    });
    // 同一条片子里两个角色撞音色，观众就分不清谁在说话，这是对话类最致命的错
    const used = new Map<string, string[]>();
    for (const c of cfg.characters) {
      const key = c.cast ?? '青年女';
      used.set(key, [...(used.get(key) ?? []), c.id]);
    }
    const dup = [...used.entries()].filter(([, ids]) => ids.length > 1);
    console.log(rows.join('\n'));
    if (dup.length) {
      console.log(`\n⚠ 音色撞车：${dup.map(([k, ids]) => `${ids.join('/')} 都用了「${k}」`).join('；')}`);
      console.log('  对话类里两个角色同音色 = 观众分不清谁在说话，换一个再出片。');
    }
    return;
  }

  // ── 单条稿件预览：场景图 + 对话 + 分析，落到 projects/段子与儿童故事/<日期>_<id>/ ──
  if (cmd === 'preview') {
    const dir = findProjectDir(cfg) ?? projectDir(cfg);
    mkdirSync(dir, { recursive: true });
    const { tracks } = loadVoices(cfg);
    if (tracks.size === 0) {
      console.log('还没有配音，场景图按估算时长出，时间点会有偏差。');
      console.log(`先跑 npm run voice -- ${path} && npm run align -- ${path} 更准。\n`);
    }
    await sampleVoices();
    // 走跟出片同一条路径：只重渲这条，顺手把汇总页也带上。
    // 单条页和汇总页共用一份代码，两边才不会各写各的、渐渐长歪。
    syncProjects((c) => loadVoices(c).tracks, { renderFor: cfg.id, quiet: true });
    console.log(`  ${dir}/stills/       7 张场景图`);
    console.log(`  ${dir}/方案.md      ← 分析写这里，重跑不会覆盖`);
    for (const u of unfilled(dir)) console.log(`      ⚠ 「${u.section}」还有 ${u.count} 处没填`);
    console.log(`  ${dir}/index.html   ← 双击打开`);
    console.log('  projects/段子与儿童故事/index.html   ← 汇总页也同步了');
    return;
  }

  // ── 封面：出 9x16 / 3x4 / 安全区 三张 ──
  if (cmd === 'cover') {
    const { tracks } = loadVoices(cfg);
    const tl = buildTimeline(cfg);
    const ctx: RenderCtx = { tl, voices: tracks };
    const { svg, title, at } = coverSvg(ctx, { title: argv[2], tag: argv[3] });

    for (const w of checkTitle(cfg, title)) console.log(`⚠ ${w}`);
    if (!argv[2] && !cfg.cover?.title) {
      console.log(`（大字是从第一句自动推的：「${title}」——这只是兜底，上线前建议手写一句）`);
      console.log('  写法见 封面设计规范-COVER.md 第二节：第一人称卖惨 > 第三人称叙述 > 互动求助\n');
    }

    const dir = findProjectDir(cfg) ?? projectDir(cfg);
    mkdirSync(`${dir}/cover`, { recursive: true });
    const png = svgToPng(svg);
    writeFileSync(`${dir}/${coverFile(cfg)}`, png);

    // 九宫格裁 3:4（居中 1080×1440）
    const crop = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', `${dir}/${coverFile(cfg)}`,
      '-vf', 'crop=1080:1440:0:240', `${dir}/cover/${cfg.id}-3x4.png`], { encoding: 'utf8' });
    if (crop.status !== 0) console.log(`3:4 裁切失败：${crop.stderr?.slice(0, 200)}`);

    // 安全区辅助线：把辅助层塞进同一张 svg 再出一次
    const withGuides = svg.replace('</svg>', `${safeZoneOverlaySvg()}</svg>`);
    writeFileSync(`${dir}/cover/${cfg.id}-安全区.png`, svgToPng(withGuides));

    console.log(`封面大字：「${title}」　取帧 ${at.toFixed(2)}s（彩色，非定格灰帧）`);
    console.log(`  ${dir}/${coverFile(cfg)}     发布用`);
    console.log(`  ${dir}/cover/${cfg.id}-3x4.png      个人主页九宫格的样子`);
    console.log(`  ${dir}/cover/${cfg.id}-安全区.png    检查有没有被平台 UI 盖住`);
    console.log(`\n出片时会自动把它嵌成第一帧（"cover": { "asFirstFrame": false } 可关）`);
    return;
  }

  // ── 本地 TTS 生成配音 ──
  if (cmd === 'voice') {
    if (!report(cfg, '配音')) return;
    if (!laomaOk(cfg, argv, '配音')) return;
    const n = await synthesizeJoke(cfg);
    console.log(`\n生成 ${n} 句到 voice/${cfg.id}/`);
    console.log(`接着跑：npm run align -- ${path} && npm run build -- ${path}`);
    return;
  }

  // ── 出片思路：方案骨架 ──────────────────────────────────────────────
  //
  // **在写稿阶段跑，不是出片之后。** 方案 §四 的发布文案（标题、封面大字、
  // 收尾金句）是同一个钩子的三种长度，分开想必然对不齐；而且填 §四 的时候
  // 就得把「这一条的中心思想是什么」想清楚 —— 想不清楚的稿子，
  // 渲完片子也还是想不清楚，只是多花了一次渲染。
  if (cmd === 'plan') {
    const dir = findProjectDir(cfg) ?? projectDir(cfg);
    mkdirSync(dir, { recursive: true });
    ensurePlan(cfg, dir);
    const miss = unfilled(dir);
    console.log(`  ${dir}/方案.md`);
    if (miss.length) {
      console.log('');
      console.log('还没填：');
      for (const u of miss) console.log(`  ⚠ 「${u.section}」${u.count} 处`);
      console.log('');
      console.log(`填完 §四 就能出发布文案（不用等成片）：npx tsx src/yiye-publish.ts ${path}`);
    } else {
      console.log(`  全部填完了。出发布文案：npx tsx src/yiye-publish.ts ${path}`);
    }
    return;
  }

  // ── 静帧 ──
  if (cmd === 'layout') {
    // --fix：把撞车的自动推开并写回 json
    if (argv.includes('--fix')) {
      const { x, rest } = layoutSolve(cfg);
      for (const ch of cfg.characters) if (x.has(ch.id)) ch.x = x.get(ch.id)!;
      for (const p of cfg.props ?? []) if (x.has(p.id)) p.x = x.get(p.id)!;
      writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
      console.log('已写回站位：');
      for (const [k, v] of x) console.log(`  ${k.padEnd(10)} x=${v}`);
      if (rest.length) {
        console.log(`\n还剩 ${rest.length} 处推不开——这一镜东西太多，1080 宽横排放不下。`);
        console.log('得从 stage 里撤东西或调小 scale，挪位置救不了：');
        for (const i of rest) console.log(`  ${i.line >= 0 ? `第${i.line}句` : '配置'}  ${i.msg}`);
      }
      return;
    }
    layoutReport(cfg);
    return;
  }

  /**
   * 首帧 —— 出场档 ②／③ 的第一帧，单出一张，**外带 120px 缩略图**。
   *
   *   npm run frame -- jokes/laoma-008.json
   *
   * ⚠ **缩略图那张是验收项，不是附赠。** 首帧规范 §四 写着：
   * 把首帧缩到 120px 宽、眯眼看 —— 物件还认得出吗？那个数字还看得见吗？
   * 两条都过才算合格。**信息流里观众得到的分辨率就是这个量级，大屏上好看不算数。**
   *
   * 所以这个命令一次出两张，**并排看**。只出大的那张，人一定只看大的。
   */
  if (cmd === 'frame') {
    const tl = buildTimeline(cfg);
    const open = openSpan(tl);
    if (!open) {
      console.log('这条稿子没开出场档（`opening` 没写），首帧就是开场空镜 —— 用 npm run still 看。');
      return;
    }
    const { tracks } = loadVoices(cfg);
    const ctx: RenderCtx = { tl, voices: tracks };
    mkdirSync(`${OUT}/stills`, { recursive: true });
    const big = `${OUT}/stills/${cfg.id}-首帧.png`;
    const png = svgToPng(renderFrame(ctx, 0));
    writeFileSync(big, png);
    // 缩略图走 ffmpeg 缩放，跟平台一个路子（不是把 svg 按小尺寸重渲 ——
    // 重渲会按小画布重新算字号，那就不是"缩略"了，是另一张图）
    const thumb = `${OUT}/stills/${cfg.id}-首帧-120px.png`;
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', big, '-vf', 'scale=120:-1', thumb], { encoding: 'utf8' });
    if (r.status !== 0) console.log(`  ⚠ 缩略图没出来：${r.stderr?.trim()}`);
    console.log(`  ${big}`);
    if (r.status === 0) console.log(`  ${thumb}   ← 首帧规范 §四：眯眼看，物件认得出吗？数字看得见吗？`);
    console.log(
      `出场档 ${open.style === 'object-first' ? '③ 先出声 · 物件' : '② 先出声 · 场景'}　` +
        `首帧字「${open.text}」　${open.subject ? `物件「${open.subject}」　` : ''}第 ${open.end.toFixed(2)}s 撤，人滑 ${open.slide}s`
    );
    return;
  }

  if (cmd === 'still') {
    const { tracks } = loadVoices(cfg);
    const tl = buildTimeline(cfg);
    const ctx: RenderCtx = { tl, voices: tracks };
    const secs = argv.slice(2).map(Number).filter((v) => !Number.isNaN(v));
    const list = secs.length ? secs : [1.0, tl.punchStart + 0.5, tl.freezeStart + 0.5, tl.duration - 1];
    mkdirSync(`${OUT}/stills`, { recursive: true });
    for (const s of list) {
      const f = Math.max(0, Math.min(Math.ceil(tl.duration * FPS) - 1, Math.round(s * FPS)));
      const p = `${OUT}/stills/${cfg.id}-${s.toFixed(2)}s.png`;
      writeFileSync(p, svgToPng(renderFrame(ctx, f)));
      console.log(`  ${p}`);
    }
    console.log(`片长 ${tl.duration.toFixed(2)}s，笑点 ${tl.punchStart.toFixed(2)}s，定格 ${tl.freezeStart.toFixed(2)}s`);
    return;
  }

  // ── 对齐：静音检测 → 回填时长 ──
  if (cmd === 'align') {
    mkdirSync(`${OUT}/voice/${cfg.id}`, { recursive: true });
    let found = 0;

    cfg.lines.forEach((line, i) => {
      // 无声字幕：时长是稿子定的，不量、不回填 audio。**这不是「没找到配音」**
      if (line.silent) {
        line.dur = line.silent;
        delete line.audio;
        console.log(`  第 ${i + 1} 句 [无声字幕] ${line.silent}s：「${lineText(line)}」`);
        return;
      }
      const p = findVoice(cfg, i);
      if (!p) {
        console.log(`  第 ${i + 1} 句：未找到配音（放到 voice/${cfg.id}/${i + 1}-${line.who}.wav）`);
        return;
      }
      const a = readWav(p);
      const data = resample(a, SR);
      const { start, end } = trimSilence(data, SR);
      const cut = data.slice(start, end);
      const outP = `${OUT}/voice/${cfg.id}/${i + 1}-${line.who}.wav`;
      writeWav(outP, cut, SR);
      line.dur = Math.round((cut.length / SR) * 1000) / 1000;
      line.audio = outP;
      found++;
      console.log(`  第 ${i + 1} 句 ${basename(p)}：原 ${(data.length / SR).toFixed(2)}s → 去静音 ${line.dur}s`);
    });
    writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
    const tl = buildTimeline(cfg);
    console.log(`\n已回填 ${found} 句到 ${path}`);
    console.log(`片长 ${tl.duration.toFixed(2)}s，笑点 ${tl.punchStart.toFixed(2)}s，定格(BGM 骤停) ${tl.freezeStart.toFixed(2)}s`);
    console.log(`接着跑：npm run build -- ${path}`);
    return;
  }

  // ── 出片 ──
  // ── 只出音轨，不渲一帧 ────────────────────────────────────────────────
  //
  // README 第 3.5 步写着「不要用 build 来听配音」，可**在这之前并没有别的办法
  // 听整条**：单句 wav 散在 voice/ 里，一句一句点开听不出节奏——而节奏正是要听的东西
  // （句间空多久、换镜那一拍够不够、金句前有没有留住）。于是照样有人跑 build 去听，
  // 一次 37 分钟。这个命令走的是 build 里一模一样的 mixdown，只是不渲帧，几秒钟出结果。
  if (cmd === 'audio') {
    if (!report(cfg, '试听')) return;
    const { raw, tracks } = loadVoices(cfg);
    if (raw.size === 0) {
      console.log('没找到配音。先跑 npm run voice -- <稿件>');
      return;
    }
    cfg.lines.forEach((l, i) => {
      const t = tracks.get(i);
      if (t) l.dur = t.dur;
    });
    const tl = buildTimeline(cfg);
    const dir = findProjectDir(cfg) ?? projectDir(cfg);
    mkdirSync(dir, { recursive: true });
    // **不加封面那一帧的前置静音**：那是给画面对齐用的，纯试听不需要，
    // 加了反而让开头多一段莫名其妙的空白
    const p = `${dir}/${cfg.id}-试听.wav`;
    writeWav(p, mixdown(tl, raw), SR);
    const mm = Math.floor(tl.duration / 60);
    const ss = (tl.duration % 60).toFixed(1).padStart(4, '0');
    const bgm = cfg.bgm?.enabled === false ? '关' : cfg.bgm?.key ?? 'happy';
    console.log('');
    console.log(`  ${p}`);
    console.log(`  片长 ${mm}:${ss}　配音 ${cfg.lines.length} 句　BGM ${bgm}`);
    console.log('');
    console.log('听三件事：句与句之间够不够喘气、换镜那一拍是不是明显长一档、落点句有没有慢下来。');
    console.log('不对就改 pace / delivery，重跑 voice + align + audio —— 别用 build 来听。');
    return;
  }

  if (cmd === 'draft' || cmd === 'build') {
    if (!report(cfg, '出片')) return;
    if (cmd === 'build' && !laomaOk(cfg, argv, '出片')) return;
    // 发布文案没填就别渲。**这不是洁癖**——封面大字要跟标题一起定，
    // 而封面是从成片里取帧的，等渲完才发现该换，就得再渲一次 37 分钟。
    if (cmd === 'build') {
      const miss = unfilled(findProjectDir(cfg) ?? projectDir(cfg));
      if (miss.length) {
        console.log('');
        console.log('方案.md 还没写完：');
        for (const u of miss) console.log(`  ⚠ 「${u.section}」${u.count} 处`);
        console.log('');
        console.log('填完再出片。要强行出片加 --anyway。');
        console.log('');
        if (!argv.includes('--anyway')) return;
      }
    }
    const withVoice = cmd === 'build';
    const { raw, tracks } = withVoice ? loadVoices(cfg) : { raw: new Map<number, Float32Array>(), tracks: new Map<number, VoiceTrack>() };
    if (withVoice && raw.size === 0) {
      console.log('没找到任何配音，正在按估算时长出草片。要正式出片请先 npm run align。');
    }
    if (withVoice) {
      // 用真实时长
      cfg.lines.forEach((l, i) => {
        const t = tracks.get(i);
        if (t) l.dur = t.dur;
      });
    } else {
      cfg.lines.forEach((l) => {
        if (!l.dur) l.dur = estimateDur(lineText(l));
      });
    }

    const tl = buildTimeline(cfg);
    const ctx: RenderCtx = { tl, voices: tracks };
    // 成片和音轨都落到项目目录，一条片子的东西聚在一处。
    // out/ 只留跨稿件的临时产物（音效试听、音色试听、纸纹）。
    const dir = findProjectDir(cfg) ?? projectDir(cfg);
    mkdirSync(dir, { recursive: true });

    // 封面当第一帧。平台多数拿第一帧做缩略图，这一帧值钱。
    // hold=0 时只占 1 帧（33ms），观众看不见，但缩略图取得到。
    let coverPng: Buffer | undefined;
    let coverFrames = 0;
    if (withVoice && (cfg.cover?.asFirstFrame ?? true)) {
      const cv = coverSvg(ctx);
      for (const w of checkTitle(cfg, cv.title)) console.log(`⚠ 封面：${w}`);
      coverPng = svgToPng(cv.svg);
      coverFrames = Math.max(1, Math.round((cfg.cover?.hold ?? 0) * FPS));
      // 顺手把封面也存一份，省得再跑一次 npm run cover
      mkdirSync(`${dir}/cover`, { recursive: true });
      writeFileSync(`${dir}/${coverFile(cfg)}`, coverPng);
      console.log(`封面已嵌为第一帧：「${cv.title}」${coverFrames > 1 ? `，停留 ${(coverFrames / FPS).toFixed(2)}s` : '（1 帧）'}`);
    }

    let mix = mixdown(tl, raw);
    // 画面前面加了几帧，音轨就要补等长静音往后让，否则整条对不上
    if (coverFrames > 0) {
      const lead = Math.round((coverFrames / FPS) * SR);
      const padded = new Float32Array(lead + mix.length);
      padded.set(mix, lead);
      mix = padded;
    }

    const audioPath = `${dir}/${audioFile(cfg)}`;
    writeWav(audioPath, mix, SR);

    const outPath = `${dir}/${withVoice ? filmFile(cfg) : draftFile(cfg)}`;
    console.log(`片长 ${tl.duration.toFixed(2)}s / ${Math.ceil(tl.duration * FPS) + coverFrames} 帧`);
    await renderVideo(ctx, audioPath, outPath, {
      crf: withVoice ? 19 : 24,
      preset: withVoice ? 'medium' : 'veryfast',
      coverPng,
      coverFrames,
    });
    console.log(`完成：${outPath}`);
    console.log(`音频轨：${audioPath}（要换 BGM 就改这条再单独合）`);
    // 出片后立刻同步预览页：成片、场景图、汇总页永远是同一版。
    // 只重渲这条稿件的场景图，其余复用磁盘上已有的，所以这一步很快。
    if (withVoice) {
      console.log('\n同步预览页…');
      syncProjects((c) => loadVoices(c).tracks, { renderFor: cfg.id });
      console.log(`  ${dir}/index.html   单条`);
      console.log('  projects/段子与儿童故事/index.html   汇总');
    }
    return;
  }

  console.log(`用法：
  npm run cast                      看角色音色表 + 念法表
  npm run try -- <音色> [台词]      试听某个角色音色（逗号分隔可一次多个）
  npm run voices [zh|ja]            列出 Edge 基础音色（选角表之外用）
  npm run sfx                       试听合成音效 + BGM
  npm run lines -- <cfg>            台词 × 音色对照表，出片前核对
  npm run voice -- <cfg>            生成全部配音（Edge 合成 + 变声）
  npm run align -- <cfg>            读配音回填真实时长
  npm run still -- <cfg> [秒...]    出静帧看画面
  npm run draft -- <cfg>            无配音草片
  npm run build -- <cfg>            正式出片
  npm run cover -- <cfg> [大字] [标签]  出封面三件套（不给大字就自动推）
  npm run voicedoc                  生成音色音调手册（实测数字，改完 cast.ts 就重跑）
  npm run preview [-- <cfg>]        稿件预览页（场景图+对话+分析），不带参数则汇总全部

流程：写 json → voice → align → build（等配音时用 still 看画面）
例：npm run voice -- jokes/snake-poison.json`);
}

main().catch((e) => {
  console.error('出错了：', e.message);
  process.exit(1);
});
