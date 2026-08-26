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

const { id: EP, dir: DIR, slug: SLUG } = resolveEp(argv);
const coverSec = flag('--cover-sec');

interface Step {
  key: string;
  name: string;
  script: string;
  args?: string[];
  /** 这一步产出什么，用来做交付物核对 */
  out: string[];
  /** 失败只提醒、不掐断整条线。用于"缺了它片子照样能发，但该补"的那种步骤 */
  soft?: boolean;
}

const STEPS: Step[] = [
  { key: '音频', name: '整期合成', script: 'src/shuoshu-build.ts', out: ['audio/全片.wav', 'audio/全片.manifest.json', 'audio/全片.srt'] },
  { key: '场景', name: '场景图', script: 'src/shuoshu-scene.ts', out: ['scenes'] },
  {
    // ── 2026-08-23：两种封面版式并成一种 ──────────────────────────────
    //
    // 以前这一步跑 `shuoshu-cover.ts`（渐变靛青底 + 繁体竖排篇名），出七个文件；
    // YouTube 缩略图是另一套版式、另一个脚本、还得人工上传。**现在只留一种。**
    //
    // 成片第一帧、B站/西瓜横版、微信 1:1，全部由 `yt-cover.ts` 那套版式出。
    //
    // ⚠ **代价记在这儿**：规范 §〇 本来把两张图分开，因为它们任务不同 ——
    // 缩略图要在信息流里让人点，首帧要接住已经点进来的人。并成一张之后，
    // **片子第一帧是主字（如「不笑」）不再是篇名（「嬰寧」）**，
    // 篇名只剩眉标那一行小字。这是知情的取舍，不是疏漏。
    //
    // `shuoshu-cover.ts` **留在仓库里没删** —— E01–E04 是用它出的，
    // 那几期已经发布，不回改。它只是不再被 ship 调用了。
    key: '封面',
    name: '封面（第一帧 + 上传 + 微信 1:1，一种版式）',
    script: 'src/yt-cover.ts',
    out: [
      'cover.png',
      'cover/wechat-1080x1080.png',
      'cover/check-square-200.png',
      'cover/cover.svg',
      'cover/cover-square.svg',
    ],
  },
  {
    key: '成片',
    name: '出视频',
    script: 'src/shuoshu-video.ts',
    args: coverSec ? ['--cover-sec', coverSec] : [],
    out: [`${SLUG}.mp4`, `${SLUG}.srt`],
  },
  {
    // 收进交付包。**扫的是三条线全部**，不只这一期 —— 幂等，重跑不会重复。
    // soft：包没收上也不该拦住出片，片子是好的。
    key: '交付',
    name: '交付包（醒木不响/_待发）',
    script: 'src/deliver.ts',
    out: [],
    soft: true,
  },
];

function run(label: string, script: string, args: string[] = [], soft = false): void {
  console.log(`\n${'─'.repeat(58)}\n▸ ${label}\n${'─'.repeat(58)}`);
  const r = spawnSync(process.execPath, [TSX, script, '--ep', EP, ...args], { stdio: 'inherit' });
  if (r.status === 0) return;
  if (soft) {
    console.log(`\n! ${label} 没出来，先跳过。补完再单跑：npm run yt:cover -- --ep ${EP}`);
    return;
  }
  console.error(`\n✗ ${label} 失败（退出码 ${r.status}）。\n  修完之后从这一步接着跑：--from ${label}`);
  process.exit(1);
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
    run(`${s.key}｜${s.name}`, s.script, s.args, s.soft);
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

  // ── 护栏｜构图 ──────────────────────────────────────────────────────
  //
  // 「x>1620 不要放深墨」那条硬约束撞过四次（E05 三次、E06 差点第四次），
  // 一直靠人记。2026-08-26 进机器。**只查这一期用到的构图**（十几秒）——
  // 全扫 84 个要一分多钟，那种贵度挂不到每次出片上。
  //
  // **不掐断。** E01–E05 里有一批越界的构图，那几期已经发布、不回改，
  // 掐断的话这条护栏一天都活不下去。它的活是「说出来」，不是「拦住」。
  console.log(`\n${'─'.repeat(58)}\n▸ 护栏｜构图（题字栏有没有被压住）\n${'─'.repeat(58)}`);
  spawnSync(process.execPath, [TSX, 'src/scene-check.ts', '--ep', EP], { stdio: 'inherit' });

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
  // 上传用那张：文件名带篇名（YT_<篇名>.png），扫目录不按固定名字找
  const yt = readdirSync(DIR).filter((f) => /^YT_.+\.png$/.test(f) && f !== 'YT_预览210.png');
  if (yt.length) for (const f of yt) console.log(`  ✓ ${f.padEnd(30)} ${(statSync(`${DIR}/${f}`).size / 1024 / 1024).toFixed(1)} MB`);
  else console.log('  ! 没有 YT_<篇名>.png——上传用的横版就是它（见 YouTube封面规范.md）');

  for (const f of ['发布文案.md']) {
    if (!existsSync(`${DIR}/${f}`)) {
      console.log(`  ! 没有 ${f}——发布文案跟封面一样是频道规范，不是可选项`);
    } else console.log(`  ✓ ${f}`);
  }

  // 字幕平移对不对：跟成片对齐那份的第一条应该正好等于封面时长
  const srt = `${DIR}/${SLUG}.srt`;
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
      `  · YouTube 缩略图看 YT_预览210.png——210px 是唯一的验收标准
` +
      `  · YouTube 缩略图看 YT_预览210.png——210px 是唯一的验收标准\n` +
      `清单在 ${DIR}/发布文案.md 第四节。\n${'═'.repeat(58)}`
  );
}

if (process.argv[1]?.includes('shuoshu-ship')) main();
