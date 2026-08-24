// ── 交付包：三条线的片子收进一个文件夹，按档期排好 ────────────────────
//
// 用法：npm run deliver          扫三条线，缺哪个包补哪个
//      npm run deliver -- --dry  只说要做什么，不动文件
//
// ── 为什么不是把项目目录整个搬过来 ──
//
// 上传一条片子实际要六样：mp4、srt、横版封面、微信方版、自检图、发布文案。
// 而一个说书项目目录里还躺着 `audio/全片.wav`（115 MB）和 `scenes/` 60 张图 ——
// **整个搬过去等于把 175 MB 的中间产物搬进你要上传的文件夹。**
// 而且发布文案里的 `../../../` 相对链接会集体指错（仓库记过这个坑：不报错，
// 只在有人点的时候才发现）。
//
// 所以搬的是**交付物**，不是项目。项目目录留在原地，该在哪在哪。
//
// ── 一次上传 = 一个包 ──
//
// 「一个文件夹」的单位不是项目目录，是**一次上传**。理由是治愈线一个项目目录里
// 有好几条片子：方丈记有上篇下篇，每篇还各有一个文字版（那是另一档产品，
// 不是同一条片子的另一个版本）—— 四条片子四次上传，就该是四个包。
//
// ── 用硬链接，不复制 ──
//
// 同一个卷上 `link()` 出来的是同一份数据：**62 MB 的 mp4 不会变成两份**，
// 发布文案改哪一边都是改同一个文件（这正是要的 —— 复制一份就成了两份文案，
// 改哪份都对，那就是两份）。链接不上（跨卷之类）才退回复制。
//
// ── 排期账本 ──
//
// 没排档的包叫 `未排期_<线>_<名字>`，跟老马线一个写法（`horse/SCHEDULE.md`）。
// **要排期就给它改前缀**，改完 `npm run schedule` 就认得。
// 发完把整个包从 `_待发` 挪进 `_已发`。**目录树本身就是账本，没有第二张表。**

import { readdirSync, existsSync, statSync, mkdirSync, linkSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { OUT_ROOT, OUT_SHUOSHU, OUT_ZHIYU, OUT_CHAN } from './paths.js';
import { parseDir } from './schedule.js';
import { writeIndex } from './xingmu-index.js';

const ROOT = `${OUT_ROOT}/醒木不响`;
const PENDING = `${ROOT}/_待发`;
const DONE = `${ROOT}/_已发`;

/** 哪三条线进这个文件夹。心理洞察不进档期，所以也不进交付 */
const LINES: Record<string, string> = {
  说书: OUT_SHUOSHU,
  治愈: OUT_ZHIYU,
  小故事大道理: OUT_CHAN,
};

const ls = (p: string): string[] => (existsSync(p) ? readdirSync(p) : []);
const dirs = (p: string): string[] => ls(p).filter((d) => statSync(`${p}/${d}`).isDirectory());
const files = (p: string): string[] => ls(p).filter((f) => statSync(`${p}/${f}`).isFile());

/** 一次上传要的东西。找不到的留空，最后统一报 */
interface Pack {
  line: string;
  /** 包名，如 2026-08-25_1800JST_说书_婴宁-E05 */
  name: string;
  /** 项目目录，相对 joke-video/ */
  from: string;
  /** 目标文件名 → 源文件绝对路径 */
  items: Record<string, string>;
  missing: string[];
}

/** 在几个候选位置里挑第一个存在的 */
const pick = (...cands: string[]): string | undefined => cands.find((c) => c && existsSync(c));

/**
 * 一条片子 → 一个包。
 *
 * @param videoPath mp4 的路径
 * @param part      治愈/禅佛典的分部（上 / 下 / 全）。说书没有分部
 */
function packOf(line: string, proj: string, videoPath: string, part?: string): Pack {
  const stem = basename(videoPath).replace(/\.mp4$/, '');
  const vdir = videoPath.slice(0, videoPath.lastIndexOf('/'));
  const coverDir = part ? `${proj}/cover/${part}` : `${proj}/cover`;

  // 横版封面：说书是 YT_<篇名>.png（跟缩略图同一张），治愈/禅佛典是 upload-1280x720.png
  const yt = files(proj).find((f) => /^YT_.+\.png$/.test(f) && f !== 'YT_预览210.png');
  const items: Record<string, string> = {};
  const missing: string[] = [];
  const put = (as: string, src?: string) => {
    if (src) items[as] = resolve(src);
    else missing.push(as);
  };

  put(`${stem}.mp4`, videoPath);
  put(
    `${stem}.srt`,
    pick(videoPath.replace(/\.mp4$/, '.srt'), `${vdir}/${part ?? ''}篇.srt`, `${vdir}/全篇.srt`, ...files(vdir).filter((f) => f.endsWith('.srt')).map((f) => `${vdir}/${f}`))
  );
  put('封面-横版1280.png', pick(yt ? `${proj}/${yt}` : '', `${coverDir}/upload-1280x720.png`, `${proj}/cover/upload-1280x720.png`));
  put('封面-微信1080.png', pick(`${proj}/cover/wechat-1080x1080.png`, `${coverDir}/square-1400x1400.png`, `${coverDir}/wechat-1080x1080.png`));
  put('自检-小图.png', pick(`${proj}/YT_预览210.png`, `${coverDir}/check-210.png`, `${coverDir}/check-320.png`, `${proj}/cover/check-square-200.png`));
  put('发布文案.md', pick(`${proj}/发布文案.md`));

  // 包名：项目目录有档期前缀就用它，没有就是「未排期」（老马线那个写法）
  const dirName = basename(proj);
  const parsed = parseDir(dirName);

  // ── 身份那一段：**去掉的是整个档期前缀，不只是日期** ────────────────
  //
  // 原来这儿写的是 `stem.replace(/^\d{4}-\d{2}-\d{2}_/, '')`，只削日期。
  // 说书线没事（它的成片名本来就只有身份，`婴宁-E05.mp4`），
  // 治愈线那几本也没事（老目录 `2026-08-19_hojoki`，削完正好剩 `hojoki_上`）。
  //
  // **第一个用新目录名的治愈项目一进来就露馅了**：成片名是
  // `2026-08-26_1800JST_治愈_别人怎么看你-E01_全.mp4`，削掉日期还剩
  // `1800JST_治愈_…`，再拼上前缀就成了
  // `2026-08-26_1800JST_治愈_1800JST_治愈_别人怎么看你-E01_全`。
  // 不报错，只是包名难看 —— 而包名就是那本账，看着不对就没人信它。
  //
  // 现在：目录名认得出档期，就拿 `parsed.slug` 当身份，成片名里比目录名
  // **多出来的那一截**（`_全` / `_上_文字版` / `_全_烧字幕`）原样跟在后面。
  const extra = stem.startsWith(dirName) ? stem.slice(dirName.length).split('_').filter(Boolean) : [];
  const ident =
    parsed && stem.startsWith(dirName)
      ? [parsed.slug, ...extra].join('_')
      : stem.replace(/^\d{4}-\d{2}-\d{2}_/, '');
  const label = [ident, part && !stem.includes(part) ? part : ''].filter(Boolean).join('-');
  const name = parsed
    ? `${parsed.date}_${parsed.time}JST_${parsed.line}_${label}`
    : `未排期_${line}_${label}`;

  return { line, name, from: proj, items, missing };
}

/** 一个项目目录里所有要单独上传的片子 */
function videosIn(proj: string): { path: string; part?: string }[] {
  const out: { path: string; part?: string }[] = [];
  // 说书：mp4 就在项目根
  for (const f of files(proj).filter((f) => f.endsWith('.mp4'))) out.push({ path: `${proj}/${f}` });
  // 治愈 / 禅佛典：成片/<部>/*.mp4。**文字版单独算一条** —— 那是另一档产品，不是同一条片子的另一版
  const made = `${proj}/成片`;
  for (const part of dirs(made)) for (const f of files(`${made}/${part}`).filter((f) => f.endsWith('.mp4'))) out.push({ path: `${made}/${part}/${f}`, part });
  return out;
}

function build(): Pack[] {
  const out: Pack[] = [];
  for (const [line, root] of Object.entries(LINES))
    for (const d of dirs(root)) {
      const proj = `${root}/${d}`;
      for (const v of videosIn(proj)) out.push(packOf(line, proj, v.path, v.part));
    }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const dry = process.argv.includes('--dry');
  const packs = build();
  // 已经在 _已发 里的不再往 _待发 放 —— 那是发过的，别倒回去
  const done = new Set(dirs(DONE));
  // 已经在 _待发 里的：认包名，包名一致就算已经收过
  const pending = new Set(dirs(PENDING));

  console.log(`交付包　${ROOT}\n`);
  let made = 0;
  const warns: string[] = [];

  for (const p of packs) {
    if (done.has(p.name)) {
      console.log(`  · ${p.name}　（已发，跳过）`);
      continue;
    }
    const dst = `${PENDING}/${p.name}`;
    const already = pending.has(p.name);
    console.log(`  ${already ? '↻' : '+'} ${p.name}`);
    if (p.missing.length) warns.push(`${p.name} 缺：${p.missing.join(' / ')}`);
    if (dry) continue;

    // 重建：整包删掉重连。**清单是权威，目录只是产物** ——
    // 留着上一轮的残file 会出现"目录里有但清单里没有"的鬼文件
    if (already) rmSync(dst, { recursive: true, force: true });
    mkdirSync(dst, { recursive: true });
    for (const [as, src] of Object.entries(p.items)) {
      try {
        linkSync(src, `${dst}/${as}`);
      } catch {
        copyFileSync(src, `${dst}/${as}`); // 跨卷之类链不上，退回复制
      }
    }
    writeFileSync(
      `${dst}/来源.txt`,
      `这个包里的文件是硬链接，跟项目目录里那份是同一份数据（改哪边都一样）。\n` +
        `项目目录：${resolve(p.from)}\n` +
        `重建：npm run deliver\n` +
        `排期：给这个目录改前缀（未排期_ → 2026-08-25_1800JST_），改完 npm run schedule 就认得\n` +
        `发完：把整个目录挪进 ../_已发/\n`
    );
    made++;
  }

  if (!dry) console.log(`\n${made} 个包`);
  if (warns.length) {
    console.log('\n缺东西的（补齐再上传）：');
    for (const w of warns) console.log(`  ! ${w}`);
  }
  // 一页看完：成片 / 类型 / 发布状态 / 发布文案 / 档期。
  // **跟着包一起重建** —— 分成两条命令的话，总有一次收完包忘了出页，
  // 那张页就开始说假话（而它看着一切正常）。
  if (!dry) console.log(`\n→ ${writeIndex()}　双击打开，一页看完成片 / 类型 / 状态 / 文案 / 档期`);

  console.log(
    `\n_待发 里按名字排就是上传顺序。发完把整个包挪进 _已发。\n` +
      `没排档的叫「未排期_」，给它改前缀就是排期 —— 目录树本身就是账本，没有第二张表。`
  );
}

if (process.argv[1]?.includes('deliver')) main();
