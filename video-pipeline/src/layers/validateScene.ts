import type { SceneSpec } from '../types';
import { cityXY } from './japan-geo';

/**
 * 场景数据校验 —— 硬拦截，不出片。
 *
 * 为什么要这么严：
 * 稿件里的数字是散文式的（「从不到两成涨到将近一半」「三年翻了两番」），
 * 让 LLM 自动提取成 series 一定会错。而**图表里的数字错了比不做图糟糕得多** ——
 * 观众记住的就是那个数字，说错了是硬伤，事后无法挽回。
 *
 * 所以宁可在渲染阶段直接失败，也不让一条带错数字的片子出去。
 * LLM 只负责标位置和建议图型，数据字段必须由人填。
 */
export function validateScene(scene: SceneSpec, shotId: string): void {
  const bad = (msg: string): never => {
    throw new Error(`[${shotId}] ${scene.kind}：${msg}`);
  };

  switch (scene.kind) {
    case 'lineChart':
    case 'barChart': {
      if (!scene.series || !scene.series.length) {
        bad('series 未填。数据必须人工确认后填入，不能由稿件自动提取');
      }
      if (scene.series!.some((v) => typeof v !== 'number' || !isFinite(v))) {
        bad('series 含非数字或 NaN');
      }
      if (scene.kind === 'barChart') {
        if (!scene.labels || !scene.labels.length) bad('barChart 必须提供 labels');
        if (scene.labels!.length !== scene.series!.length) {
          bad(`labels(${scene.labels!.length}) 与 series(${scene.series!.length}) 数量不一致`);
        }
        if (scene.series!.length > 8) bad(`柱子 ${scene.series!.length} 根太多，8 根以内才读得清`);
      } else if (scene.labels && scene.labels.length && scene.labels.length !== scene.series!.length) {
        bad(`labels(${scene.labels.length}) 与 series(${scene.series!.length}) 数量不一致`);
      }
      break;
    }

    case 'counter': {
      const vs = scene.values;
      if (vs && vs.length) {
        if (vs.length > 3) bad(`并排 ${vs.length} 个数字太多，2-3 个才有对比效果`);
        for (const v of vs) {
          if (typeof v.to !== 'number' || !isFinite(v.to)) bad(`values 里 "${v.label}" 的 to 未填或非数字`);
          if (typeof v.from !== 'number' || !isFinite(v.from)) bad(`values 里 "${v.label}" 的 from 未填或非数字`);
        }
      } else {
        if (typeof scene.to !== 'number' || !isFinite(scene.to)) {
          bad('to 未填。单个数字用 from/to，并排多个用 values[]');
        }
      }
      break;
    }

    case 'timeline': {
      if (!scene.events || !scene.events.length) bad('events 未填');
      if (scene.events!.length > 6) {
        bad(`节点 ${scene.events!.length} 个太多，超过 6 个文字会挤在一起（建议 4-5 个）`);
      }
      for (const e of scene.events!) {
        if (!e.year || !e.text) bad('events 里有条目缺 year 或 text');
      }
      break;
    }

    case 'quote': {
      if (!scene.text) bad('text 未填');
      if (scene.text!.length > 80) bad(`引文 ${scene.text!.length} 字太长，80 字以内才放得下`);
      // 关键词写错了不会报错，只会静默不高亮 —— 那就等于白写，所以这里拦住
      for (const k of scene.emphasize ?? []) {
        if (!scene.text!.includes(k)) bad(`emphasize 里的「${k}」不在 text 中，检查是否有错字`);
      }
      break;
    }

    case 'steps': {
      const items = scene.items;
      if (!items || items.length < 2) bad('items 至少 2 条。只有 1 条该用 quote');
      if (items!.length > 5) bad(`${items!.length} 条太多，5 条以内才读得完（超过 5 条观众记不住）`);
      for (const it of items!) {
        if (!it.text || !it.text.trim()) bad('items 里有条目缺 text');
        // 卡面正文一折行，固定槽位的行高就乱，所以这里直接拦住而不是自动缩字
        if (it.text.length > 14) bad(`「${it.text}」${it.text.length} 字太长，卡面正文 14 字以内`);
        if (it.note && it.note.length > 22) bad(`note「${it.note}」${it.note.length} 字太长，22 字以内`);
      }
      if (items!.length > 3 && items!.some((it) => it.note)) {
        bad('超过 3 条时不能再带 note，卡面会塞满');
      }
      const at = scene.itemAt;
      if (at && at.length) {
        if (at.length !== items!.length) {
          bad(`itemAt(${at.length}) 与 items(${items!.length}) 数量不一致`);
        }
        for (let i = 0; i < at.length; i++) {
          if (typeof at[i] !== 'number' || !isFinite(at[i]!) || at[i]! < 0) bad('itemAt 含负数或非数字');
          // 间隔太小就是几条一起浮上来，等于没做逐条
          if (i > 0 && at[i]! - at[i - 1]! < 0.15) bad(`itemAt 第 ${i + 1} 条与上一条间隔不足 0.15 秒`);
        }
      }
      break;
    }

    /* ── 以下是从 fx-kit 移植的场景 ─────────────────────── */

    case 'subtitleStack': {
      const ls = scene.lines;
      if (!ls || !ls.length) bad('lines 未填。三级字幕按 主句 / 补充 / 出处 给 1–3 行');
      if (ls!.length > 3) bad(`${ls!.length} 行太多，三级字幕最多 3 行（主句 / 补充 / 出处）`);
      if (ls!.some((t) => !t || !t.trim())) bad('lines 里有空行');
      if ((ls![0] ?? '').length > 20) bad(`主句「${ls![0]}」${ls![0]!.length} 字太长，20 字以内`);
      break;
    }

    case 'maskTitle': {
      const ls = scene.lines ?? (scene.title ? [scene.title] : []);
      if (!ls.length) bad('lines（或 title）未填');
      if (ls.length > 4) bad(`${ls.length} 行太多，标题级文字 4 行以内`);
      for (const t of ls) {
        if (!t || !t.trim()) bad('lines 里有空行');
        if (t.length > 16) bad(`「${t}」${t.length} 字太长，标题行 16 字以内`);
      }
      break;
    }

    case 'glitchTitle': {
      const t = scene.lines?.[0] ?? scene.text ?? scene.title;
      if (scene.lines && scene.lines.length > 3) bad(`封面最多三层（标题 / 副标题 / 关键内容），给了 ${scene.lines.length} 层`);
      if (!t) bad('text 未填');
      if (t!.length > 12) bad(`「${t}」${t!.length} 字太长，故障标题 12 字以内才砸得住`);
      if (scene.slices != null && (scene.slices < 2 || scene.slices > 6)) {
        bad(`slices=${scene.slices} 超范围。30fps 下 3–4 最清楚，2–6 之外没有意义`);
      }
      // 幅度太小的话单帧看不出错位，等于白做
      if (scene.amp != null && scene.amp < 6) bad(`amp=${scene.amp} 太小，低于 6 基本看不出错位`);
      // 抖动超过 1.4 秒就不是「信号坏了一下」，是「这片子坏了」
      if (scene.dur != null && (scene.dur <= 0 || scene.dur > 1.4)) {
        bad(`dur=${scene.dur}s 超范围（0–1.4 秒）。抖太久就不像故障，像播放器卡了`);
      }
      break;
    }

    case 'compareBars': {
      const rows = scene.rows;
      if (!rows || rows.length < 2) bad('rows 至少 2 行，只有 1 行不叫对照');
      if (rows!.length > 5) bad(`${rows!.length} 行太多，5 行以内才读得清`);
      for (const r of rows!) {
        if (!r.label || !r.label.trim()) bad('rows 里有条目缺 label');
        if (r.label.length > 8) bad(`中间的 label「${r.label}」${r.label.length} 字太长，8 字以内`);
        if (typeof r.l !== 'number' || !isFinite(r.l) || typeof r.r !== 'number' || !isFinite(r.r)) {
          bad(`「${r.label}」的 l / r 未填或非数字。数值必须人工确认，不能从稿件自动提取`);
        }
      }
      break;
    }

    case 'arrowAnnotate': {
      if (!scene.circle && !scene.arrow && !scene.label) bad('circle / arrow / label 至少给一个');
      const norm = (v: number | undefined, name: string) => {
        if (v == null) return;
        if (v < 0 || v > 1) bad(`${name}=${v} 超出 0–1。坐标是相对整幅画面的归一值，不是像素`);
      };
      if (scene.circle) {
        norm(scene.circle.cx, 'circle.cx');
        norm(scene.circle.cy, 'circle.cy');
        norm(scene.circle.rx, 'circle.rx');
        norm(scene.circle.ry, 'circle.ry');
      }
      if (scene.arrow) {
        norm(scene.arrow.x1, 'arrow.x1');
        norm(scene.arrow.y1, 'arrow.y1');
        norm(scene.arrow.x2, 'arrow.x2');
        norm(scene.arrow.y2, 'arrow.y2');
      }
      norm(scene.labelX, 'labelX');
      norm(scene.labelY, 'labelY');
      break;
    }

    case 'flash': {
      if (scene.peak != null && (scene.peak <= 0 || scene.peak > 1)) bad(`peak=${scene.peak} 应在 0–1`);
      break;
    }

    case 'spotlight': {
      for (const pt of scene.path ?? []) {
        if (pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1) {
          bad(`path 里的点 (${pt.x}, ${pt.y}) 超出 0–1。坐标是相对整幅画面的归一值`);
        }
      }
      if (scene.radius != null && (scene.radius <= 0.02 || scene.radius > 0.5)) {
        bad(`radius=${scene.radius} 超范围（0.02–0.5，相对画面宽度）`);
      }
      if (scene.dark != null && (scene.dark < 0 || scene.dark > 1)) bad(`dark=${scene.dark} 应在 0–1`);
      break;
    }

    case 'grain': {
      if (scene.strength != null && (scene.strength < 0 || scene.strength > 100)) {
        bad(`strength=${scene.strength} 超范围（0–100，ffmpeg noise 滤镜的强度）`);
      }
      break;
    }

    case 'japanMap': {
      if (!scene.cities || !scene.cities.length) bad('cities 未填');
      if (scene.cities!.length > 6) bad(`城市 ${scene.cities!.length} 个太多，6 个以内才不重叠`);
      const unknown = scene.cities!.filter((x) => !cityXY(x.name)).map((x) => x.name);
      if (unknown.length === scene.cities!.length) {
        bad(`城市名都未收录：${unknown.join('、')}。在 japan-geo.ts 的 CITIES 里加经纬度`);
      }
      break;
    }
  }
}
