// ── 环境自检：这台机器能不能出片 ─────────────────────────────────────
//
// 用法：npm run doctor
//
// **为什么需要这个**：光看代码读不出真相。joke-video 的字体首选写的是
// `Noto Sans CJK SC`（思源旧命名），而开发机上装的是 `Noto Sans SC`——
// 族名不同，匹配不上，实际一路 fallback 到微软雅黑。换到 Mac 会落到苹方，
// 字形和字宽都变，但**不会有任何报错**。
//
// 同类的静默失败还有：ffmpeg 缺 rubberband → 变声退化成另一个人；
// libass 找不到字幕字体 → 静默回退。这些都只能实测，不能靠读配置。

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// **必须先读 .env。** 少了这一句，VG_FONT / JOKE_FONT 这些在 .env 里配好的值
// 读不到，doctor 会拿代码里的默认值去判断，然后报一个根本不存在的故障。
// 第一版就是这么误报的：.env 里明明写着 VG_FONT=Microsoft YaHei、成片的 ass
// 里也是它，doctor 却说「整条 fallback 链都没有」。
dotenv.config();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let bad = 0;
let warned = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const no = (m: string, fix?: string) => {
  bad++;
  console.log(`  ✗ ${m}`);
  if (fix) console.log(`      ${fix}`);
};
const warn = (m: string, fix?: string) => {
  warned++;
  console.log(`  ⚠ ${m}`);
  if (fix) console.log(`      ${fix}`);
};

console.log('\n── Node ──');
const major = Number(process.versions.node.split('.')[0]);
major >= 20 ? ok(`node ${process.versions.node}`) : no(`node ${process.versions.node}，需要 >= 20`);

console.log('\n── ffmpeg ──');
const ff = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
if (ff.status !== 0) {
  no('找不到 ffmpeg', 'macOS: brew install ffmpeg　Windows: https://www.gyan.dev/ffmpeg/builds/ 的 full build');
} else {
  ok((ff.stdout ?? '').split('\n')[0].replace('ffmpeg version ', 'ffmpeg '));
  const filters = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 1 << 24 }).stdout ?? '';
  // rubberband 是编译期可选的。没有它，morph 退化成单级重采样、formant 被忽略，
  // 女童/精灵/童声/反派这些靠 formant 立起来的音色会变成另一个人
  /\brubberband\b/.test(filters)
    ? ok('rubberband（变声的 pitch/formant 解耦）')
    : no('ffmpeg 缺 rubberband —— 变声会退化，音色跟调好的不是一个人', '换一个带 librubberband 的构建');
  /\baexciter\b/.test(filters) ? ok('aexciter（沙哑老头音色）') : warn('ffmpeg 缺 aexciter —— 沙哑老头这一档会报错');
}
spawnSync('ffprobe', ['-version'], { encoding: 'utf8' }).status === 0 ? ok('ffprobe') : warn('找不到 ffprobe（核对成片时要用）');

console.log('\n── 字体 ──');
// 用 resvg 实测能不能解析：渲一段文字，跟"故意写一个不存在的族名"比哈希。
// 相同 = 没匹配上，走了默认字体
let probe: ((f: string) => string) | null = null;
try {
  const { Resvg } = await import('@resvg/resvg-js');
  probe = (fam: string) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><text x="10" y="90" font-family="${fam}" font-size="72">画皮字幕测试</text></svg>`;
    return createHash('md5')
      .update(new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: fam } }).render().asPng())
      .digest('hex');
  };
} catch {
  warn('装不上 @resvg/resvg-js，跳过字体检查', 'npm i');
}

if (probe) {
  const MISS = probe('ZzzNoSuchFamilyHere');
  const has = (f: string) => probe!(f) !== MISS;
  /** 一条 fallback 链里第一个真实存在的族名 */
  const firstHit = (stack: string) => stack.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).find((f) => f !== 'sans-serif' && f !== 'serif' && has(f));

  const LINES: [string, string, string][] = [
    ['段子 / 儿童故事　字幕·封面·片头卡', 'Noto Sans CJK SC, Noto Sans CJK JP, Source Han Sans SC, Microsoft YaHei, Yu Gothic UI, PingFang SC', 'JOKE_FONT'],
    ['说书　水墨题字', 'Noto Serif SC, Source Han Serif SC, SimSun, STSong, Songti SC, Microsoft YaHei', 'SHUOSHU_FONT'],
    [`解说　ass 字幕${process.env.VG_FONT ? '（.env 已指定）' : ''}`, process.env.VG_FONT ?? 'Noto Sans CJK SC', 'VG_FONT'],
  ];
  for (const [label, stack, env] of LINES) {
    const hit = firstHit(stack);
    const first = stack.split(',')[0].trim();
    // fallback 链**本来就是用来退的** —— joke-video 的注释写明「Windows 建议 Microsoft YaHei」，
    // 退到第四个是设计好的，不是缺陷。所以只有"一个都没有"才算问题；
    // 退到第几个只是个事实，报出来是为了让你知道换机器后会变成什么。
    if (!hit) no(`${label}：整条 fallback 链一个都没有 —— 会用系统默认字体`, `装一个，或设 ${env}=<族名>`);
    else if (hit !== first) ok(`${label}：${hit}（链上第 ${stack.split(',').findIndex((x) => x.trim().replace(/^['"]|['"]$/g, '') === hit) + 1} 个；换机器会变，要锁死就设 ${env}）`);
    else ok(`${label}：${hit}`);
  }

  // 说书封面走仓库里的静态字重 OTF，不看系统字体
  const dir = `${ROOT}fonts/NotoSerifCJKsc/OTF/SimplifiedChinese/`;
  const weights = ['Black', 'Bold', 'SemiBold', 'Medium', 'Regular', 'Light', 'ExtraLight'];
  const got = weights.filter((w) => existsSync(`${dir}NotoSerifCJKsc-${w}.otf`));
  got.length === weights.length
    ? ok(`说书　封面字重：fonts/ 下 ${got.length} 个静态 OTF 齐全`)
    : warn(
        `说书　封面字重：fonts/ 下只有 ${got.length}/7 个 OTF —— 标题字重会退化`,
        'fonts/ 不在版本库里（162M）。下载 Noto Serif CJK SC 的 OTF 放进去，或设 SHUOSHU_COVER_FONT'
      );
}

console.log('\n── 配置 ──');
const envFile = `${ROOT}.env`;
if (!existsSync(envFile)) warn('没有 .env', 'cp .env.example .env 再填 key');
else {
  const txt = readFileSync(envFile, 'utf8');
  const val = (k: string) => (txt.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1]?.trim() ?? '';
  // 只判断"填没填"，不打印值
  const a = val('ANTHROPIC_API_KEY');
  a && !a.startsWith('sk-ant-...') ? ok('ANTHROPIC_API_KEY 已填（写稿要用）') : warn('ANTHROPIC_API_KEY 还是占位符 —— npm run vg -- script 跑不了');
  val('PEXELS_API_KEY').length > 20 ? ok('PEXELS_API_KEY 已填（解说线找空镜要用）') : warn('PEXELS_API_KEY 没填 —— 解说线的 footage 步骤会失败');
}

console.log(`\n${bad ? `${bad} 项必须解决，否则出来的片子是错的。` : warned ? `没有致命问题，${warned} 项要留意。` : '全部就绪。'}\n`);
process.exit(bad ? 1 : 0);
