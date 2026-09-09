#!/usr/bin/env node
/* ===========================================================================
   gao-2d/build.mjs — 英语频道合成脚本（出片方案 §7.3）

   用法（cwd 一律是仓库根）：
     node gao-2d/build.mjs uk_potholes --check     只自检，不跑 ffmpeg
     node gao-2d/build.mjs uk_potholes             全量出片
     node gao-2d/build.mjs uk_potholes --only 5    只重建第 5 块

   稿件源   gao-2d/稿件/<slug>/时间表.mjs ＋ 工作表.md
   工作目录 projects/高总/<slug>/       audio/ media/ _tmp/ <slug>.mp4
   帧序列   projects/高总/_帧/<组>/      全频道共用，node gao-2d/出帧.mjs 生成

   ── 跟交接过来的 v4 原稿的七处不同（理由见方案 §16 仓库版变更）──
     · SVG→PNG 走 @resvg/resvg-js，不再找 rsvg-convert / inkscape / magick。
       仓库里所有渲图都用它，多养一条外部依赖没道理。第 8 项自检因此从
       「转换器可用」换成「字卡字体装没装」—— 转换器现在是 npm 依赖，缺了
       import 就炸；字体缺了**不报错，只是悄悄换一个字族**，那才需要一道闸。
     · 配置按 slug 找，不再手写 shots/ 路径。
     · 配比与阈值全部来自 自检.mjs，页面和闸共用一份算法。
     · 渲图字体**点名到文件**，不让 resvg 扫系统字体库。A 层是逐帧渲的，
       扫一次 665 MB 的字体库 × 上百帧，慢 5 倍（实测见 字体表 那段注释）。
     · 分段编码用 ultrafast，不用 medium —— 分段是中间产物，终片还要再编一遍
       （见 分段编码 那段注释：快 3.6 倍，而且终片质量反而更好）。
     · 帧目录**先清空再建**（重建 不是 ensure）—— 旧帧留着会让段子悄悄变长。
     · sh() **失败就抛** —— ffmpeg 挂了还往下走，会拿上一次的旧段子拼片。
   =========================================================================== */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { buildCard, buildOverlay, buildMarks, W, H, 缺字体 } from './numcard-core.mjs';
import { 自检, 素材路径, 音乐路径, FPS, dur, nfr } from './自检.mjs';

/* C 层：去饱和、压暗、偏冷（方案 §6.5） */
const GRADE_C = 'hue=s=0.18,eq=contrast=1.15:brightness=-0.04,colorbalance=rs=0.03:bs=-0.02';
/* DOC 层不走那套 —— 本来就是黑白版面，压暗反而看不清。只把纸底从纯白压到 #f4f4f2 */
const GRADE_DOC = 'eq=contrast=1.06:brightness=-0.02';

const argv = process.argv.slice(2);
const SLUG = argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a));
const CHECK = argv.includes('--check');
const ONLY = argv.includes('--only') ? Number(argv[argv.indexOf('--only') + 1]) : null;

if (!SLUG) { console.error('用法：node gao-2d/build.mjs <slug> [--check] [--only N]'); process.exit(1); }

const 稿件 = path.join('gao-2d/稿件', SLUG);
const 工作 = path.join('projects/高总', SLUG);
const 帧 = 'projects/高总/_帧';
const 素材 = 'projects/高总/_素材';
const TMP = path.join(工作, '_tmp');
const 音乐 = 'projects/高总/_音乐';
const 根 = { 工作, 帧, 素材, 音乐 };

const 表 = path.join(稿件, '时间表.mjs');
if (!fs.existsSync(表)) { console.error(`没有这条稿件：${表}`); process.exit(1); }
const cfg = (await import(pathToFileURL(path.resolve(表)).href)).default;

/**
 * 跑外部命令。**失败就停**，不许往下走。
 *
 * 原先这儿是 `spawnSync(...)` 不看返回值。ffmpeg 挂掉（缺素材、滤镜写错、
 * 不在 PATH）脚本照样往下跑，最后 concat 按**完整时间表**去列 seg —— 拿到的
 * 是上一次留下的旧段子。出来一条看着正常、其中一段是上回内容的片子，
 * 比直接报错难查得多。
 */
const sh = (c, a) => {
  const r = spawnSync(c, a, { stdio: 'inherit' });
  if (r.error) throw new Error(`跑不起来 ${c}：${r.error.message}\n  （PATH 里有它吗？）`);
  // Windows 把负的退出码回成无符号（ffmpeg 的 -42 会变成 4294967254），换回来
  const code = r.status > 0x7fffffff ? r.status - 0x100000000 : r.status;
  if (code !== 0) throw new Error(`${c} 退出码 ${code}，报错在上面。命令是：\n  ${c} ${a.join(' ')}`);
  return r;
};

/**
 * 分段的编码参数。**分段是中间产物** —— concat 之后整条还要再编一次
 * （终片 preset slow），所以这一遍编得精细纯属白烧。
 *
 * 实测 90 帧 1080×1920，中间产物两种 preset，各自再过一遍终编：
 *
 *     preset medium     1122 ms   终片 PSNR 47.52
 *     preset ultrafast   312 ms   终片 PSNR 48.70
 *
 * 快 3.6 倍，而且**终片质量更好** —— 中间码率高，留给终编的信息多。
 * crf 压到 14 也是这个道理：中间文件大一点无所谓，反正 _tmp 是要删的。
 */
const 分段编码 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p'];
const pad = (n) => String(n).padStart(5, '0');
const ensure = (d) => fs.mkdirSync(d, { recursive: true });
/**
 * 帧目录：**先清空再建**。
 *
 * 跟 `出帧.mjs` 同一个道理（那儿 line 134 的注释写着「上一次跑得更长的话，
 * 多出来的旧帧会被 build.mjs 一起循环进去」）—— 只是那条防的是 `_帧/`，
 * 这儿防的是 `_tmp/a*` `_tmp/b*`。把某一块的时长改短再重建，旧帧还躺在
 * 目录里，`%05d.png` 会一路读下去，**段子比时间表长，还不报错**。
 */
const 重建 = (d) => { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); };
const q = (p) => path.resolve(p).replace(/\\/g, '/');

/**
 * 渲图字体：**点名到文件，不让 resvg 扫系统字体库**。
 *
 * `png()` 在 A 层是**逐帧**调的（uk_potholes 一次出片 103 次），而 `new Resvg()`
 * 每次都会重建一遍字体库。实测 12 次 1080×1920：
 *
 *     loadSystemFonts: true    3013 ms   RSS +166 MB
 *     loadSystemFonts: false    584 ms   RSS +108 MB
 *
 * 慢 5.2 倍，就为了在 665 MB / 165 个字体文件里找 Archivo 和 JetBrains Mono ——
 * 而这两个**多半没装**（`缺字体()` 会报），找不到再回退。纯白烧。
 *
 * ⚠ 不能只写 `loadSystemFonts: false` 就完事：那样一个字体都没有，文字直接不渲。
 *   所以回退字族也得点名进来 —— 后半截那几个是 Windows 自带的，`FONT_TITLE` /
 *   `FONT_MONO` 的回退链正好落在它们身上。
 *
 * 验证过：uk_potholes 三张 A 层卡，改前改后 PNG **字节完全一致**（字形没变），
 * 耗时 8990 ms → 1872 ms。字节数是这儿唯一靠得住的判据 —— 字体回退不报错。
 */
const 字体表 = (() => {
  /* **仓库自带的优先**（2026-09-09）：`fonts/` 里放了 Archivo 和 JetBrains Mono，
     换台机器不用重装、版本也钉死了 —— 字体回退是静默的，钉死版本才不会哪天悄悄变形。
     系统目录退到后面，只用来捡 Segoe UI / Arial / Consolas 那几个回退字族。 */
  const 项目 = path.resolve('fonts');
  const d = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : '/usr/share/fonts';
  const 用户 = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft/Windows/Fonts') : null;
  const 找 = (名) => [项目, d, 用户].filter(Boolean)
    .map((dir) => path.join(dir, 名)).find((p) => fs.existsSync(p));
  return ['Archivo-Black.ttf', 'Archivo-Bold.ttf', 'Archivo-Regular.ttf',
          'JetBrainsMono-Bold.ttf', 'JetBrainsMono-Regular.ttf',
          'segoeui.ttf', 'segoeuib.ttf', 'arial.ttf', 'arialbd.ttf',
          'consola.ttf', 'consolab.ttf', 'cour.ttf'].map(找).filter(Boolean);
})();

const png = (svg, w = W) =>
  new Resvg(svg, { fitTo: { mode: 'width', value: w }, background: 'rgba(0,0,0,0)',
                   font: { loadSystemFonts: false, fontFiles: 字体表 } }).render().asPng();

/* ---- 打印自检 ---------------------------------------------------------- */
function 报() {
  const r = 自检(cfg, 根);
  console.log(`\n${cfg.slug}　${cfg.题 ?? ''}　模板 ${cfg.模板 ?? '—'}\n` + '-'.repeat(76));
  for (const l of r.行)
    console.log(`${String(l.id).padStart(2)}  ${l.layer.padEnd(3)} ${String(l.start).padStart(5)}–${String(l.end).padEnd(5)} ${String(l.时长).padStart(5)}s  ${l.有 ? ' ' : '✗'} ${l.素材}`);
  console.log('-'.repeat(76));
  console.log(`总长 ${r.总长}s / ${Math.round(r.总长 * FPS)} 帧 @${FPS}fps`);
  console.log(`配比  A ${r.配比.A}%  B ${r.配比.B}%  C ${r.配比.C}%  DOC ${r.配比.DOC}%   （参考 35/25/25/15）`);

  /* 第 8 项：字卡字体。缺了 resvg 不报错，只是静默换一个字族 */
  const 缺 = 缺字体();
  if (缺.length) r.提醒.push(`系统里没装 ${缺.join('、')} —— 卡面会静默回退到 Consolas / Segoe UI，字形和字距都不是方案定的那套`);

  /* 时间表总长 vs 人声实际时长。
     时间码是按语速估算预填的，跑完 TTS 必须回填（方案 §7.3「时间码从音频来」）——
     忘了回填是**静默失效**：八项自检全过，出来的片子音画错位，最后几秒没画面。
     ⚠ 这道闸装在 build 侧不装在 `自检.mjs`：那份是纯函数、不跑 ffprobe，
     汇总页要随便调它。跟「字体装没装」同一类 —— 需要外部世界才能查的东西都在这儿。 */
  const 人声 = cfg.audio ? path.join(工作, cfg.audio) : null;
  if (人声 && fs.existsSync(人声)) {
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', 人声], { encoding: 'utf8' });
    const 实 = parseFloat((p.stdout || '').trim());
    if (isFinite(实)) {
      const 差 = +(实 - r.总长).toFixed(2);
      if (Math.abs(差) > 0.15)
        r.硬伤.push(`时间表总长 ${r.总长}s，人声实际 ${实.toFixed(2)}s，差 ${差 > 0 ? '+' : ''}${差}s`
          + ` —— 时间码还没按实测回填。画面${差 > 0 ? '短了，末尾会缺' : '长了，末尾会留空'} ${Math.abs(差)}s`
          + `（工作表 §5 和 时间表.mjs 两处一起改）`);
    }
  }

  /* 备料单 —— 缺件不只报文件名，连「要准备成什么样」一起给。
     说明写在 时间表.mjs 每块的 素材 字段里，跟 clip 名挨着，改名时不会漏改。 */
  const 待备 = r.行.filter((l) => !l.有 && (l.layer === 'C' || l.layer === 'DOC'));
  if (待备.length) {
    console.log('\n备料单　（这几块还没有文件）');
    for (const l of 待备) {
      const d = l.说明;
      console.log(`  第 ${l.id} 块  ${l.layer}  ${l.时长}s${l.共用 ? '  [共用库]' : ''}`);
      console.log(`    文件  ${l.素材}`);
      console.log(d?.要 ? `    要    ${d.源 ? `[${d.源}] ` : ''}${d.要}`
                        : '    要    （没写 —— 补 时间表.mjs 这块的 素材.要）');
      if (d?.检索) console.log(`    检索  ${d.检索}`);
      if (d?.备注) console.log(`    备注  ${d.备注}`);
    }
  }

  if (r.提醒.length) console.log('\n提醒\n' + r.提醒.map((m) => '  · ' + m).join('\n'));
  console.log(r.硬伤.length ? '\n待解决\n' + r.硬伤.map((m) => '  · ' + m).join('\n') + '\n' : '\n八项自检通过。\n');
  return r.硬伤.length === 0;
}

/* ---- 来源角标：渲成带透明通道的 PNG 再叠，绕开 drawtext 的字体路径问题 ---- */
function 角标(s) {
  const fw = 900, fh = 60;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fw} ${fh}" width="${fw}" height="${fh}">`
    + `<text x="${fw}" y="42" text-anchor="end" font-family="Archivo, 'Segoe UI', Arial, sans-serif"`
    + ` font-size="28" fill="#8a8a8a">${String(s.credit).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`;
  const dir = path.join(TMP, 'credits'); ensure(dir);
  const f = path.join(dir, `c${pad(s.id)}.png`);
  fs.writeFileSync(f, png(svg, fw));
  return f;
}

/* ---- A 层：逐帧渲卡，动画走完之后复制末帧（不再重渲） ------------------- */
function 层A(s) {
  const dir = path.join(TMP, `a${pad(s.id)}`); 重建(dir);
  const n = nfr(s);
  const an = Math.min(n, Math.max(1, Math.round((s.anim ?? 1.2) * FPS)));
  for (let f = 0; f < an; f++)
    fs.writeFileSync(path.join(dir, `${pad(f)}.png`), png(buildCard(s.card, an <= 1 ? 1 : f / (an - 1))));
  const last = path.join(dir, `${pad(an - 1)}.png`);
  for (let f = an; f < n; f++) fs.copyFileSync(last, path.join(dir, `${pad(f)}.png`));
  return 编码序列(path.join(dir, '%05d.png'), s);
}

/* ---- B 层：角色 PNG 序列，不足则循环 ---------------------------------- */
function 层B(s) {
  const 组 = 素材路径(s, 根);
  const src = fs.readdirSync(组).filter((f) => f.endsWith('.png')).sort();
  if (!src.length) throw new Error(`${组} 里没有 PNG —— 先跑 node gao-2d/出帧.mjs`);
  const dir = path.join(TMP, `b${pad(s.id)}`); 重建(dir);
  const n = nfr(s);
  for (let f = 0; f < n; f++) {
    const pick = s.loop === false ? src[Math.min(f, src.length - 1)] : src[f % src.length];
    fs.copyFileSync(path.join(组, pick), path.join(dir, `${pad(f)}.png`));
  }
  return 编码序列(path.join(dir, '%05d.png'), s);
}

/* ---- C / DOC 层：视频或静图，裁竖屏 ＋ 对应调色 ------------------------ */
function 层素材(s) {
  const out = path.join(TMP, `seg${pad(s.id)}.mp4`);
  const 文件 = 素材路径(s, 根);
  const 静图 = /\.(png|jpe?g|webp)$/i.test(文件);
  const chain = [
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    /* d 多给 2 帧余量，精确长度交给底下的 `-frames:v`。
       zoompan 自带 fps ＋ 链尾还有一个 fps 滤镜，两次时间戳重采样会吃掉 1 帧 ——
       实测 d=225 只出 224 帧。少一帧不报错，只是每段悄悄短 0.03s，十段累起来就漂了。 */
    s.kenburns ? `zoompan=z='min(zoom+0.0006,1.10)':d=${nfr(s) + 2}:s=${W}x${H}:fps=${FPS}` : null,
    s.layer === 'DOC' ? GRADE_DOC : GRADE_C, 'setsar=1', `fps=${FPS}`,
  ].filter(Boolean);

  /* 标注（红笔痕迹）不再走 `drawbox` —— 那个滤镜只画得了矩形，也只能硬闪一下。
     改成 SVG → PNG 序列 → overlay（见下面的链构造），箭头／下划线／感叹号都能画，
     而且能一个接一个扫出来。`box` 是老写法，等价于一条 box 型标注。 */

  /**
   * ⚠ **kenburns 时静图不能 `-loop`。**
   * `zoompan` 的 `d` 是「**每个输入帧**输出多少帧」，不是「总共输出多少帧」。
   * `-loop 1 -t 7.5` 会喂进 225 个输入帧，每个再被展开成 d=225 帧 ——
   * 225×225＝50625 帧，一段 7.5 秒的画面渲成 28 分钟、3.5 GB。
   * 2026-09-09 实测：三个静图段吃掉 6.6 GB，还在往下跑。
   * 不 loop 时输入只有 1 帧，zoompan 把它展开成 d＝nfr(s) 帧，正好是这一块的长度。
   */
  const inputs = 静图
    ? (s.kenburns ? ['-i', 文件]
                  : ['-loop', '1', '-t', String(dur(s)), '-i', 文件])
    : ['-ss', String(s.in ?? 0), '-t', String(dur(s)), '-i', 文件];

  const vf = chain.join(',');
  /**
   * 滤镜链按需往后接：素材 →〔credit 角标〕→〔叠加层〕。
   * **按现有输入数递推，不写死下标** —— 四种组合（有无角标 × 有无叠加层）都要能跑。
   *
   * 角标叠在 H-h-320（底边距底 320px）。
   * ⚠ 原先是 H-h-560，跟字幕**必然**打架：字幕 MarginV=520 是底边，多行往上长，
   *   3 行就顶到距底 730，而 560 那个位置在距底 620 —— 正好被压住。
   *   2026-09-09 实测：坑洞篇第 6 块 5 行字幕，第 4 行盖在角标上。
   * 320 是这么来的：要在字幕底边（距底 520）之下，又要在 Shorts 底部 UI（约 250px）之上。
   */
  const ins = [...inputs];
  const 段 = [`[0:v]${vf}[v0]`];
  let 尾 = 'v0', n = 1;
  /* 标注排在角标之前：标注是画面内容的一部分，角标是元信息，压在最上层 */
  const 标注 = [...(s.box ? [{ 型: 'box', ...s.box }] : []), ...(s.标注 ?? [])];
  if (标注.length) {
    ins.push('-framerate', String(FPS), '-i', 标注序列(s, 标注));
    段.push(`[${尾}][${n}:v]overlay=0:0[v${n}]`);
    尾 = `v${n}`; n++;
  }
  if (s.credit) {
    ins.push('-i', 角标(s));
    段.push(`[${尾}][${n}:v]overlay=W-w-60:H-h-320[v${n}]`);
    尾 = `v${n}`; n++;
  }
  if (s.punch || s.lower || s.outro) {
    ins.push('-framerate', String(FPS), '-i', 叠加序列(s));
    段.push(`[${尾}][${n}:v]overlay=0:0[v${n}]`);
    尾 = `v${n}`; n++;
  }
  const args = n > 1
    ? ['-y', ...ins, '-filter_complex', 段.join(';'), '-map', `[${尾}]`]
    : ['-y', ...ins, '-vf', vf];

  /* `-frames:v` 是硬闸：段长只能是时间表算出来的帧数。
     滤镜链再怎么出岔子（上面那个 zoompan 就是例子），也不会渲出一段几十分钟的东西 ——
     到数即停，不是渲完再截，所以顺带也是性能保险。 */
  sh('ffmpeg', [...args, '-an', '-frames:v', String(nfr(s)), ...分段编码, '-r', String(FPS), out]);
  return out;
}

/**
 * 标注序列（红笔痕迹）。跟叠加层一样：动画帧实渲、走完复制末帧。
 * 1 秒画完 ＝ 30 帧实渲，多条标注在这一秒里一条接一条扫出来。
 */
function 标注序列(s, 标注) {
  const dir = path.join(TMP, `m${pad(s.id)}`); 重建(dir);
  const n = nfr(s);
  const an = Math.min(n, FPS);
  for (let f = 0; f < an; f++)
    fs.writeFileSync(path.join(dir, `${pad(f)}.png`), png(buildMarks(标注, an <= 1 ? 1 : f / (an - 1))));
  const last = path.join(dir, `${pad(an - 1)}.png`);
  for (let f = an; f < n; f++) fs.copyFileSync(last, path.join(dir, `${pad(f)}.png`));
  return path.join(dir, '%05d.png');
}

/* ---- 叠加层：punch 强调字幕 ＋ lower 数据条，都不占层 ------------------ */
/**
 * 渲成一条 PNG 序列再 overlay，做法跟 A 层一样：**动画帧实渲，走完复制末帧**。
 * 0.6 秒扫开 ＝ 18 帧实渲，剩下的拷贝 —— 一块 3 秒的数据条只渲 18 张，不是 90 张。
 */
function 叠加序列(s) {
  const dir = path.join(TMP, `l${pad(s.id)}`); 重建(dir);
  const n = nfr(s);
  /* outro 的逐行淡入一直持续到块尾（末行落在 t≈0.96），所以**整块都要实渲**；
     punch / lower 是 0.6 秒扫开，18 帧就够，剩下拷贝末帧。 */
  const an = s.outro ? n : Math.min(n, Math.round(0.6 * FPS));
  for (let f = 0; f < an; f++)
    fs.writeFileSync(path.join(dir, `${pad(f)}.png`), png(buildOverlay({ punch: s.punch, lower: s.lower, outro: s.outro }, an <= 1 ? 1 : f / (an - 1))));
  const last = path.join(dir, `${pad(an - 1)}.png`);
  for (let f = an; f < n; f++) fs.copyFileSync(last, path.join(dir, `${pad(f)}.png`));
  return path.join(dir, '%05d.png');
}

function 编码序列(pattern, s) {
  const out = path.join(TMP, `seg${pad(s.id)}.mp4`);
  const vf = `scale=${W}:${H}:flags=lanczos,setsar=1`;
  const args = (s.punch || s.lower || s.outro)
    ? ['-y', '-framerate', String(FPS), '-i', pattern,
       '-framerate', String(FPS), '-i', 叠加序列(s),
       '-filter_complex', `[0:v]${vf}[base];[base][1:v]overlay=0:0[v]`, '-map', '[v]']
    : ['-y', '-framerate', String(FPS), '-i', pattern, '-vf', vf];
  sh('ffmpeg', [...args, '-an', '-frames:v', String(nfr(s)), ...分段编码, '-r', String(FPS), out]);
  return out;
}

/* ---- ASS 字幕（方案 §6.6：全大写，每屏 3–5 词，MarginV 520 避开 Shorts UI） -- */
function 写字幕(file) {
  const tc = (t) => {
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
  };
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Main,Archivo,74,&H00FFFFFF,&H00111111,&H00111111,-1,0,0,0,100,100,1,0,1,7,0,2,90,90,520,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
  const body = (cfg.captions || []).map((c) =>
    `Dialogue: 0,${tc(c.t0)},${tc(c.t1)},Main,,0,0,0,,${c.text.replace(/\n/g, '\\N')}`).join('\n');
  fs.writeFileSync(file, head + body + '\n');
}

/* ---- 主流程 ------------------------------------------------------------ */
if (CHECK) process.exit(报() ? 0 : 1);
if (!报()) { console.error('先把上面的问题解决掉。'); process.exit(1); }

ensure(TMP); ensure(工作);
const T = cfg.timeline;

for (const s of (ONLY ? T.filter((x) => x.id === ONLY) : T)) {
  console.log(`\n>> 第 ${s.id} 块  ${s.layer}  ${dur(s)}s`);
  if (s.layer === 'A') 层A(s);
  else if (s.layer === 'B') 层B(s);
  else 层素材(s);
}
if (ONLY) { console.log(`\n第 ${ONLY} 块已重建：${TMP}/seg${pad(ONLY)}.mp4`); process.exit(0); }

const list = path.join(TMP, 'concat.txt');
fs.writeFileSync(list, T.map((s) => `file '${q(path.join(TMP, `seg${pad(s.id)}.mp4`))}'`).join('\n') + '\n');
sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', path.join(TMP, 'video.mp4')]);

写字幕(path.join(TMP, 'subs.ass'));
const subPath = q(path.join(TMP, 'subs.ass')).replace(/:/g, '\\:');

const inputs = ['-i', path.join(TMP, 'video.mp4'), '-i', path.join(工作, cfg.audio)];
let afilter = '[1:a]anull[a]';
if (cfg.music?.file) {
  inputs.push('-stream_loop', '-1', '-i', 音乐路径(cfg, 根));
  const cut = cfg.music.cutAt ?? T[T.length - 1].end;
  /* 淡入 0.8s ＋ 淡出 0.8s。原来只有 0.4s 淡出、开头是硬切 ——
     音乐突然出现比没有音乐更显眼。这条链从没被跑过（三条片的 music 都是 null）。 */
  afilter = `[2:a]volume=${cfg.music.db}dB,atrim=0:${cut},afade=t=in:st=0:d=0.8,afade=t=out:st=${(cut - 0.8).toFixed(2)}:d=0.8[m];`
          + `[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`;
}

sh('ffmpeg', ['-y', ...inputs,
  '-filter_complex', `[0:v]subtitles='${subPath}'[v];${afilter}`,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  '-shortest', path.join(工作, `${cfg.slug}.mp4`)]);

console.log(`\n完成 -> ${工作}/${cfg.slug}.mp4`);
console.log('过一遍：人声到 -16 LUFS 了吗；字幕有没有压到底部安全区；DOC 层的纸底刺不刺眼。');
