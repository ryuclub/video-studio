// ── 字幕：剪纸风不能用「黑体+粗黑描边」，会把画面弄脏 ────────────────
// 做法：台词放在一块米白纸片上（旋转 -1°、手撕边、带投影），文字用深墨，关键词换芥黄。

import { piece, tornRect, n } from './style/papercut.js';
import { P } from './style/palette.js';
import { W, FONT, FONT_HEAVY } from './config.js';
import { clamp, easeOutBack } from './anim.js';
import { tidyCaption } from './shuoshu-srt.js';

const isWide = (ch: string) => /[\u2E80-\u9FFF\uAC00-\uD7FF\uFF00-\uFF60\u3000-\u303F]/.test(ch);

function textWidth(text: string, fs: number): number {
  let w = 0;
  for (const ch of text) w += isWide(ch) ? fs : fs * 0.55;
  return w;
}

function wrap(text: string, fs: number, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (textWidth(cur + ch, fs) > maxW && cur.length) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function tspans(line: string, highlight: string | undefined, ink: (c: string) => string): string {
  if (!highlight || !line.includes(highlight)) return escapeXml(line);
  const idx = line.indexOf(highlight);
  return (
    escapeXml(line.slice(0, idx)) +
    `<tspan fill="${ink(P.accent)}">${escapeXml(highlight)}</tspan>` +
    escapeXml(line.slice(idx + highlight.length))
  );
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * 台词字幕。in/out 用小幅弹入，避免生硬。
 * @param prog 出现进度 0..1（用于弹入动画）
 */
export function dialogueStrip(
  text: string,
  y: number,
  ink: (c: string) => string,
  seed: number,
  prog = 1,
  highlight?: string,
  /**
   * 谐音注解，打在台词下方一行小字。
   * 谐音梗光靠听只能 get 一半（「龟来」和「归来」完全同音），
   * 字幕必须把另一半写出来，观众才接得住。
   */
  annotation?: string,
  /**
   * 字号。默认 64 是给段子台词设计的（短、要有冲击力）；
   * **旁白叙述句长得多**，44 字用 64px 会占满下半画面、把道具全挡住，
   * B 类传 46 更合适。
   */
  fontSize = 64
): string {
  const fs = fontSize;
  const afs = Math.round(fs * 0.56); // 注解比台词小一档，不抢主字
  const maxW = W - 200;
  // 频道规范：一条台词末尾不留标点，句中的句号换成逗号。**在这儿做掉，别靠稿子写对** ——
  // 稿子是按纸上的段落写的（「这一觉不一样。他觉得自己是挣来的。」），
  // 搬到屏幕上那个句号就成了一句话中间蹦出来的句号。见 shuoshu-srt.ts 的 tidyCaption。
  // **keepTone：结尾的 ！？ 留着** —— 这条线上那是包袱的语气，不是标点噪声。
  const lines = wrap(tidyCaption(text, { keepTone: true }), fs, maxW);
  const lh = fs * 1.42;
  const alh = annotation ? afs * 1.5 : 0;
  const padX = 34;
  const padY = 22;
  const contentW = Math.max(
    ...lines.map((l) => textWidth(l, fs)),
    annotation ? textWidth(annotation, afs) : 0
  );
  const boxW = Math.min(maxW + padX * 2, contentW + padX * 2);
  const boxH = lines.length * lh + alh + padY * 2 - (lh - fs) * 0.5;
  const x = (W - boxW) / 2;
  const top = y - boxH;

  const k = easeOutBack(clamp(prog));
  const scale = 0.94 + 0.06 * k;
  const alpha = clamp(prog * 1.6);

  const body = lines
    .map(
      (l, i) =>
        `<text x="${n(W / 2)}" y="${n(top + padY + fs * 0.86 + i * lh)}" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="${ink(
          P.ink
        )}" text-anchor="middle" xml:space="preserve">${tspans(l, highlight, ink)}</text>`
    )
    .join('');

  const anno = annotation
    ? `<text x="${n(W / 2)}" y="${n(top + padY + fs * 0.86 + lines.length * lh + afs * 0.5)}" font-family="${FONT}"
      font-size="${afs}" font-weight="600" fill="${ink(P.accent)}" text-anchor="middle"
      xml:space="preserve">${escapeXml(annotation)}</text>`
    : '';

  return `<g opacity="${n(alpha)}" transform="translate(${n(W / 2)},${n(y)}) scale(${n(scale)}) rotate(-1) translate(${n(-W / 2)},${n(-y)})">
    ${piece(tornRect(x, top, boxW, boxH, seed, 1.6, 18), ink(P.light), { dx: 5, dy: 7, shadowAlpha: 0.16 })}
    ${body}
    ${anno}
  </g>`;
}

/** 顶部钩子字幕（结尾用），比台词小一档，旋转反向 */
/**
 * 顶部钩子字幕（结尾用），比台词小一档，旋转反向。
 *
 * `plain` = 去掉衬底色块，只留字（独白线用）。那条线的字幕全程无衬底，
 * 收尾卡再挂一块藏青色块就成了整片里唯一一个「装饰」，
 * 而且它正好落在定格去色那一帧上 —— 全屏都灰了，就它一块蓝。
 */
export function hookStrip(
  text: string,
  y: number,
  ink: (c: string) => string,
  seed: number,
  prog = 1,
  plain = false
): string {
  const fs = 52;
  const lines = wrap(tidyCaption(text, { keepTone: true }), fs, W - 260);
  const lh = fs * 1.4;
  const padX = 28;
  const padY = 18;
  const boxW = Math.max(...lines.map((l) => textWidth(l, fs))) + padX * 2;
  const boxH = lines.length * lh + padY * 2 - (lh - fs) * 0.5;
  const x = (W - boxW) / 2;
  const alpha = clamp(prog * 2);
  const dy = (1 - clamp(prog)) * -30;

  const body = lines
    .map(
      (l, i) =>
        `<text x="${n(W / 2)}" y="${n(y + padY + fs * 0.86 + i * lh + dy)}" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="${ink(
          plain ? P.ink : P.paper
        )}" text-anchor="middle" xml:space="preserve">${escapeXml(l)}</text>`
    )
    .join('');

  return `<g opacity="${n(alpha)}" transform="rotate(1 ${n(W / 2)} ${n(y)})">
    ${plain ? '' : piece(tornRect(x, y + dy, boxW, boxH, seed, 1.6, 18), ink(P.primary), { dx: 4, dy: 6, shadowAlpha: 0.2 })}
    ${body}
  </g>`;
}

/**
 * 「先出声，后出人」的**开场大字**（老马线的第二档出场风格）。
 *
 * 第 1 句在说，画面上只有场景和这一行字 —— 人还没进来。
 *
 * ── 它跟 seriesCard 不是一回事 ──
 *
 * `seriesCard` 是**系列识别**：三十期同一张卡、同一位置，刷到第五期就认得出来。
 * 这一行是**内容**：写的是这一条自己的那个数，每条都不一样。
 *
 * ── ⚠ 2026-08-22 从「黑底卡」改成「场景上的大字」 ──
 *
 * 先做的是一张**整幅黑底、纸白大字**的卡，理由是这条线全片纸白配深墨、
 * 对比度压得很低，在信息流里没有首帧优势，而黑底是唯一能把对比度拉满的地方。
 *
 * **看下来黑得太久。** 第 1 句要念三四秒，那几秒画面上什么都没有 ——
 * 对比度是拉满了，但观众盯着一块黑，**场景这条信息白白晚到了四秒**。
 * 而这条线的场景本来就是内容的一部分（008 那块叫号屏从第一秒起就该在画面上）。
 *
 * 现在是：**场景照常出，人不出，字压在场景上。** 首帧仍旧是一句大字，
 * 但同一帧里还交代了「他在医院」—— 同样的三秒装了两条信息。
 *
 * ⚠ 底色换了，字色也得跟着换：**黑底那版是纸白字，这版是墨字**。
 * 照抄纸白会直接消失在纸白底上。
 *
 * ⚠ **字号按宽度反推，不写死** —— 那句话可长可短（「前面还有二十三位」9 字、
 * 「第十一行」4 字），写死字号的话短句显小、长句折行，而这一行的全部力气就在「大」。
 *
 * ⚠ **`cy` 要传侧边字幕那条视线高度，不是画幅正中。**
 * 正中（y=960）在 hospital 那个场景里正好压在排椅上，字被家具的边啃。
 * 更要紧的是**视线**：大字撤掉之后紧接着就是侧边字幕，两处对齐的话
 * 眼睛一次都不用换位置 —— 大字缩成小字，位置没动。
 */
export function openLineSvg(text: string, cy: number, ink: (c: string) => string): string {
  const t = tidyCaption(text, { keepTone: true });
  const margin = 96;
  const maxW = W - margin * 2;
  // ⚠ **字族和 font-weight 两样都要给。** 只写字族名拿到的是这一族里的常规甚至细体
  //（第一次渲出来就是细的，跟"大字"完全不是一回事）；只写 900 又拿不到 Black
  // 这个独立字族（封面设计规范 §七之一 那条警告）。`cover.ts` 的 inkedLine 也是两样都写。
  // 上限 200：再大就顶到平台顶部 UI 那条带子里去了
  let fs = 200;
  while (fs > 60 && textWidth(t, fs) > maxW) fs -= 4;
  return (
    `<text x="${n(W / 2)}" y="${n(cy + fs * 0.36)}" font-family="${FONT_HEAVY}" font-size="${n(fs)}"` +
    ` font-weight="900" fill="${ink(P.ink)}" text-anchor="middle" letter-spacing="${n(fs * 0.02)}" xml:space="preserve">${escapeXml(t)}</text>`
  );
}

/**
 * 片头卡 —— 系列固定的那张「XX，第 NN 页」。
 *
 * **为什么是卡不是旁白念一句**：短视频前 3 秒决定观众留不留，而系列识别
 * 靠听是建立不起来的（多数人前几秒静音刷）。30 期同一张卡、同一位置、同一字号，
 * 刷到第五期就认得出来了。
 *
 * 只画在 intro 那段空镜上，**不进时间轴**——时间轴只能有一份（见 README 第 3.5 步 ③），
 * 片头卡多插一段就得在音频侧同步补偿，那条路踩过一次了。
 *
 * @param prog 0..1，卡片在 intro 里的进度。首尾自动淡入淡出
 */
/**
 * 出场档 ③「先出声 · 物件」的首帧：**物件特写 ＋ 一行字**，整幅。
 *
 * 规格出处 `老马_首帧规范_v1.md` §三。那份的起因写在开头：
 * **2 秒跳出 50–80%，因为开头 1.3 秒是无声的角色入场动画** ——
 * 这一档的全部目的是把那 1.3 秒还给内容。
 *
 * ── 跟出场档 ② 的分工 ──
 *
 * ② 是**场景直出 ＋ 一行大字**（`openLineSvg`）：三秒里同时交代「他在哪」和那句话。
 * ③ 是**只有物件**：首帧规范 §五 把「整幅场景图」列成了禁令 ——
 * 「信息量太散，观众要花半秒扫画面，同时声音在讲第一句，注意力分裂」。
 *
 * **两档都留着，不是谁替谁。** 场景本身是内容的时候走 ②（008 的叫号屏从第一秒
 * 就该在画面上）；物件画得出特写、而且要在信息流里抢那 120px 缩略图的时候走 ③。
 *
 * ── 数字标红是这个系列的签名 ──
 *
 * 首帧唯一的一点红是那个数，收尾卡是「第 N 天」。一红一黑，开合对上了。
 * **别的地方一律不用红** —— 这条红只值钱在它稀缺。
 *
 * ⚠ **无描边、无阴影、无底框、无动效。**「整块直接出现，第 0 帧就在那」——
 * 动效意味着「还没说完」，观众会等；而这一帧要的是「已经开始了」。
 */
export function openFrameSvg(objectSvg: string, text: string, opts: { height: number } ): string {
  const H2 = opts.height;
  const t = tidyCaption(text, { keepTone: true });
  // 规范 §三：左右安全区各 90px
  const maxW = W - 90 * 2;
  // 规范 §三：字号 128–148（8 字满宽时取下限）。**先按上限试，装不下往下退到 128** ——
  // 退到底还装不下说明 frame_text 超了 8 字，那是体检该拦的事，这儿不再缩
  let fs = 148;
  while (fs > 128 && textWidth(t, fs) > maxW) fs -= 2;
  // 规范 §三：基线 y = 0.72H
  const baseY = H2 * 0.72;
  return (
    `<rect width="${W}" height="${H2}" fill="${FRAME_PAPER}"/>` +
    objectSvg +
    `<text x="${n(W / 2)}" y="${n(baseY)}" font-family="${FONT_HEAVY}" font-size="${n(fs)}"` +
    ` font-weight="900" fill="${FRAME_INK}" text-anchor="middle" xml:space="preserve">${redDigits(t)}</text>`
  );
}

/** 规范 §三 的三个色。**不走 palette** —— 这一帧是独立版式，不跟着全片的墨色走 */
const FRAME_PAPER = '#EDEEE8';
const FRAME_INK = '#1B1E1B';
/** 数字用的朱。首帧唯一的一点红 */
const FRAME_RED = '#B03A2E';

/**
 * 把一行字里的**数字**换成朱色 tspan。
 *
 * ⚠ **中文数字也要算**（二十三、七、六）—— 这条线的数几乎全是中文写的，
 * 只认阿拉伯数字的话这个签名一次都不会出现。
 *
 * ⚠ **连续的数字要连成一段**：「二十三」是一个数不是三个，
 * 逐字包 tspan 的话字间距会被 tspan 边界撑开，肉眼看得出来。
 */
function redDigits(t: string): string {
  return t
    .split(/([d]+|[零一二两三四五六七八九十百千万]+)/)
    .filter(Boolean)
    .map((seg, i) => (i % 2 === 1 ? `<tspan fill="${FRAME_RED}">${escapeXml(seg)}</tspan>` : escapeXml(seg)))
    .join('');
}

export function seriesCard(
  name: string,
  label: string,
  ink: (c: string) => string,
  seed: number,
  prog = 1
): string {
  const fs1 = 92; // 系列名
  const fs2 = 48; // 期号
  const padX = 76;
  const padY = 56;
  const gap = 44; // 系列名和期号之间（中间夹一道芥黄细线）
  const y0 = 780; // 画面上偏中：竖版正中偏上一点，比正中稳

  const boxW = Math.max(textWidth(name, fs1), textWidth(label, fs2)) + padX * 2;
  const boxH = fs1 * 1.1 + gap + fs2 * 1.1 + padY * 2;
  const x = (W - boxW) / 2;
  const top = y0 - boxH / 2;

  // 进场 0.28 / 退场 0.22，中间满亮。**退场要留够**，卡还在画面上就开始说话，
  // 观众会同时读两处字
  const alpha = clamp(prog / 0.28) * clamp((1 - prog) / 0.22);
  const k = easeOutBack(clamp(prog / 0.28));
  const scale = 0.955 + 0.045 * k;

  const ruleY = top + padY + fs1 * 1.1 + gap / 2;

  return `<g opacity="${n(alpha)}" transform="translate(${n(W / 2)},${n(y0)}) scale(${n(scale)}) rotate(-1.2) translate(${n(
    -W / 2
  )},${n(-y0)})">
    ${piece(tornRect(x, top, boxW, boxH, seed, 1.8, 20), ink(P.light), { dx: 6, dy: 9, shadowAlpha: 0.18 })}
    <text x="${n(W / 2)}" y="${n(top + padY + fs1 * 0.86)}" font-family="${FONT}" font-size="${fs1}" font-weight="800"
      fill="${ink(P.ink)}" text-anchor="middle" letter-spacing="6" xml:space="preserve">${escapeXml(name)}</text>
    <path d="${tornRect(W / 2 - 54, ruleY - 3, 108, 6, seed + 3, 1, 10)}" fill="${ink(P.accent)}"/>
    <text x="${n(W / 2)}" y="${n(top + padY + fs1 * 1.1 + gap + fs2 * 0.86)}" font-family="${FONT}" font-size="${fs2}"
      font-weight="600" fill="${ink(P.neutral)}" text-anchor="middle" letter-spacing="4"
      xml:space="preserve">${escapeXml(label)}</text>
  </g>`;
}

// ── 侧边字幕：老马这条独白线专用 ──────────────────────────────────────
//
// 跟 `dialogueStrip` 是两套，不是它的一个选项：
//
//              dialogueStrip（段子/一页故事）   sideText（独白线）
//   衬底        米白纸片 + 手撕边 + 投影         **没有**
//   位置        画面底部居中                     角色的左边或右边
//   入场        弹入                             **没有，直接出现**
//   断行        按宽度折                         **按逗号断**，一小句一行
//
// ── 为什么这条线要另一套 ──
//
// 段子是「两个角色在演，字幕是台词条」，纸片衬底把台词从画面里托出来。
// 老马是**一个人在讲**，画面几乎不动、镜头也不动 —— 这时候字幕不是配角，
// 它是观众的主要落点。给它加衬底、加弹入，等于给主角化了个妆再让他别动。
//
// 所以：去掉一切装饰，字直接落在纸底上；不动，因为一动就是这幅静止画面里
// 唯一在动的东西，注意力全被它拿走。
//
// ── 按逗号断行 ──
//
// 稿子是按呼吸写的（「我们组的群里，最恐怖的两个字是收到」），
// 逗号那儿本来就是停顿。按宽度折会把停顿折到别处去，读起来就不是那句话了。
// 一小句一行，行与行的长短参差本身就是节奏。
// 逗号断完就不再出现在屏幕上 —— 尾标点一律不留，那是频道规范（tidyCaption）。

/** 按标点断成小句。标点自己不上屏 */
function clauses(text: string): string[] {
  return text
    .split(/[，。！？、；：,.!?;:]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * 侧边字幕的**柔光描边**：字周围描一圈纸色，画在字底下。
 *
 * ── 这不是投影，投影是走过的弯路 ──
 *
 * 2026-08-21 先做过一版**外投影**（同形副本位移 3/4px、30% 深墨）。方向错了：
 * 投影解决的是「把字抬起来」，而这一层真正要解决的是「**别被背后的线条咬**」——
 * 005 的字全排在白板上、背后是四行潦草横线，007 的字压着窗框格子。
 * 深色的影子跟那些深色线是同一类干扰，非但不挡，还添乱；而且它糊在深墨字周围，
 * 等于把字变粗变脏。
 *
 * ── 抄的是治愈线，那边已经把这条路走完了 ──
 *
 * `src/xinli-text.ts` 的文字层（ASS）：`OutlineColour = 纸色`、`Outline = 3`、
 * **`Shadow = 0`**。它原本也是先铺了一张半透明纸条当底板，废掉了 ——
 * 「一段字对应一个矩形，看着就是一个贴上去的色块」，而且纸条是固定宽度的，
 * 短句一来右边空掉一大半，那块空白比格条更显眼。换成描边之后
 * 「一个字管一个字那么大的范围，没有边界、没有形状，也就没有『块』」。
 *
 * ── 参数怎么换算过来的 ──
 *
 * **搬的是「描边宽 ÷ 字号」这个比，不是绝对像素** —— 那边画布 1920×1080、
 * 正文 44px，这边 1080×1920、字号 34–52，绝对值搬过来会差一倍。
 * 那边 3 ÷ 44 ≈ 0.068，指的是**往外长 3px**（libass 的 outline 只往外长）。
 *
 * ⚠ **SVG 的 stroke 是骑在轮廓线上的，一半长在字面里。** 所以要往外 0.068,
 * stroke-width 得给 0.136 —— 里面那一半会被后画的填充盖掉。
 * 这跟封面标题 `cover.ts / inkedLine()` 是同一个坑，那边也是画两遍。
 *
 * 治愈线给的调法直接适用：**往外小于 2px 挡不住线条，大于 4px 笔画之间的白开始糊成一片**。
 * 这边字号 34–52，往外 2.3–3.5px，正在带里。
 *
 * ── 两件不能改的 ──
 *
 * ① **颜色用纸色不用纯白。** 治愈线的原话：「用纯白会在这张低对比的图上跳出来」。
 *    走 `ink()` 是为了跟着定格去色一起走（虽然字幕在定格前就没了，一致就好）。
 * ② **描边那一遍不带高亮色。** 高亮词在正片里是芥黄，描边副本要是也跟着描一圈黄的，
 *    笔画边上就镶了道金边 —— 所以 `tspans` 的 highlight 传 `undefined`，整块一个颜色。
 *
 * ⚠ 治愈线那边是 `lur2.4` 的**柔**边，这边是**硬**边（SVG 里要柔得上
 * `feGaussianBlur`，逐帧滤镜，800 帧 × 每帧四五行字，成本没量过）。
 * 那边的注释说硬边「看着像给字加了白边的字幕」—— 这条先按硬边出，
 * 真觉得字幕感太重再上滤镜，那时候要连渲染耗时一起量。
 */
const SIDE_HALO = {
  /** 描边宽 ÷ 字号。往外长的是这个数的一半（另一半被填充盖掉） */
  k: 0.136,
};

/**
 * 侧边字幕。**没有衬底、没有动效**，一小句一行。
 *
 * 「没有衬底」是有意的，而且**现在也仍然没有衬底** —— 柔光描边（见上面那段）
 * 干的是底板的活，但它的作用范围只有一个字那么大，没有边界也就没有「块」。
 *
 * @param colX   文字列的左边界（左对齐排）
 * @param colW   列宽，超了才二次折行
 * @param cy     整块字的垂直中心
 * @param halo   柔光描边，缺省开。传 false 关掉（`shadow` 是它的旧名，还认）
 */
export function sideText(
  text: string,
  opts: {
    colX: number;
    colW: number;
    cy: number;
    ink: (c: string) => string;
    fontSize?: number;
    highlight?: string;
    halo?: boolean;
    /** @deprecated 旧名。这一层早先是投影，现在是描边 —— 见 SIDE_HALO 顶上那段 */
    shadow?: boolean;
  }
): string {
  // **字号按最长的那一小句自适应。** 写死字号的话，只要有一句比别的长，
  // 它就会被折成两行 —— 而按逗号断行的全部意义就是「一小句一行」，
  // 折了就等于没断。所以宁可全篇小一号，也不要有一句破相。
  const want = clauses(tidyCaption(text, { keepTone: true }));
  const MIN_FS = 34;
  let fs = opts.fontSize ?? 52;
  while (fs > MIN_FS && want.some((c) => textWidth(c, fs) > opts.colW)) fs -= 2;
  const lh = fs * 1.5;
  // 缩到下限还装不下的（罕见，一小句二十多字）才按宽度折，这是兜底不是常态
  const lines = want.flatMap((c) => wrap(c, fs, opts.colW));
  const top = opts.cy - ((lines.length - 1) * lh) / 2;
  const haloInk = opts.ink(P.paper);
  const glyphs = (l: string, i: number, pass: 'halo' | 'fill') =>
    `<text x="${n(opts.colX)}" y="${n(top + i * lh)}" ` +
    `font-family="${FONT}" font-size="${fs}" font-weight="700" text-anchor="start" xml:space="preserve" ` +
    (pass === 'halo'
      ? `fill="none" stroke="${haloInk}" stroke-width="${n(fs * SIDE_HALO.k)}" ` +
        `stroke-linejoin="round" stroke-linecap="round">${escapeXml(l)}`
      : `fill="${opts.ink(P.ink)}">${tspans(l, opts.highlight, opts.ink)}`) +
    `</text>`;
  // **描边整块画在前面，正文再压上去。** 逐行「描边＋填充」交替画的话，
  // 下一行的描边会啃掉上一行的填充 —— 行距 1.5 倍、描边半宽 0.068 × 字号，够得着。
  // 跟 cover.ts 的 inkedLine 是同一条规矩。
  const body = lines.map((l, i) => glyphs(l, i, 'fill')).join('');
  if (opts.halo === false || opts.shadow === false) return body;
  return lines.map((l, i) => glyphs(l, i, 'halo')).join('') + body;
}
