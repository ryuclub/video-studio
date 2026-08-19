import fs from 'node:fs';
import path from 'node:path';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { CONFIG, ensureDir } from '../config.js';
import type { Script, Timeline, LineTiming } from '../types.js';
import { ffmpeg, durationMs, applyLexicon, log } from '../lib/util.js';

/**
 * 逐行合成，而不是整篇合成后再切。
 *
 * 这样时间轴天然精确到行，不依赖 TTS 的词级时间戳回调 —— 那个 API 在不同
 * 库版本之间变过好几次，逐行测量更稳，也让换 TTS 后端（Azure / ElevenLabs）
 * 只需要替换 TtsBackend 一个接口。
 *
 * 副作用是句间会有轻微的语气断点，但这类解说本来就要顿挫，反而合适。
 */
export interface TtsBackend {
  synthesize(text: string, outFile: string): Promise<void>;
  close(): void;
}

class EdgeTts implements TtsBackend {
  private tts: MsEdgeTTS | null = null;

  private async client(): Promise<MsEdgeTTS> {
    if (!this.tts) {
      const t = new MsEdgeTTS();
      // 一次握手复用到底，70 行就不用开 70 个 WebSocket
      await t.setMetadata(CONFIG.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      this.tts = t;
    }
    return this.tts;
  }

  private async once(text: string, outFile: string): Promise<void> {
    const tts = await this.client();
    const { audioStream } = tts.toStream(text, { rate: CONFIG.rate });
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(outFile);
      audioStream.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
      audioStream.on('error', reject);
    });
    if (fs.statSync(outFile).size === 0) {
      throw new Error('TTS 返回空音频');
    }
  }

  /**
   * 断线重连重试。
   *
   * 复用长连接省握手，但服务端跑几十行之后必然把它掐掉，之后 toStream 会
   * 安静地返回空流 —— 不报错，只是写出 0 字节。所以空音频要当成「连接死了」
   * 处理：重新握手再来，而不是直接判定音色名非法。
   * 10 行的冒烟测试碰不到这个，60 行的真片一定会碰到。
   */
  async synthesize(text: string, outFile: string): Promise<void> {
    const MAX = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await this.once(text, outFile);
        return;
      } catch (e) {
        if (attempt >= MAX) {
          throw new Error(
            `TTS 连续 ${MAX} 次失败：${e instanceof Error ? e.message : e}。` +
              `若每次都是空音频，检查音色名是否有效：${CONFIG.voice}`,
          );
        }
        log('tts', `第 ${attempt} 次失败，重连后重试`);
        this.close();
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  close(): void {
    this.tts?.close();
    this.tts = null;
  }
}

/**
 * 削掉每段合成的头尾静音。
 *
 * Edge TTS 每段都会自己带上一头一尾的静音（本机实测 0.73–0.99 秒/段），
 * 五十行就白搭近一分钟，听感上就是"字与字之间全是空的"。
 * 两遍 silenceremove 中间夹一个 areverse 是削尾的标准写法；
 * start_periods=1 保证只削首尾各一段，句内的自然停顿不会被吃掉。
 *
 * 头留 50ms、尾留 60ms —— 削到零会连起始辅音一起削掉，"四"会变成"i"。
 * 修剪之后再量时长，时间轴自然跟着对齐；句间留白改由 pauseAfterMs 显式控制。
 */
const TRIM_FILTER = [
  'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak',
  'areverse',
  'silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB:detection=peak',
  'areverse',
].join(',');

async function trimEdges(file: string): Promise<void> {
  const tmp = `${file}.trim.mp3`;
  await ffmpeg(['-i', file, '-af', TRIM_FILTER, '-c:a', 'libmp3lame', '-b:a', '96k', tmp]);
  // 整段都在阈值以下（极轻的语气词）时会被削成空文件，那种情况宁可留原样
  if (fs.statSync(tmp).size === 0) {
    fs.unlinkSync(tmp);
    return;
  }
  fs.renameSync(tmp, file);
}

/** 生成一段静音，用于 chip 停留和句间留白 */
async function silence(ms: number, outFile: string): Promise<void> {
  await ffmpeg([
    '-f', 'lavfi',
    '-i', 'anullsrc=channel_layout=mono:sample_rate=24000',
    '-t', (ms / 1000).toFixed(3),
    '-c:a', 'libmp3lame', '-b:a', '96k',
    outFile,
  ]);
}

export async function synthesize(
  dir: string,
  script: Script,
  backend: TtsBackend = new EdgeTts(),
): Promise<Timeline> {
  const partsDir = ensureDir(path.join(dir, 'voice'));
  const timings: LineTiming[] = [];
  const concatParts: string[] = [];
  let cursor = 0;

  try {
    for (let i = 0; i < script.lines.length; i++) {
      const line = script.lines[i];
      const raw = line.speech !== undefined ? line.speech : line.text;
      // 屏幕上的换行和角标竖线不该被读出来
      const spoken = raw
        .replace(/\\n/g, '')
        .replace(/\r?\n/g, '')
        .replace(/\s*\|\s*/g, '，')
        .trim();

      const file = path.join(partsDir, `${String(i).padStart(3, '0')}.mp3`);
      let dur: number;

      if (spoken.length === 0) {
        // 无配音行（通常是 chip）：静音占位，停留时长由 pauseAfterMs 决定。
        // pauseAfterMs 写 0 是合法的（stack 组的首行要跟下一行同时出现，不留白），
        // 但 0 秒静音会生成一个只有帧头、没有音频帧的 mp3 ——
        // concat 读到它会**静默截断整条人声**，后面几分钟的配音全没了，还不报错。
        // 所以 0 秒的段根本不生成，也不进 concat。
        dur = line.pauseAfterMs ?? 2200;
        if (dur <= 0) {
          timings.push({ index: i, startMs: cursor, endMs: cursor });
          continue;
        }
        await silence(dur, file);
      } else {
        await backend.synthesize(applyLexicon(spoken), file);
        await trimEdges(file);
        dur = await durationMs(file);
      }

      timings.push({ index: i, startMs: cursor, endMs: cursor + dur });
      concatParts.push(file);
      cursor += dur;

      // 句后停顿（无配音行的停顿已计入自身时长，不重复加）
      const pause = spoken.length === 0 ? 0 : (line.pauseAfterMs ?? 160);
      if (pause > 0) {
        const gap = path.join(partsDir, `${String(i).padStart(3, '0')}_gap.mp3`);
        await silence(pause, gap);
        concatParts.push(gap);
        cursor += pause;
      }

      if ((i + 1) % 10 === 0) log('tts', `${i + 1}/${script.lines.length}`);
    }
  } finally {
    backend.close();
  }

  // 拼接成整条人声。这里重新编码而不是 -c copy：
  // 各段 mp3 的帧参数不保证完全一致，copy 拼出来时长会漂，字幕就会越走越偏
  const listFile = path.join(partsDir, 'concat.txt');
  fs.writeFileSync(
    listFile,
    concatParts.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );
  // 输出 44.1kHz：Edge TTS 原始就是 24kHz，升采样不增加音质，但 24kHz 属于
  // MPEG-2 Layer III 低采样率扩展，部分播放器认得出文件却放不出声。
  // 44.1kHz 是 MPEG-1 标准采样率，到处都能放。
  const audioFile = path.join(dir, 'voice.mp3');
  await ffmpeg([
    '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1',
    audioFile,
  ]);

  // 拼出来的实际时长必须跟逐行累加对得上。
  // 原来这里写的是 Math.max(cursor, actual) —— 截断被 cursor 盖住，
  // 日志照常打印「总时长 295.4s」，直到成片放到一半没声音才发现。
  const actual = await durationMs(audioFile);
  const drift = Math.abs(actual - cursor);
  if (drift > 500) {
    throw new Error(
      `人声拼接后时长对不上：逐行累加 ${(cursor / 1000).toFixed(1)}s，` +
        `实际 ${(actual / 1000).toFixed(1)}s，差 ${(drift / 1000).toFixed(1)}s。` +
        '通常是某一段 mp3 无效（0 秒静音或合成失败），concat 读到它会静默截断。' +
        `  排查：ffprobe voice/*.mp3，找时长读不出来的那一段`,
    );
  }
  const timeline: Timeline = { audioFile, totalMs: Math.max(cursor, actual), lines: timings };
  fs.writeFileSync(path.join(dir, 'timeline.json'), JSON.stringify(timeline, null, 2), 'utf8');
  log('tts', `总时长 ${(timeline.totalMs / 1000).toFixed(1)}s → voice.mp3`);
  return timeline;
}
