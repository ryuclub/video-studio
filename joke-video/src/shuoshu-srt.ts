// ── 字幕：把「一段话 + 它的起止时间」切成能读的几条 ────────────────────
//
// 说书的段落是**按呼吸写的，不是按屏幕写的**：一段五十多个字、十几秒，
// 直接当一条字幕就是满屏一堵墙。所以要在段落内部再切。
//
// 切在哪：标点。念的时候本来就在那儿停。
// 时间怎么给：**先按字数比例算，再吸到波形里最近的那个能量谷**。
//
// 为什么要吸：纯比例分是"平均语速"假设，可实际上句尾会拖、逗号会停，
// 误差累到段末能有半秒——字幕比声音早半秒出，看着就是抢拍。
// 而 Edge 在标点处本来就插了静音，谷底找得到，吸过去就是**真的那一停**。
//
// 只用得上已经合成好的波形，不需要 Edge 的 wordBoundary，
// 也就不用为了字幕去动 tts.ts 的缓存结构。

/** 一条字幕 */
export interface SrtCue {
  start: number;
  end: number;
  text: string;
}

/** 一条字幕最多几个字。中文单行 20 字在 1080p 上是舒服的上限 */
const MAX_CHARS = 20;
/** 短于这个的字幕读不完，宁可跟前一条并着 */
const MIN_SEC = 0.8;

/** 算时长权重：只数字，标点不占时间 */
const weigh = (s: string) => (s.match(/[一-龥a-zA-Z0-9]/g) ?? []).length;

/** 按标点打散，标点跟着前一句走 */
export function clauses(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if ('。！？…；：，、'.includes(ch)) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur);
  return out.filter((c) => c.trim());
}

/**
 * 把一段话打包成若干条字幕文本。
 *
 * 贪心：能装下就接着装。**优先在句末（。！？）断**——
 * 一条字幕跨句号读起来最别扭，跨逗号无所谓。
 */
export function packLines(text: string, max = MAX_CHARS): string[] {
  const cs = clauses(text);
  const out: string[] = [];
  let cur = '';
  for (const c of cs) {
    const endsSentence = /[。！？…]$/.test(cur);
    if (cur && (weigh(cur + c) > max || (endsSentence && weigh(cur) >= max * 0.6))) {
      out.push(cur);
      cur = '';
    }
    cur += c;
    // 单个小句就超长（没标点的长句），硬切
    while (weigh(cur) > max * 1.4) {
      let n = 0;
      let cut = 0;
      for (const ch of cur) {
        cut++;
        if (weigh(ch)) n++;
        if (n >= max) break;
      }
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * 把边界时刻吸到最近的能量谷。
 * @param body 这一段自己的波形（已经去掉首尾静音）
 * @param t    段内的相对时刻（秒）
 * @param win  往两边找多远
 */
export function snapToDip(body: Float32Array, sr: number, t: number, win = 0.45): number {
  const hop = Math.round(0.02 * sr);
  const dur = body.length / sr;
  // 太靠边就别吸了，吸过去会把字幕挤成负时长
  if (t < 0.3 || t > dur - 0.3) return t;

  const lo = Math.max(Math.round((t - win) * sr), Math.round(0.2 * sr));
  const hi = Math.min(Math.round((t + win) * sr), body.length - hop - Math.round(0.2 * sr));
  if (hi <= lo) return t;

  let best = t;
  let bestE = Infinity;
  for (let i = lo; i <= hi; i += hop) {
    let e = 0;
    for (let k = 0; k < hop; k++) e += body[i + k] * body[i + k];
    // 同样深的谷，取离原时刻近的那个——别为了 0.1dB 把字幕拽走半秒
    const penalty = 1 + Math.abs(i / sr - t) * 0.15;
    const v = Math.sqrt(e / hop) * penalty;
    if (v < bestE) {
      bestE = v;
      best = i / sr + hop / sr / 2;
    }
  }
  return best;
}

/**
 * 一个声部 → 若干条字幕。
 * body 传进来就吸谷，不传就纯按字数比例分。
 */
export function cueToSrt(
  cue: { start: number; end: number; text: string },
  body?: Float32Array,
  sr = 48000
): SrtCue[] {
  const lines = packLines(cue.text);
  if (lines.length === 1) return [{ start: cue.start, end: cue.end, text: cue.text }];

  const total = lines.reduce((n, l) => n + weigh(l), 0) || 1;
  const span = cue.end - cue.start;

  // ① 按字数比例定内部边界
  const bounds: number[] = [];
  let acc = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    acc += weigh(lines[i]);
    bounds.push((acc / total) * span);
  }
  // ② 吸到波形的谷底
  const snapped = body ? bounds.map((b) => snapToDip(body, sr, b)) : bounds;
  // ③ 吸完可能乱序（两个边界抢同一个谷），排一下并保底最短时长
  snapped.sort((a, b) => a - b);
  for (let i = 0; i < snapped.length; i++) {
    const prev = i === 0 ? 0 : snapped[i - 1];
    if (snapped[i] - prev < MIN_SEC * 0.5) snapped[i] = prev + MIN_SEC * 0.5;
  }

  const out: SrtCue[] = [];
  for (let i = 0; i < lines.length; i++) {
    const s = i === 0 ? 0 : snapped[i - 1];
    const e = i === lines.length - 1 ? span : snapped[i];
    out.push({ start: cue.start + s, end: cue.start + Math.max(e, s + 0.3), text: lines[i] });
  }
  return out;
}

const stamp = (sec: number) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(t).padStart(3, '0')}`;
};

/**
 * 拼成 srt 文本。
 *
 * 带 UTF-8 BOM —— Windows 上一堆播放器（PotPlayer、旧版 MPC）不认没 BOM 的 UTF-8，
 * 会按 GBK 解，中文全成乱码。ffmpeg 烧字幕不受影响。
 */
/**
 * 去掉每条字幕**末尾**的标点。
 *
 * 频道规范：字幕结尾不留标点。句读靠断句和停顿已经交代清楚了，
 * 屏幕上那个句号只是噪声；一条字幕最后挂个逗号更难看——它在暗示"还有下半句"，
 * 可下半句是另一条字幕。
 *
 * **只去末尾，句子内部的照留**——「他问：姑娘，天还没亮」里面的逗号是节奏，
 * 去掉就读不通了。
 */
export function trimTailPunct(s: string): string {
  return s.trim().replace(/[。，、；：！？…·—.,;:!?]+$/u, '').trim();
}

/**
 * 一行字**中间**的句号换成逗号。
 *
 * 屏幕上的一行不是纸上的一段：一行字里蹦出一个句号，读起来像话已经完了、
 * 可后面还接着 —— 「三点十三分。三点二十」这种在屏幕上很怪。同一个位置写逗号，
 * 停顿的意思一样在，看着才是一行话。
 *
 * **只动句中的，末尾那个不管** —— 末尾归 `trimTailPunct`。
 * 句中的逗号、顿号、冒号一律照留，那是节奏（跟 `trimTailPunct` 同一条界）。
 *
 * 半角的 `.` 不碰：那多半是数字（3.5）或西文缩写，换成逗号就错了。
 */
export function midPeriodToComma(s: string): string {
  // 后面还有非空白、非句号的字 → 这个句号在句中
  return s.replace(/。(?=[\s\S]*[^\s。])/gu, '，');
}

/**
 * **屏幕上的一行字，统一走这儿。**
 *
 * 去尾标点 ＋ 句中句号换逗号。新起任何一条要把字放到画面上的管线，
 * 第一件事就是把这个函数接上 —— 这两条都是频道规范，
 * 而规范每次靠人记着就每次都会漏（尾标点那条用户提醒过很多次）。
 *
 * 现在接着的：`toSrt`（说书烧字幕 ＋ 治愈/心理的 .srt）、
 * `xinli-text.ts`（文字版正文层）、`zhiyu-scene.ts`（题句卡横排）、
 * `subtitle.ts`（段子与《一页故事》的台词条，带 `keepTone`）。
 * 另外两个 npm 工程导不进来，各照抄了一份：`src/lib/ass.ts`（记者读稿）、
 * `video-pipeline/src/layers/scenes.ts`（动效面板）。**改规则三处一起改。**
 *
 * ── `keepTone`：留住结尾的 ！和 ？ ──
 *
 * 旁白线上的 `！？` 跟句号一样是噪声，去掉。**段子和《一页故事》的台词不一样** ——
 * 「打蛋了！」「我们把它滚回去吧！」那个感叹号是包袱的语气，不是标点。
 * 54 条台词里有 8 条落在这个情况上，一刀切掉等于把语气一起切了。
 * 所以那条线传 `keepTone: true`：句号、逗号、冒号照去，只留 `！？`。
 */
export function tidyCaption(s: string, opts: { keepTone?: boolean } = {}): string {
  const trimmed = opts.keepTone
    ? s.trim().replace(/(?<![！？])[。，、；：…·—.,;:]+$/u, '').trim()
    : trimTailPunct(s);
  return midPeriodToComma(trimmed);
}

/**
 * 整体平移时间轴。
 * 片头压了几秒封面，音轨跟着延后，字幕也得跟着走，否则会提前几秒出现。
 */
export function shiftSrt(srt: string, seconds: number): string {
  const bump = (m: string) => {
    const [h, mi, rest] = m.split(':');
    const [s, ms] = rest.split(',');
    const t = Number(h) * 3600 + Number(mi) * 60 + Number(s) + Number(ms) / 1000 + seconds;
    const ms2 = Math.max(0, Math.round(t * 1000));
    const hh = Math.floor(ms2 / 3600000);
    const mm = Math.floor((ms2 % 3600000) / 60000);
    const ss = Math.floor((ms2 % 60000) / 1000);
    const mmm = ms2 % 1000;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(mmm).padStart(3, '0')}`;
  };
  return srt.replace(/\d{2}:\d{2}:\d{2},\d{3}/g, bump);
}

export function toSrt(cues: SrtCue[]): string {
  const body = cues
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${tidyCaption(c.text)}\n`)
    .join('\n');
  return '﻿' + body;
}
