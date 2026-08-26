// ── 字幕：剪纸风不能用「黑体+粗黑描边」，会把画面弄脏 ────────────────
// 做法：台词放在一块米白纸片上（旋转 -1°、手撕边、带投影），文字用深墨，关键词换芥黄。

import { piece, tornRect, n } from './style/papercut.js';
import { P } from './style/palette.js';
import { W, FONT, FONT_HEAVY, FONT_LAOMA } from './config.js';
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

/**
 * **手动断点**。写在稿件的 `say[].text` 里，只对字幕生效 ——
 * `lineText()` 会在送 TTS／SRT／体检之前把它剥掉。
 *
 * ⚠ **为什么非要有它。** 下面那个打分器能消灭「断错」，但判不出「哪个合法断点最好」：
 * 「读完回我一句辛苦了」断成 4/5 和 6/3 都合法，可「辛苦了」该独占一行 ——
 * 因为那是领导说的原话。**这件事只有写稿的人知道**，规则再多也推不出来。
 */
export const BREAK_MARK = '|';

/**
 * **附着字**：不能出现在下一行开头的字。它们得挂在前一个字后面才有意思，
 * 拎到行首读者要往上一行找主人。**这跟好不好看无关，是读得动读不动。**
 *
 * ⚠ 跟 `laoma-long-cover.ts` 的 `CLINGY` 同源，那边比这边少四个
 *（么呢吗吧）—— 封面是四五个字的短标题，撞不上语气字。**改这边不要顺手改那边**：
 * 封面那十条已出片的断口会跟着变。
 */
const CLINGY = '的了着过地得们之么呢吗吧';

/** 数词。跟量词之间不许断 —— 「一句」劈成「一／句」是硬错 */
const NUM = '一二两三四五六七八九十几半零';
/** 量词。断在它**后面**反而是好断点（数量词说完了） */
const CLASSIFIER = '个次回下条句版天年月日分秒遍趟页人只件张份步口杯遍层';
/** 这些字必须挂着后面的字，不能结行 */
const PROCLITIC = '不没别很太更最又再也就还挺比跟和把被给对从在向往用于把';
/** 介词。它和它后面那个宾语是一整块，**断点只能在整块之前或之后** */
const PREP = '比跟和把被给对从在向往为替按照朝';
/** 否定词。「否定＋动词」也是一整块，不能把动词留在行尾 */
const NEG = '不没别';
/** 标点后面是最好的断点 */
const AFTER_PUNCT = '，、；：。！？…—」』）';

const isAlnum = (c: string) => /[A-Za-z0-9]/.test(c);

/**
 * 折行：**枚举所有合法断点，打分取最高**。
 *
 * ⚠ **正文在 `horse/SUBTITLE_SPEC.md` §五之二** —— 六条硬禁止、两条加分、
 * 手动断点、以及「还没做的那两条」都写在那儿。**判据要改先改那一节**，
 * 别只改这儿：下面这些注释是给读代码的人看的，规范才是给写稿的人看的。
 *
 * ── 为什么不是贪心，也不是均分 ──
 *
 * 原来是「贪心塞满 → 再盲目均分到同样行数」。拿 laoma-019 的 13 屏字幕量过，
 * **均分是净负的**：3 处改好、5 处改坏。你要的两处（`AI` 不劈、「一句」不劈）
 * 贪心本来就断对了，是均分又把它们断坏的。
 *
 * ⚠ **平衡度不能当主目标，只能当平手判据。** 同样是量出来的：
 * 「读完回我一句辛苦了」九个字，最该要的 6/3 恰好是**最不平衡**的那个断法，
 * 而 5/4、4/5 都更平衡、都断错。所以平衡只配一个很小的权重。
 *
 * 硬禁止四条（命中就出局，不参与打分）：
 *   ① 断在拉丁字母／数字串内部　　「领导用 AI 读周报」→「领导用 A／I 读周报」
 *   ② 下一行以附着字开头　　　　　「…写／了」
 *   ③ 断在数词和量词之间　　　　　「读完回我一／句辛苦了」
 *   ④ 上一行以粘着字结尾　　　　　「那周报不／是我写的」
 */
export function wrapSmart(text: string, fs: number, maxW: number): string[] {
  // 手动断点最优先 —— 标了就照标的来，一个字都不商量
  if (text.includes(BREAK_MARK))
    return text
      .split(BREAK_MARK)
      .map((s) => s.trim())
      .filter(Boolean);

  const chars = [...text];
  if (textWidth(text, fs) <= maxW) return [text];

  // 需要几行：按宽度算，跟原来那一遍贪心得到的行数一致
  const need = wrap(text, fs, maxW).length;
  if (need < 2) return [text];
  return split(chars, fs, maxW, need);
}

/** 递归切：先给第一行挑断点，剩下的接着切 */
function split(chars: string[], fs: number, maxW: number, need: number): string[] {
  if (need <= 1) return [chars.join('')];
  const per = chars.length / need; // 理想的每行字数，只用来算平衡度
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 1; i < chars.length; i++) {
    const head = chars.slice(0, i);
    const tail = chars.slice(i);
    if (textWidth(head.join(''), fs) > maxW) break; // 再往后只会更宽
    // 剩下的必须装得进 need-1 行
    if (wrap(tail.join(''), fs, maxW).length > need - 1) continue;

    const prev = chars[i - 1];
    const next = chars[i];
    if (isAlnum(prev) && isAlnum(next)) continue; // ① 拉丁／数字串
    if (CLINGY.includes(next)) continue; //           ② 附着字起行
    if (NUM.includes(prev) && CLASSIFIER.includes(next)) continue; // ③ 数量词
    if (PROCLITIC.includes(prev)) continue; //        ④ 粘着字结行
    // ⑤ 介词短语内部：「我是学得比它｜更新得慢」把「比它」和它比的东西拆开了。
    //    要断就断在介词之前 —— 「我是学得｜比它更新得慢」。
    if (i >= 2 && PREP.includes(chars[i - 2])) continue;
    // ⑥ 否定＋动词：「那周报不是｜我写的」把「不是」和它否定的东西拆开了。
    //    要断就断在否定词之前 —— 「那周报｜不是我写的」。
    if (i >= 2 && NEG.includes(chars[i - 2])) continue;

    let s = 0;
    if (AFTER_PUNCT.includes(prev)) s += 4;
    // 数量词说完了是个好断点：「一句｜辛苦了」
    if (CLASSIFIER.includes(prev) && i >= 2 && NUM.includes(chars[i - 2])) s += 2;
    s -= Math.abs(i - per) * 0.4; // 平衡度，权重故意小
    if (i >= chars.length - i) s += 0.3; // 打平时前行不短于后行

    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  }
  // 一个合法断点都没有：退回等分，别把整句挤成一行溢出去
  if (best < 0) best = Math.max(1, Math.round(per));
  // ⚠ **每行掐掉首尾空格。** 「我用 AI 写周报」断在 AI 后面，第二行会是「␣写周报」——
  // 左对齐排版下那个空格是看得见的，整行往右缩一格，跟上一行对不齐。
  return [
    chars.slice(0, best).join('').trim(),
    ...split(chars.slice(best), fs, maxW, need - 1).map((l) => l.trim()),
  ];
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
  plain = false,
  /**
   * 字号。缺省 52 是字幕规范 §三「签名」那一档的数。
   *
   * ⚠ **老马线传 72。** 那张卡是**日子牌**（「老马的第 1858 天」），
   * 它不只是签名 —— 观众要在定格那几秒里读出那个数、并且自己算一下那是多久
   * （CHANNEL_LAOMA §五之二：「数字本身就是内容」）。52 号在竖屏上偏小，读不出分量。
   */
  fs = 52
): string {
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
  // ⚠ **两处都栽过跟头，别再改回去。**
  //
  // `\d` 不能写成 `[d]` —— 字符类里的 d 就是字母 d，阿拉伯数字一个都标不上，
  // 而这条线的数虽然多半是中文写的，`frameText` 里照样有「23 位」那种写法。
  //
  // 不能先 `.filter(Boolean)` 再按下标判奇偶。split 带捕获组时奇数位一定是数字段，
  // 可**首字就是数字的句子**（「二十三位在前面」）会在开头留一个空串 ——
  // 先滤掉它，下标整体错一位，红的就跑到后半句去了。空串在 map 里跳过，下标不动。
  return t
    .split(/(\d+|[零一二两三四五六七八九十百千万]+)/)
    .map((seg, i) => (!seg ? '' : i % 2 === 1 ? `<tspan fill="${FRAME_RED}">${escapeXml(seg)}</tspan>` : escapeXml(seg)))
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
 * 老马线字幕的三档规格（字幕规范 §三，2026-08-23 接进来）。
 *
 * ── 两个颜色都不用纯的 ──
 *
 * 纯白配纯黑在暖色场景里会显得硬、显得是外挂上去的 UI。
 * 奶白和深墨取自纸白配棕的调色板，**字幕才融得进画面**。
 *
 * ── 落点是「放大 ＋ 换色」两件事一起做 ──
 *
 * 落点比铺垫大 25% 并且换成琥珀。**只放大或只换色都不够** ——
 * 规范原话。琥珀一条片子只用一次，就是落点那一句。
 *
 * ⚠ **字号是照规范抄的，但规范假设的是整幅 900px 宽的横排字幕。**
 * 这条线的字幕排在角色旁边那一列，实测只有 515px 宽 ——
 * 所以 80 号一行放得下六个字左右，**长句必须折行**（用户 2026-08-23 明确要折行）。
 * 折行行距 1.25 也是规范给的。
 */
const LAOMA_SUB = {
  /** 铺垫 */
  setup: { fs: 80, fill: '#FAF6EC', line: '#2B2622' },
  /** 落点：大 25% ＋ 换琥珀 */
  punch: { fs: 100, fill: '#F0B72E', line: '#2B2622' },
  /** 描边宽 ÷ 字号（规范给的是 15/80 和 19/100，两个都约等于这个数） */
  strokeK: 0.19,
  /** 折行行距 ÷ 字号 */
  lineH: 1.25,
} as const;

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
    /** 哪一档：铺垫 / 落点。落点整屏换琥珀并放大 25%（字幕规范 §三） */
    tier?: 'setup' | 'punch';
    highlight?: string;
    halo?: boolean;
    /** @deprecated 旧名。这一层早先是投影，现在是描边 —— 见 SIDE_HALO 顶上那段 */
    shadow?: boolean;
  }
): string {
  // ⚠ **2026-08-23 改：字号定死，长句折行 —— 不再靠缩字号硬塞一行。**
  //
  // 原来的做法是「字号按最长那一小句自适应」，理由写着「按逗号断行的全部意义
  // 就是一小句一行，折了就等于没断，所以宁可全篇小一号」。
  // 那条在字号 48 的年代成立；换到规范的 80 / 100 之后不成立了 ——
  // 这一列只有 515px 宽，**一句十个字按老逻辑会被一路缩回 48**，
  // 规范那三档就等于没接。用户要的是**折行**，不是缩字号。
  //
  // 缩字号只剩兜底：**一个字都放不下**的时候（列被角色挤得极窄）才动。
  const spec = LAOMA_SUB[opts.tier ?? 'setup'];
  const want = clauses(tidyCaption(text, { keepTone: true }));
  let fs = opts.fontSize ?? spec.fs;
  const MIN_FS = 34;
  while (fs > MIN_FS && textWidth('测', fs) > opts.colW) fs -= 2;
  // ⚠ **只超一点点的，缩字号塞进一行，别折。**
  //
  // 2026-08-23 那次改动（字号定死、长句折行）是为了废掉「一路缩回 48 号」，
  // 但钟摆甩过头了：现在一个像素都不让。「没有一个人看过」七个字 560px、
  // 列宽 515px，**只超 45px（9%）就被折成两行** —— 而那是一句该一口气读完的短句。
  //
  // 窗口只给 10%（80 → 72 号），够把 6.4 字/行抬到 7.15 字/行。**再宽就是缩字号了**，
  // 那正是上一次要废掉的东西。超得多的（十个字 800px）该折还折。
  const SHRINK = 0.9;
  const widest = Math.max(...want.map((c) => textWidth(c, fs)));
  if (widest > opts.colW && widest * SHRINK <= opts.colW) fs = Math.floor((fs * opts.colW) / widest);
  const lh = fs * LAOMA_SUB.lineH;
  const lines = want.flatMap((c) => wrapSmart(c, fs, opts.colW));
  const top = opts.cy - ((lines.length - 1) * lh) / 2;
  const haloInk = opts.ink(P.paper);
  const glyphs = (l: string, i: number, pass: 'halo' | 'fill') =>
    `<text x="${n(opts.colX)}" y="${n(top + i * lh)}" ` +
    // ⚠ **老马线用得意黑**（字幕规范 §二）。它只有一个字重而且是斜体，
    // **层次只能靠字号和颜色做，不能靠字重** —— 所以这儿不再写 font-weight。
    `font-family="${FONT_LAOMA}" font-size="${fs}" text-anchor="start" xml:space="preserve" ` +
    (pass === 'halo'
      ? `fill="none" stroke="${opts.ink(spec.line)}" stroke-width="${n(fs * LAOMA_SUB.strokeK)}" ` +
        // ⚠ round 别漏 —— 不加的话笔画拐角会长出尖刺（字幕规范 §三）
        `stroke-linejoin="round" stroke-linecap="round">${escapeXml(l)}`
      // ⚠ **落点那一屏整屏就是琥珀，不再单独染词。** 规范要的是「放大 ＋ 换色」
      // 两件事一起做；整屏已经是琥珀了，里面再挑一个词染同一个色没有意义。
      : `fill="${opts.ink(spec.fill)}">${
          opts.tier === 'punch' ? escapeXml(l) : tspans(l, opts.highlight, opts.ink)
        }`) +
    `</text>`;
  // **描边整块画在前面，正文再压上去。** 逐行「描边＋填充」交替画的话，
  // 下一行的描边会啃掉上一行的填充 —— 行距 1.5 倍、描边半宽 0.068 × 字号，够得着。
  // 跟 cover.ts 的 inkedLine 是同一条规矩。
  const body = lines.map((l, i) => glyphs(l, i, 'fill')).join('');
  if (opts.halo === false || opts.shadow === false) return body;
  return lines.map((l, i) => glyphs(l, i, 'halo')).join('') + body;
}
