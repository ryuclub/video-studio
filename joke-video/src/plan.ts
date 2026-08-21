// ── 稿件落地方案：把「拆解过程」也留下来 ──────────────────────────────
//
// 之前只留结果（json + 场景图 + 成片），**判断依据全丢在聊天记录里**。
// 下次改片子时看得到 `enterFrom: 700`，却不知道这个数字是为了"体现乌龟的慢"
// 才调出来的，动了会破坏什么也无从判断。
//
// 所以这份文档分两种内容，用标记分开：
//
//   ① AUTO 区块 —— 机器从当前配置生成，**每次 preview 都重写**。
//      分镜表、场景角色表、片长这些"事实"，不会过期。
//   ② 其余部分 —— 人（或我）写的"意图"和发布文案，**重写时原样保留**。
//
// 分开的理由很实在：早先的 分析.md 是"文件存在就不动"，于是永远停在第一次生成
// 的那一版——mouse-cake 的分析里写着"全片 116.8s"，实际早就 145.09s 了；
// 类型标着"B 类（对话反转）"，而 B 是旁白叙述。既过期又误导。

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildTimeline } from './beats/typeA.js';
import { buildTimelineB } from './beats/typeB.js';
import { getPace } from './pace.js';
import { lineText, subtitleText, type JokeCfg, type Timeline } from './types.js';

/** AUTO 区块的边界标记 */
const open = (id: string) => `<!-- AUTO:${id} 以下由 npm run preview 自动生成，改了会被覆盖 -->`;
const close = (id: string) => `<!-- /AUTO:${id} -->`;

/**
 * 把新生成的 AUTO 内容塞回旧文档，人写的部分一个字不动。
 * 找不到标记就说明这一块是新加的，交给调用方决定怎么办。
 */
function replaceBlock(doc: string, id: string, body: string): string | null {
  const o = open(id);
  const c = close(id);
  const i = doc.indexOf(o);
  const j = doc.indexOf(c);
  if (i < 0 || j < 0 || j < i) return null;
  return doc.slice(0, i + o.length) + '\n\n' + body.trim() + '\n\n' + doc.slice(j);
}

const block = (id: string, body: string) => `${open(id)}\n\n${body.trim()}\n\n${close(id)}`;

function timelineOf(cfg: JokeCfg): Timeline {
  return cfg.type === 'B' ? buildTimelineB(cfg) : buildTimeline(cfg);
}

const fmt = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

/** 表格单元格里不能出现裸的竖线和换行 */
const cell = (s: string) => (s || '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');

// ── 二、分镜表 ──────────────────────────────────────────────────────
function shotTable(cfg: JokeCfg, tl: Timeline): string {
  const rows: string[] = [];
  let prevStage = '';

  for (const seg of tl.segments) {
    if (seg.kind === 'intro') {
      rows.push(`| ${fmt(seg.start)}–${fmt(seg.end)} | 开场空镜　场景 \`${cfg.scene}\` | — | ${ambienceOf(cfg)} |`);
      continue;
    }
    if (seg.kind !== 'line' || !seg.line || seg.lineIndex == null) continue;

    const line = seg.line;
    const i = seg.lineIndex;
    const stage = line.stage ?? cfg.characters.filter((c) => c.rig !== 'none').map((c) => c.id);
    const stageKey = stage.join(',');
    const isNewShot = stageKey !== prevStage;
    prevStage = stageKey;

    // 画面：换镜时写全，同一镜内的后续句子只标「同上」，表才读得下去
    const scene = line.scene ?? cfg.scene;
    const chars = stage.filter((id) => cfg.characters.some((c) => c.id === id));
    const props = stage.filter((id) => (cfg.props ?? []).some((p) => p.id === id));
    const moves: string[] = [];
    if (line.enter) moves.push(`从${line.enter === 'left' ? '左' : '右'}爬入`);
    if (chars.length === 1) moves.push('单人镜');
    if (line.beat === 'punch') moves.push('**笑点·推近**');

    const shot = isNewShot
      ? [
          `场景 \`${scene}\``,
          `在场 ${chars.join(' + ') || '—'}`,
          props.length ? `道具 ${props.join(' + ')}` : '',
          moves.join('　'),
        ]
          .filter(Boolean)
          .join('　')
      : '同上';

    // note 是人写的镜头意图，跟着这一句走
    const picture = line.note ? `${shot}<br>*${line.note}*` : shot;
    const say = `**${line.who}**：${subtitleText(line)}`;

    rows.push(`| ${fmt(seg.start)}–${fmt(seg.start + (line.dur ?? 0))} | ${cell(picture)} | ${cell(say)} | ${cell(sfxAt(cfg, tl, seg.start))} |`);
    // 张嘴无声 / 闭目：**这两样是分镜表上必须看得见的**。
    // 它们不是一句台词，所以原来一行都不占 —— 而《天气预报》全片最要紧的
    // 那一下（她说「我知道啊」，他张嘴说不出话）正好就是这一种，
    // 人对着分镜表核片子的时候等于看不到它。
    const after = seg.start + (line.dur ?? 0);
    if (line.openMouth)
      rows.push(
        `| ${fmt(after + 0.1)}–${fmt(after + 0.1 + line.openMouth)} | **张嘴，不出声** ${line.openMouth}s　*他想说什么，说不出来* | — | 静音 |`
      );
    if (line.closeEyes)
      rows.push(
        `| ${fmt(after + 0.06)}–${fmt(after + 0.06 + line.closeEyes)} | **闭目** ${line.closeEyes}s　*不是眨眼 —— 忍耐* | — | 静音 |`
      );
  }

  const tail = tl.segments.find((s) => s.kind === 'freeze' || s.kind === 'hold');
  if (tail) {
    const what =
      cfg.type === 'A'
        ? cfg.hook
          ? `定格去色 + 钩子字幕「${cfg.hook}」`
          : `定格去色${cfg.fadeOut ? ` + 黑场 ${cfg.fadeOut}s` : ''}　**不出收尾卡**`
        : `缓慢淡出 + 尾字幕${cfg.hook ? `「${cfg.hook}」` : ''}`;
    rows.push(`| ${fmt(tail.start)}–${fmt(tl.duration)} | ${what} | — | ${cfg.type === 'A' ? 'BGM 骤停' : 'BGM 收尾'} |`);
  }

  return `| 时间 | 画面 | 台词 | 音效 / BGM |\n|---|---|---|---|\n${rows.join('\n')}`;
}

function ambienceOf(cfg: JokeCfg): string {
  const amb = cfg.ambience ?? 'none';
  const bgm = (cfg.bgm?.enabled ?? true) ? `BGM \`${cfg.bgm?.key ?? 'happy'}\`` : 'BGM 关';
  return amb === 'none' ? bgm : `${bgm}　环境音 \`${amb}\``;
}

function sfxAt(cfg: JokeCfg, tl: Timeline, t: number): string {
  const hits = tl.sfx
    .filter((c) => c.until == null && Math.abs(c.at - t) < 0.35)
    .map((c) => `\`${c.name}\``);
  return hits.length ? hits.join(' ') : '—';
}

// ── 三、场景 / 角色 / 节奏 ──────────────────────────────────────────
function castTable(cfg: JokeCfg, tl: Timeline): string {
  const scenes = [...new Set([cfg.scene, ...cfg.lines.map((l) => l.scene).filter(Boolean)])];
  const pace = getPace(cfg.pace, cfg.type === 'B' ? 'narrate' : 'banter');
  const chars = cfg.characters
    .map((c) => {
      const where = c.rig === 'none' ? '只有声音' : `\`${c.rig}\`${c.art ? ` / \`${c.art}\`` : ''}　x=${c.x ?? '默认'}`;
      const voice = [c.cast ?? '未指定', c.rate].filter(Boolean).join(' ');
      return `| ${c.id} | ${where} | \`${voice}\` |`;
    })
    .join('\n');

  return `**场景**　${scenes.map((s) => `\`${s}\``).join(' → ')}

**节奏**　\`${cfg.pace ?? (cfg.type === 'B' ? 'narrate' : 'banter')}\`
句内 ${pace.clauseEnd}/${pace.clauseComma}s　句间 ${(pace.padAfter + pace.padBefore).toFixed(2)}s　换镜 ${(pace.padAfterShot + pace.padBefore).toFixed(2)}s

| 角色 | 形象 | 音色 |
|---|---|---|
${chars}

**片长** ${tl.duration.toFixed(2)}s　**${cfg.lines.length}** 句　**${new Set(cfg.lines.map((l) => (l.stage ?? []).join(','))).size}** 个分镜`;
}

// ── 首次生成的骨架 ─────────────────────────────────────────────────
function skeleton(cfg: JokeCfg, tl: Timeline): string {
  const title = cfg.title ?? cfg.hook ?? cfg.id;
  return `# ${title}　落地方案

> 带 \`AUTO\` 标记的区块由 \`npm run preview\` 从当前配置重新生成，改了会被覆盖。
> **其余部分随便改，重新生成时原样保留。**

## 一、稿件定位

- **类型**　${cfg.type} 类（${cfg.type === 'A' ? '对话反转，一句 punch 驱动全片' : '旁白叙述，线性推进，没有笑点锚点'}）
- **一句话讲什么**　（？）
- **为什么这么分镜**　（？把稿件拆成这几镜的依据是什么）
- **不能动的地方**　（？哪些参数是刻意调的，动了会破坏什么）

## 二、分镜表

${block('shots', shotTable(cfg, tl))}

## 三、场景 / 角色 / 节奏

${block('cast', castTable(cfg, tl))}

## 四、发布文案

> 发平台时直接抄这一段。

- **标题候选**
  1. （？）
  2. （？）
  3. （？）
- **内容关键词**　（？稿件本身讲的是什么，3–6 个）
- **热度关键词**　（？观众会搜什么，跟内容沾边的高频词）
- **话题标签**　（？#xxx）
- **简介**　（？两三句，第一句要能单独立住，列表页只显示第一行）
- **封面大字**　\`${cfg.cover?.title ?? '（未设，自动从第一句推）'}\`

## 五、人工核对

- [ ] 每一镜的画面和台词对得上（看 index.html 的场景图）
- [ ] 音画同步：配音起点落在字幕窗口内
- [ ] 站位：\`npm run layout\` 零冲突
- [ ] 节奏：句间缓冲听着不赶
- [ ] 内容风控
`;
}

/**
 * 生成 / 刷新方案文档。返回 markdown 正文。
 *
 * 已存在时**只重写 AUTO 区块**；文档结构是人可以随便改的，
 * 只要那几对标记还在就行。标记被删掉就当这一块不要了，不强塞回去。
 */
/**
 * 方案.md 里还有多少个没填的 `（？）`，按小节归类。
 *
 * **发布文案要在写稿阶段填，不是成片后补。** 标题、封面大字、收尾金句是同一个钩子的
 * 三种长度，分开想必然对不齐——等片子渲完再回头凑标题，要么标题跟金句打架，
 * 要么发现封面大字该换，而封面是从成片里取帧的，改一次就得重渲。
 *
 * 所以 preview 每次都报一遍还差什么，build 之前再拦一次。
 */
export function unfilled(dir: string): { section: string; count: number }[] {
  const p = `${dir}/方案.md`;
  if (!existsSync(p)) return [];
  const out: { section: string; count: number }[] = [];
  let section = '';
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) {
      section = h[1];
      continue;
    }
    const n = (line.match(/（？/g) ?? []).length;
    if (!n) continue;
    const hit = out.find((o) => o.section === section);
    if (hit) hit.count += n;
    else out.push({ section, count: n });
  }
  return out;
}

export function ensurePlan(cfg: JokeCfg, dir: string): string {
  const p = `${dir}/方案.md`;
  const tl = timelineOf(cfg);

  if (!existsSync(p)) {
    const md = skeleton(cfg, tl);
    writeFileSync(p, md);
    return md;
  }

  let doc = readFileSync(p, 'utf8');
  for (const [id, body] of [
    ['shots', shotTable(cfg, tl)],
    ['cast', castTable(cfg, tl)],
  ] as const) {
    const next = replaceBlock(doc, id, body);
    if (next) doc = next;
  }
  writeFileSync(p, doc);
  return doc;
}
