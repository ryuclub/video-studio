// ── 儿童故事出片总装：一条命令从稿件到成片 ──────────────────────────────
//
// 用法：
//   npm run ship -- jokes/page-01-turtle.json            全套，一直到成片
//   npm run ship -- jokes/page-01-turtle.json --check    只到试听，不渲片
//   npm run ship -- jokes/page-01-turtle.json --from 试听  从这一步往后跑
//   npm run ship -- jokes/page-01-turtle.json --keep-voice 配音不重跑（改了画面时用）
//
// ── 这条命令负责什么，不负责什么 ──
//
// **负责**：站位 → 配音 → 对齐 → 音画同步核对 → 试听音轨 → 逐镜静帧 → 成片 + 封面。
// 每一步失败就停，不往下走 —— 每一步都吃上一步的产物，带着错误往下跑
// 只会把错误摊到更贵的地方（渲染一次八分钟）。
//
// **不负责**（这两件事机器现在做不了）：
//
//   ① **写稿**。`jokes/*.json` 要先有。从脚本集的故事本体扩写成配音稿、
//      拆分镜、标念法，是编剧判断不是规则。体检拦得住"字段写错"，
//      拦不住"这一镜不该切"。
//   ② **试听**。跑完这条命令**成片是能看的，但不代表能发**。
//      节奏对不对只有耳朵知道，`--check` 就是为这一步留的。
//
// 详见 儿童故事出片方案.md。

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { buildTimeline } from './beats/typeA.js';
import { buildTimelineB } from './beats/typeB.js';
import { lineText, type JokeCfg, type Timeline } from './types.js';
import { findProjectDir, projectDir, filmFile, audioFile, coverFile } from './preview.js';
import { unfilled } from './plan.js';

// 直接拿 node 跑 tsx 的入口，不走 npx + shell —— 路径里迟早出现空格，
// shell 拼出来的命令行会散（跟 shuoshu-ship.ts 同一个理由）
const TSX = createRequire(import.meta.url).resolve('tsx/package.json').replace(/package.json$/, 'dist/cli.mjs');

const argv = process.argv.slice(2);
const has = (k: string) => argv.includes(k);
const flag = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const file = argv.find((a) => !a.startsWith('--') && a.endsWith('.json'));

if (!file || !existsSync(file)) {
  console.log('用法：npm run ship -- jokes/<稿件>.json [--check] [--from <步骤>] [--keep-voice]');
  process.exit(1);
}

const cfg: JokeCfg = JSON.parse(readFileSync(file, 'utf8'));
const timelineOf = (c: JokeCfg): Timeline => (c.type === 'B' ? buildTimelineB(c) : buildTimeline(c));

interface Step {
  key: string;
  desc: string;
  /** 跑 cli.ts 的哪个子命令；不填就是本文件里的内建检查 */
  cmd?: string;
  args?: string[];
  run?: () => boolean;
  /** 属于「出片」阶段，--check 时跳过 */
  ship?: boolean;
}

/** 音画同步核对：逐句比对配音区间和字幕窗口。几秒钟，但能挡住最贵的一类错 */
function syncCheck(): boolean {
  const c: JokeCfg = JSON.parse(readFileSync(file!, 'utf8')); // 读回 align 刚写完的 dur
  const tl = timelineOf(c);
  let bad = 0;
  let prevEnd = 0;
  for (const sg of tl.segments) {
    if (sg.kind !== 'line' || !sg.line) continue;
    const start = sg.start + (sg.line.padBefore ?? 0.35);
    const end = start + (sg.line.dur ?? 0);
    const over = sg.start < prevEnd - 1e-6;
    if (start < sg.start - 1e-6 || end > sg.end + 1e-6 || over) {
      bad++;
      console.log(
        `  ✗ 第${(sg.lineIndex ?? 0) + 1}句 窗口[${sg.start.toFixed(2)},${sg.end.toFixed(2)}) ` +
          `配音[${start.toFixed(2)},${end.toFixed(2)}] ${over ? '与上一句重叠' : '越界'}　${lineText(sg.line).slice(0, 12)}`
      );
    }
    prevEnd = sg.end;
  }
  const spoken = c.lines.reduce((s, l) => s + (l.dur ?? 0), 0);
  const mm = Math.floor(tl.duration / 60);
  const ss = (tl.duration % 60).toFixed(1).padStart(4, '0');
  console.log(
    `  ${c.lines.length} 句　片长 ${mm}:${ss}　纯配音 ${spoken.toFixed(1)}s　` +
      `留白 ${(tl.duration - spoken).toFixed(1)}s（${((1 - spoken / tl.duration) * 100).toFixed(0)}%）`
  );
  if (bad) console.log(`\n  ${bad} 句音画不同步。改 pace/padBefore 后重跑 align。`);
  else console.log('  ✓ 每句配音都落在自己的字幕窗口内，无重叠');
  return bad === 0;
}

const STEPS: Step[] = [
  { key: '站位', desc: '实测包围盒，重叠/出框自动推开', cmd: 'layout', args: ['--fix'] },
  { key: '配音', desc: 'Edge TTS 逐句合成 + 变声', cmd: 'voice' },
  { key: '对齐', desc: '去首尾静音，真实时长回填进 json', cmd: 'align' },
  { key: '同步', desc: '音画同步核对', run: syncCheck },
  { key: '试听', desc: '整条音轨（不渲帧）', cmd: 'audio' },
  { key: '静帧', desc: '逐镜场景图 + 预览页 + 方案.md', cmd: 'preview' },
  { key: '成片', desc: '渲染 + 封面第一帧', cmd: 'build', ship: true },
];

const from = flag('--from');
const check = has('--check');
if (from && !STEPS.some((s) => s.key === from)) {
  console.log(`没有这一步：${from}\n可用：${STEPS.map((s) => s.key).join(' / ')}`);
  process.exit(1);
}

// --keep-voice：画面改了、台词没改时用，省掉两分钟重合成。
// **台词改了千万别用** —— 音轨还是旧的，字幕是新的，对不上
const skip = new Set<string>();
if (has('--keep-voice')) {
  skip.add('配音');
  skip.add('对齐');
}

let started = !from;
const t0 = Date.now();
console.log(`\n${'═'.repeat(58)}`);
console.log(`出片总装　${cfg.title ?? cfg.id}　（${file}）`);
console.log(check ? '模式：--check，跑到试听为止，不渲片' : '模式：全套，一直到成片');
console.log('═'.repeat(58));

for (const s of STEPS) {
  if (!started && s.key !== from) continue;
  started = true;
  if (check && s.ship) {
    console.log(`\n── 跳过「${s.key}」（--check）──`);
    continue;
  }
  if (skip.has(s.key)) {
    console.log(`\n── 跳过「${s.key}」（--keep-voice）──`);
    continue;
  }

  console.log(`\n── ${s.key}　${s.desc} ──`);
  if (s.run) {
    if (!s.run()) {
      console.log(`\n「${s.key}」没过，停在这里。`);
      process.exit(1);
    }
    continue;
  }
  const r = spawnSync(process.execPath, [TSX, 'src/cli.ts', s.cmd!, file, ...(s.args ?? [])], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log(`\n「${s.key}」失败（退出码 ${r.status}），停在这里。修完可以从这一步续跑：`);
    console.log(`  npm run ship -- ${file} --from ${s.key}`);
    process.exit(1);
  }
}

// ── 交付物核对 ──
const dir = findProjectDir(cfg) ?? projectDir(cfg);
const want = check
  ? [`${dir}/${cfg.id}-试听.wav`, `${dir}/方案.md`, `${dir}/index.html`, `${dir}/stills`]
  : [`${dir}/${filmFile(cfg)}`, `${dir}/${audioFile(cfg)}`, `${dir}/${coverFile(cfg)}`, `${dir}/方案.md`, `${dir}/index.html`];

console.log(`\n${'═'.repeat(58)}`);
console.log(`完成，用时 ${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
let miss = 0;
for (const w of want) {
  const ok = existsSync(w);
  if (!ok) miss++;
  console.log(`  ${ok ? '✓' : '✗'} ${w}`);
}

const holes = unfilled(dir);
if (holes.length) {
  console.log('\n方案.md 还有没填的：');
  for (const h of holes) console.log(`  ⚠ 「${h.section}」${h.count} 处`);
}

console.log('\n机器能查的都查完了。剩下三件只有人能做：');
console.log(`  □ 试听　　${dir}/${cfg.id}-试听.wav　—— 节奏赶不赶、落点句够不够慢`);
console.log(`  □ 逐镜　　${dir}/index.html　　　　—— 画面和台词对得上吗`);
console.log('  □ 内容风控');
console.log(check ? '\n听着对了就跑：npm run ship -- ' + file + ' --from 成片' : '');
console.log('═'.repeat(58) + '\n');
process.exit(miss ? 1 : 0);
