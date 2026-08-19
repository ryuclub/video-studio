// ── 说书人 A/B：同一段素材，四个叙述者方案 ─────────────────────────────
//
// 用法：npx tsx src/shuoshu-narrator-ab.ts
//
// 试听反馈：**角色都好，主讲人机械、偏慢。** 这条 A/B 就是为了定主讲人。
//
// 诊断（数字来自 试听-前三幕.manifest.json）：
//   · 说书人净语速 230 字/分，是全场最慢的一个（书生 258 / 艳鬼 240 / 妇人 237）
//     链路上就慢：cast −6% + 叙平 −10% = −16%，比谁都低 2–4 个百分点
//   · 全片说书人有 40% 的字挂在 `叙缓`（净 −28%），实测只有 178–203 字/分
//   · 云扬 = 微软的**新闻播报**音色，而说书人的 morph 是 0.97/0.97 几乎等于原声，
//     播音腔一点没被改掉。角色好听不是偶然：晓晓/晓伊/云希都是对话向音色
//   · 71 段常规参数完全相同，每段独立合成 = 165 条一模一样的语调弧线
//
// 四个版本**只改主讲人**，角色（书生）除了 V3 的对调之外一律不动：
//
//   现状  对照
//   V1    只提速 + 句子级微抖动，音色不动 —— 隔离出"慢"这一个变量
//   V2    V1 + 换云健（体育解说底子，自带推进感）+ 卸掉播音压缩器
//   V3    V1 + 主讲换云希、书生换云扬（王生是读书人，一本正经的播音腔反而贴）
//
// 为什么男声只能在这三个里挑：Edge 中文一共 8 个音色，男声实际可用 3 个
// （云夏是童声），而男角色有 4 个（说书人/书生/老道/乞丐），本来就得共用。
//
// **不改 cast.ts。** 变体全靠 CharacterCfg 的 cast/rate/morph 覆盖搭出来，
// A/B 没定之前选角表一个字不动——定了再落。

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { synthesizeJoke } from './tts.js';
import { readWav, resample, writeWav } from './audio/wav.js';
import { trimSilence } from './audio/align.js';
import { normalize, softClip } from './audio/dsp.js';
import { SR, PEAK_DBFS } from './config.js';
import { getBeat } from './shuoshu-beat.js';
import { DELIVERIES, addPercent } from './cast.js';
import { resolveEp } from './shuoshu-ep.js';

const { id: EP, dir: PROJ } = resolveEp(process.argv.slice(2));
const OUT_DIR = `${PROJ}/narrator-ab`;

/**
 * 试听段落。**用剧本原文，不另写素材** —— 试听句跟成片不是同一批字的话，
 * 听着好的方案铺到全片可能完全是另一回事。
 *
 *   1, 2      冷开场的钩子（扣子 → 揭底），全片定调
 *   24        引述 + 书生对白，V3 的对调要在这儿听
 *   59–66     幕二「王生往窗里看」，A/B 立项时就用的那八句，最吃表演
 */
const PICK = [1, 2, 24, 59, 60, 61, 62, 63, 64, 65, 66];

interface Variant {
  tag: string;
  desc: string;
  /** 主讲人：cast 名或直接 ShortName */
  cast: string;
  rate?: string;
  morph?: { pitch?: number; formant?: number; tone?: string[] };
  /** 书生也换的话写这里（只有 V3 用） */
  sheng?: { cast: string; rate?: string; morph?: { pitch?: number; formant?: number } };
  /** 句子级微抖动 */
  jitter: boolean;
}

/** 卸掉播音压缩器之后的替代音染：只留一点低频托底和很轻的压缩 */
const LIGHT_TONE = [
  'equalizer=f=240:t=q:w=1.0:g=1.5',
  'acompressor=threshold=-18dB:ratio=1.6:attack=15:release=250',
];

const VARIANTS: Variant[] = [
  {
    tag: '0-现状',
    desc: '云扬 + 播音音染，叙平净 −16%',
    cast: '说书人',
    jitter: false,
  },
  {
    tag: 'V1-提速',
    desc: '音色不动，整体 +12%（叙平净 −4%）+ 句子级微抖动 ±3%',
    cast: '说书人',
    rate: '+12%',
    jitter: true,
  },
  {
    tag: 'V2-云健',
    desc: '换云健压成沉稳中年（pitch 0.92 / formant 0.94），卸掉播音压缩器',
    cast: 'zh-CN-YunjianNeural',
    // 云健在同一个 rate 设定下比云扬**天生慢 13%**（+6% 时实测 239 vs 276 字/分）。
    // 不补上的话这条会因为"慢"被淘汰，而慢是我们要修的那个毛病，不是它的问题——
    // A/B 只能有一个变量。
    rate: '+19%',
    morph: { pitch: 0.92, formant: 0.94, tone: LIGHT_TONE },
    jitter: true,
  },
  {
    tag: 'V3-云希对调',
    desc: '主讲换云希（pitch 0.90 / formant 0.92），书生换云扬',
    cast: 'zh-CN-YunxiNeural',
    rate: '+6%',
    morph: { pitch: 0.9, formant: 0.92, tone: LIGHT_TONE },
    sheng: { cast: 'zh-CN-YunyangNeural', morph: { pitch: 0.99, formant: 0.99 } },
    jitter: true,
  },
];

/**
 * 句子级微抖动：真人不会每句同速。
 * **按段号定，不用随机数** —— 随机的话每次跑出来不一样，缓存也白费，
 * 而且 A/B 里两个版本的差别会混进随机噪声，判断不了是方案好还是抽签好。
 */
function jitterOf(no: number, sub: number): string {
  const h = ((no * 2654435761 + sub * 40503) >>> 0) % 5;
  return ['-3%', '-1.5%', '0%', '+1.5%', '+3%'][h];
}

interface Seg {
  no: number;
  sub: number;
  who: string;
  text: string;
  beat: string;
}

/** 跟 shuoshu-build 同一套清洗：破折号 Edge 完全不认，「」念不出来 */
const forTTS = (t: string) =>
  t
    .replace(/[「」『』]/g, '')
    .replace(/[—－]{2,}\s*$/, '')
    .replace(/[—－]{2,}/g, '，')
    .trim();

async function render(v: Variant, segs: Seg[]) {
  const parts: Float32Array[] = [];
  let speech = 0;
  let chars = 0;

  for (const s of segs) {
    const bt = getBeat(s.beat);
    const isNarrator = s.who === '说书人';

    // 主讲人走变体配置，角色走选角表原样（V3 的书生除外）
    let cast = s.who;
    let rate: string | undefined;
    let morph: Variant['morph'];
    if (isNarrator) {
      cast = v.cast;
      rate = v.rate;
      morph = v.morph;
    } else if (s.who === '书生' && v.sheng) {
      cast = v.sheng.cast;
      rate = v.sheng.rate;
      morph = v.sheng.morph;
    }

    // 节拍的念法 + 这一段的微抖，叠成一个 delivery 对象送进去
    const base = DELIVERIES[bt.delivery];
    const delivery =
      v.jitter && isNarrator
        ? { ...base, rate: addPercent(base.rate, jitterOf(s.no, s.sub)) }
        : bt.delivery;

    const id = `_shuoshu/nab/${v.tag}-${s.no}-${s.sub}`;
    await synthesizeJoke({
      id,
      type: 'B',
      scene: 'abstract',
      pace: 'bedtime',
      characters: [{ id: '_', rig: 'none', side: 'left', cast, rate, morph }],
      lines: [{ who: '_', text: forTTS(s.text), beat: 'setup', delivery }],
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

    if (isNarrator) {
      speech += body.length / SR;
      chars += (s.text.match(/[一-龥]/g) ?? []).length;
    }
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  const mixed = normalize(softClip(out), PEAK_DBFS);
  writeWav(`${OUT_DIR}/${v.tag}.wav`, mixed, SR);
  return { dur: mixed.length / SR, cpm: (chars / speech) * 60 };
}

async function main() {
  const doc = JSON.parse(readFileSync(`${PROJ}/script.json`, 'utf8')) as {
    lines: { no: number; text: string; who?: string; beat?: string; parts?: Seg[] }[];
  };
  const byNo = new Map(doc.lines.map((l) => [l.no, l]));
  const segs: Seg[] = [];
  for (const no of PICK) {
    const l = byNo.get(no);
    if (!l) throw new Error(`script.json 里没有第 ${no} 段`);
    const ps = l.parts ?? [{ who: l.who!, text: l.text, beat: l.beat! }];
    ps.forEach((p, i) => segs.push({ no, sub: i, who: p.who, text: p.text, beat: p.beat }));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`试听段落：第 ${PICK.join('/')} 段　共 ${segs.length} 个声部\n`);

  const rows: string[] = [];
  for (const v of VARIANTS) {
    const t0 = Date.now();
    const { dur, cpm } = await render(v, segs);
    console.log(`${v.tag.padEnd(12)}${dur.toFixed(1)}s　主讲 ${cpm.toFixed(0)} 字/分　(${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    rows.push(`| **${v.tag}** | ${v.desc} | ${dur.toFixed(1)}s | **${cpm.toFixed(0)}** |`);
  }

  writeFileSync(
    `${OUT_DIR}/说明.md`,
    `# 说书人 A/B —— 定主讲人

试听反馈是**角色都好，主讲人机械、偏慢**。所以这四条**只改主讲人**，
角色一律不动（V3 的书生对调除外）。

素材是剧本原文第 ${PICK.join(' / ')} 段：冷开场的钩子、一句书生对白、
以及幕二「王生往窗里看」那八句。

| 版本 | 改了什么 | 时长 | 主讲净语速 |
|---|---|---|---|
${rows.join('\n')}

参照：前三幕试听里**书生 258 / 艳鬼 240 / 妇人 237 字/分**，你说这几个都好。
主讲人当时是 **230**，全场最慢。

## 为什么慢

链路上就慢：\`cast −6% + 叙平 −10% = −16%\`，比谁都低 2–4 个百分点。
更要命的是全片主讲有 **40% 的字挂在 \`叙缓\`**（净 −28%），实测只有 178–203 字/分。

## 为什么机械

\`说书人\` 用的是**云扬 = 微软的新闻播报音色**，设计目标就是"平稳、可信、
不带个人色彩"——这几乎就是机械的定义。而它的 morph 是 \`0.97 / 0.97\`，
**几乎等于原声**，播音腔一点没被改掉。

角色好听不是偶然：晓晓、晓伊、云希都是**对话向**音色。老道也是云扬，
但被压到 pitch 0.86 + aged EQ + −10% 语速，已经不像播音员了。

还有一条帮凶：\`TONE.broadcast\` 里有个 **2.5:1 的压缩器**，
我们用 gain 做的 0.70–1.08 音量起伏被它按掉一部分。V2/V3 把它换成了 1.6:1。

## 听的时候判断三件事

1. **V1 够不够。** 如果只提速就顺了，音色别动——换基础音色要重出试听样本、
   重测分离度红线，能不动最好。
2. **V2 的云健会不会"太热情"。** 它是体育解说底子，自带推进感是优点，
   但十几分钟连着听会不会累，这条只能靠耳朵。
3. **V3 的对调值不值。** 主讲换云希（年轻些、活泼些），书生换云扬
   （王生是读书人，一本正经的播音腔反而贴）。听第 24 段那两句连着的，
   引述接对白的地方最能听出两个声音搭不搭。

## 附带在听的：句子级微抖动

V1/V2/V3 都开了 ±3% 的语速微抖（按段号定，不是随机数——随机的话每次跑
出来不一样，A/B 的差别会混进抽签噪声）。原来 71 段常规参数完全相同，
每段又是独立合成，等于 165 条一模一样的语调弧线。

## 定了之后要落的

- 选角表 \`cast.ts\` 改主讲人那一组（V2/V3 还要动乞丐或书生，男声就三个够用的，得挪位）
- 新增说书专用的 \`说缓/说平/说快\` 三档念法 —— **不要动全局的 \`叙缓/叙平/叙快\`**，
  joke-video 的旁白挂着它们，改了会串台
- 重出 \`voice-samples/\` 里主讲那两条，重测分离度（主讲 vs 老道、乞丐 vs 书生）
`
  );

  console.log(`\n→ shuoshu/projects/${EP}/narrator-ab/`);
}

main();
