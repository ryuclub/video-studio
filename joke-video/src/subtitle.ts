// ── 字幕：剪纸风不能用「黑体+粗黑描边」，会把画面弄脏 ────────────────
// 做法：台词放在一块米白纸片上（旋转 -1°、手撕边、带投影），文字用深墨，关键词换芥黄。

import { piece, tornRect, n } from './style/papercut.js';
import { P } from './style/palette.js';
import { W, FONT } from './config.js';
import { clamp, easeOutBack } from './anim.js';

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
  const lines = wrap(text, fs, maxW);
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
export function hookStrip(text: string, y: number, ink: (c: string) => string, seed: number, prog = 1): string {
  const fs = 52;
  const lines = wrap(text, fs, W - 260);
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
          P.paper
        )}" text-anchor="middle" xml:space="preserve">${escapeXml(l)}</text>`
    )
    .join('');

  return `<g opacity="${n(alpha)}" transform="rotate(1 ${n(W / 2)} ${n(y)})">
    ${piece(tornRect(x, y + dy, boxW, boxH, seed, 1.6, 18), ink(P.primary), { dx: 4, dy: 6, shadowAlpha: 0.2 })}
    ${body}
  </g>`;
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
