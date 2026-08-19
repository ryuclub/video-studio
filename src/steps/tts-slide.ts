import fs from 'node:fs';
import path from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { CONFIG } from '../config.js';
import type { SlideScript, SlideTimeline, WordStamp } from '../types.js';
import { ffmpeg, durationMs, log } from '../lib/util.js';
import { stripPunct } from '../lib/slides.js';

/**
 * PPT 风的配音：整条一次性合成，时间轴靠 TTS 的词级时间戳还原。
 *
 * 跟 tts.ts 的逐行合成是两种取舍：
 *  - 逐行：时间轴天然精确到行，但每行都有一次语调重置，连读听得出接缝
 *  - 整条：语调从头到尾连贯，代价是时间轴要自己从词级时间戳里算回来
 *
 * PPT 风是「一个人从头讲到尾」，接缝比时间轴精度更要命，所以走整条。
 *
 * 一个反直觉的限制：**SSML 的 <break> 在 Edge TTS 免费端点上用不了** ——
 * 服务端收到停顿标签就掐断连接、返回 0 字节，失败长得跟断线一模一样。
 * 所以停顿只能靠标点：实测逗号 250ms、分号 289ms、句号/叹号/问号 580–605ms。
 * 要更精确就在成品音轨上按词级时间戳裁静音，别再往文本里塞标签。
 * 完整实测见 history/PPT-STYLE.md 第七节。
 */

/** metadata 是一串首尾相接的多行 JSON，正则抓比 JSON.parse 稳 */
const WORD_RE = /"Offset":\s*(\d+),\s*"Duration":\s*(\d+),\s*"text":\s*\{\s*"Text":\s*"([^"]*)"/g;

async function synthWhole(text: string): Promise<{ mp3: Buffer; words: WordStamp[] }> {
  const MAX = 3;
  for (let attempt = 1; ; attempt++) {
    const tts = new MsEdgeTTS();
    try {
      await tts.setMetadata(CONFIG.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3, {
        wordBoundaryEnabled: true,
      });
      const { audioStream, metadataStream } = tts.toStream(text, { rate: CONFIG.rate });
      const chunks: Buffer[] = [];
      let raw = '';
      audioStream.on('data', (c: Buffer) => chunks.push(c));
      metadataStream?.on('data', (c: Buffer) => { raw += c.toString(); });
      const done = (s: NodeJS.ReadableStream | null) =>
        s
          ? new Promise<void>((r) => {
              s.on('end', () => r());
              s.on('close', () => r());
              s.on('error', () => r());
            })
          : Promise.resolve();
      await Promise.all([done(audioStream), done(metadataStream)]);
      // metadata 通常比音频晚一点收完
      await new Promise((r) => setTimeout(r, 1200));

      const mp3 = Buffer.concat(chunks);
      if (mp3.length === 0) {
        throw new Error(
          '合成返回空音频。若解说词里混入了 <break> 之类的 SSML 标签，' +
            '服务端会直接掐断连接 —— 停顿请用标点，不要用标签',
        );
      }
      const words = [...raw.matchAll(WORD_RE)].map((m) => ({
        offMs: Number(m[1]) / 10000,
        durMs: Number(m[2]) / 10000,
        text: m[3],
      }));
      if (words.length === 0) throw new Error('没拿到词级时间戳，无法定位分镜');
      return { mp3, words };
    } catch (e) {
      if (attempt >= MAX) throw e;
      log('tts', `第 ${attempt} 次失败，重连后重试`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    } finally {
      tts.close();
    }
  }
}

export async function synthesizeSlide(dir: string, script: SlideScript): Promise<SlideTimeline> {
  const text = script.narration.replace(/\s+/g, '');
  log('tts', `整条合成 ${text.length} 字（${CONFIG.voice} ${CONFIG.rate}）`);

  const { mp3, words } = await synthWhole(text);

  const rawFile = path.join(dir, 'voice_raw.mp3');
  fs.writeFileSync(rawFile, mp3);
  // Edge 出的是 24kHz，属于 MPEG-2 低采样率扩展，部分播放器认得出文件却放不出声。
  // 统一转成 44.1kHz，跟另一套风格保持一致。
  const audioFile = path.join(dir, 'voice.mp3');
  await ffmpeg(['-i', rawFile, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1', audioFile]);
  fs.unlinkSync(rawFile);

  /*
   * 建「原文字符位置 → 毫秒」的表。
   *
   * 这张表是整条链路的地基：分镜的 anchor 全靠查它定位。
   * 所以这里必须严格校验 —— 词事件拼起来要跟去标点的解说词逐字相等。
   * 不等就说明 TTS 对某个词做了归一化（数字、外文缩写最常见），
   * 那样后面所有锚点都会整体错位，宁可现在报错也不要出一条画面对不上的片子。
   */
  const plain = stripPunct(text);
  const joined = words.map((w) => w.text).join('');
  if (joined !== plain) {
    let at = 0;
    while (at < joined.length && at < plain.length && joined[at] === plain[at]) at++;
    throw new Error(
      `词级时间戳无法与解说词对齐（第 ${at} 字起）。\n` +
        `  TTS 读成: ${JSON.stringify(joined.slice(Math.max(0, at - 10), at + 16))}\n` +
        `  解说词是: ${JSON.stringify(plain.slice(Math.max(0, at - 10), at + 16))}\n` +
        `  多半是数字或外文缩写被 TTS 归一化了，把那个词改成中文写法即可。`,
    );
  }

  const charMs: number[] = new Array(plain.length);
  let i = 0;
  for (const w of words) {
    for (let j = 0; j < w.text.length; j++, i++) {
      // 词内按时长均分到字，够用了 —— 分镜切换点只落在句读处
      charMs[i] = Math.round(w.offMs + (w.durMs * j) / w.text.length);
    }
  }

  const actual = await durationMs(audioFile);
  const timeline: SlideTimeline = {
    audioFile,
    totalMs: Math.max(actual, Math.round(words[words.length - 1].offMs + words[words.length - 1].durMs)),
    words,
    plain,
    charMs,
  };
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(timeline), 'utf8');
  log('tts', `${words.length} 个词 / 总时长 ${(timeline.totalMs / 1000).toFixed(1)}s → voice.mp3`);
  return timeline;
}
