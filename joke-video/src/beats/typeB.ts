// ── B 类结构：旁白叙述 ────────────────────────────────────────────────
//
// 跟 A 类（对话反转）的根本区别：
//
//   A 类：两个角色你来我往，**必须有且只有一句 punch**，
//         整条时间轴、BGM 骤停、定格去色全从 punch 推出来。
//   B 类：一个旁白从头讲到尾，角色只演不说（或偶尔说一两句），
//         **没有笑点锚点**，是线性推进的若干情节点。
//
// 所以 B 类不做定格去色、不做 BGM 骤停——那是抖包袱的手法，
// 睡前故事用了会把人吓醒。结尾是缓慢淡出 + 尾字幕。
//
// 时长完全由旁白决定：每句配音多长，那一镜就多长。画面跟着声音走，不是反过来。

import { lineText, type JokeCfg, type Timeline, type Segment, type SfxCue } from '../types.js';
import { getPace } from '../pace.js';

/** 没有配音时的时长估算：中文约每字 0.22s（跟 A 类同一口径） */
export function estimateDur(text: string): number {
  return Math.max(1.1, [...text].length * 0.22 + 0.5);
}

export function buildTimelineB(cfg: JokeCfg): Timeline {
  // 三层停顿全从预设来，别在这里写死数值——写死了下一条片子又要从头试
  const pace = getPace(cfg.pace, 'narrate');
  const intro = cfg.intro ?? 1.6;
  // B 类没有 freeze，末尾只留一段 hold 给尾字幕
  const holdDur = cfg.hold ?? 2.4;

  const segments: Segment[] = [{ kind: 'intro', start: 0, end: intro }];
  const sfx: SfxCue[] = [];

  /** 两句是不是同一镜（在场名单和场景都没变） */
  const sameShot = (a: number, b: number) => {
    const x = cfg.lines[a];
    const y = cfg.lines[b];
    if (!x || !y) return false;
    const sx = (x.stage ?? []).join(',');
    const sy = (y.stage ?? []).join(',');
    return sx === sy && (x.scene ?? cfg.scene) === (y.scene ?? cfg.scene);
  };

  let t = intro;
  cfg.lines.forEach((line, i) => {
    const padBefore = line.padBefore ?? pace.padBefore;
    const dur = line.dur ?? estimateDur(lineText(line));

    // 停顿跟着**画面**走，不是均匀撒：**换镜的地方多留一拍**，
    // 让新画面落定、观众跟上，故事才有呼吸感。
    // 全程一个间隔就是"一口气读完"，睡前故事最忌这个。
    const shotEnds = i === cfg.lines.length - 1 || !sameShot(i, i + 1);
    const padAfter = line.padAfter ?? (shotEnds ? pace.padAfterShot : pace.padAfter);

    const start = t + padBefore;
    const end = start + dur;
    segments.push({ kind: 'line', start, end: end + padAfter, line, lineIndex: i });
    t = end + padAfter;
  });

  // 结尾：不去色、不骤停，就是安安静静停住
  const freezeStart = t;
  segments.push({ kind: 'hold', start: freezeStart, end: freezeStart + holdDur });
  const duration = freezeStart + holdDur;

  if ((cfg.ambience ?? 'none') !== 'none') {
    sfx.push({ name: 'grass', at: 0, until: duration });
  }

  // punchStart/punchEnd 在 B 类里没有语义，指向末尾让下游代码不至于炸
  return { cfg, segments, duration, punchStart: freezeStart, punchEnd: freezeStart, freezeStart, sfx };
}
