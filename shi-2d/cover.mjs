/**
 * 老石 · 竖版封面（商务 / 时事新闻档）
 *
 * **标志动作 ＋ 醒目标题。** 人物用 `代表性站姿`（美术自己起的名字，就是这张的定位：
 * 双手插兜、双腿交叉，最像「这个人平时什么样」）。
 *
 *   node shi-2d/cover.mjs <项目目录>
 *
 * 读 `<项目目录>/封面.json`：
 *   { "角标": "中介不说的事", "主标": ["第1套", "不是最好的"],
 *     "重点行": 1, "副标": "顺序是话术不是巧合", "姿势": "代表性站姿" }
 *
 * ⚠ **`主标` 是「一行里的几段」，不是「几行」。** 数组会拼成横排的第一行，
 * `重点行` 指的是**哪一段标黄**。见下面「两行制」。
 *
 * ⚠ **这条线跟「醒木不响」没有关系。** 那是说书／治愈／心理洞察那几条线的频道，
 * 老石是独立的商务／时事新闻线 —— 页脚、角标、水印里都不要出现醒木不响的字眼，
 * 也不要用那边的印章「醒」。

 * ## 为什么不用 `YouTube封面规范.md` 那套
 *
 * 那份规范的 `ink` / `night` 两档是给**说书、治愈、禅佛典**用的：墨底、宋体、朱砂印章，
 * 走的是文气和幽微。**老石是商务／时事新闻档，那套一上身就阴森了**（第一版试过，撤了）。
 *
 * 这档的取向反过来：
 *
 * | | 说书档（ink） | **老石档（news）** |
 * |---|---|---|
 * | 底 | 近黑的墨 `#141C24` | **干净的深藏青渐变**，往下提亮，有空间不压抑 |
 * | 字 | 思源宋体 Black | **得意黑**（无衬线，斜体，速报感） |
 * | 重音 | 朱砂 ＋ 印章「醒」 | **新闻红色块** ＋ 左侧栏目色条 |
 * | 气质 | 幽、静 | **快、硬、可信** |
 *
 * 唯一照搬的是**验收标准**：缩到 210px 宽，主标还读不读得出。不是 1080px 下好不好看。
 *
 * ⚠ **字体必须喂文件** —— resvg 找不到字体不报错，**自己换一个接着渲**
 * （`fonts/README.md`：渲出来跟微软雅黑字节数完全一样）。
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { load } from './素材.mjs';
import { POSE } from './pose.mjs';
import { 换衬衫, 解析色 } from './衬衫.mjs';
import { 取色系 } from './色系.mjs';

const require = createRequire(path.join(process.cwd(), 'package.json'));
const { Resvg } = require('@resvg/resvg-js');

const DIR = process.argv[2];
if (!DIR) { console.error('要给项目目录'); process.exit(1); }

const SRC = 'E:/ryu/石总/SVG/正面new/SVG/';
const REPO = process.cwd();
const 黑 = path.join(REPO, 'fonts/smiley-sans-v2.0.1/SmileySans-Oblique.otf');
if (!fs.existsSync(黑)) throw new Error(`字体不在：${黑}　—— 不喂文件 resvg 会静默换字体`);

/**
 * news 档：干净的深藏青 ＋ 新闻红。不是墨黑，不阴森。
 *
 * **这里只有恒定的那 70%。** 每期跟着话题类型切的三个色（重音／副标／背景光晕）
 * 在 `色系.mjs`，下面按 `类型` 取。
 */
const C = {
  底上: '#0B1E33',      // 顶部略深
  底下: '#173B5E',      // 底部提亮，有空间
  字: '#FFFFFF',
  次: '#A8C4DC',        // 频道名
  红: '#E5402C',        // 栏目色（角标块 ＋ 左侧色条）—— **不跟类型切，这是频道身份**
  线: '#3D6C94',
};

/**
 * **主副双色：白 ＋ 类型色。**（2026-09-06）
 *
 * 重点那段是**当期类型的重音色**（内幕荧光黄／博弈琥珀金／认知极客青），
 * 副标取同一个色的浅一档 —— 一张封面就一个色相 ＋ 白，双色法则是严的。
 * **原来压在字脚下的红色高亮条撤掉了**，撤掉是关键：字已经有色了，
 * 底下再压一条等于说两遍；而且那条会啃掉字的下半截，缩到 210px 反而更糊。
 *
 * ⚠ **红只留给角标块和左侧色条**（那是栏目身份，不跟标题抢）。
 * 白／类型色／红三个重音一起上，画面就没有重点了 —— 跟数据板那条
 * 「一屏最多一个 accent」是同一个道理。以后要再加重音，先撤一个。
 * 这也是**类型二的文案不用经典红**的原因之一，另一个原因是对比度，见 `色系.mjs`。
 */

const W = 1080, H = 1920;
const cfgPath = path.join(DIR, '封面.json');
const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
// **动作表优先** —— 类型和衬衫都是「封面和成片必须一致」的东西，一期只能有一个说法。
// 动作表是片子按它渲的那一份，所以它说了算；`封面.json` 里写的只在没有动作表时兜底
const 动作表 = path.join(DIR, '动作表.json');
const 表 = fs.existsSync(动作表) ? JSON.parse(fs.readFileSync(动作表, 'utf8')) : {};
const 系 = 取色系(表.类型 ?? cfg.类型);
const 角标 = cfg.角标 || cfg.眉标 || '时事观察';
const 主标 = cfg.主标 || ['主标题'];
const 重点行 = cfg.重点行 ?? 1;      // 主标数组里哪一段标黄（不是哪一行 —— 主标只有一行）
const 副标 = cfg.副标 || '';
const 页脚 = cfg.页脚 || '社长老石';
const 姿势名 = cfg.姿势 || '代表性站姿';

/* ---------- 人物 ---------- */
const p = POSE[姿势名];
if (!p) throw new Error(`姿势库里没有「${姿势名}」`);
// 2026-09-06：页脚那条线和居中频道名撤了（频道名改成右侧竖排），底部空出来一条，
// 所以脚底从 1782 放到 1860、人也大了一档。⚠ 再往下会压到 YouTube 的时长角标
const 人高 = 1160, 脚底 = 1860;
const s = 人高 / p.画布[1];
const tx = W / 2 - p.眼中 * s;
const ty = 脚底 - p.画布[1] * s;
// ⚠ **衬衫颜色要跟成片一致** —— 封面和片子是同一期，穿两件衣服是最扎眼的穿帮
const 衬衫名 = 表.衬衫 || cfg.衬衫 || null;
const 衬衫 = 衬衫名 ? 解析色(衬衫名) : null;
const 人 = 换衬衫(load(SRC + p.文件).shapes.map((x) => x.xml).join(''), 衬衫?.色, p.文件);

/* ---------- 版面 ---------- */
/** SVG 文本里这几个字符有语法含义 */
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * **两行制：主标一行、副标一行。**（2026-09-06）
 *
 * 副标原来是竖排在人物左边的 60px，还是太小；改成**横排第二行、字号翻倍到 92px**。
 * 主标跟着并成一行 —— 上下两行一大一小，是最短的读法：**一眼一行**。
 *
 * ⚠ 主标并成一行之后，白／黄不再是「上白下黄」，而是**同一行里前白后黄**。
 * `重点行` 现在指的是**主标数组里哪一段标黄**。双色法则本身没变。
 *
 * ⚠ 横排一行放得下多少字是硬的：主标 108px 最多 9 字，副标 92px 最多 9 字
 * （9×108 ＋ 左边距 96 ＝ 1068，只剩 12px）。**超了当场停，回去删字** ——
 * 不自动缩字号，一缩就回到「210px 下看不见」那个问题，而那正是这次要修的。
 */
const 主号 = 108, 主y = 400, 主上限 = 9;
const 副号 = 92, 副y = 556, 副上限 = 9, 副粗 = 4;

const 量 = (t) => [...String(t)].length;
const 拦 = (名, t, 号, 上限) => {
  if (量(t) <= 上限) return;
  console.error(`${名}「${t}」${量(t)} 字，${号}px 横排一行最多 ${上限} 字 —— 删字，别缩字号`);
  console.error('  缩字号就回到 46px 那个问题了：缩到 210px 宽根本看不见');
  process.exit(1);
};
拦('主标', 主标.join(''), 主号, 主上限);
if (副标) 拦('副标', 副标, 副号, 副上限);

/** 主标一行。`重点行` 那一段给当期类型的重音色，其余白 */
const 主行 = () =>
  `<text x="96" y="${主y}" font-family="Smiley Sans" font-size="${主号}" letter-spacing="2">` +
  主标.map((seg, i) =>
    `<tspan fill="${i === 重点行 ? 系.重 : C.字}">${esc(seg)}</tspan>`).join('') +
  `</text>`;

/**
 * 副标一行，**当期类型色的浅一档 ＋ 加粗**。
 *
 * ⚠ **得意黑只有一个字重**（`fonts/` 里只有 Oblique 一个文件）。`font-weight="bold"`
 * 在 resvg 里**不报错也不变粗** —— 跟 README 那条「可变字体的加粗是静默失效的」
 * 是同一个坑。所以「粗」只能自己描：先描一圈同色的边，再把填充压上去。
 * `paint-order` 也别用，resvg 对它同样是不报错地忽略。
 */
const 副行 = () => {
  const 体 = (extra) =>
    `<text x="96" y="${副y}" font-family="Smiley Sans" font-size="${副号}" ` +
    `letter-spacing="2" ${extra}>${esc(副标)}</text>`;
  return 体(`fill="none" stroke="${系.副}" stroke-width="${副粗}" stroke-linejoin="round"`) +
    体(`fill="${系.副}"`);
};

/**
 * **竖排**：一个字一个 `<text>` 摆位。现在只剩页脚频道名在用。
 *
 * ⚠ 不能靠 `writing-mode: vertical-rl` —— resvg 对它的支持不保准，而且标点的位置
 * （逗号要蹲在格子右上角）它也不会处理。逐字摆位是唯一稳的做法。
 *
 * ⚠ **得意黑只有斜体**（`fonts/` 里没有正体）。竖着排的话每个字往右倾 9°，
 * 一列下来越走越偏，像一串歪塔。所以每个字**反向 skew 扳正** ——
 * 斜体本身就是一个 skew，反着来基本还原成正体，形还是得意黑那个形。
 */
const 斜度 = 9;
const 竖排 = (t, x, y0, 号, 色, 距 = 1.15) => [...t].map((ch, i) => {
  const y = y0 + i * 号 * 距;
  // 标点单独往右上角挪一点，不然竖排看着像掉在格子中间
  const 点 = /[，、。：；！？]/.test(ch);
  const dx = 点 ? 号 * 0.22 : 0, dy = 点 ? -号 * 0.30 : 0;
  return `<g transform="translate(${(x + dx).toFixed(1)},${(y + dy).toFixed(1)}) skewX(${斜度})">` +
    `<text x="0" y="0" font-family="Smiley Sans" font-size="${号}" fill="${色}" ` +
    `text-anchor="middle">${esc(ch)}</text></g>`;
}).join('');

/**
 * 背景的色彩层次：**暗金数据线条 ＋ 虚化光斑**。蓝底 ＋ 暗金 ＋ 微弱光晕，
 * 是「彭博终端／数据分析室」那个质感。
 *
 * ⚠ **光斑不能靠模糊滤镜** —— resvg 的滤镜支持不全（见 README 坑 9）。
 * 用**径向渐变的圆**：中心亮、边缘透明。一个 bokeh 本质上就是这个，效果一样还快。
 *
 * ⚠ **透明度全部压在 0.16 以下，标题那两行（y300–620）一个都不放。**
 * 验收标准是「缩到 210px 主标还读不读得出」—— 纹理在 1080px 下是质感，
 * 在 210px 下必须退成一片底色，不能变成噪点。
 */
function 底纹() {
  // 折线走势：右上角一段、左下角一段，都绕开标题区
  const 折 = (pts, op) =>
    `<polyline points="${pts}" fill="none" stroke="${系.纹}" stroke-width="3" opacity="${op}"/>`;
  const 格 = [];
  for (let y = 1180; y <= 1720; y += 108)
    格.push(`<rect x="60" y="${y}" width="${W - 120}" height="1.5" fill="${系.纹}" opacity="0.07"/>`);
  const 斑 = [[190, 760, 150], [920, 700, 130], [960, 980, 170], [140, 1560, 110], [700, 1780, 90]]
    .map(([cx, cy, r], i) =>
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#bok${i % 2})" />`).join('');
  return 格.join('') +
    折('720,180 790,140 860,168 930,110 1000,136', 0.16) +
    折('60,1700 180,1608 300,1650 420,1520 540,1566 660,1444', 0.13) +
    斑;
}

// 左侧栏目色条：从角标顶一直拉到副标脚下，色条 ＋ 两行标题连成一个左对齐的块
const 条底 = 副标 ? 副y + 28 : 主y + 28;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<defs>` +
  `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${C.底上}"/><stop offset="1" stop-color="${C.底下}"/></linearGradient>` +
  `<radialGradient id="glow" cx="0.5" cy="0.62" r="0.55">` +
  `<stop offset="0" stop-color="${系.晕}" stop-opacity="${系.晕浓}"/>` +
  `<stop offset="1" stop-color="${系.晕}" stop-opacity="0"/></radialGradient>` +
  // 两种光斑：偏白、偏蓝。中心亮边缘透明 —— 这就是 bokeh，不用滤镜
  `<radialGradient id="bok0" cx="0.5" cy="0.5" r="0.5">` +
  `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.10"/>` +
  `<stop offset="0.6" stop-color="#FFFFFF" stop-opacity="0.04"/>` +
  `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>` +
  `<radialGradient id="bok1" cx="0.5" cy="0.5" r="0.5">` +
  `<stop offset="0" stop-color="${系.斑}" stop-opacity="0.12"/>` +
  `<stop offset="0.6" stop-color="${系.斑}" stop-opacity="0.05"/>` +
  `<stop offset="1" stop-color="${系.斑}" stop-opacity="0"/></radialGradient>` +
  `</defs>` +
  `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
  底纹() +
  `<ellipse cx="${W / 2}" cy="1420" rx="520" ry="520" fill="url(#glow)"/>` +

  // 左侧栏目色条 —— 商务／新闻版式的定位符
  `<rect x="60" y="150" width="14" height="${条底 - 150}" fill="${C.红}"/>` +

  // 顶部：红块角标 ＋ 一条细横线拉到画面右
  `<rect x="96" y="150" width="${角标.length * 46 + 56}" height="72" rx="6" fill="${C.红}"/>` +
  `<text x="${96 + (角标.length * 46 + 56) / 2}" y="203" font-family="Smiley Sans" font-size="46" ` +
  `fill="${C.字}" text-anchor="middle" letter-spacing="4">${esc(角标)}</text>` +
  `<rect x="${96 + 角标.length * 46 + 78}" y="184" width="${W - 96 - 角标.length * 46 - 78 - 76}" ` +
  `height="3" fill="${C.线}"/>` +

  // 第一行主标（同一行里前白后黄），第二行副标（淡青加粗）
  主行() +
  (副标 ? 副行() : '') +

  // 人物压在最上层
  `<g transform="translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${s.toFixed(4)})">${人}</g>` +

  // 频道名竖排，右列 x865，正对人物下半身。
  // ⚠ 别往右下角放 —— YouTube 缩略图那儿压时长角标
  竖排(页脚, 865, 1330, 56, C.次) +
  `</svg>`;

const out = path.join(DIR, '封面.png');
fs.writeFileSync(out, new Resvg(svg, {
  font: { loadSystemFonts: false, fontFiles: [黑] },
  background: C.底上,
}).render().asPng());

console.log(`${out}　${W}×${H}`);
console.log(`类型「${系.类型}」${系.名}　重音 ${系.重}　副标 ${系.副}　光晕 ${系.晕}`);
console.log(`角标「${角标}」　主标「${主标.join('')}」　副标「${副标}」　姿势「${姿势名}」　衬衫「${衬衫?.名 || '粉'}」`);
console.log('⚠ 缩到 210px 宽再看一眼主标读不读得出 —— 那才是验收标准');
