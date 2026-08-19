// ── 男声对照：三个男角色同场，听得出谁是谁吗 ──────────────────────────
//
// 用法：npx tsx src/shuoshu-voicecheck.ts --ep E01
//
// 为什么单独做一条：**分离度这件事，单条试听是听不出来的。**
// 一个一个分开听，每个都挺好；接在一起才知道换没换人。
// 而 E01 v2 补回的幕四正好是最难的一处——道士和二郎一问一答，
// 中间还夹着说书人的叙述，三个男声在一分钟里轮流出现。
//
// 更麻烦的是**没有音色可分了**：Edge 中文男声实际可用只有三个
// （云扬/云希/云健），男角色有四个。所以这条对照要同时回答两个问题：
//
//   ① 二郎（新增）跟老道分得开吗——他俩同底（云扬），靠反向拉开
//   ② 说书人 ↔ 老道 的老账。红线是撞的（Δ基频 17Hz / Δ低高频 1.8dB），
//      但红线里没算**语速差**（说书人 +19% vs 老道 −10%，差了将近 30%）。
//      指标是 proxy 不是目的，这条得耳朵定
//
// 台词全部取自 E01 v2 的幕四原文，不另写试听句。

import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { readWav, resample, writeWav } from './audio/wav.js';
import { trimSilence } from './audio/align.js';
import { measure } from './audio/measure.js';
import { normalize, softClip } from './audio/dsp.js';
import { SR, PEAK_DBFS } from './config.js';
import { getBeat } from './shuoshu-beat.js';
import { resolveEp } from './shuoshu-ep.js';

const { dir: PROJ } = resolveEp(process.argv.slice(2));
const OUT_DIR = `${PROJ}/voice-samples`;

interface Turn {
  cast: string;
  text: string;
  beat: string;
}

/** 幕四·捕，道士进院子盘问二郎那一段。三个男声在 40 秒里轮了六次 */
const SCENE: Turn[] = [
  { cast: '说书人', text: '道士站在院子当中，抬起头，前后左右看了一圈。', beat: '常规' },
  { cast: '老道', text: '还好。没跑远。', beat: '落定' },
  { cast: '说书人', text: '然后他问二郎：', beat: '引述' },
  { cast: '老道', text: '南边那个院子，是谁家的？', beat: '常规' },
  { cast: '二郎', text: '是我住的。', beat: '常规' },
  { cast: '老道', text: '它现在就在你家里。', beat: '揭底' },
  { cast: '说书人', text: '二郎愣住了。', beat: '顿' },
  { cast: '二郎', text: '不可能。我家里没有生人。', beat: '常规' },
  { cast: '说书人', text: '二郎跑回家，过了一会儿又跑回来，脸都白了。', beat: '提速' },
  {
    cast: '二郎',
    text: '真有。今天早上来了个老太婆，说想到我家做佣工。我媳妇看她可怜，就留下了。',
    beat: '常规',
  },
  { cast: '老道', text: '就是它。', beat: '落定' },
];

/**
 * 分离度探针。**所有角色念同一句**，指标才可比。
 * 句子取自幕四，一问一答两句凑一起，长短适中、声调覆盖广。
 */
const PROBE = '南边那个院子，是谁家的？我家里没有生人。';

/** 二郎单独一条，长句，听音色本身 */
const SOLO: Turn = {
  cast: '二郎',
  text: '我一早去了青帝庙，家里的事我不知道。我回去问问。',
  beat: '常规',
};

async function render(turns: Turn[], tag: string): Promise<Map<string, Float32Array[]>> {
  const parts: Float32Array[] = [];
  const byCast = new Map<string, Float32Array[]>();

  for (const [i, t] of turns.entries()) {
    const bt = getBeat(t.beat);
    const id = `_shuoshu/vcheck/${tag}-${i}`;
    await synthesizeJoke({
      id,
      type: 'B',
      scene: 'abstract',
      pace: 'bedtime',
      characters: [{ id: '_', rig: 'none', side: 'left', cast: t.cast }],
      lines: [{ who: '_', text: t.text, beat: 'setup', delivery: bt.delivery }],
    });
    const p = `voice/${id}/1-_.wav`;
    if (!existsSync(p)) throw new Error(`合成失败：${p}`);
    const raw = resample(readWav(p), SR);
    const tr = trimSilence(raw, SR);
    const body = raw.slice(tr.start, tr.end);

    const scaled = new Float32Array(body.length);
    for (let k = 0; k < body.length; k++) scaled[k] = body[k] * bt.gain;
    parts.push(scaled);
    parts.push(new Float32Array(Math.round(bt.pause * SR)));

    if (!byCast.has(t.cast)) byCast.set(t.cast, []);
    byCast.get(t.cast)!.push(body);
  }

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeWav(`${OUT_DIR}/${tag}.wav`, normalize(softClip(out), PEAK_DBFS), SR);
  return byCast;
}

async function main() {
  console.log('渲染幕四三男声对照…');
  const byCast = await render(SCENE, '10-三男声对照');
  console.log('渲染二郎单条…');
  await render([SOLO], '09-二郎');

  // ── 红线复测：**必须用同一句话** ──
  //
  // 踩过的坑：一开始拿每个角色**各自的台词**去量，老道 125Hz、二郎 127Hz，
  // 差 2Hz，判定"撞车"。换成同一句话量，是 119 vs 146，差 27Hz，过线。
  // 差别不在音色，在**内容**——基频跟说了什么字强相关（韵母、声调都影响），
  // 台词不同就没有可比性，而且低男声上自相关还会跳倍频，误差能到一个八度。
  //
  // 所以：**拼起来的那条 wav 只给耳朵，指标一律用同一句探针量。**
  const rows: { cast: string; f0: number; band: number; dur: number }[] = [];
  for (const cast of [...byCast.keys()]) {
    await synthesizeJoke({
      id: `_shuoshu/vcheck/probe-${cast}`,
      type: 'B', scene: 'abstract', pace: 'bedtime',
      characters: [{ id: '_', rig: 'none', side: 'left', cast }],
      lines: [{ who: '_', text: PROBE, beat: 'setup', delivery: '叙平' }],
    });
    const raw = resample(readWav(`voice/_shuoshu/vcheck/probe-${cast}/1-_.wav`), SR);
    const tr = trimSilence(raw, SR);
    const m = measure(raw.slice(tr.start, tr.end), SR);
    rows.push({ cast, f0: m.f0, band: m.band, dur: m.dur });
  }
  rows.sort((a, b) => a.f0 - b.f0);

  console.log('\n音色    基频Hz   低高频差dB');
  for (const r of rows) console.log(`  ${r.cast.padEnd(5)}${r.f0.toFixed(0).padStart(6)}${r.band.toFixed(1).padStart(11)}`);

  console.log('\n两两分离度（红线：Δ基频 ≥25Hz **或** Δ低高频 ≥6dB，任一满足即可）：');
  const verdicts: string[] = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const df = Math.abs(rows[i].f0 - rows[j].f0);
      const db = Math.abs(rows[i].band - rows[j].band);
      const ok = df >= 25 || db >= 6;
      const dt = (Math.abs(rows[i].dur - rows[j].dur) / Math.min(rows[i].dur, rows[j].dur)) * 100;
      const line = `  ${ok ? '过 ' : '✗撞'}  ${rows[i].cast} ↔ ${rows[j].cast}　Δ基频 ${df.toFixed(0)}Hz　Δ低高频 ${db.toFixed(1)}dB　语速差 ${dt.toFixed(0)}%`;
      console.log(line);
      verdicts.push(line.trim());
    }

  writeFileSync(
    `${OUT_DIR}/三男声对照-说明.md`,
    `# 三男声对照（E01 v2 幕四）

补回道士捉鬼那一整幕之后，**男角色变成四个**（说书人 / 书生 / 老道 / 二郎），
而 Edge 中文男声实际可用只有三个（云扬 / 云希 / 云健，云夏是童声）。
所以必然有人共用底子，这条对照就是来验共用得住不住。

| 文件 | 听什么 |
|---|---|
| \`09-二郎.wav\` | 二郎单条长句，先听音色本身像不像一个慌张的年轻人 |
| \`10-三男声对照.wav\` | 幕四原文，40 秒里三个男声轮六次。**分离度只能这样听**——单条分开听每个都挺好，接在一起才知道换没换人 |

## 二郎怎么定的

跟老道**同底**（都是云扬），走反方向拉开：

| | 基础音色 | pitch / formant | 语速 | 音染 |
|---|---|---|---|---|
| 老道 | 云扬 | 0.86 / 0.91 | −10% | aged（苍、颤） |
| **二郎** | 云扬 | **1.14 / 1.07** | **+6%** | 高频 +5dB、低频 −3dB（提亮） |

一个低慢苍，一个高快亮。二郎的戏份本来就是慌慌张张跑回来报信，快和亮是对的。

调了三轮才过线，**每一轮都是拿同一句话量的**：pitch 1.04 → 差 21Hz 没过；
1.10 → 差 22Hz 还是没过（云扬在这个区间不太线性）；1.14 加上提亮 → 两根轴都过。
+2.3 半音仍在「±2 能听出区别、±4 开始有加工痕迹」的安全区里。

## ⚠ 量分离度必须用同一句话

一开始拿各角色**自己的台词**量，老道 125Hz、二郎 127Hz，差 2Hz，判"撞车"；
换同一句探针量是 119 vs 146，差 27Hz，过线。

差别不在音色，在**内容**——基频跟说了什么字强相关（韵母、声调都影响），
低男声上自相关还会跳倍频，误差能到一个八度。
**拼起来那条 wav 只给耳朵，指标一律用同一句探针量。**

## 实测

| 音色 | 基频 Hz | 低高频差 dB | 同句时长 |
|---|---|---|---|
${rows.map((r) => `| ${r.cast} | ${r.f0.toFixed(0)} | ${r.band.toFixed(1)} |`).join('\n')}

${verdicts.map((v) => `- ${v}`).join('\n')}

## 说书人 ↔ 老道 那笔老账

同句探针量下来 **Δ基频只有 9Hz、Δ低高频 3.7dB，两根轴都没过**——
换云健之后主讲掉到 110Hz，正好落在老道（119Hz）旁边。

但**红线里没算语速差**：同一句话，说书人念 3.74 秒，老道念 4.77 秒，
**差 28%**。这在听感上是很强的一根分辨轴，只是红线没把它算进去。

所以这条对照真正要你回答的是：**幕四里道士和说书人交替出现时，你有没有一瞬间分不清。**
分得清就维持现状（音色是你认可过的，不动最好）；分不清再动老道。

这个项目踩过一次「优化指标优化到听不懂」的坑（厉鬼那版低通 1500 砍掉辅音），
**指标是 proxy 不是目的。**
`
  );

  console.log(`\n→ ${OUT_DIR}/09-二郎.wav`);
  console.log(`→ ${OUT_DIR}/10-三男声对照.wav`);
  console.log(`→ ${OUT_DIR}/三男声对照-说明.md`);
}

main();
