/**
 * 石总 2D 口播 · 合片
 *
 * 三层叠起来：**背景静图（缓慢移镜）→ 人物 PNG 序列 → 字幕**，最后配上 vo.mp3。
 * 人物那一层是 `shoot.mjs` 出的带透明通道的帧，这儿只负责摞和烧字。
 *
 * 字幕两条频道规范（`src/lib/ass.ts` 的 `tidyCaption()`，四条线通用）：
 *   - 结尾不留标点
 *   - 句中的句号换成逗号
 *
 * ⚠ **字体必须喂文件**。ffmpeg 的 ass 滤镜靠 fontconfig 找字体，Windows 上按名字
 * 多半找不到 —— 找不到不报错，**自己换一个字体接着渲**，你只会觉得「字怎么不对」。
 * 所以这儿一律带 `fontsdir`。
 *
 * 用法：node shi-2d/build.mjs <项目目录> [成片名.mp4]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { POSE } from './pose.mjs';
import { 取色系, ass色 } from './色系.mjs';
import { 开场卡 } from './开场卡.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const DIR = process.argv[2];
// ⚠ 片名**别从命令行传**。Git Bash 传中文参数会静默改字（实际发生过：`老石_…` 落盘成
// `老石说_…`，而 build 自己打印出来的还是对的 —— 只有磁盘上是错的）。默认从目录名推：
//   projects/老石/20260905_AI智能体越狱  →  老石_AI智能体越狱.mp4
const OUT = (process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null)
  || `老石_${path.basename(DIR).replace(/^\d{8}_/, '')}.mp4`;
if (!DIR) { console.error('要给项目目录'); process.exit(1); }

/**
 * `--静帧 1.5,3.0` —— **不合片，只在这几个秒数上各出一张 PNG。**
 *
 * 加这个是因为 **build 是交付动作，不是调试手段**：改了字幕层或者叠加层，
 * 合一次 40 秒的片要等好几分钟，而要看的其实只有一帧。
 * ⚠ 它走的是**同一条 filter 链**，所以静帧上什么样成片上就什么样 ——
 * 另起一条预览路径是会骗人的（那正是「报成功的失败」最爱长的地方）。
 */
const 静帧 = (() => {
  const i = process.argv.indexOf('--静帧');
  if (i < 0) return null;
  const v = (process.argv[i + 1] || '').split(',').map(Number).filter((x) => x >= 0);
  if (!v.length) { console.error('--静帧 后面要给秒数，逗号分隔：--静帧 1.5,3.0'); process.exit(1); }
  return v.sort((a, b) => a - b);
})();

const REPO = process.cwd();
// 场景图在哪儿。一期一个来源，写在动作表的 `背景目录` 里；不写就是试片那批（赛博指挥中心）。
// **换目录不用改代码** —— 场景库是分批到位的，一期一期换过去
const BG_DIR_默认 = 'E:/ryu/石总/SVG/正面new/SVG/场景图';
// 相对路径：filter 参数里带盘符的冒号会被当成分隔符，转义在 Windows 上很难写对
const FONT_DIR = 'fonts/smiley-sans-v2.0.1';
const FONT = 'Smiley Sans Oblique';

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'vo/manifest.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(DIR, '动作表.json'), 'utf8'));
const segs = manifest.segments;
const BG_DIR = plan.背景目录 || BG_DIR_默认;

/**
 * ⚠ **有配音层却没用它跑配音，是会静默走偏的。**
 *
 * 配音层改的是「送给 TTS 的那份文本」（停顿、正音），改完不重跑 `tts-match.mjs`，
 * `vo/` 里还是上一版的音 —— 时长、时间轴、字幕全对得上，**片子合得出来、听着也没错**，
 * 只是那些停顿一个都没有。所以在这儿拦一道。
 */
const 配音层 = path.join(DIR, '配音.json');
if (fs.existsSync(配音层) && !manifest.配音层) {
  console.error('有 配音.json，但 vo/manifest.json 说这批配音不是按它跑的。');
  const 斜 = (x) => x.split('\\').join('/');
  console.error(`  重跑：node tts-match.mjs --file ${斜(path.join(DIR, '稿子.txt'))}` +
    ` --配音 ${斜(配音层)} --out ${斜(path.join(DIR, 'vo'))}`);
  process.exit(1);
}
// ⚠ **vo.mp3 是手工 concat 出来的，重跑 tts-match 不会自动更新它。**
// 不更新的话：时间轴按新的、声音是旧的，**片子照合、长度照对**，只有声画对不上 ——
// 这是这条链路上最贵的一种静默失效
{
  const mf = path.join(DIR, 'vo/manifest.json'), vo = path.join(DIR, 'vo.mp3');
  if (fs.existsSync(vo) && fs.statSync(vo).mtimeMs < fs.statSync(mf).mtimeMs) {
    const 斜 = (x) => x.split('\\').join('/');
    console.error('vo.mp3 比 vo/manifest.json 旧 —— 重跑过配音但没重新 concat。');
    console.error(`  cd ${斜(DIR)} && ffmpeg -y -f concat -safe 0 -i vo/list.txt -c copy vo.mp3`);
    process.exit(1);
  }
}
/**
 * **背景音乐**。动作表里写 `"音乐": "老石背景音4.mp3"`，目录默认 `E:/ryu/石总/背景音乐`。
 *
 * ⚠ **音量不写死 dB，写「比人声低几个 LU」。** 五首素材的响度差了 10 dB
 * （-10.5 到 -20.5 LUFS）—— 写死增益的话，换一首歌音乐就会突然大 10 dB，
 * **而这个错误在合片之前一步都不会报**。所以两个文件都现量 ebur128，增益是算出来的。
 *
 * ⚠ **不做 ducking（sidechaincompress）。** 这条片子是满口播、句间只有零点几秒空隙，
 * 压下去就再也没抬起来过，白搭一层复杂度。定电平就够。
 */
const 音乐目录 = plan.音乐目录 || 'E:/ryu/石总/背景音乐';
const 压低 = plan.音乐压低 ?? 18;      // 比人声低几个 LU
const 乐入 = 1.2, 乐出 = 1.5;
// ⚠ **两路进 amix 之前必须先统一格式。** 人声是 Edge 出的**单声道 24kHz**，
// 音乐是立体声 44.1k —— 不统一的话 amix 按第一路来，音乐被压成单声道 24k，
// 等于**砍到 12kHz 带宽**，听着发闷。这是加了音乐才暴露的：光有人声时 24k 单声道没问题
const 音格 = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';
// ⚠ **ebur128 的汇总写在 stderr 上，不在 stdout。** execFileSync 只拿得到 stdout，
// 拿回来是空的 —— 所以走 spawnSync 读 stderr
const 响度 = (f) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f,
    '-filter_complex', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /\bI:\s+(-?[\d.]+) LUFS/.exec(String(r.stderr).slice(-2000));
  if (!m) throw new Error(`量不出响度：${f}`);
  return +m[1];
};

const 替身 = JSON.parse(fs.readFileSync(new URL('./素材库/替身.json', import.meta.url), 'utf8'));

/* ---------- 字幕 ---------- */

/**
 * 字幕规格 —— **频道方案 §1.3**（2026-09-05 裁决，取代了原来的「逐字敲出」）。
 *
 * | | 原来 | 现在（§1.3） |
 * |---|---|---|
 * | 出字 | 一个字一个字敲（按响度累积） | **整句出现** |
 * | 字号 | 66 | **72**（§1.3 给的是 68–76） |
 * | 描边 | 单层 5px | **双层**：外层粗黑 10px，内层白字带 3px 黑边 |
 * | 位置 | MarginV 235（带占 y235~390） | **MarginV 300**（带占 y300~560） |
 * | 关键数字 | 没有 | 标黄或标红，**一条最多三处**（动作表里写 `标`） |
 *
 * 逐字那套删掉了，不是因为它不好使（它按响度走、停顿处字自然停住，做得挺准），
 * 是 §1.3 的判断：**逐字打字机会拖慢阅读，短视频里是减分项**。
 * 做法留个记录：一个字发一条 Dialogue，后面的字用 `\alpha&HFF&` 变透明占位。
 *
 * ⚠ **字幕位置和人物机位是绑死的，动一个必须回去核另一个。**
 * 带底从 390 挪到 560 之后，原来的构图（全身头顶 419、半身 492）会被字幕压脸，
 * 所以人物同时按 §1.1 下移：全身 y600~1560、半身头顶不高于 600。
 * 那两个数在 `shoot.mjs` 的 `CANVAS` 和 `素材库/姿势.json` 的 `_机位` 里。
 */
const CAP = {
  字号: 72,      // §1.3：主台词 68–76
  每行: 13,      // 可用宽 1080−60−60=960，72px 的汉字放得下 13 个（13×72=936）
  最多行: 3,     // §1.1：标准版字幕区最多三行。72px 三行 ≈ 260px，正好是 300→560
  带顶: 300,     // §1.2：y<260 是平台标题栏和关注按钮，任何内容不进
  外描边: 10,    // 双层描边的外层（纯黑，压在底下）
  内描边: 3,
  // ⚠ ASS 的颜色是 **&HBBGGRR&**，不是 RGB —— 写反了不报错，只是颜色不对。
  // 所以别手写，一律走 `色系.mjs` 的 ass色()。红 #C4452F → BB=2F GG=45 RR=C4
  标色: { 红: '&H2F45C4&' },
  最多标: 3,     // §1.3：一条里最多标三处
};

/** 抄自 src/lib/ass.ts。改规则记得两边一起改 */
const tidyCaption = (s) =>
  s.trim().replace(/[。，、；：！？…·—.,;:!?]+$/u, '').trim()
    .replace(/。(?=[\s\S]*[^\s。])/gu, '，');

/**
 * 按字数折行。中文按字宽算就够了，不用真去量。
 * ⚠ **不能从西文词中间断开** —— 第一版把「OpenAI」断成了「OpenA / I」。
 * 汉字哪儿都能断，字母数字连成的一串必须整块走。
 *
 * 折成**尽量均匀的几行**（不是「填满一行再换」）：一行满一行秃在竖屏上很难看，
 * 而且下面那条 3 行的闸是按行数拦的，均匀折能少占一行。
 */
function wrap(text, per = CAP.每行) {
  const cs = [...text];
  // ⚠ **按显示宽度算，不按字数。** 西文和空格只有汉字的一半多一点，
  // 按字数算的话「OpenAI 智能体」那种句子会被判成超宽、白白多折一行。
  const 宽 = (c) => (/[\x20-\x7e]/.test(c) ? 0.55 : 1);
  const 累宽 = [0];
  for (const c of cs) 累宽.push(累宽[累宽.length - 1] + 宽(c));
  const 总宽 = 累宽[cs.length];
  const 行数 = Math.max(1, Math.ceil(总宽 / per - 1e-9));
  if (行数 === 1) return [text];

  const latin = (c) => /[A-Za-z0-9]/.test(c);
  // 数词后面多半跟着量词，「发生了一／件震惊全球的」这种劈法最难看；
  // 标点也不能落到行首。两条都是**不报错、只是难看**的那类，所以写成判据挡在这儿
  const 数词 = /[一二三四五六七八九十百千万亿零两几半]/;
  // 同一类的还有**前缀**：「第」后面永远跟着数，「全／整」后面跟着量或名。
  // 2026-09-06 排 01-A 时折出了「是从看到第／一套那一刻」和「让他先发全／部房源清单」，
  // 跟数词那条是同一个毛病。⚠ 「全」也会出现在词尾（安全／周全），
  // 挡在那儿只是让断点往旁边挪 4 个字以内，代价比劈开词小得多
  const 前缀 = /[第全整]/;
  // 行首禁：标点（不能出现在行首）＋ 虚词和补语。
  // 后一半是实测加的 —— 第一版折出了「它们不仅自主入侵／了开源平台」和「它们甚至学／会了」，
  // 两处都不报错、只是难看。**没有词典就只能拦这一层**，拦不住的靠人眼
  const 行首禁 = /[，。、；：！？…—·%）」』】\)\]了着过的地得们吗呢吧么会到出完住]/;
  const 可断 = (i) => i > 1 && i < cs.length - 1
    && !(latin(cs[i - 1]) && latin(cs[i]))     // 不能从西文词中间断开
    && !数词.test(cs[i - 1])
    && !前缀.test(cs[i - 1])
    && !行首禁.test(cs[i]);

  const out = [];
  let from = 0;
  for (let k = 1; k < 行数; k++) {
    const 目标宽 = (总宽 * k) / 行数;
    // 离目标宽最近的位置，再往两边找：先找标点后的断点，再找一般的可断点
    let 近 = 1;
    for (let i = 1; i < cs.length; i++) if (Math.abs(累宽[i] - 目标宽) < Math.abs(累宽[近] - 目标宽)) 近 = i;
    let cut = -1;
    for (let d = 0; d <= 4 && cut < 0; d++)
      for (const i of [近 + d, 近 - d])
        if (i > from && 可断(i) && /[，、：；。！？]/.test(cs[i - 1])) { cut = i; break; }
    for (let d = 0; d <= 6 && cut < 0; d++)
      for (const i of [近 + d, 近 - d]) if (i > from && 可断(i)) { cut = i; break; }
    if (cut < 0) cut = Math.max(from + 1, 近);
    out.push(cs.slice(from, cut).join('').trim());
    from = cut;
  }
  out.push(cs.slice(from).join('').trim());
  return out;
}

/** ASS 里这几个字符有语法含义，原样写进去会把整条 Dialogue 弄坏 */
const assEsc = (s) => s.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}');

/**
 * 整句一次出现（§1.3）。返回上下两层的文本：
 *   底层  纯黑、粗描边，只管把字从背景里托出来
 *   面层  白字（`标` 点到的那几处换成黄或红）
 *
 * **两层的字号、字距、折行必须一模一样**，差一点就会看见黑影错位。
 * 所以两层共用同一份折行结果，只在颜色和描边上分。
 */
function 整句(seg, 标, 标色) {
  const 行 = wrap(tidyCaption(seg.text));
  if (行.length > CAP.最多行) {
    console.error(`第 ${seg.index} 句折成了 ${行.length} 行，字幕区最多 ${CAP.最多行} 行：${seg.text}`);
    console.error(`  单句字数上限是 26（频道方案 §3.2），这句 ${[...seg.text].length} 字 —— 拆句子，别改字号`);
    process.exit(1);
  }
  const 素 = 行.map(assEsc).join('\\N');
  let 彩 = 素;
  for (const 词 of 标) {
    const t = assEsc(词);
    // 折行可能正好把要标的词劈开 —— 劈开了就标不上，得说出来
    if (!彩.includes(t)) {
      console.error(`第 ${seg.index} 句要标「${词}」，但它被折行劈开了：${行.join(' / ')}`);
      process.exit(1);
    }
    彩 = 彩.replace(t, `{\\1c${标色}}${t}{\\1c&HFFFFFF&}`);
  }
  return { 底: 素, 面: 彩 };
}

const cs = (t) => {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};


/**
 * 要标的词写在动作表的逐句里：`"标": ["125%"]`，整条片子最多三处（§1.3）。
 *
 * **标色默认跟着当期的话题类型走**（`"类型"`，见 `色系.mjs`）——
 * ⚠ 封面承诺一个重音色、片子里的数字标另一个色，是个比穿两件衬衫还明显的穿帮，
 * 因为观众是**点进来的三秒内**做的对照。所以这里不给独立的默认值。
 *
 * `"标色"` 只在要**故意**跟封面不一样时写，现在只认「红」（危机那一档的老写法）。
 */
const 系 = 取色系(plan.类型);
const 标色 = plan.标色 ? CAP.标色[plan.标色] : ass色(系.重);
if (!标色) {
  console.error(`标色写的是「${plan.标色}」—— 只认「红」，或者干脆别写，跟着类型走`);
  process.exit(1);
}
/**
 * 双层描边：**同一句发两条 Dialogue**，底层（Layer 0）纯黑粗边、面层（Layer 1）白字细边。
 * 单条 Dialogue 也能有描边，但只有一层，压在花背景上还是发虚 —— 尤其是实拍空镜进来以后。
 *
 * ⚠ 两层的样式除了颜色和描边宽度**必须完全一样**（字号、字距、边距、Alignment、MarginV），
 * 差一个数就会看见黑影错位半个字。所以两个 Style 是同一串参数抄两遍，只改三个位置。
 *
 * ⚠ 字重：这套字体（Smiley Sans）**只有一个字重**，Bold 那位给 1 是 libass 自己合成的假粗。
 * 合成得出来就用，出不来就是不粗 —— **不报错**。所以粗细主要靠那 10px 外描边扛。
 */
/**
 * **开场卡**：句1 那几秒，封面那两行字弹进画面，**替掉句1 的字幕**（不是叠上去）。
 * 为什么必须是「替」不是「叠」，见 `开场卡.mjs` 开头 —— 一句话：句1 的字幕说的就是
 * 封面那句话，叠上去等于同一句写两遍；而且开场的画面事件已经被「人走进来」用掉了。
 *
 * 文案**从 `封面.json` 读，不在动作表里再写一遍** —— 同源才不会飘，
 * 封面那个 9 字闸也就自动管到这儿了。
 * 要关掉在动作表里写 `"开场卡": false`（默认开，这是这条线的片头）。
 */
const 封面文件 = path.join(DIR, '封面.json');
const 封面 = fs.existsSync(封面文件) ? JSON.parse(fs.readFileSync(封面文件, 'utf8')) : null;
const 卡 = (plan.开场卡 === false || !封面)
  ? null : 开场卡(segs[0], 封面, 系, { FONT, ass色 });
if (卡 && plan.逐句[0]?.标?.length) {
  console.error('句1 有「标」，但开场卡会把句1 的字幕整条替掉 —— 那个词就没了。');
  console.error('  要么把标挪到别的句，要么这一期写 "开场卡": false');
  process.exit(1);
}

/**
 * **信息词标色的三道闸**（2026-09-06 定）。
 *
 * ⚠ **背景变了：不会有本人录音了，后续走克隆音。** 克隆音同样是 TTS，
 * **一样没有重音控制** —— 所以「等真人录音到位，眼睛和耳朵一起重」这条路是**永久断的**。
 * 结论：**颜色是这条线唯一的、也是永远唯一的强调通道**。正因为只有这一个，
 * 它只能给「观众会截图带走的东西」，不能给语气。
 *
 * 标什么，判据是**数／名／令**三类（写稿时的口径见 `老石出片方案.md` §五）：
 *   数  数字（3 套、125%、第 1 套）
 *   名  这一期给一个东西起的名字（定锚）
 *   令  观众能照着做的那一句（顺序你定）
 * 语气词（一定／根本／才／就／专门）**一律不标** —— 声音是平的，标了就是让字幕替声音撒谎。
 *
 * 三道闸：
 *   ① 总数（**开场卡算一处** —— 它就是一块类型色的字，观众不会因为它长在别处就少看一眼）
 *   ② 一句最多一处（§1.3「一屏最多一个 accent」照字面执行）
 *   ③ 相邻两句不能都标 —— 跟「生气不能相邻」同一个道理，连着说两次「看这儿」两次都废
 */
const 标句 = plan.逐句.filter((x) => x.标?.length).map((x) => x.句);
const 标数 = plan.逐句.reduce((a, x) => a + (x.标?.length || 0), 0) + (卡 ? 1 : 0);
if (标数 > CAP.最多标) {
  console.error(`一条片子最多标 ${CAP.最多标} 处（频道方案 §1.3），这条 ${标数} 处` +
    (卡 ? '（含开场卡那一处）' : '') + '。');
  console.error('  标多了等于没标 —— 只留「数／名／令」那几个，语气词不算');
  process.exit(1);
}
for (const x of plan.逐句) {
  if ((x.标?.length || 0) > 1) {
    console.error(`第 ${x.句} 句标了 ${x.标.length} 处：${x.标.join(' / ')}`);
    console.error('  一句最多一处 —— 一屏两个重点等于没有重点（§1.3）');
    process.exit(1);
  }
}
for (let i = 1; i < 标句.length; i++) {
  if (标句[i] - 标句[i - 1] === 1) {
    console.error(`第 ${标句[i - 1]} 句和第 ${标句[i]} 句连着标 —— 相邻两句不能都标。`);
    console.error('  连着说两次「看这儿」，两次都废。挑落点那一句留着，另一句撤了');
    process.exit(1);
  }
}
if (标数) console.log(`标色　${标数} 处${卡 ? '（开场卡 1 ＋ 字幕 ' + (标数 - 1) + '）' : ''}　句 ${标句.join('/')}`);

const 样式 = (名, 主色, 描边, 阴影) =>
  `Style: ${名},${FONT},${CAP.字号},${主色},${主色},&H00000000,&H00000000,1,0,0,0,100,100,1,0,1,${描边},${阴影},8,60,60,${CAP.带顶},1`;

const ass =
  `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${样式('subEdge', '&H00000000', CAP.外描边, 2)}
${样式('sub', '&H00FFFFFF', CAP.内描边, 0)}${卡 ? '\n' + 卡.样式 : ''}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
` +
  segs.map((s, i) => {
    // ⚠ 句1 的字幕**整条不出** —— 开场卡替了它。一换一，画面事件数才不增
    if (卡 && i === 0) return null;
    const { 底, 面 } = 整句(s, plan.逐句[i]?.标 || [], 标色);
    return `Dialogue: 0,${cs(s.start)},${cs(s.end)},subEdge,,0,0,0,,${底}\n`
      + `Dialogue: 1,${cs(s.start)},${cs(s.end)},sub,,0,0,0,,${面}`;
  }).filter(Boolean).concat(卡 ? 卡.事件 : []).join('\n') + '\n';

const assPath = path.join(DIR, '字幕.ass');
fs.writeFileSync(assPath, ass, 'utf8');

/* ---------- 背景分段 ---------- */

/**
 * 转场时长。**硬切写 0.05 秒**（一帧半，肉眼就是硬切）——
 * 这样所有切点走同一条 `xfade` 代码路径，不用为「有的硬切有的叠化」分两套。
 */
const 转场表 = {
  硬切: { 秒: 0.05, 式: 'fade' },
  叠化: { 秒: 0.70, 式: 'fade' },
  滑移: { 秒: 0.28, 式: 'slideleft' },
  滑移右: { 秒: 0.28, 式: 'slideright' },
};

const bgs = plan.背景.map((b, i) => {
  const start = i === 0 ? 0 : segs[plan.背景[i - 1].到句 - 1].end;
  const end = segs[b.到句 - 1].end;
  const tr = 转场表[b.转场 || '硬切'] || 转场表.硬切;
  return {
    file: path.join(BG_DIR, b.图),
    dur: +(end - start).toFixed(3),
    运镜: b.运镜 || '静',
    转场: i === 0 ? null : tr,        // 第一段没有「切入」，开头用淡入
  };
});

/* ---------- 拼 ---------- */

const framesDir = path.join(DIR, 'frames');
const n = fs.readdirSync(framesDir).filter((f) => /^f\d+\.png$/.test(f)).length;
if (!n) { console.error('没有帧，先跑 shoot.mjs'); process.exit(1); }

const args = ['-y', '-loglevel', 'error', '-stats'];
// xfade 会把两段**叠掉** duration 秒，所以每段的输入时长要额外加上它「切出去」那次转场的长度，
// 不然总长会短一截、跟配音对不上
bgs.forEach((b, i) => {
  const 叠 = bgs[i + 1]?.转场?.秒 || 0;
  b.输入时长 = +(b.dur + 叠).toFixed(3);
  args.push('-loop', '1', '-t', String(b.输入时长), '-framerate', '30', '-i', b.file);
});
args.push('-framerate', '30', '-i', path.join(framesDir, 'f%05d.png'));
args.push('-i', path.join(DIR, 'vo.mp3'));

/**
 * 背景的处理。**人物是纯色平涂的矢量图，背景是照片级的 3D 渲染** ——
 * 两者放一起，背景那些高对比的霓虹环会比人物还抢眼，所以要把它推到人物后面去。
 *
 * ⚠ **推的手段从「虚化」换成了「上下留暗底」**（2026-09-06 舞台模式定版）。
 * 背景只占 240–1560 那一带，上下是中性暗底 —— 这条带本身就在说「那是另一个平面」，
 * 再糊一道只是把场景的信息糊没了。**虚化归零，压暗和降饱和留着。**
 * 移轴那套（上下糊中间清）和整块均匀糊都试过，见 README 坑 7。
 */
/**
 * **舞台演讲模式**（2026-09-06 定）。人物站在一块自己画的发光台上，
 * 脚本里的场景变成他身后那块巨幕的内容 —— 而不是他走进去的地方。
 *
 * 这么改是为了根治「人悬在半空」：他站的台子是我们画的，位置我们定，
 * **跟背景那张画的地面透视再也没关系**。顺带解决三件事：
 *   俯拍的场景（街景那张）能用了 —— 它是幕上的内容，不是他站的地方
 *   数据板不用另起一层 —— 就是幕上的一块内容
 *   换场景读成「换幕」，比人瞬移到另一个地方自然
 *
 * 叠序：**暗底 → 场景（只占幕带 240–1560）→ 舞台（只在全身镜头上）→ 人物 → 字幕**。
 */
const 舞台 = {
  幕带: { 上: 240, 下: 1560 },
  _幕带: "背景只占这一带，上下留暗底。**浮的其实是台子** —— 台子压在背景自己的地面上（办公室地毯／马路），两个地面透视打架，眼睛就判定是贴上去的。把背景那条地面从画面里拿掉，台子就落在中性的暗底上，没有东西跟它打架了",
  台: { cx: 540, cy: 1745, rx: 430, ry: 95, 厚: 28 },
  灯: '#6ec6ff',
  _台: '脚底落在成片 1751（shoot.mjs 的 CANVAS.feetY + 380）。台顶 = cy - ry = 1650，脚在台面往下 53% 处 —— 第一版把台压到 1796，脚正好落在后沿上，看着像站在圈后面',
};
// ⚠ 巨幕上的场景是**均匀虚化**，不是原来那套「上下糊中间清」——
// 幕是一块平的屏、整块离得一样远，移轴那种糊法在这儿反而假
// ⚠ **虚化去掉了**（2026-09-06）。背景收进上下边框里之后，它已经跟人物分开了 ——
// 边框本身就是「这是另一个平面」的信号，再糊一道只是把场景的信息糊没了。
// 压暗和降饱和留着：人物是纯色平涂，背景不压还是会抢。
const BG = { 虚化: 0, 压暗: -0.16, 饱和: 0.88 };

/**
 * 演播室底（`_暗底.png`），垫在最底下。场景那一带盖在它上面，**上下露出来的就是暗底**。
 *
 * 它只干两件事：一层近黑的竖向渐变，加**台子脚下那圈淡反光**（把暗底和台子连起来，
 * 不然台子自己也是浮的）。
 *
 * ⚠ **幕框那张撤了**（2026-09-06）：内暗角 ＋ 细边框 ＋ 屏边光那一套试过，
 * 竖屏本来就窄，四周再收一圈画面剩不下多少，边框还抢注意力。**上下暗底就够了。**
 * ⚠ resvg 的滤镜支持不全，这里的光晕一律靠**渐变或同心描边叠**，不要用 feGaussianBlur。
 */
function 写演播室(file) {
  const { 上, 下 } = 舞台.幕带;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs>` +
    `<linearGradient id="r" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#05060a"/><stop offset="0.5" stop-color="#0d1117"/>` +
    `<stop offset="1" stop-color="#040508"/></linearGradient>` +
    // 台子脚下那圈地面的淡反光，把暗底和台子连起来 —— 不然台子也是浮的
    `<radialGradient id="fl" cx="50%" cy="100%" r="62%">` +
    `<stop offset="0" stop-color="${舞台.灯}" stop-opacity="0.09"/>` +
    `<stop offset="1" stop-color="${舞台.灯}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="1080" height="1920" fill="url(#r)"/>` +
    `<ellipse cx="540" cy="1900" rx="720" ry="300" fill="url(#fl)"/></svg>`;
  fs.writeFileSync(file, new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
  return file;
}

// ⚠ **上下那两条发光边线撤了**（2026-09-06）。画过一版「那是屏的上下边」的细线，
// 读出来还是「画面被裁了」—— 暗底和场景之间的明度差本身就够当边界了，不用再描一道。
// 想找那段代码的话在 git 历史里，别凭印象重写一遍。

function 写舞台(file) {
  const { cx, cy, rx, ry, 厚 } = 舞台.台;
  let g = '';
  for (const [k, wd, op] of [[1.10, 26, 0.06], [1.06, 18, 0.10], [1.03, 10, 0.18]]) {
    g += `<ellipse cx="${cx}" cy="${cy}" rx="${(rx * k).toFixed(1)}" ry="${(ry * k).toFixed(1)}" ` +
      `fill="none" stroke="${舞台.灯}" stroke-width="${wd}" opacity="${op}"/>`;
  }
  // 台子自己也要"踩"在地上 —— 底下一圈更大更淡的暗影。没有它，台子就是浮的那个
  const 影 = `<radialGradient id="sh" cx="50%" cy="50%" r="50%">` +
    `<stop offset="0.35" stop-color="#000" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><defs>${影}` +
    `<radialGradient id="t" cx="50%" cy="55%" r="72%">` +
    `<stop offset="0" stop-color="#4a5460"/><stop offset="0.6" stop-color="#2b323c"/>` +
    `<stop offset="1" stop-color="#151920"/></radialGradient>` +
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#1c212a"/><stop offset="1" stop-color="#0a0c10"/></linearGradient>` +
    `</defs>` +
    `<ellipse cx="${cx}" cy="${cy + 厚 + 10}" rx="${(rx * 1.28).toFixed(0)}" ry="${(ry * 1.18).toFixed(0)}" fill="url(#sh)"/>` + g +
    `<path d="M${cx - rx},${cy} a${rx},${ry} 0 0 0 ${2 * rx},0 l0,${厚} ` +
    `a${rx},${ry} 0 0 1 -${2 * rx},0 z" fill="url(#s)"/>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#t)"/>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" ` +
    `stroke="#9adcff" stroke-width="3" opacity="0.85"/></svg>`;
  fs.writeFileSync(file, new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng());
  return file;
}

// 遮罩要等 BG 定义完才能生成（写遮罩 里用到它），所以这一路输入放在这儿加
args.push('-loop', '1', '-i', 写演播室(path.join(DIR, '_暗底.png')));
args.push('-loop', '1', '-i', 写舞台(path.join(DIR, '_舞台.png')));
// ⚠ 音乐比片子短就接不满，所以一律 -stream_loop -1，长度靠 -shortest 收
const 音乐文件 = plan.音乐 ? path.join(音乐目录, plan.音乐) : null;
if (音乐文件) {
  if (!fs.existsSync(音乐文件)) { console.error('找不到背景音乐：' + 音乐文件); process.exit(1); }
  args.push('-stream_loop', '-1', '-i', 音乐文件);
}

/**
 * 一段背景的处理链。两种走法：
 *
 *   静  放大到 SRCPX 再裁 1080×1920，**裁窗慢慢飘** —— 静图不飘会像卡住
 *   推/拉  先裁一个比成片大 15% 的窗（1242×2208），再用 zoompan 在里面推拉。
 *        先裁到成片的长宽比再 zoompan，**不能直接 zoompan 方图** —— 那样窗口是方的、
 *        塞进竖屏会拉变形。z=1 时窗口 1242×2208 缩到 1080×1920（还是锐的），
 *        z=1.15 时正好 1:1，全程不会糊
 *
 * **「希区柯克变焦」就是背景推、人物不推。** 这条管线人物和背景本来就是两层，
 * 所以它反而是最容易做的一个 —— 不用额外写什么，动作表里背景写「推」、那几句人物不给推镜就是了。
 */
// 底图放大到这个尺寸再裁。**必须大于推拉窗口 1242×2208**，不然 crop 会报「size too big」
const SRCPX = 2400;
const 推幅 = 0.15;
function bgSeg(b, i) {
  const 帧 = Math.max(2, Math.round(b.输入时长 * 30));
  const H带 = 舞台.幕带.下 - 舞台.幕带.上;
  // ⚠ **不能直接 `scale=SRCPX:SRCPX`** —— 那是硬拉成正方。试片那四张本来就是 1024×1024
  // 所以没露馅，2026-09-06 接进一张 1376×768 的城市街景，整条街被竖着抻了 2.4 倍。
  // 现在是**按短边铺满再中心裁方**，方图走这条路一模一样、宽图才对
  const pre = `[${i}:v]scale=${SRCPX}:${SRCPX}:force_original_aspect_ratio=increase,` +
    `crop=${SRCPX}:${SRCPX},setsar=1,`;
  // 背景整块**均匀虚化**（舞台模式起）。原来是「上下糊中间清」的移轴糊法 ——
  // 那是为了「人站在这个地方」；现在人站自己的台子上、背景退成远处一块屏，整块该一样糊
  const post = (BG.虚化 ? `gblur=sigma=${BG.虚化},` : '') +
    `eq=brightness=${BG.压暗}:saturation=${BG.饱和}[b${i}]`;
  const 窗w = Math.round(1080 * (1 + 推幅)), 窗h = Math.round(H带 * (1 + 推幅));
  if (b.运镜 === '推' || b.运镜 === '拉') {
    const z = b.运镜 === '推'
      ? `1+${推幅}*on/${帧 - 1}`
      : `${1 + 推幅}-${推幅}*on/${帧 - 1}`;
    return pre +
      `crop=${窗w}:${窗h}:${Math.round((SRCPX - 窗w) / 2)}:${Math.round((SRCPX - 窗h) / 2)},` +
      `zoompan=z='${z}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x${H带}:fps=30,` +
      post;
  }
  // 静：裁窗慢慢飘 —— 一张静图钉死会像贴纸
  return pre +
    `crop=1080:${H带}:'${Math.round((SRCPX - 1080) / 2)}+30*sin(t*0.15+${i})':` +
    `'${Math.round((SRCPX - H带) / 2)}+20*sin(t*0.11+${i})',` +
    post;
}
const bgChain = bgs.map(bgSeg).join(';');

// 段与段之间用 xfade 接。**硬切也走 xfade**（0.05 秒），一条代码路径省事
let cur = '[b0]', xf = '';
let 累计 = bgs[0].输入时长;
for (let i = 1; i < bgs.length; i++) {
  const t = bgs[i].转场;
  const off = +(累计 - t.秒).toFixed(3);
  const out = i === bgs.length - 1 ? '[bgc]' : `[x${i}]`;
  xf += `${cur}[b${i}]xfade=transition=${t.式}:duration=${t.秒}:offset=${off}${out};`;
  累计 = +(累计 + bgs[i].输入时长 - t.秒).toFixed(3);
  cur = out;
}
if (bgs.length === 1) xf = '[b0]null[bgc];';


/**
 * **切近景那几句，舞台要藏起来。**
 *
 * 半身镜头（`说话姿势3`／`思考姿势`／坐姿那几张）只取到腰以上 —— 脚根本不在画面里，
 * 台子还留在下面就成了一块无主的发光板。所以按句开关：**全身的句子才画台**。
 *
 * 做法是 overlay 的 `enable` 表达式：把「要画台」的那几段时间 OR 起来
 * （`between` 返回 0/1，加起来 >0 就是真）。整段都是半身的话给一个空表达式 `0`。
 */
const 半身 = new Set(['半身', '半身坐']);
function 台可见区间() {
  const 出 = [];
  plan.逐句.forEach((x, i) => {
    let 名 = x.动作;
    if (!POSE[名] && 替身[名]?.用) 名 = 替身[名].用;
    // 骨架动作（走／站定／示意）不在姿势库里 —— 那些都是全身
    const 近 = 半身.has(POSE[名]?.机位);
    if (近) return;
    const s = segs[i];
    const 上 = 出[出.length - 1];
    if (上 && Math.abs(上[1] - s.start) < 1e-6) 上[1] = s.end;   // 连着的合成一段
    else 出.push([s.start, s.end]);
  });
  return 出;
}
const 台段 = 台可见区间();
const 台可见 = 台段.length
  ? 台段.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+')
  : '0';
if (台段.length !== 1 || 台段[0][0] > 0.001 || 台段[0][1] < segs[segs.length - 1].end - 0.001) {
  console.log(`舞台　${台段.length} 段：${台段.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}s`).join('　')}` +
    `（切近景那几句藏起来）`);
}

const i暗底 = bgs.length + 2, i舞台 = i暗底 + 1, i音乐 = i舞台 + 1;
const 总长 = segs[segs.length - 1].end;
const 淡 = 0.7;
// 叠序：**暗底 → 背景带（y240–1560）→ 舞台 → 人物 → 字幕**
// ⚠ 边框线（那两条幽蓝细线）撤了 —— 暗底和背景本来就分得开，加一条线反而像个 UI 控件
// ⚠ 试过把背景收进一块「巨幕」里（带边框、四周留黑），撤了 —— 竖屏本来就窄，
// 再往里收一圈，画面剩不下多少，而且边框把注意力抢过去了。**背景照旧顶边**，
// 舞台单独一层压在它上面，人站在舞台上 —— 悬空是靠舞台解决的，不是靠边框
const filter =
  `${bgChain};${xf}` +
  `[${i暗底}:v][bgc]overlay=0:${舞台.幕带.上}[band];` +
  `[band][${i舞台}:v]overlay=0:0:enable='${台可见}'[stg];` +
  `[${bgs.length}:v]setsar=1[man];` +
  `[stg][man]overlay=0:380:format=auto:shortest=1[v0];` +
  `[v0]ass=${assPath.replace(/\\/g, '/')}:fontsdir=${FONT_DIR},` +
  // 开头淡入、结尾淡出。**字幕烧完再淡** —— 先淡后烧的话字幕不会跟着淡
  `fade=t=in:st=0:d=${淡},fade=t=out:st=${(总长 - 淡).toFixed(2)}:d=${淡}[v]`;
// ⚠ **filter_complex 里带标签的输出必须全部 -map 出去**，剩一个没接的就整条报错退出。
// 所以声音那一段单独拼 —— 出静帧的时候不要它
let 声 = `;[${bgs.length + 1}:a]afade=t=out:st=${(总长 - 淡).toFixed(2)}:d=${淡}[a]`;
if (音乐文件) {
  // 增益是**算出来的不是拍出来的**：两个文件现量 ebur128，让音乐落在人声下面 `压低` 个 LU
  const 人 = 响度(path.join(DIR, 'vo.mp3')), 乐 = 响度(音乐文件);
  const 增益 = +(人 - 压低 - 乐).toFixed(1);
  console.log(`音乐 ${plan.音乐}　人声 ${人} LUFS　音乐 ${乐} LUFS　→ 压 ${增益} dB（落到 ${(乐 + 增益).toFixed(1)} LUFS，比人声低 ${压低} LU）`);
  声 = `;[${bgs.length + 1}:a]afade=t=out:st=${(总长 - 淡).toFixed(2)}:d=${淡},${音格}[vo]` +
    `;[${i音乐}:a]volume=${增益}dB,afade=t=in:st=0:d=${乐入},` +
    `afade=t=out:st=${(总长 - 乐出).toFixed(2)}:d=${乐出},${音格}[bgm]` +
    // ⚠ **amix 的 normalize 必须给 0**。默认是 1，会把每一路都除以路数 ——
    // 人声凭空低 6dB，**不报错**，只是听着闷
    `;[vo][bgm]amix=inputs=2:duration=first:normalize=0[a]`;
}

if (静帧) {
  // **同一条 filter 链**，只是末尾挑几帧出来。挑帧用 select 而不是 -ss ——
  // -ss 会跳过前面的解码，而 xfade / zoompan 的输出依赖从 0 开始连续走
  const 挑 = 静帧.map((t) => `between(t,${t.toFixed(3)},${(t + 0.034).toFixed(3)})`).join('+');
  const 出目录 = path.join(DIR, '静帧');
  fs.mkdirSync(出目录, { recursive: true });
  args.push(
    '-filter_complex', `${filter};[v]select='${挑}'[vs]`,   // 不接 `声`
    '-map', '[vs]', '-vsync', '0',
    '-t', (静帧[静帧.length - 1] + 0.2).toFixed(2),
    '-frames:v', String(静帧.length),
    path.join(出目录, '%02d.png'),
  );
  console.log(`静帧 ${静帧.map((t) => t.toFixed(2) + 's').join(' / ')}　→ ${出目录}`);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });
  静帧.forEach((t, i) => {
    const f = path.join(出目录, `${String(i + 1).padStart(2, '0')}.png`);
    if (fs.existsSync(f)) console.log(`  ${t.toFixed(2)}s　${f}`);
  });
  process.exit(0);
}

args.push(
  '-filter_complex', filter + 声,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
  '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '4.1',
  '-c:a', 'aac', '-b:a', '192k',
  ...(音乐文件 ? ['-ar', '48000', '-ac', '2'] : []),
  '-shortest', '-movflags', '+faststart',
  path.join(DIR, OUT),
);

console.log(`${n} 帧　背景 ${bgs.map((b) => b.dur + 's').join(' / ')}`);
execFileSync('ffmpeg', args, { stdio: 'inherit' });

const f = path.join(DIR, OUT);
const dur = execFileSync('ffprobe',
  ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
console.log(`\n${f}　${(fs.statSync(f).size / 1048576).toFixed(1)} MB　${(+dur).toFixed(2)}s`);
