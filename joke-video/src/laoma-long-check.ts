// ── 老马长片体检 ────────────────────────────────────────────────────
//
//   npm run laoma:long-check -- jokes/laoma-long-001.json
//
// ⚠ **这条线以前一个闸都没有。** `laoma-check` 按 `format === 'long'` 跳过 ——
// 它查的全是短片的东西（落点、铺垫几句、物件、日子牌、片长 18–45 秒），
// 拿去判一条五分钟的稿子**报出来的每一条都是错的**，
// 而天天报错的闸门只会教人加 `--anyway`（那样连另外两条有用的闸也一起失效）。
//
// 所以这一支是**另写的**，只查 `horse/长片_稿件规范.md` §九 那张表里**可判定的部分**。
//
// ── 落地这张表的时候，规范被改准了三处 ──
//
// 写闸逼着把「差不多是这个意思」变成「机器能判」，三处因此改了（都回填进规范了）：
//
// 1. **「台词 10 字以内」说的是一小句，不是一整段。** `long-parse` 的规矩是
//    「一段一句，别按句号拆」，所以一个 `line` 可以含几小句。
//    001 实测：整段算有 5 句超标，**按小句算只剩 3 句**，而那 3 句里
//    最长的一句正是说破段 —— 见下一条。
// 2. **说破段豁免 10 字。** 规范 §三 自己写着说破段要「长短不一」，
//    001 那句 21 字的「我什么都不干，我就永远不用知道自己到底行不行」是全片的支点。
// 3. **「旁白无语气词」不含引述。** 001 那两句「命中」的
//    （`你不累啊`、`这个我来吧`）**全在引号里** —— 那是他引别人的话，
//    不是旁白自己的语气。查之前要把引号里的挖掉。
//
// ── 还有一处实测跟文档对不上，一并改了 ──
//
// 出片方案 §六 写着「老马语速 **5.6 字/秒**（含标点）—— 估片长用这个数」。
// **实测净语速是 5.20，而且拿它直接估片长会短 35%** ——
// 因为 001 的停顿加起来有 **73.1 秒**（占全片 21%）。
// 估片长的式子是 `字数 ÷ 5.2 ＋ 停顿总和`，不是 `字数 ÷ 5.6`。

import { readFileSync } from 'node:fs';
import type { JokeCfg, LineCfg } from './types.js';
// ⚠ **用语的判据不写在这儿。** 正文 `horse/用语规范.md`，实现 `laoma-diction.ts` ——
// 段子线那道闸 import 的是同一支。本文件原来有一份自己的 `书面词`（6 个）和
// `定义句式`，跟规范 §7.2 的 12 个是同一件事的两份表；2026-08-26 合并掉了。
import { checkDiction } from './laoma-diction.js';

interface Issue {
  level: 'error' | 'warn' | 'info';
  rule: string;
  msg: string;
}

/** 老马的**净**语速（不含停顿），001 实测 1431 字 ÷ 275.2 秒 */
const CPS = 5.2;

/** §五：不总结，不升华，不许诺 */
const 总结词 = ['从那以后', '我明白了', '我懂了', '我决定', '教会了我', '懂得了', '学会了', '让我知道了'];

/** §九：旁白一个语气词都不许有 */
const 语气词 = /[啊呢吧嘛哦呗]/;

/** ⚠ 引号里的不算 —— 那是引别人的话，不是旁白自己的语气 */
const 去引述 = (s: string) => s.replace(/["“][^"”]*["”]/g, '').replace(/「[^」]*」/g, '');

const 汉字 = (s: string) => s.replace(/[^一-龥]/g, '').length;
const 小句 = (s: string) => (s.match(/[^。！？]*[。！？]|[^。！？]+$/g) ?? [s]).map((x) => x.trim()).filter(Boolean);
const txt = (l: LineCfg) => (l.say ?? []).map((s) => s.text).join('') || l.text || '';

export function checkLong(cfg: JokeCfg): Issue[] {
  const out: Issue[] = [];
  const L = cfg.lines;
  const secs = (cfg as JokeCfg & { _sections?: Array<{ name: string; from: number; to: number }> })._sections ?? [];
  const secOf = (i: number) => secs.find((s) => i >= s.from && i <= s.to);
  const layerOf = (l: LineCfg) => (l as { _layer?: string })._layer ?? (l.who === 'niu' ? '台词' : '旁白');
  const shuopo = L.map((l, i) => (l.shuopo ? i : -1)).filter((i) => i >= 0);

  // ── 管线完整性：这三条不过，下面查什么都是虚的 ──

  if (cfg.format !== 'long')
    out.push({ level: 'error', rule: '体裁', msg: `\`format\` 不是 "long" —— 这一支只查长片，短片走 \`npm run laoma:check\`` });

  const 缺dur = L.filter((l) => l.dur === undefined && l.silent === undefined).length;
  if (缺dur)
    out.push({
      level: 'error',
      rule: '对齐',
      msg:
        `${缺dur} 句没有 \`dur\` —— **\`align\` 没跑，或者被 \`long-parse\` 冲掉了**。` +
        `没有 \`dur\` 时间轴退回估算值，**不报错，帧照出，只是嘴和声音差着**。补跑：\`npm run align\``,
    });

  // ── 结构（§一）──

  if (!shuopo.length) {
    out.push({
      level: 'warn',
      rule: '说破',
      msg:
        '稿子里一句都没标 `【马·破】` —— **说破是这条线的支点**（规范 §一），' +
        '不标就查不了「只说破一次」「说破后往回收」「句间不许压」这三条。标法见 §八',
    });
  } else {
    // 连续的一段才算一次说破；中间隔开就是两次
    const 段: number[][] = [];
    for (const i of shuopo) {
      const last = 段[段.length - 1];
      if (last && i === last[last.length - 1] + 1) last.push(i);
      else 段.push([i]);
    }
    if (段.length > 1)
      out.push({
        level: 'error',
        rule: '说破',
        msg: `说破分成了 ${段.length} 段（句 ${段.map((g) => `${g[0]}–${g[g.length - 1]}`).join(' / ')}）—— **全片只说破一次**（§一）`,
      });
    const 末 = shuopo[shuopo.length - 1];
    if (末 >= L.length - 1)
      out.push({ level: 'error', rule: '说破', msg: '说破是最后一句 —— **说破之后要有往回收的一句**（§一）' });
    // ⚠ **这一条是 warn，而且大概率不是问题 —— 但它查不出前提。**
    //
    // 规范 §七 原来写「说破段的句间 **1.0 秒，一秒都不能压**」，
    // 而 001 实测是 0.8 / 1.0 / 0.6 / 0.8 / 0.5 / 0.6 / 0.5 / 1.5，八句里六句低于 1.0。
    //
    // **2026-08-26 用户听完定了**：「001 的音频还可以，**可能因为有场景音，没听出静场**。」
    // 于是那条规矩的前提被找出来了 —— 它是在「声音是干的」那个假设下写的。
    // 现在分两档：**干声 1.0 秒 ／ 有环境床音 0.5 秒**。
    //
    // ⚠ **体检查不出走的是哪一档。** 床音是 `tools/long-ambience.mts` 在 mixdown
    // **之后**外挂的，`cfg.ambience` 在 json 里是 `'none'` —— **json 里看不见床音铺没铺**。
    // 而 `npm run build` 那条路**不带床音**，同一份稿子走那边就是干的，
    // 那几处 0.5 秒会真的变成静场。
    //
    // 所以这儿只报「有几处落在 0.5–1.0 之间」，**由人回答「这一版铺床音了吗」**。
    const 短 = shuopo.filter((i) => i !== 末 && (L[i].padAfter ?? 0) < 1.0);
    if (短.length)
      out.push({
        level: 'warn',
        rule: '说破',
        msg:
          `说破段有 ${短.length} 处句间在 1.0s 以下（句 ${短.map((i) => `${i}:${L[i].padAfter}`).join(' ')}）。` +
          `**铺了环境床音就没事**（下限 0.5s，001 走的这一档）；` +
          `⚠ **但 \`npm run build\` 出的成片不带床音** —— 走那条路出片的话，` +
          `这几处是真的静场，下限回到 1.0s（§七）`,
      });
  }

  // ── 语言（§二 §五）──

  // 书面概念词、判断句式、句长、漏停、口语字、多音字、排比 —— **全在 `laoma-diction` 里**，
  // 跟段子线同一份实现。这儿只负责把长片的行喂进去，并关掉两条对长片不成立的：
  //
  //   · 方言密度：§3.2 的「三处」量的是 25–45 秒里的密度。001 有 82 句、4 处方言字，
  //     套这个绝对值就是误报 —— 传 `null` 关掉。
  //   · 落点前那一拍：长片没有 `beat: punch` 这套结构，不传 `beat` 就不查。
  out.push(
    ...checkDiction(
      L.map((l, i) => ({ text: txt(l), at: `第 ${i} 句` })),
      { 方言上限: null },
    ).map((d) => ({ level: d.level, rule: '用语', msg: d.msg })),
  );

  // 结尾只查最后一章 —— 「不总结不升华不许诺」说的是结尾
  const 末章 = secs[secs.length - 1];
  if (末章)
    for (let i = 末章.from; i <= 末章.to; i++) {
      const t = txt(L[i]);
      for (const w of 总结词)
        if (t.includes(w))
          out.push({
            level: 'error',
            rule: '结尾',
            msg: `第 ${i} 句有「${w}」—— **结尾不总结、不升华、不许诺**（§五）。变化要小到不像变化`,
          });
    }

  // §九：台词 10 字以内。⚠ 按**小句**算，且**说破段豁免**
  L.forEach((l, i) => {
    if (layerOf(l) !== '台词' || l.shuopo) return;
    for (const p of 小句(txt(l)))
      if (汉字(p) > 10)
        out.push({
          level: 'warn',
          rule: '台词长度',
          msg: `第 ${i} 句里的小句「${p}」${汉字(p)} 字，超过 10（§九）。说破段豁免，这句没标说破`,
        });
  });

  // §九：旁白无语气词。⚠ 引号里的不算
  L.forEach((l, i) => {
    if (layerOf(l) !== '旁白') return;
    const bare = 去引述(txt(l));
    const m = bare.match(语气词);
    if (m)
      out.push({
        level: 'warn',
        rule: '旁白语气',
        msg:
          `第 ${i} 句旁白里有语气词「${m[0]}」（${JSON.stringify(bare.slice(0, 18))}）—— ` +
          `**旁白一个语气词都不许有**（§九）。` +
          `⚠ **加了引号的引述会被排除，不加引号的排除不掉** —— ` +
          `001 第 9 句「我问过他，你不累啊」就是这种：那个「啊」是他引的别人的话，` +
          `不是旁白自己的语气。**是不是误报要人看一眼**`,
      });
  });

  // §二.2：要给一处说不下去的地方
  if (!L.some((l) => /……|\.{3}/.test(txt(l))))
    out.push({
      level: 'warn',
      rule: '磕巴',
      msg: '全片没有一处「……」—— **要给一处说不下去的地方**（§二.2）。那半秒是全片最重的半秒',
    });

  // ── 节奏（§七）──

  L.forEach((l, i) => {
    const pa = l.padAfter ?? 0;
    if (pa <= 1.5) return;
    const 章末 = secOf(i)?.to === i; // 换章 ＝ 换场景 ＝ 画面有变化
    const 有说明 = Boolean((l as { note?: string }).note); // 稿子写了「同时给一次镜头或声音层变化」
    if (!章末 && !有说明)
      out.push({
        level: 'error',
        rule: '静场',
        msg:
          `第 ${i} 句之后静场 ${pa}s，**画面无变化处上限 1.5 秒**（§七）。` +
          `要停更久就得同时给一次镜头切换或声音层变化，并把它写进 \`⏸**${pa} — 说明**\``,
      });
  });

  // 稿件规范 §八：**老牛从不旁白**，他每一句都是当面对老马说的
  L.forEach((l, i) => {
    if (l.who === 'niu' && layerOf(l) === '旁白')
      out.push({
        level: 'error',
        rule: '分层',
        msg: `第 ${i} 句是老牛的旁白 —— **老牛从不旁白**（§八）。画面上看不出来，但现场混响一接上，漏掉的正好是他这些句子`,
      });
  });

  // ── 片长（§六）──

  const chars = L.reduce((n, l) => n + txt(l).length, 0);
  const pads = L.reduce((n, l) => n + (l.padAfter ?? 0) + (l.padBefore ?? 0), 0);
  const 估 = chars / CPS + pads;
  const 实 = L.reduce((n, l) => n + (l.dur ?? 0), 0) + pads;
  out.push({
    level: 'info',
    rule: '片长',
    msg:
      `${chars} 字 · 停顿 ${pads.toFixed(1)}s（占 ${((pads / (实 || 估)) * 100).toFixed(0)}%）· ` +
      `估 ${(估 / 60).toFixed(1)} 分${实 ? ` · 实测 ${(实 / 60).toFixed(2)} 分` : ''}` +
      `　⚠ **估片长 ＝ 字数 ÷ ${CPS} ＋ 停顿**，不是字数 ÷ 5.6（那样会短三成）`,
  });

  const layers = new Map<string, number>();
  for (const l of L) layers.set(layerOf(l), (layers.get(layerOf(l)) ?? 0) + 1);
  out.push({
    level: 'info',
    rule: '构成',
    msg: `${L.length} 句 · ${secs.length} 章 · ${[...layers].map(([k, v]) => `${k} ${v}`).join(' / ')}`,
  });

  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────

/**
 * 必答清单：**机器一条都查不了的那些。**
 *
 * ⚠ 原来这儿只印了 `长片_稿件规范.md` §九 里 **8 条 👤 中的 4 条**
 * （安慰／物件／配角／接得住），漏了「结尾回到开篇那个东西」「说破段不是整齐排比」
 * 「比喻之后跟了人话」，也没提用语规范那半和 §6.3。
 *
 * ⚠ **只列机器查不了的。** 查得了的上面逐条报过了 ——
 * 抄两遍会让人在两份清单之间比对，比对着比对着就都不看了。
 */
const 必答清单 = `
────────────────────────────────────────────────────────
机器查不了的，逐条问自己　（长片_稿件规范.md §九 里标 👤 的那些）

结构
  · 对方没有给安慰
    （§一：老牛回一句「那你现在知道了」就够。安慰会把说破的重量卸掉）
  · 有一个贯穿全片的物件，且位置有变化
  · 结尾回到了开篇那个东西
  · 配角有一处不完美（§六）

语言
  · 说破段不是整齐排比
  · 每句台词都接住了上一句
  · 比喻之后跟了人话（§三）

用语　用语规范 §十一：人只需要看三样
  · 事情够不够怪（§八：朴素的是词，不朴素的是事）
  · 少不少一拍
  · 口音的违和感能不能接受

生成后抽听　用语规范 §2.2
  · 「都」在句中、「了」le/liǎo —— 闸门只报「得」，这两个是特意退回这张表的

那半秒是剪出来的　长片_稿件规范 §6.3
  · 说不下去的地方（⏸0.5）**要拆成两条音频、中间手工插静音**。
    ⚠ 闸只查得了标记在不在，**查不了音频是不是真拆了** ——
    TTS 演不了省略号，没拆的话那半秒根本不存在

平读测试
  · 每一句用完全平的语调念，意思还在 → 过；散了 → 改
  ⚠ Edge TTS 拒绝一切 SSML，写坏了没有后期能救，只能回来改字
────────────────────────────────────────────────────────`;

/**
 * 跑一遍、打印、返回过没过。**命令行和出片链路共用这一份。**
 *
 * ⚠ 抽出来是因为 `cli.ts` 那边原来对长片直接放行 —— 那段还写着
 * 「长片自己的规范还没写，这条线现在没有闸」，是 2026-08-26 之前的状态。
 * 规范和闸都有了之后还留着那段，结果是**必答清单只在手动跑这个命令时才出现**，
 * 而 `voice` / `build` 那两个真正要出片的时刻一个字都不印 ——
 * 那正好是这张清单想拦住的时刻。
 */
export function gateLong(cfg: JokeCfg): boolean {
  const issues = checkLong(cfg);

  console.log('');
  for (const i of issues.filter((x) => x.level === 'info')) console.log(`  ${i.rule}　${i.msg}`);
  console.log('');

  const err = issues.filter((x) => x.level === 'error');
  const warn = issues.filter((x) => x.level === 'warn');
  for (const i of err) console.log(`  ✗ [${i.rule}] ${i.msg}`);
  for (const i of warn) console.log(`  ⚠ [${i.rule}] ${i.msg}`);

  if (!err.length && !warn.length) console.log('  ✓ 机器查得了的都过了');
  console.log('');
  console.log(必答清单);
  return !err.length;
}

function main(): void {
  const src = process.argv[2];
  if (!src) {
    console.log('用法：npm run laoma:long-check -- jokes/laoma-long-001.json');
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(src, 'utf8')) as JokeCfg;
  if (!gateLong(cfg)) process.exitCode = 1;
}

if (process.argv[1]?.includes('laoma-long-check')) main();
