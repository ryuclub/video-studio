// ── A/B 对比：默认节奏 vs 手工调过的节奏 ──────────────────────────────
//
// 用法：npx tsx src/shuoshu-ab.ts
//
// 选的是幕二「王生推门 → 绕到窗口 → 往里看」那一段，全片最吃表演的地方。
//
// **B 版必须按"能铺到 165 段"的标准调。** 花一小时精雕一段做出漂亮 demo，
// 然后发现这个投入乘以 165 根本做不完，成片质量掉回 A —— 那是自欺欺人。
// 所以 B 的调法是：大部分段落走预设，只对真正吃表演的几句手工动。
// 下面每句的注释里标了「预设」还是「手工」，手工的占三成左右，
// 这个比例乘以 165 段才落在报的工时区间里。

import { OUT_SHUOSHU } from './paths.js';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { readWav, resample, writeWav } from './audio/wav.js';
import { trimSilence } from './audio/align.js';
import { normalize, softClip } from './audio/dsp.js';
import { SR, PEAK_DBFS } from './config.js';
import { getBeat } from './shuoshu-beat.js';

const OUT_DIR = `${OUT_SHUOSHU}/2026-08-18_liaozhai-E01/ab-test`;

interface Beat {
  text: string;
  /**
   * 节拍标签。**数值全部来自 shuoshu-beat.ts，这里不写死任何数字。**
   *
   * 一开始是把停顿/音量直接写在这儿的，然后试听反馈"悬停得太长"——
   * 如果这些数字散落在 165 段里，改一次要动三十处。集中到节拍表之后，
   * 那次调整只改了一行。
   */
  beat: string;
  /** 调这一句用了什么心思。空 = 走默认没单独动 */
  why?: string;
}

/** A 版：全部走默认。均匀停顿、统一音量、统一语速 */
const FLAT_PAUSE = 0.6;

const BEATS: Beat[] = [
  { text: '回到家，他直接去书房。', beat: '常规' },
  {
    text: '手往门上一推',
    beat: '顿',
    why: '手工：动作句提速，收尾留半拍。原文这里是破折号，但 Edge 不认破折号，只能靠插空白做',
  },
  {
    text: '门从里面闩上了。',
    beat: '落定',
    why: '手工：发现异常。放慢 + 稍压 + 留一拍，让听众自己反应过来"里面有人"',
  },
  {
    text: '王生站在门口，心跳得厉害。',
    beat: '贴近',
    why: '手工：压低嗓子把听众拉近。说书最基本的手段，也是 A 版完全没有的东西',
  },
  { text: '他绕到屋子侧面，那儿有扇窗。窗纸上有个破口。', beat: '常规' },
  { text: '王生凑过去，往里看。', beat: '扣子', why: '手工：全段最轻最慢的一句，把人吊住' },
  { text: '他看见', beat: '悬', why: '手工：三个字，最长的停顿' },
  {
    text: '屋里坐着一个鬼。',
    beat: '揭底',
    why: '手工：揭底。音量放回来并略推，语速恢复常态——**不要演，平着说反而更冷**',
  },
];

async function render(tag: string, useDesign: boolean) {
  const parts: Float32Array[] = [];

  for (const [i, b] of BEATS.entries()) {
    const bt = getBeat(b.beat);
    const delivery = useDesign ? bt.delivery : '叙平';
    const id = `_ab/${tag}-${i}`;
    await synthesizeJoke({
      id,
      type: 'B',
      scene: 'abstract',
      pace: 'bedtime',
      characters: [{ id: '_', rig: 'none', side: 'left', cast: '说书人' }],
      lines: [{ who: '_', text: b.text, beat: 'setup', delivery }],
    });

    const p = `voice/${id}/1-_.wav`;
    if (!existsSync(p)) throw new Error(`合成失败：${p}`);
    const raw = resample(readWav(p), SR);
    // Edge 每段头尾都带几百毫秒编码静音，不去掉的话设计的停顿全被它顶乱
    const tr = trimSilence(raw, SR);
    const body = raw.slice(tr.start, tr.end);

    const g = useDesign ? bt.gain : 1;
    const scaled = new Float32Array(body.length);
    for (let k = 0; k < body.length; k++) scaled[k] = body[k] * g;
    parts.push(scaled);

    const pause = useDesign ? bt.pause : FLAT_PAUSE;
    parts.push(new Float32Array(Math.round(pause * SR)));
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  const mixed = normalize(softClip(out), PEAK_DBFS);
  writeWav(`${OUT_DIR}/${tag}.wav`, mixed, SR);
  return mixed.length / SR;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const a = await render('A-默认节奏', false);
  const b = await render('C-紧凑版', true);

  const hand = BEATS.filter((x) => x.why).length;
  writeFileSync(
    `${OUT_DIR}/说明.md`,
    `# A/B 对比 · 幕二「王生往窗里看」

同一段稿子，同一个音色（\`说书人\`），只有节奏不同。

| | 时长 | 停顿 | 音量 | 语速 |
|---|---|---|---|---|
| **A-默认节奏** | ${a.toFixed(1)}s | 一律 ${FLAT_PAUSE}s | 全程一致 | 全程 \`叙平\` |
| **C-紧凑版** | ${b.toFixed(1)}s | 0.45–1.0s 按节拍给 | 0.70–1.08 | 叙缓/叙平/叙快 混用 |

## B 版每一句为什么这么调

${BEATS.map((x, i) => {
  const bt = getBeat(x.beat);
  return `**${i + 1}. 「${x.text}」**　\`${x.beat}\` · ${bt.delivery} · 停 ${bt.pause}s · 音量 ${bt.gain}\n${
    x.why ? `> ${x.why}` : '> 走默认，没单独动'
  }`;
}).join('\n\n')}

## 关于这个 B 能不能铺到 165 段

${BEATS.length} 句里手工调了 **${hand}** 句（${Math.round((hand / BEATS.length) * 100)}%），
其余走预设。**这个比例是刻意控制的** —— 花一小时精雕一段做出漂亮 demo，
然后发现投入乘以 165 做不完、成片掉回 A 版，那是自欺欺人。

E01 全片值得手工调的大约三十段，其余一百三十段靠预设，
这样工作量才落在报的区间里，而 B 听起来才是**成片的真实水平**。

## 听的时候判断什么

1. **B 比 A 好多少？** 如果差别不明显，说明这条路的天花板不行，
   得回去谈 Azure 的 \`style="story"\` 或者真人录音。
2. **音量压到 0.72 会不会听不清？** 这是新加的能力（\`LineCfg.gain\`），
   之前全片一个音量。

> **已定：「悬」从 2.2s 缩到 1.4s。** 反馈是"有明显的停留空白"。
> 根因未必是长度 —— TTS 的停顿是绝对静音（实测 −227dB），真人停两秒
> 听众能听到换气和现场，我们插的是虚无，所以同样长度会读成"卡住了"。
> 以后给全片垫上房间底噪（−48dB 粉噪那一版），这个值可以再放长回去。

## 这套控制的天花板

能控：停顿位置和长度、整句快慢、整句音量、整句高低（有死区）。

**控不了：一句话内部哪个字重读、一句话内部的音高曲线、气口。**
Edge 的中文只有一种"念稿"腔，这三样是它自己生成的，我们碰不到。
所以做出来会像干净的有声书朗读，不像评书 —— 差的那一截是 TTS 给不了的。
`
  );

  console.log(`A-默认节奏.wav　${a.toFixed(1)}s`);
  console.log(`C-紧凑版.wav　${b.toFixed(1)}s`);
  console.log(`\n→ projects/说书/2026-08-18_liaozhai-E01/ab-test/`);
}

main();
