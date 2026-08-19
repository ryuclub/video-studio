// ── 混音：配音 + 音效 + BGM ───────────────────────────────────────────

import { SR, GAIN, PEAK_DBFS } from '../config.js';
import { add, normalize, softClip } from './dsp.js';
import { sfx, PERCUSSIVE, AMBIENT, type SfxName } from './sfx.js';
import { makeBgm } from './bgm.js';
import type { Timeline } from '../types.js';

export function mixdown(tl: Timeline, voices: Map<number, Float32Array>): Float32Array {
  const n = Math.ceil((tl.duration + 0.3) * SR);
  const bus = new Float32Array(n);

  // BGM：笑点定格处骤停
  const bgmCfg = tl.cfg.bgm ?? {};
  if (bgmCfg.enabled !== false) {
    const stop = bgmCfg.stopAtPunch === false ? undefined : tl.freezeStart;
    const bgm = makeBgm(tl.duration + 0.2, stop, bgmCfg.key ?? 'happy');
    add(bus, bgm, 0, bgmCfg.gain ?? GAIN.bgm);
  }

  // 音效
  for (const cue of tl.sfx) {
    const name = cue.name as SfxName;
    const isAmb = AMBIENT.includes(name);
    const isPerc = PERCUSSIVE.includes(name);
    const baseGain = cue.gain ?? 1;
    const g = baseGain * (isAmb ? GAIN.ambience : isPerc ? GAIN.sfxPercussive : GAIN.sfxTonal);
    if (cue.until != null) {
      // 铺底：循环到 until
      const dur = cue.until - cue.at;
      const buf = sfx(name, name === 'cicada' ? dur : undefined);
      let at = Math.floor(cue.at * SR);
      const end = Math.floor(cue.until * SR);
      while (at < end) {
        add(bus, buf, at, g);
        at += buf.length;
      }
    } else {
      add(bus, sfx(name), Math.floor(cue.at * SR), g);
    }
  }

  // 配音：**直接用时间轴里已经算好的 segment.start**，不要在这里重算一遍。
  //
  // 早先这里自己按 padBefore 0.15 / padAfter 0.2 推了一遍时间，
  // 而 typeB 用的是 0.25 / 0.35（换镜 1.2）——两边各算各的，每句差一点，
  // **逐句累积**，22 句下来音画能差十几秒。表现就是"音频和字幕不在一个节奏上"，
  // 而且越到后面越离谱。
  //
  // 时间轴只能有一份。谁要改停顿，改 beats/ 里那一处，音频自动跟上。
  for (const seg of tl.segments) {
    if (seg.kind !== 'line' || seg.lineIndex == null) continue;
    const v = voices.get(seg.lineIndex);
    // 逐句增益：说书靠音量起伏做远近，不能全片一个响度
    if (v) add(bus, v, Math.floor(seg.start * SR), GAIN.voice * (seg.line?.gain ?? 1));
  }

  return normalize(softClip(bus), PEAK_DBFS);
}
