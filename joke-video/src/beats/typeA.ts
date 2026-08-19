// ── A 类结构：对话反转 ────────────────────────────────────────────────
// 铺垫 → 提问 → 回应 → 反转 → 定格留白。
// 这一层是整套方案里最值钱的部分：换段子、换动物、换人都不改这里。

import { lineText, type JokeCfg, type Timeline, type Segment, type SfxCue } from '../types.js';


/** 没有配音时的时长估算：中文约每字 0.22s */
export function estimateDur(text: string): number {
  return Math.max(1.1, [...text].length * 0.22 + 0.5);
}

import { buildTimelineB } from './typeB.js';

/** 按 type 分发。A 对话反转 / B 旁白叙述 */
export function buildTimeline(cfg: JokeCfg): Timeline {
  if (cfg.type === 'B') return buildTimelineB(cfg);
  return buildTimelineA(cfg);
}

function buildTimelineA(cfg: JokeCfg): Timeline {
  const intro = cfg.intro ?? 2.0;
  const freezeDur = cfg.freeze ?? 2.0;
  const holdDur = cfg.hold ?? 4.0;

  const segments: Segment[] = [{ kind: 'intro', start: 0, end: intro }];
  const sfx: SfxCue[] = [];

  let t = intro;
  let punchStart = intro;
  let punchEnd = intro;

  cfg.lines.forEach((line, i) => {
    const padBefore = line.padBefore ?? (line.beat === 'punch' ? 0.4 : 0.15);
    const dur = line.dur ?? estimateDur(lineText(line));
    const padAfter = line.padAfter ?? (line.beat === 'punch' ? 0.35 : 0.2);
    const start = t + padBefore;
    const end = start + dur;
    segments.push({ kind: 'line', start, end: end + padAfter, line, lineIndex: i });

    // 字幕弹入的小 pop。默认关掉：它是 780→420Hz 的正弦扫频，听感是个音高明确的
    // "do"，每句话前面来一下，三句就腻了，而且盖住台词起头的字。
    // 想要就在 json 里写 "cues": { "subtitlePop": true }。
    if (cfg.cues?.subtitlePop) sfx.push({ name: 'pop', at: start - 0.04, gain: 0.5 });
    // 回应句用木鱼点一下（这个有节拍作用，默认留着）
    if (line.beat === 'reply' && (cfg.cues?.replyWood ?? true)) sfx.push({ name: 'wood', at: start - 0.06 });
    // 反转句尾拖一个下滑音
    if (line.beat === 'punch') {
      punchStart = start;
      punchEnd = end;
      sfx.push({ name: 'slide', at: Math.max(start, end - 0.55) });
    }
    t = end + padAfter;
  });

  const freezeStart = t;
  segments.push({ kind: 'freeze', start: freezeStart, end: freezeStart + freezeDur });
  segments.push({ kind: 'hold', start: freezeStart + freezeDur, end: freezeStart + freezeDur + holdDur });
  const duration = freezeStart + freezeDur + holdDur;

  // 定格那一下：BGM 骤停 + 咚
  sfx.push({ name: 'thud', at: freezeStart });
  // 定格之后的蝉鸣（死寂里的夏天）
  if ((cfg.ambience ?? 'grass') !== 'none') {
    sfx.push({ name: 'grass', at: 0, until: intro + 0.6 });
    sfx.push({ name: 'cicada', at: freezeStart + 0.25, until: duration });
  }
  // 开场的一声"嘶"（蛇专属，换成人物记得关掉）
  if (cfg.cues?.introHiss ?? true) sfx.push({ name: 'hiss', at: intro * 0.55 });

  return { cfg, segments, duration, punchStart, punchEnd, freezeStart, sfx };
}

export function segAt(tl: Timeline, t: number): Segment {
  for (const s of tl.segments) if (t >= s.start && t < s.end) return s;
  return tl.segments[tl.segments.length - 1];
}

/** 当前正在说话的行（不含 pad） */
export function speakingAt(tl: Timeline, t: number): { line: import('../types.js').LineCfg; index: number; local: number } | null {
  for (const s of tl.segments) {
    if (s.kind !== 'line' || !s.line) continue;
    const dur = s.line.dur ?? estimateDur(lineText(s.line));
    if (t >= s.start && t < s.start + dur) return { line: s.line, index: s.lineIndex!, local: t - s.start };
  }
  return null;
}

/** 当前应该显示的字幕（说话中 + 说完后的 pad 期间继续显示） */
export function subtitleAt(tl: Timeline, t: number): { line: import('../types.js').LineCfg; index: number; prog: number } | null {
  for (const s of tl.segments) {
    if (s.kind !== 'line' || !s.line) continue;
    if (t >= s.start - 0.12 && t < s.end) {
      return { line: s.line, index: s.lineIndex!, prog: Math.min(1, (t - (s.start - 0.12)) / 0.22) };
    }
  }
  return null;
}
