// ── 说书出片总装：一条命令从稿件到成片 ────────────────────────────────
//
// 用法：
//   npx tsx src/shuoshu-ship.ts --ep E02              全套
//   npx tsx src/shuoshu-ship.ts --ep E02 --check      只体检，什么都不出
//   npx tsx src/shuoshu-ship.ts --ep E02 --from 场景   从这一步往后跑
//   npx tsx src/shuoshu-ship.ts --ep E02 --cover-sec 2  片头封面时长
//
// ── 这条命令负责什么，不负责什么 ──
//
// **负责**：解析之后的一切。体检 → 音频 → 场景图 → 封面 → 成片 → 护栏 → 交付物核对。
// 每一步失败就停，不往下走——这条管线的每一步都吃上一步的产物，
// 带着错误往下跑只会把错误摊到更贵的地方（编码一次三分多钟）。
//
// **不负责**（这三件事机器做不了，别指望这条命令）：
//
//   ① **写稿**。3800 字的说书稿，机器写不出能听的东西
//   ② **标注节拍**。哪一句该压低、哪一句该停死，是编剧判断不是规则。
//      体检会拦住"一段没标"，但拦不住"标得不对"
//   ③ **试听**。E01 的教训：跳过试听直接出全片，主讲人机械偏慢，全片重来。
//      跑完这条命令**成片是能看的，但不代表能发**
//
// 换句话说：这条命令把**第 ② 步到第 ⑦ 步**焊成了一条，
// 第 ① 步（写稿）和第 ③ 步（标注）仍然要人（或者模型）先做完。

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { resolveEp } from './shuoshu-ep.js';
import { preflightShuoshu } from './shuoshu-preflight.js';

// 直接拿 node 跑 tsx 的入口，不走 npx + shell。
// `shell: true` 配数组参数 Node 会警告（参数不转义只拼接），而这里的路径里
// 迟早会出现空格——用 shell 拼出来的命令行就散了。顺带每步省掉 npx 的启动开销。
const TSX = createRequire(import.meta.url).resolve('tsx/package.json').replace(/package.json$/, 'dist/cli.mjs');

const argv = process.argv.slice(2);
const flag = (k: string) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (k: string) => argv.includes(k);

const { id: EP, dir: DIR } = resolveEp(argv);
const coverSec = flag('--cover-sec');

interface Step {
  key: string;
  name: string;
  script: string;
  args?: string[];
  /** 这一步产出什么，用来做交付物核对 */
  out: string[];
}

const STEPS: Step[] = [
  { key: '音频', name: '整期合成', script: 'src/shuoshu-build.ts', out: ['audio/全片.wav', 'audio/全片.manifest.json', 'audio/全片.srt'] },
  { key: '场景', name: '场景图', script: 'src/shuoshu-scene.ts', out: ['scenes'] },
  {
    key: '封面',
    name: '封面图（16:9 + 1:1）',
    script: 'src/shuoshu-cover.ts',
    out: [
      'cover.png',
      'cover/upload-1280x720.png',
      'cover/check-320.png',
      'cover/cover.svg',
      // 1:1，微信。**跟横版一起出**，不是事后补的——补的东西迟早有一期会忘
      'cover/wechat-1080x1080.png',
      'cover/check-square-200.png',
      'cover/cover-square.svg',
    ],
  },
  {
    key: '成片',
    name: '出视频',
    script: 'src/shuoshu-video.ts',
    args: coverSec ? ['--cover-sec', coverSec] : [],
    out: [`${EP}.mp4`, `${EP}.srt`],
  },
];

function run(label: string, script: string, args: string[] = []): void {
  console.log(`\n${'─'.repeat(58)}\n▸ ${label}\n${'─'.repeat(58)}`);
  const r = spawnSync(process.execPath, [TSX, script, '--ep', EP, ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n✗ ${label} 失败（退出码 ${r.status}）。\n  修完之后从这一步接着跑：--from ${label}`);
    process.exit(1);
  }
}

/** 体检。有错就停——这条线最贵的失败是"跑完了但东西是错的" */
function check(phase: string): void {
  const issues = preflightShuoshu(DIR);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  if (!issues.length) {
    console.log(`  ✓ 体检（${phase}）没发现问题`);
    return;
  }
  for (const i of issues) console.log(`  ${i.level === 'error' ? '✗' : '!'} ${i.msg}`);
  if (errors.length) {
    console.error(`\n体检没过：${errors.length} 个错。**不往下跑了**——带着这些错出片，成品是废的。`);
    process.exit(1);
  }
  console.log(`  ✓ 体检（${phase}）通过，${warns.length} 个提醒`);
}

function main() {
  console.log(`《${EP}》出片`);

  console.log('\n① 体检');
  check('出片前');
  if (has('--check')) {
    console.log('\n--check：只体检，到此为止');
    return;
  }

  const from = flag('--from');
  let started = !from;
  const t0 = Date.now();
  for (const s of STEPS) {
    if (!started && s.key !== from) {
      console.log(`\n（跳过 ${s.key}）`);
      continue;
    }
    started = true;
    run(`${s.key}｜${s.name}`, s.script, s.args);
    // 音频出来之后画面密度才查得了，所以这里再体检一次
    if (s.key === '音频') {
      console.log('');
      check('有音频之后');
    }
  }

  console.log(`\n${'─'.repeat(58)}\n▸ 护栏｜选角表\n${'─'.repeat(58)}`);
  const cast = spawnSync(process.execPath, [TSX, 'src/cast-check.ts'], { stdio: 'inherit' });
  if (cast.status !== 0) {
    console.error('\n✗ 选角表跟基线不一致。上面每一行都该是你**打算**改的角色，多一行就是漏网的连带影响。');
    process.exit(1);
  }

  // ── 交付物核对 ──
  console.log(`\n${'─'.repeat(58)}\n▸ 交付物\n${'─'.repeat(58)}`);
  const want = [...STEPS.flatMap((s) => s.out), 'script.json', 'scenes.json'];
  let missing = 0;
  for (const f of want) {
    const p = `${DIR}/${f}`;
    if (!existsSync(p)) {
      console.log(`  ✗ 缺 ${f}`);
      missing++;
      continue;
    }
    const st = statSync(p);
    const size = st.isDirectory() ? `${readdirSync(p).length} 个文件` : `${(st.size / 1024 / 1024).toFixed(1)} MB`;
    console.log(`  ✓ ${f.padEnd(30)} ${size}`);
  }
  for (const f of ['发布文案.md']) {
    if (!existsSync(`${DIR}/${f}`)) {
      console.log(`  ! 没有 ${f}——发布文案跟封面一样是频道规范，不是可选项`);
    } else console.log(`  ✓ ${f}`);
  }

  // 字幕平移对不对：跟成片对齐那份的第一条应该正好等于封面时长
  const srt = `${DIR}/${EP}.srt`;
  if (existsSync(srt)) {
    const m = /(\d\d):(\d\d):(\d\d),(\d\d\d)/.exec(readFileSync(srt, 'utf8'));
    if (m) {
      const t = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
      const expect = coverSec ? Number(coverSec) : 1.5;
      const ok = Math.abs(t - expect) < 0.05;
      console.log(`  ${ok ? '✓' : '✗'} 字幕首条 ${t.toFixed(1)}s ${ok ? '=' : '≠'} 封面 ${expect}s`);
      if (!ok) missing++;
    }
  }

  if (missing) {
    console.error(`\n✗ ${missing} 项交付物有问题`);
    process.exit(1);
  }

  console.log(`\n全套跑完　${((Date.now() - t0) / 1000 / 60).toFixed(1)} 分钟`);
  console.log(
    `\n${'═'.repeat(58)}\n` +
      `**成片是能看的，但还不能发。** 机器查不了的三件事：\n` +
      `  · 整片听一遍，尤其台词最多的那个角色——音色撑不撑得住长段\n` +
      `  · 人名前后一致，全片不能换叫法\n` +
      `  · 封面 check-320.png（横版）和 check-square-200.png（微信 1:1）认不认得出篇名\n` +
      `清单在 ${DIR}/发布文案.md 第四节。\n${'═'.repeat(58)}`
  );
}

if (process.argv[1]?.includes('shuoshu-ship')) main();
