// 旁白方案 A/B/C 对比实验：睡前故事该用单一独白还是分角色配音
//
// A 纯独白      —— 全部 青年女 + 平，一个调子读到底
// B 妈妈演绎    —— 全部 青年女，角色句换 delivery（真实妈妈就是这么读的）
// C 分角色配音  —— 旁白 青年女，小老鼠 童声，小兔 女童
//
// 跑完听 out/narration/{A,B,C}/*.wav，数字看控制台。

import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { synthesizeJoke } from './src/tts.js';
import { readWav } from './src/audio/wav.js';
import { measure } from './src/audio/measure.js';
import type { LineCfg } from './src/types.js';

interface Shot {
  who: '旁白' | '小老鼠' | '小兔';
  text: string;
  /** B 方案：妈妈演绎时这句怎么读 */
  actAs?: string;
}

const STORY: Shot[] = [
  { who: '旁白', text: '小老鼠们住在一个小山脚下，它们每天都到小山坡上去玩。' },
  { who: '小老鼠', text: '多大的蛋呀，我们可以做个大蛋糕！', actAs: '拔高' },
  { who: '旁白', text: '可是，蛋太大了，它们抬得满头大汗，才挪动了几步。' },
  { who: '小老鼠', text: '我们把它滚回去吧！', actAs: '急' },
  { who: '旁白', text: '大家刚滚了一会儿，突然看见山坡下全是大石头。' },
  { who: '小老鼠', text: '有办法了，我们把锅拿来，就在这儿做蛋糕。', actAs: '拔高' },
  { who: '旁白', text: '蛋糕做好了，香喷喷的味道真好闻。' },
  { who: '小兔', text: '别扔，用它做辆车。', actAs: '疑问' },
];

const CAST_C: Record<Shot['who'], string> = {
  旁白: '青年女',
  小老鼠: '童声',
  小兔: '女童',
};

async function run(plan: 'A' | 'B' | 'C') {
  const dir = `out/narration/${plan}`;
  mkdirSync(dir, { recursive: true });
  const rows: { who: string; f0: number; range: number; band: number; dur: number; tag: string }[] = [];

  for (let i = 0; i < STORY.length; i++) {
    const sh = STORY[i];
    const cast = plan === 'C' ? CAST_C[sh.who] : '青年女';
    const delivery = plan === 'B' ? sh.actAs : undefined;
    const line: LineCfg = { who: '_', text: sh.text, beat: 'reply', delivery };

    const id = `_narr/${plan}-${i}`;
    await synthesizeJoke({
      id,
      type: 'A',
      scene: 'abstract',
      characters: [{ id: '_', rig: 'human', side: 'left', cast, rate: '-8%' }],
      lines: [line],
    });
    const src = `voice/${id}/1-_.wav`;
    const dst = `${dir}/${String(i + 1).padStart(2, '0')}-${sh.who}.wav`;
    if (existsSync(src)) copyFileSync(src, dst);
    const a = readWav(src);
    const m = measure(a.data, a.sampleRate);
    rows.push({
      who: sh.who,
      f0: m.f0,
      range: m.f0Range,
      band: m.band,
      dur: m.dur,
      tag: `${cast}${delivery ? '/' + delivery : ''}`,
    });
  }

  console.log(`\n── 方案 ${plan} ──`);
  rows.forEach((r, i) =>
    console.log(
      `  ${String(i + 1).padStart(2)} ${r.who.padEnd(4)} ${r.tag.padEnd(10)} 基频 ${String(r.f0).padStart(3)}Hz  跨度 ${String(
        r.range
      ).padStart(3)}Hz  低高频差 ${String(r.band).padStart(5)}dB`
    )
  );

  const narr = rows.filter((r) => r.who === '旁白');
  const chars = rows.filter((r) => r.who !== '旁白');
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const nF = avg(narr.map((r) => r.f0));
  const cF = avg(chars.map((r) => r.f0));
  const allF = rows.map((r) => r.f0);

  console.log(`  ── 旁白均值 ${nF.toFixed(0)}Hz　角色均值 ${cF.toFixed(0)}Hz　落差 ${Math.abs(cF - nF).toFixed(0)}Hz`);
  console.log(`  ── 全片基频跨度 ${(Math.max(...allF) - Math.min(...allF)).toFixed(0)}Hz`);
  console.log(`  ── 用到的音色数 ${new Set(rows.map((r) => r.tag.split('/')[0])).size} 个`);
  return { plan, nF, cF, spread: Math.max(...allF) - Math.min(...allF), casts: new Set(rows.map((r) => r.tag.split('/')[0])).size };
}

(async () => {
  const res = [];
  for (const p of ['A', 'B', 'C'] as const) res.push(await run(p));
  console.log('\n══ 汇总 ══');
  console.log('  方案   音色数   旁白↔角色落差   全片基频跨度');
  for (const r of res)
    console.log(
      `   ${r.plan}      ${String(r.casts).padStart(2)}      ${Math.abs(r.cF - r.nF).toFixed(0).padStart(4)}Hz         ${r.spread
        .toFixed(0)
        .padStart(4)}Hz`
    );
  console.log('\n  音频在 out/narration/{A,B,C}/ 下，按顺序听一遍再定。');
})();
