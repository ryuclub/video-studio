// ── 调音手册生成器：跑一遍所有音色和念法，把实测数字写成表 ────────────
//
// 为什么要生成而不是手写：参数一改，手写的数字就过期了，而过期的参考表
// 比没有参考表更浪费时间（照着错数字调，越调越偏）。
// 改完 cast.ts 重跑 `npm run voicedoc`，表和代码永远对得上。

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { CASTS, DELIVERIES, resolveCast } from './cast.js';
import { synthesizeJoke } from './tts.js';
import { readWav } from './audio/wav.js';
import { measure, type VoiceMetrics } from './audio/measure.js';
import { lineText, type JokeCfg } from './types.js';

/**
 * 音色探针：要**长句**。
 * 音色的厚薄和辨识度体现在长句的语调起伏里，短句量不出来。
 */
export const PROBE = '大哥，我们有毒吗？我咬到了自己的舌头。';

/**
 * 念法探针：要**短句**。
 *
 * 念法测的是"一个短语怎么说"。长句上基频中位数是个坏统计量——多句 + 疑问句
 * 本身就大起大落，把念法的效果淹掉，实测能把 +80Hz 的「拔高」量成负数。
 */
export const DELIVERY_PROBE = '我问你几点到。';

const TMP = '_voicedoc';

async function probe(cast: string, delivery?: string): Promise<VoiceMetrics> {
  const id = `${TMP}/${cast}${delivery ? '-' + delivery : ''}`;
  await synthesizeJoke({
    id,
    type: 'A',
    scene: 'abstract',
    characters: [{ id: '_', rig: 'human', side: 'left', cast }],
    lines: [{ who: '_', text: delivery ? DELIVERY_PROBE : PROBE, beat: 'reply', delivery }],
  });
  const a = readWav(`voice/${id}/1-_.wav`);
  return measure(a.data, a.sampleRate);
}

/** 扫 jokes/ 攒案例库：哪条片子用了什么音色和念法 */
function caseLibrary(): string {
  if (!existsSync('jokes')) return '（还没有稿件）';
  const files = readdirSync('jokes').filter((f) => f.endsWith('.json')).sort();
  if (!files.length) return '（还没有稿件）';

  const rows: string[] = [];
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(`jokes/${f}`, 'utf8')) as JokeCfg;
    const roles = cfg.characters.map((c) => `${c.id}=\`${c.cast ?? '?'}\``).join('　');
    rows.push(`### ${cfg.id}${cfg.title ? `　（标题：${cfg.title}）` : ''}\n`);
    rows.push(`角色音色：${roles}\n`);
    rows.push('| 句 | 台词 | 音色 | 念法 |');
    rows.push('|---|---|---|---|');
    for (const l of cfg.lines) {
      const ch = cfg.characters.find((c) => c.id === l.who);
      if (l.say?.length) {
        l.say.forEach((s, k) => {
          rows.push(
            `| ${k === 0 ? '' : '↳'} | ${s.text} | \`${ch?.cast ?? '?'}\` | \`${
              typeof s.delivery === 'string' ? s.delivery : s.delivery ? '自定义' : '平'
            }\` |`
          );
        });
      } else {
        rows.push(
          `| ${l.beat === 'punch' ? '**笑点**' : l.beat} | ${lineText(l)} | \`${ch?.cast ?? '?'}\` | \`${
            typeof l.delivery === 'string' ? l.delivery : l.delivery ? '自定义' : '平'
          }\` |`
        );
      }
    }
    rows.push('');
  }
  return rows.join('\n');
}

export async function buildVoiceDoc(outPath = '音色音调手册-VOICE.md'): Promise<void> {
  console.log(`基准句：「${PROBE}」\n`);

  console.log('测角色音色…');
  const castRows: string[] = [];
  const castMetrics: [string, VoiceMetrics][] = [];
  for (const name of Object.keys(CASTS)) {
    const m = await probe(name);
    castMetrics.push([name, m]);
    const c = resolveCast(name);
    castRows.push(
      `| \`${name}\` | ${c.base.replace('zh-CN-', '').replace('Neural', '')} | ${c.rate ?? '0%'} | ${
        c.morph.pitch
      } / ${c.morph.formant} | ${m.f0} | ${m.band} | ${m.dur} | ${c.note} |`
    );
    console.log(`  ${name.padEnd(8)} 基频 ${String(m.f0).padStart(3)}Hz  低高频差 ${String(m.band).padStart(5)}dB  净时长 ${m.dur}s`);
  }

  console.log(`\n测念法（童声 + 短句「${DELIVERY_PROBE}」，只看相对变化）…`);
  // 基准也走短句探针，跟念法同口径才可比
  const baseM = await probe('童声', '平');
  const delRows: string[] = [];
  for (const name of Object.keys(DELIVERIES)) {
    const m = await probe('童声', name);
    const df = m.f0 - baseM.f0;
    const dd = ((m.dur / baseM.dur - 1) * 100).toFixed(0);
    delRows.push(
      `| \`${name}\` | ${JSON.stringify(DELIVERIES[name])} | ${m.f0} | ${df >= 0 ? '+' : ''}${df} | ${m.dur} | ${
        Number(dd) >= 0 ? '+' : ''
      }${dd}% |`
    );
    console.log(`  ${name.padEnd(6)} 基频 ${df >= 0 ? '+' : ''}${df}Hz  时长 ${Number(dd) >= 0 ? '+' : ''}${dd}%`);
  }

  // 撞车矩阵：任意两个音色的低高频差之差，<6dB 标红
  const pairs: string[] = [];
  for (let i = 0; i < castMetrics.length; i++) {
    for (let j = i + 1; j < castMetrics.length; j++) {
      const [na, ma] = castMetrics[i];
      const [nb, mb] = castMetrics[j];
      const d = Math.abs(ma.band - mb.band);
      const fd = Math.abs(ma.f0 - mb.f0);
      // 低高频差和基频都接近，才算真撞车
      if (d < 6 && fd < 25) pairs.push(`| \`${na}\` | \`${nb}\` | ${d.toFixed(1)} | ${fd} |`);
    }
  }

  const md = `# 音色音调手册

**这份是 \`npm run voicedoc\` 生成的，别手改。** 改 \`src/cast.ts\` 再重跑，
表和代码才不会脱节——过期的参考表比没有更浪费时间，照着错数字调会越调越偏。

基准句：「${PROBE}」。测量口径见 \`src/audio/measure.ts\`。

---

## 一、先看这三条（踩过的坑，实测）

### 1. SSML pitch 响应又不对称、又不连续

同一句、同音色（童声，「我问你几点到。」），只扫 SSML pitch：

| 设定 | 实测基频 | 变化 | |
|---|---|---|---|
| +10Hz | 310Hz | +0 | 死区 |
| +20Hz | 314Hz | +4 | 死区 |
| **+30Hz** | 343Hz | **+33** | 台阶，一下跳上来 |
| +40Hz | 340Hz | +30 | 平台 |
| +50Hz | 343Hz | +33 | 平台 |
| +60Hz | 348Hz | +38 | |
| **+80Hz** | 372Hz | **+62** | |
| +100Hz | 372Hz | +62 | 饱和 |
| −20Hz | 265Hz | −45 | |
| −40Hz | 223Hz | −87 | |
| −60Hz | 187Hz | −123 | |

三条结论：

1. 正方向 **+20Hz 以内等于没写**，+30Hz 才起跳
2. **+30~+50Hz 是同一个平台**，在这区间里调数值没意义；要更高得跳到 +80Hz
3. 负方向近乎线性且灵敏，**斜率约 2.1×**（设 −20Hz 实际掉 45Hz）

所以念法只用 **+30 / +80 / −15 / −20 / −32** 这几个档位，别在平台里瞎调。

### 2. 破折号和省略号不产生停顿

想要「龟——来——」那种拖腔，写标点是没用的：

| 写法 | 时长 |
|---|---|
| 龟来 | 1.763s |
| 龟——来—— | 1.760s　← 完全无效 |
| 龟…………来………… | 1.764s　← 无效 |
| 龟。来。 | 2.186s　← 只有句号有效，+0.42s |

**而且破折号的行为不可预测。** 同样是破折号：

- 「龟——来——」→ 1.760s，跟不加完全一样，**被忽略**
- 「妈——妈！」→ 中间插进 **0.38 秒静音**，被当成断句

所以**别拿标点控制停顿**。要拖长音就把 \`text\` 写成不带破折号的连续文本，
拖长交给 \`holdHead\`，字幕另用 \`subtitle\` 字段写成带破折号的样子。

**唯一可靠的拖腔手段是变声的 \`tempo\`**（走 rubberband，音高不变）。

### 字内拖长：holdHead

「妈~~~妈」这种慢节拍呼唤，**不能用 \`say\` 分句做**——分句是两次独立合成、
两个音节起头，听着是"妈…妈"两声，不是一口气里的拖长。
正确做法是整句合成一段连续音频，再只把开头一个字做时间拉伸：

\`\`\`jsonc
{ "text": "妈妈！", "subtitle": "妈——妈！", "delivery": "喊", "holdHead": 0.35 }
\`\`\`

切分点自动找两字之间的能量低谷（\`findDip\`）。实测头字 0.78s / 尾字 0.34s =
**2.3 : 1**，全程连续无断点。

⚠ \`text\` 里**千万别留破折号**——Edge 会在那儿插 0.38 秒静音，
切分点落进静音里，一拉伸就把停顿也拉长了，越改越断。
\`延宕\` 念法就是干这个的，实测把「龟来」从 0.62s 拉到 1.03s（1.65×）。

### 3. 两个概念别混

| | 改什么 | 走哪个参数 |
|---|---|---|
| **谁在说** | 角色身份、年龄、体型 | \`cast\` 的 \`morph.pitch\` / \`formant\` |
| **怎么说** | 语调起伏、快慢、情绪 | \`delivery\` 的 \`pitchHz\` / \`rate\` |

做抑扬顿挫**只动 delivery**。动了 morph.pitch，角色会变成另一个人。

---

## 二、角色音色

低高频差 = 低频(<600Hz) 与 高频(>2kHz) 的 RMS 差，**越大越"厚"**。
对手戏的两个角色，这个数至少要拉开 **6dB**，否则观众分不清谁在说话。

| cast | 基础音色 | rate | pitch/formant | 基频 | 低高频差 | 净时长 | 用在哪 |
|---|---|---|---|---|---|---|---|
${castRows.join('\n')}

${
  pairs.length
    ? `### ⚠ 容易撞车的组合\n\n低高频差 <6dB **且** 基频差 <25Hz，别放在同一条片子里对戏：\n\n| A | B | 低高频差 | 基频差 |\n|---|---|---|---|\n${pairs.join(
        '\n'
      )}\n`
    : '### 撞车检查\n\n当前选角表里没有会撞车的组合（低高频差和基频都接近的）。\n'
}

---

## 三、念法

用 \`童声\` 念短句「${DELIVERY_PROBE}」测的，看的是**相对变化**。换个音色绝对值会变，方向和幅度可以参考。

**念法必须用短句测。** 长句上基频中位数会被句子本身的语调起伏淹掉——
实测能把 +80Hz 的 \`拔高\` 量成负数。音色表用长句，念法表用短句，两张表口径不同。

| delivery | 参数 | 基频 | 相对基准 | 净时长 | 相对基准 |
|---|---|---|---|---|---|
${delRows.join('\n')}

### 怎么配

- **punch 句几乎总要变调**，不然三句一个调子，包袱抖不响。最常用 \`泄气\`。
- **一句话内部的起伏**用 \`say\` 分句，每小句给不同念法：

\`\`\`jsonc
"say": [
  { "text": "我没叫你名字，", "delivery": "急",   "gap": 0.18 },
  { "text": "我问你几点到。", "delivery": "压低" }
]
\`\`\`

实测这组落差 **46Hz**、语速差 **1.22×**，是"越说越无奈"的语调。
整句只给一个 delivery 做不到这个——句内还是平的。

---

## 四、案例库

已出片子实际用了什么。新稿件不知道怎么配时，先从这里找像的。

${caseLibrary()}

---

## 五、调音流程

\`\`\`bash
npm run cast                              # 看有哪些音色和念法
npm run try -- 童声,老太太 "真实台词"       # 试听对比，出到 out/try/
npm run lines -- jokes/<id>.json          # 出片前核对，会报音色撞车
npm run voicedoc                          # 改完 cast.ts 重新生成这份手册
\`\`\`

要拖着滑块调参数，用 \`voice-clone\` 的网页试听台（\`npm run lab\` → localhost:5178，
音色地图那个），调满意了把 pitch / formant 抄回 \`src/cast.ts\`。两边同一套滤镜链。

**试听句一定要用真实会用到的台词。**「测试测试」听不出差别——
音色的区分度体现在长句的语调起伏里。
`;

  writeFileSync(outPath, md);
  console.log(`\n手册已生成：${outPath}`);
}
