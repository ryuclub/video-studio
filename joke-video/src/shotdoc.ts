// ── 分镜手册生成器：把可用的场景、角色形象、镜头类型渲成图 + 表 ──────────
//
// 跟音色手册同一个道理：**别手工维护会漂的东西**。
// 场景加了一个、角色形象改了配色、镜头类型多了一种——重跑一次就同步。
// 写新稿件时先翻这份，看有什么现成的，不够再做新的。

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { svgToPng } from './video.js';
import { W, H, GROUND, OUT } from './config.js';
import { makeInk } from './style/palette.js';
import { SCENES, SCENE_NAMES, getScene } from './scenes/index.js';
import { ROSTER } from './roster.js';
import { buildTimeline } from './beats/typeA.js';
import { lineText, type JokeCfg } from './types.js';

const DOC_DIR = 'docs/分镜';
const ink = makeInk(0);



function svgPage(inner: string, bg = '#F4EDE2'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${bg}"/>${inner}</svg>`;
}

/** 镜头类型：这条管线现在能表达哪些分镜 */
const SHOT_TYPES = [
  {
    name: '双人同框',
    how: '`stage` 不写（默认全部在场）',
    when: '两个角色你来我往、需要看到彼此反应时。A 类段子的默认',
    note: '镜头会左右摇跟随说话者，笑点句推近到 1.34',
  },
  {
    name: '单人镜头',
    how: '`"stage": ["kid"]`',
    when: '分镜是「镜头1 只有小龟，镜头2 只有龟妈妈」这种交替时',
    note: '角色自动居中，镜头不再左右摇、只做推近。定格沿用笑点那一镜的名单',
  },
  {
    name: '爬入 / 走入',
    how: '`"enter": "right"`',
    when: '角色这一镜才登场，要「慢悠悠爬过来」',
    note: '从画外开始，用整句时长爬完、最后 20% 落位；期间四肢做走路循环。只在这一句前后生效',
  },
  {
    name: '缩壳登场（乌龟专属）',
    how: '`"neckEmerge": true`',
    when: '「远处一块石头缓缓抬起头」这种揭示',
    note: '开口前 0.5s 才把头伸出来。要梗成立，角色配色得跟背景礁石接近',
  },
  {
    name: '定格去色',
    how: '`freeze`（秒）',
    when: '笑点抖完，画面冻住 + BGM 骤停',
    note: '整帧去色 85%。`hook` 尾字幕**跟定格同时出现**且不去色，会在灰调里跳出来。别等定格快结束才出——中间那段纯灰画面没信息，白占时长',
  },
  {
    name: '开场空镜',
    how: '`intro`（秒）',
    when: '每条片子开头，交代环境',
    note: '镜头从 1.06 缓推到 1.0；角色从画外滑入',
  },
];

/** 扫 jokes/ 攒案例：每条片子实际用了什么分镜 */
function caseLibrary(): string {
  if (!existsSync('jokes')) return '（还没有稿件）';
  const files = readdirSync('jokes').filter((f) => f.endsWith('.json')).sort();
  const rows: string[] = [];
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(`jokes/${f}`, 'utf8')) as JokeCfg;
    const tl = buildTimeline(cfg);
    rows.push(
      `### ${cfg.id}${cfg.title ? `　（标题：${cfg.title}）` : ''}\n`,
      `场景 \`${cfg.scene}\`　角色 ${cfg.characters
        .map((c) => `${c.id}=\`${c.rig}${c.variant ? '/' + c.variant : ''}\``)
        .join('　')}　片长 ${tl.duration.toFixed(1)}s\n`,
      '| 镜 | 台词 | 在场 | 镜头 |',
      '|---|---|---|---|'
    );
    cfg.lines.forEach((l, i) => {
      const stage = l.stage ? l.stage.join(' + ') : '全部';
      const extra = [l.enter ? `从${l.enter === 'left' ? '左' : '右'}爬入` : '', l.beat === 'punch' ? '**笑点·推近**' : '']
        .filter(Boolean)
        .join('　');
      rows.push(`| ${i + 1} | ${lineText(l)} | ${stage} | ${extra || '—'} |`);
    });
    rows.push('');
  }
  return rows.join('\n');
}

export function buildShotDoc(outPath = '分镜手册-SHOT.md'): void {
  mkdirSync(DOC_DIR, { recursive: true });

  console.log('渲场景…');
  const sceneRows: string[] = [];
  for (const name of SCENE_NAMES) {
    const L = getScene(name)(ink, 41);
    const p = `${DOC_DIR}/scene-${name}.png`;
    writeFileSync(p, svgToPng(svgPage(L.far + L.mid + L.near)));
    sceneRows.push(`| \`${name}\` | <img src="分镜/scene-${name}.png" width="150"> |`);
    console.log(`  ${p}`);
  }

  console.log('渲角色形象…');
  const castRows: string[] = [];
  for (const c of ROSTER) {
    const p = `${DOC_DIR}/cast-${c.key}.png`;
    // 放在中性底色上，形象看得清
    writeFileSync(p, svgToPng(svgPage(c.draw(ink), '#EFE9DC')));
    castRows.push(
      `| ${c.label} | <img src="分镜/cast-${c.key}.png" width="150"> | \`${c.usage}\` | ${c.note}${
        c.svg ? `<br>原稿 \`${c.svg}\`` : '（纯代码画）'
      } |`
    );
    console.log(`  ${p}`);
  }

  const md = `# 分镜手册

**这份是 \`npm run shotdoc\` 生成的，别手改。** 加了场景、改了角色形象、多了镜头类型，
重跑一次就同步——手写的图和表会过期，过期的参考比没有更费时间。

写新稿件时先翻这份：**有现成的就别新做**，不够用再加，加完记得重跑。

---

## 一、场景

\`scene\` 字段填这里的名字。**填了没做的名字会直接报错**，不会静默回退——
早先会退回 \`grass\`，结果乌龟段子渲成了"两只龟趴在草地上"还一路跑到出片。

| scene | 空场 |
|---|---|
${sceneRows.join('\n')}

新增场景：在 \`src/scenes/index.ts\` 里加一个返回 \`{far, mid, near}\` 三层的函数，
注册进 \`SCENES\`。三层会自动按 0.35 / 0.7 / 1.35 的速率做视差。
加完先跑 \`npm run scene -- <名字>\` 单看空场，确认构图配色，再往里放角色。

---

## 二、角色形象

\`rig\` + \`variant\` 决定用哪个。

| 形象 | 样子 | json 里怎么写 | 说明 |
|---|---|---|---|
${castRows.join('\n')}

**乌龟这两只是线稿描边风**（黑描边 + 绿色块），跟片子其余部分的剪纸风不是一套，
形象以 \`guilai_xiaogui.svg\` / \`guilai_mama.svg\` 为准。路径数据直接抄进
\`src/rigs/turtle.ts\`，只把眼睛、嘴、四肢、bob 参数化——龟壳/壳沿/壳斑/腹部/脖子
是形象本身，动了就不像原稿了。

---

## 三、镜头类型

${SHOT_TYPES.map(
  (s) => `### ${s.name}

- **怎么写**：${s.how}
- **什么时候用**：${s.when}
- ${s.note}
`
).join('\n')}

### 平滑度红线

改完镜头逻辑必须自查：

\`\`\`bash
ffmpeg -v error -i <成片>.mp4 -vf "select='gt(scene,0.06)',metadata=print:file=-" -an -f null -
\`\`\`

**检出的每一处都要能说出是哪个设计动作。** 合法的只有两类：

- \`0.033s\` —— 封面帧切到开场，设计如此
- **分镜切换点** —— \`stage\` 名单变了，那本来就是一次切镜头

除此之外的检出都是 bug。早先 \`camera()\` 按当前时刻直接算目标值时，
14 秒的片子能检出 5 次，全在台词首尾——那是镜头一推一拉在抽。

两条规矩：镜头必须走**关键帧插值**，不能按当前时刻直接算目标值；
**句间停顿不要把镜头拉回原位**，保持上一句的构图直到下一句起范儿。

### 单人镜要给不同景别

两个单人镜构图一模一样时，切换看着不像切镜头，**像角色原地瞬移**——
场景没变，只有主体换了。所以 solo 镜按角色错开 zoom（1.10 / 1.22）和高度，
切换才读得出是两个机位。

---

## 四、案例库

已出片子实际用了什么分镜。新稿件不知道怎么分，先从这里找像的。

${caseLibrary()}

---

## 五、做新场景/新角色的流程

\`\`\`bash
npm run shotdoc                    # 先看有什么现成的
npm run scene -- <名字>            # 新场景做完，单看空场
npm run still -- <cfg> 1.0 4.0     # 放进角色，看指定时刻的构图
npm run build -- <cfg>             # 出片（起手会跑 preflight 体检）
\`\`\`

\`preflight\` 会拦住这些：场景/骨架/音色不存在、两个角色撞音色、punch 数量不对、
台词为空、highlight 不在台词里。**有问题一帧都不渲就停**，不会等你看到成片才发现。
`;

  writeFileSync(outPath, md);
  console.log(`\n分镜手册已生成：${outPath}`);
}
