/**
 * 老石 2D 口播 · 汇总页
 *
 * 产物：`projects/老石/index.html`（双击打开）。页顶是**稿件库** —— 频道方案 §四 里那八条
 * 还没拍的稿子，连分镜、缺什么素材、状态一起摆出来。往下一期一节：成片在左、发布文案在右，
 * 底下先是**稿子整篇**（当稿子读：语气顺不顺、哪一句超了 26 字），
 * 再是**逐句**（当分镜核：这一句的画面、动作、表情、配音、当时为什么这么排）。
 * 两种看法都要有，所以不是二选一。
 *
 * **这张页是老马那张（`joke-video/src/preview.ts` 出的 `projects/老马/index.html`）的对照物**，
 * 版式、配色、左侧目录、滚动高亮全照着来 —— 两条线的页看着是一家人。
 * 不同的地方只有一处，而且是必须不同的：**老马那页按体裁分流（单点／累积／长片），
 * 老石这条线没有体裁，分的是「镜头怎么排」**，所以筛选条换成了镜头语言速查那张卡。
 *
 * ⚠ **这条线跟「醒木不响」没有关系**（见 `老石出片方案.md` 开头）——
 * 页面里不出现那边的频道标识，页脚只写栏目名。
 *
 * 逐句那张场景图是**从成片里抠的**（`stills/NN.jpg`），不是 `frames/` 里的人物帧：
 * `frames/` 那一层是透明背景的人物，没有背景、没有字幕，**看不出这一镜长什么样**。
 * 抠好的图会留在项目目录里，下次跑直接用；要重抠加 `--force`。
 *
 * 用法：
 *   node shi-2d/index.mjs            扫 projects/老石/ 下所有期
 *   node shi-2d/index.mjs --force    连场景图一起重抠
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const ROOT = path.join(REPO, 'projects/老石');
const LIB = path.join(REPO, 'shi-2d/素材库');
const 替身 = JSON.parse(fs.readFileSync(path.join(REPO, 'shi-2d/素材库/替身.json'), 'utf8'));
const 衬衫库 = JSON.parse(fs.readFileSync(path.join(REPO, 'shi-2d/素材库/衬衫.json'), 'utf8'));
// 哪一期穿了哪个色 —— 配色卡上要标「用过／还没用过」，这是这条线的轮换账本
const 用色 = new Map();
const FORCE = process.argv.includes('--force');

if (!fs.existsSync(ROOT)) { console.error(`没有 ${ROOT}`); process.exit(1); }

/* ---------- 小工具 ---------- */

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 素材库和动作表里的注释是**半个 markdown**：只用到 `**粗**` 和反引号包的行内代码。
 * 不引 markdown 库 —— 引一个只为这两样，反而要为它的转义规则操心。
 * ⚠ 先转义再套标签，顺序反了注释里的尖括号会变成标签。
 */
const inline = (s) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

/** 素材库里那些 `_` 开头的键是说明，不是条目 */
const entries = (o) => Object.entries(o).filter(([k]) => !k.startsWith('_'));

/** JSON 里的说明字段有时是一行字符串、有时是一个数组 */
const lines = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);

/** 读 PNG 的 IHDR。只为量对照图有几格，犯不上引解码库 */
function pngSize(file) {
  const b = fs.readFileSync(file, { start: 0, end: 32 });
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const secs = (t) => `${t.toFixed(1)}s`;
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/* ---------- 发布文案 ---------- */

/**
 * `发布文案.md` 是**复制源**（见频道约定）：每个二级／三级标题底下挂一个代码块，
 * 整块选中就能粘到平台里。这儿按「标题 → 代码块」收，页面上原样摆出来。
 *
 * ⚠ **按标题收，不按顺序猜。** 标题的措辞会变（「话题标签（抖音／视频号）」），
 * 所以匹配用 `includes`，不写死全名。
 */
function parsePub(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  let head = '', fence = false, buf = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (/^```/.test(line)) {
      if (fence) { (out[head] ||= []).push(buf.join('\n')); buf = []; }
      fence = !fence;
      continue;
    }
    if (fence) { buf.push(line); continue; }
    const h = line.match(/^#{2,3}\s+(.+)$/);
    if (h) head = h[1].trim();
  }
  const pick = (kw) => {
    const k = Object.keys(out).find((x) => x.includes(kw));
    return k ? out[k] : [];
  };
  return {
    标题: pick('标题')[0] || '',
    备选: pick('备选'),
    关键词: pick('关键词')[0] || '',
    话题: pick('话题标签')[0] || '',
    简介: pick('简介')[0] || '',
    短版: pick('短版')[0] || '',
  };
}

/* ---------- 逐句场景图 ---------- */

/**
 * 从成片里抠每一句的画面。**取的不是句首那一帧** —— 句首常常还在上一镜的转场里
 * （硬切也走 0.05s 的 xfade，叠化 0.7s），抠出来是两张图叠着的糊片。
 * 往后挪半句、最多 1 秒，落在这一镜稳定的地方。
 */
function makeStills(dir, segs, mp4) {
  const out = path.join(dir, 'stills');
  fs.mkdirSync(out, { recursive: true });
  const files = [];
  segs.forEach((s, i) => {
    const f = path.join(out, `${String(i + 1).padStart(2, '0')}.jpg`);
    files.push(f);
    if (fs.existsSync(f) && !FORCE) return;
    const t = s.start + Math.min(1, s.duration * 0.5);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      '-ss', t.toFixed(2), '-i', mp4, '-frames:v', '1', '-q:v', '3', f]);
  });
  return files;
}

/* ---------- 稿件库：还没拍的那几条 ---------- */

/**
 * 从 `老石频道方案.md` §四 读稿件。**页面不存第二份稿子** ——
 * 稿子的正本就是那份方案，这儿只是把它摆出来看。抄一份到页面上，
 * 改了方案忘了改页面是迟早的事，而且**不报错**。
 *
 * 认的格式（方案里那八条就是这么写的）：
 *
 *   ### 01-A ｜揭穿｜中介带你看的第一套房
 *   **标题**　…
 *   **封面**　`第1套` / `不是最好的`
 *   **构图**　标准版
 *   ```
 *   [0.0]
 *   台词  …
 *   画面  …
 *   场景  S-01 办公室落地窗
 *   大字  第 1 套
 *   ```
 */
function 读稿件库() {
  const f = path.join(REPO, 'shi-2d/老石频道方案.md');
  if (!fs.existsSync(f)) return [];
  const md = fs.readFileSync(f, 'utf8');
  const 起 = md.indexOf('## 四、八条稿');
  if (起 < 0) return [];
  const 尾 = md.indexOf('\n## ', 起 + 5);
  const 段 = md.slice(起, 尾 < 0 ? undefined : 尾);

  const out = [];
  // 编号 ｜机制｜篇名。⚠ 分隔符是**全角竖线**，不是半角 —— 写成 | 一条都匹配不上
  const 头 = /^###\s+(\d{2}-[AB])\s*｜\s*([^｜]+?)\s*｜\s*(.+?)\s*$/gm;
  const 位置 = [];
  for (let m; (m = 头.exec(段));) 位置.push({ i: m.index, id: m[1], 机制: m[2], 篇名: m[3] });
  位置.forEach((p, k) => {
    const 体 = 段.slice(p.i, k + 1 < 位置.length ? 位置[k + 1].i : undefined);
    const 取 = (名) => (体.match(new RegExp(`\\*\\*${名}\\*\\*[\\s　]*(.+)`)) || [, ''])[1].trim();
    const 拍 = [];
    const 块 = (体.match(/```([\s\S]*?)```/) || [, ''])[1];
    for (const 段落 of 块.split(/\n(?=\s*\[)/)) {
      const t = (段落.match(/\[([\d.]+)\]/) || [])[1];
      if (t === undefined) continue;
      const 行 = (名) => (段落.match(new RegExp(`^${名}[\\s　]+(.+)$`, 'm')) || [, ''])[1].trim();
      拍.push({ t: +t, 台词: 行('台词'), 画面: 行('画面'), 场景: 行('场景'), 大字: 行('大字') });
    }
    out.push({ ...p, 标题: 取('标题'), 封面: 取('封面'), 构图: 取('构图'), 拍 });
  });
  return out;
}

/**
 * 这一条稿子要用到什么这条线现在还没有的东西。
 * **判据是「稿子里点了名的」**，不是猜的：画面那一行写了「斜靠」就是要斜靠。
 */
function 稿件缺口(稿) {
  const 画面 = 稿.拍.map((b) => b.画面).join('　');
  const 替 = Object.keys(替身).filter((k) => !k.startsWith('_') && 画面.includes(k));
  const 板 = 稿.拍.some((b) => /S-12|数据板/.test(b.场景 + b.画面));
  const 场景 = [...new Set(稿.拍.flatMap((b) => (b.场景.match(/S-\d\d/g) || [])))].sort();
  return { 替, 板, 场景 };
}

function 稿件库卡(已出) {
  const 稿件 = 读稿件库();
  if (!稿件.length) return '';
  const 机制 = [...new Set(稿件.map((s) => s.机制))];
  return `<details class="card fold" id="_scripts">
  <summary><h2>稿件库　<span class="sub-inline">${稿件.length} 条待拍 · ${机制.length} 种机制 · 已出片 ${已出.size}</span></h2></summary>
  <p class="sub">出处是 <code>shi-2d/老石频道方案.md</code> §四，<b>这张页不存第二份稿子</b> ——
  改稿改那份，页面重跑就跟上。八条是<b>四种机制各两条</b>（${esc(机制.join(' / '))}），
  同一批题材、同样的开场写法，用来测哪种机制的跳出率最低（§七）。</p>
  <p class="sub"><b>状态不手写</b>：成品的 <code>动作表.json</code> 里写 <code>"稿件": "01-A"</code>，
  这张表自己去比。<b>拍之前先看「缺什么」那一列</b> —— 点了名的动作还没有素材、
  或者要数据板，那条现在拍不了整版。</p>
  <div class="tw"><table><thead><tr>
  <th>编号</th><th>机制</th><th>篇名</th><th>拍</th><th>字</th><th>场景</th><th>缺什么</th><th>状态</th>
  </tr></thead><tbody>
${稿件.map((s) => {
    const g = 稿件缺口(s);
    const 字 = s.拍.reduce((a, b) => a + [...b.台词].length, 0);
    const 缺 = [
      g.板 ? '<b class="warn-hot">数据板</b>' : '',
      ...g.替.map((k) => `<span class="lack">${esc(k)}</span>`),
    ].filter(Boolean).join(' ');
    return `<tr><td class="mono">${s.id}</td><td>${esc(s.机制)}</td><td class="ttl">${esc(s.篇名)}</td>
<td class="mono">${s.拍.length}</td><td class="mono">${字}</td>
<td class="mono">${g.场景.join(' ')}</td><td>${缺 || '—'}</td>
<td>${已出.has(s.id) ? `<b class="st-done">已出片</b>` : '<b class="st-none">没拍</b>'}</td></tr>`;
  }).join('\n')}
  </tbody></table></div>
  <p class="sub"><b class="warn-hot">数据板</b>那几条要等 <code>board/</code> 那一层（频道方案 §1.5 规格齐了，代码没写）；
  虚线框住的是<b>动作替身</b>：素材没到，先用现有的顶上（对照见下面那张替身表）。</p>

${稿件.map((s) => {
    const g = 稿件缺口(s);
    const 待核 = s.拍.filter((b) => b.台词.includes('※')).length;
    return `  <details class="script-item" id="s-${s.id}">
    <summary><b class="mono">${s.id}</b>　${esc(s.篇名)}
    <span class="sub-inline">${esc(s.构图)} · ${s.拍.length} 拍 · 约 ${s.拍.length ? s.拍[s.拍.length - 1].t.toFixed(0) : 0}s 起收</span></summary>
    <div class="pub-row"><span class="k">标题</span><span class="v title">${esc(s.标题)}</span></div>
    <div class="pub-row"><span class="k">封面</span><span class="v">${inline(s.封面)}</span></div>
    ${待核 ? `<div class="alarm">⚠ 有 <b>${待核}</b> 句带 <code>※</code> —— <b>这些数字要老石本人核对后才能定稿</b>（频道方案 §六）。
    财经内容错一次，账号的信任成本很难补回来。</div>` : ''}
    <div class="tw"><table><thead><tr><th>时间</th><th>台词</th><th>画面</th><th>场景</th><th>大字</th></tr></thead><tbody>
${s.拍.map((b) => {
      const 长 = [...b.台词.replace('※', '')].length > 26;
      return `<tr><td class="mono">${b.t.toFixed(1)}</td>
<td class="line${长 ? ' over' : ''}">${esc(b.台词)}${长 ? `<span class="n">${[...b.台词].length}</span>` : ''}</td>
<td class="tip">${esc(b.画面)}</td><td class="mono">${esc(b.场景)}</td><td>${b.大字 ? `<b>${esc(b.大字)}</b>` : '—'}</td></tr>`;
    }).join('\n')}
    </tbody></table></div>
  </details>`;
  }).join('\n')}
</details>`;
}

/* ---------- 素材卡：他能做什么 ---------- */

/** 哪几条稿子已经拍了 —— 成品的动作表里写 `"稿件": "01-A"`，状态不手写 */
const 已出稿件 = new Set();

function 扫用色(dirs) {
  for (const d of dirs) {
    try {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, d, '动作表.json'), 'utf8'));
      if (p.稿件) 已出稿件.add(p.稿件);
      const c = p.衬衫 || '粉';
      if (!用色.has(c)) 用色.set(c, []);
      用色.get(c).push(d.replace(/^\d{8}_/, ''));
    } catch { /* 没有动作表的目录不算一期 */ }
  }
}

function rigCard() {
  const 表情 = readJson(path.join(LIB, '表情.json'));
  const 姿势 = readJson(path.join(LIB, '姿势.json'));
  const 动作 = readJson(path.join(LIB, '动作.json'));
  const exprList = entries(表情);
  const poseList = entries(姿势.姿势 || {});
  const actList = entries(动作.动作 || {});

  // 对照图是**摆拍台留下的**（face-probe / pose-probe），不是每次出片重画的。
  // 库里加了条目而图没重跑，页面上就会少几张 —— 那种「不报错、只是少了」的事
  // 是这仓库里最贵的一类，所以这儿量一下格子数，对不上就在图底下写清楚。
  const sheet = (rel, cell, extra = 0) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return null;
    const { w, h } = pngSize(abs);
    return { rel, cells: Math.round(w / cell[0]) * Math.round(h / cell[1]) - extra };
  };
  const 脸图 = sheet('_表情/表情对照.png', [380, 300]);          // face-probe 的格子
  const 身图 = sheet('_素材对照/姿势对照.png', [270, 400], 1);   // 第一格是骨架，用来比景别
  const 画风 = fs.existsSync(path.join(ROOT, '_素材对照/画风对比_插兜站姿vs骨架.png'))
    ? '_素材对照/画风对比_插兜站姿vs骨架.png' : null;

  const stale = (s, n, cmd) =>
    !s ? `<p class="sub">对照图还没跑：<code>${esc(cmd)}</code></p>`
      : s.cells === n ? ''
        : `<p class="sub warn-hot">⚠ 这张对照图是 ${s.cells} 格，库里现在有 ${n} 条 ——
           图是旧的，重跑一次：<code>${esc(cmd)}</code></p>`;

  return `<details class="card fold" id="_rig">
  <summary><h2>他能做什么　<span class="sub-inline">脸 ${exprList.length} 档表情 · 身 ${poseList.length} 张定格姿势 · ${actList.length} 个骨架动作</span></h2></summary>
  <p class="sub">表情和姿势都写在 <code>动作表.json</code> 的 <code>逐句</code> 里，一句一个。
  库在 <code>shi-2d/素材库/</code>，改数值用两个摆拍台（<code>face-probe.mjs</code> / <code>pose-probe.mjs</code>），
  <b>别为了看一个表情去渲整片</b>。</p>

  <h3 class="rig-h">脸部表情　<span class="sub-inline">骨架才有</span></h3>
  ${脸图 ? `<figure class="sheet"><img src="${脸图.rel}" alt="表情对照" loading="lazy">
    <figcaption>摆拍台出的对照图　<code>node shi-2d/face-probe.mjs projects/老石/_表情</code></figcaption></figure>` : ''}
  ${stale(脸图, exprList.length, 'node shi-2d/face-probe.mjs projects/老石/_表情')}
  <div class="tw"><table><thead><tr><th>表情</th><th>眼珠</th><th>眉</th><th>眼睑</th><th>嘴</th><th>什么时候用</th></tr></thead><tbody>
${exprList.map(([k, v]) => `<tr><td class="ttl">${esc(k)}</td><td>${JSON.stringify(v.眼珠)}</td><td>${JSON.stringify(v.眉)}</td><td>${v.眼睑}</td><td>${v.嘴 === null ? '原画' : JSON.stringify(v.嘴)}</td><td>${inline(v._ || '')}</td></tr>`).join('\n')}
  </tbody></table></div>
  <p class="sub">⚠ <b>换到定格姿势那一句，表情只剩眉毛和嘴角两根杠杆</b> —— 那些脸是画死的，眼珠和眼睑动不了。
  要眼神戏的句子用骨架（<code>思考姿势</code> 例外，它本身就画着那个眼神）。</p>

  <h3 class="rig-h">定格姿势　<span class="sub-inline">换镜头用的，不是骨架</span></h3>
  ${身图 ? `<figure class="sheet"><img src="${身图.rel}" alt="姿势对照" loading="lazy">
    <figcaption>第一格是骨架，用来比景别　<code>node shi-2d/pose-probe.mjs projects/老石/_素材对照</code></figcaption></figure>` : ''}
  ${stale(身图, poseList.length, 'node shi-2d/pose-probe.mjs projects/老石/_素材对照')}
  <div class="tw"><table><thead><tr><th>姿势</th><th>机位</th><th>嘴</th><th>说明</th></tr></thead><tbody>
${poseList.map(([k, v]) => `<tr><td class="ttl">${esc(k)}</td><td>${esc(v.机位 || v.类型 || '—')}</td><td>${v.嘴 === '张' ? '<b class="warn-hot">张（画死）</b>' : esc(v.嘴 || '—')}</td><td>${inline(v._ || '')}</td></tr>`).join('\n')}
  </tbody></table></div>
  ${画风 ? `<figure class="sheet narrow"><img src="${画风}" alt="画风对比" loading="lazy">
    <figcaption><b>插兜那一族跟骨架不是一批画的</b> —— 骨架矮一点、头大一点、西装偏暗。
    挨着切看得出是两个人，所以<b>换族那一刀要踩在换背景那一句上</b>，色差就被读成剪辑</figcaption></figure>` : ''}
  <p class="sub">⚠ <b>插兜那一族手是画死在兜里的，抬不起来。</b>
  想要手就切镜头（<code>说话姿势3</code> 摊手 ／ <code>思考姿势</code> 托下巴 ／ <code>坐姿上半身</code>）。</p>

  <h3 class="rig-h">衬衫配色　<span class="sub-inline">一期一个颜色</span></h3>
  <p class="sub">写在 <code>动作表.json</code> 的 <code>衬衫</code> 里（名字或 <code>#RRGGBB</code>），
  不写就是原画那件粉的。<b>换色是渲染时按色值替换</b>（色相和饱和度换掉、明暗关系原样保留），
  不是给素材另存十份 —— 十份素材就是十份要跟着美术改的东西。
  出帧和封面读的是<b>同一个字段</b>，不会出现片子和封面穿两件衣服。</p>
  <div class="swatches">
${entries(衬衫库.配色).map(([k, v]) => {
    const 用 = 用色.get(k) || [];
    return `<figure class="sw${用.length ? ' used' : ''}">
  <span class="chip" style="background:${esc(v.色)}"></span>
  <figcaption><b>${esc(k)}</b><code>${esc(v.色)}</code>
  <span class="note">${inline(v._ || '')}</span>
  <span class="who">${用.length ? `用过：${用.map(esc).join('、')}` : '还没用过'}</span></figcaption>
</figure>`;
  }).join('\n')}
  </div>
  <p class="sub">出帧时会扫一眼别期用过什么，撞了在命令行提醒 —— <b>只提醒不拦</b>：
  撞色不是错，是「你可能忘了换」。原色表是量出来的（<code>shirt-scan.mjs</code>，判据是
  「绿色分量最低 ＋ 彩度≥12」），<b>美术重导素材要重跑一次</b> ——
  色值一变表就对不上，而对不上的样子是「换了色但有几块还是粉的」，不报错。</p>

  <h3 class="rig-h">动作替身　<span class="sub-inline">素材还没到，先用谁顶上</span></h3>
  <p class="sub">频道方案 §1.4 和 §3.2b 点名了十来个动作，<b>库里现在只有一半</b>。
  稿子照那两张表写，由 <code>素材库/替身.json</code> 把名字落到现有素材上 ——
  <b>替身是什么、差在哪、在等哪张图，三件事跟着名字一起走</b>。
  素材到了就把那一条整条删掉：还在用这个名字的稿件会当场报错，逼着人回来看一眼。</p>
  <div class="tw"><table><thead><tr><th>稿子写</th><th>实际用</th><th>为什么是这张</th><th>差在</th><th>在等</th></tr></thead><tbody>
${entries(替身).map(([k, v]) => `<tr><td class="ttl">${esc(k)}</td><td class="ttl">${esc(v.用)}</td><td class="tip">${inline(v.因为)}</td><td class="tip">${inline(v.差在)}</td><td class="tip">${v.等 ? inline(v.等) : '<span class="ok">已有真图</span>'}</td></tr>`).join('\n')}
  </tbody></table></div>

  <h3 class="rig-h">骨架动作</h3>
  <div class="tw"><table><thead><tr><th>动作</th><th>腿</th><th>手势拍</th><th>说明</th></tr></thead><tbody>
${actList.map(([k, v]) => `<tr><td class="ttl">${esc(k)}</td><td>${esc(v.腿 || '—')}</td><td>${v.打拍 ? '有' : '—'}</td><td>${lines(v._).map(inline).join('<br>')}</td></tr>`).join('\n')}
  </tbody></table></div>
  <p class="sub"><b>摆手只属于走路。</b>说话的时候手是垂着的，偶尔抬一下强调而已 ——
  常驻摆臂出片一看就是两只手在那儿上下浮。抬手还有个硬上限：<b>超过 46° 会顶到画布边</b>。</p>
</details>`;
}

/* ---------- 镜头语言速查 ---------- */

/**
 * 出处是 `老石出片方案.md` 的 §二／§三／§四。
 * ⚠ **转场那几个秒数要跟 `build.mjs` 的「转场表」对得上** —— 改了那边回来核这儿。
 */
function grammarCard() {
  const 运镜 = [
    ['推 Push In', '✅', '背景 <code>运镜:"推"</code>，zoompan 15%。人物那层单独有 zoom，可以只推一层'],
    ['拉 Pull Out', '✅', '同上。<b>开场别用</b> —— 开场本来就有「人走进来」这个事件了'],
    ['希区柯克变焦', '✅ <b>强项</b>', '背景推、人物不推。<b>两层本来就是分开的，不用额外做任何事</b>'],
    ['走路', '✅ 两套', '骨架（三张腿姿轮换）／<code>插兜走路</code>（两相对倒，靠身体上下颠 6px 补'
      + '那口气）。走多远写在 <code>入画起点</code>，<b>换了句数或语速回来核这个数</b>'],
    ['横移 / 跟镜头', '⚠️ 半个', '背景是单张静图，没有视差。一两秒能用，长了像在拖一张画'],
    ['环绕 Orbit', '❌', '只有正面一张画。<b>这是素材问题不是技术问题</b> —— 美术补了图就接得进来'],
    ['低角度仰拍', '❌（能伪一点）', '能放大下移伪一点取景，但<b>脸的透视是平的</b>，不建议当常规手段'],
  ];
  const 转场 = [
    ['硬切', '0.05s', '默认。绝大多数切点'],
    ['淡入 / 淡出', '0.70s', '<b>只用在整片的头和尾</b>'],
    ['叠化', '0.70s', '有时间感的地方，<b>一条片子最多一次</b>'],
    ['滑移', '0.28s', '强手段，<b>留给情绪峰</b>'],
    ['遮罩转场', '—', '⚠️ 半个。手臂横过镜头做不了 —— 骨架的手抬不到那个幅度'],
  ];
  const 九条 = [
    '每 6~8 秒换一次镜头',
    '切点尽量踩在换背景那一句上 —— 同景别硬切姿势会像跳帧',
    '<b>一句只准动一样</b>：换镜头 / 抬手 / 运镜 / 换表情，四选一',
    '转场和景别变化落在同一个切点上，算一个事件',
    '<b>信息最密的那句不运镜也不抬手</b> —— 运镜跟字幕抢注意力',
    '生气一条片子最多两句，而且不能相邻',
    '「示意」是抬一下就收（1.12 秒），不是举着说完一句',
    '<b>重头戏留给运镜，不是留给动作</b> —— 情绪最重那几句人物反而该站住',
    '<b>只有峰值那一句可以破例</b>，可以叠三样。全片只此一处',
  ];
  return `<details class="card fold" id="_grammar">
  <summary><h2>镜头语言速查　<span class="sub-inline">能做什么 · 做不了什么 · 配镜头的九条</span></h2></summary>
  <p class="sub">正文在 <code>shi-2d/老石出片方案.md</code>，这儿只摆结论。
  <b>画面是三层</b>：背景静图（会推拉、会虚化）＋ 人物透明 PNG ＋ 烧进去的字幕 ——
  下面那两张表全是这一句推出来的：凡是「两层各走各的」天然会做，凡是「要绕着人转」一定做不了。</p>
  <p class="sub"><b>验收只有一句话：只要画面不单调、不呆板，就好。</b>
  粗口径 —— 连着两句以上同一个姿势、同一个景别、背景还没动，那就是单调了，不管每一句单看多合理。</p>

  <h3 class="rig-h">运镜</h3>
  <div class="tw"><table><thead><tr><th>运镜</th><th>这条管线</th><th>怎么做的 / 为什么不行</th></tr></thead><tbody>
${运镜.map(([a, b, c]) => `<tr><td class="ttl">${a}</td><td>${b}</td><td>${c}</td></tr>`).join('\n')}
  </tbody></table></div>
  <p class="sub"><b>缓推是默认动作，不是特效。</b>定格姿势放四五秒会「冻住」，
  所以每一段定格姿势都给一整句 3.5% 的缓推 —— 单帧看不出来，连起来是镜头在缓缓靠近。</p>

  <h3 class="rig-h">转场</h3>
  <div class="tw"><table><thead><tr><th>转场</th><th>时长</th><th>用在哪儿</th></tr></thead><tbody>
${转场.map(([a, b, c]) => `<tr><td class="ttl">${a}</td><td class="mono">${b}</td><td>${c}</td></tr>`).join('\n')}
  </tbody></table></div>
  <p class="sub">⚠ <b>转场作用在背景层，人物层是硬切的。</b>
  所以叠化只用在人物姿势本来就不变的地方，不然会看见「背景在化、人却跳了一下」。
  硬切也走 <code>xfade</code>（0.05 秒，一帧半），所有切点一条代码路径。</p>

  <h3 class="rig-h">字幕　<span class="sub-inline">频道方案 §1.3（2026-09-05 裁决）</span></h3>
  <div class="tw"><table><thead><tr><th>项</th><th>值</th></tr></thead><tbody>
  <tr><td class="ttl">出字</td><td><b>整句一次出现</b>，跟这句配音的起止走 —— 逐字敲出撤了（拖慢阅读）</td></tr>
  <tr><td class="ttl">字号 / 行数</td><td>72px，一行 13 个汉字宽，<b>最多三行</b>（超了当场停，回去拆句子）</td></tr>
  <tr><td class="ttl">描边</td><td><b>双层</b>：底层纯黑 10px ＋ 面层白字 3px。⚠ 字重是假粗，字体只有一个重量，粗细靠外描边扛</td></tr>
  <tr><td class="ttl">位置</td><td>字幕带 <b>y300–560</b>（§1.2：y&lt;260 是平台标题栏，任何内容不进）</td></tr>
  <tr><td class="ttl">关键数字</td><td>标黄或标红，<b>一条最多三处</b>，写在动作表逐句的 <code>标</code> 里</td></tr>
  </tbody></table></div>
  <p class="sub">⚠ <b>字幕位置和人物机位是绑死的。</b>带底挪到 560 之后人物按 §1.1 下移到成片 y600–1560
  （<code>shoot.mjs</code> 的 <code>CANVAS</code> ＋ <code>姿势.json</code> 的 <code>_机位</code>）。
  实测头顶 592（走路那一档最高）—— <b>最窄处 32px 余量</b>，动任何一边都要回来量一次。</p>

  <h3 class="rig-h">配镜头的九条</h3>
  <ol class="nine">${九条.map((s) => `<li>${s}</li>`).join('')}</ol>
  <p class="sub"><b>排之前先做三件事，顺序不能换：</b>先切结构（段落边界才是换镜头的地方）→
  给每句打情绪强度 0–5 <b>并且只认一个峰</b> → 算画面事件的预算（每段一个画面事件，每句一个人物事件）。
  上来就一句一句配动作，出来局部都合理、整体是平的。</p>
</details>`;
}

/* ---------- 还欠的 ---------- */

function todoCard() {
  const 欠 = [
    ['环绕、仰拍', '要美术补侧面／背面／仰视角的图'],
    ['遮罩转场用人物手臂', '骨架的手抬不到那个幅度，得画一张「手横过镜头」的专用图'],
    ['横移', '背景是单张静图，没有视差。要真横移得美术出一张宽幅背景'],
    ['画风统一', '2026-09-05 后加的三张站姿跟骨架不是一套'],
    ['横版封面', 'YouTube 长视频要 1280×720，按 <code>YouTube封面规范.md</code> 走，还没做'],
    ['定格姿势的口型', '「嘴」写「闭」的那几张配音一响嘴不动，<b>只能用在两秒以内的插入镜头</b>'],
  ];
  return `<details class="card fold" id="_todo">
  <summary><h2>还欠的　<span class="sub-inline">${欠.length} 项</span></h2></summary>
  <p class="sub">前三项都是<b>素材问题不是技术问题</b> —— 美术补了图，这条管线接得进来。</p>
  <div class="tw"><table><thead><tr><th>欠什么</th><th>卡在哪儿</th></tr></thead><tbody>
${欠.map(([a, b]) => `<tr><td class="ttl">${a}</td><td>${b}</td></tr>`).join('\n')}
  </tbody></table></div>
</details>`;
}

/* ---------- 一期 ---------- */

function episode(dirName, no) {
  const dir = path.join(ROOT, dirName);
  const manifestFile = path.join(dir, 'vo/manifest.json');
  const planFile = path.join(dir, '动作表.json');
  if (!fs.existsSync(manifestFile) || !fs.existsSync(planFile)) return null;

  const manifest = readJson(manifestFile);
  const plan = readJson(planFile);
  const segs = manifest.segments;
  const 篇名 = dirName.replace(/^\d{8}_/, '');
  const 日期 = /^(\d{4})(\d{2})(\d{2})_/.exec(dirName)?.slice(1).join('-') || '';
  const id = `ep-${dirName.replace(/[^\w一-龥-]/g, '')}`;

  const mp4 = fs.readdirSync(dir).find((f) => f.endsWith('.mp4'));
  const 封面 = fs.existsSync(path.join(dir, '封面.png')) ? '封面.png' : null;
  const coverText = fs.existsSync(path.join(dir, '封面.json')) ? readJson(path.join(dir, '封面.json')) : null;
  const pub = parsePub(path.join(dir, '发布文案.md'));
  const 衬衫名 = plan.衬衫 || '粉（原画）';
  const 帧数 = fs.existsSync(path.join(dir, 'frames'))
    ? fs.readdirSync(path.join(dir, 'frames')).filter((f) => /^f\d+\.png$/.test(f)).length : 0;

  // 每一句归到哪一段背景。**背景是按「到句」记的**（一段管到第几句为止），
  // 逐句那边要的是反过来的问法：这一句属于哪一段、是不是这一段的第一句。
  const bgOf = [];
  let from = 1;
  plan.背景.forEach((b, i) => {
    for (let s = from; s <= b.到句; s++) bgOf[s] = { i, b, 首: s === from };
    from = b.到句 + 1;
  });

  const stills = mp4 ? makeStills(dir, segs, path.join(dir, mp4)) : [];
  const rel = (p) => `${encodeURI(dirName)}/${p}`;

  /**
   * 稿子整篇摆出来 —— 逐句那一栏是「一句配一张图」，看的是画面对不对得上；
   * 这一块是**把稿子当稿子读**：语气顺不顺、结构立不立得住、哪一句太长。
   * 两种看法都要有，所以不是二选一。
   *
   * 读的是 `稿子.txt` **不是 manifest** —— manifest 是配音时的快照。
   * 两边对不上就说明**稿子改过但没重跑配音**，成片里还是旧词：
   * 这是这条线上最安静的一种错（页面、时间轴、帧数全都正常），所以在这儿拦一道。
   */
  const 稿子文件 = path.join(dir, '稿子.txt');
  const 稿子 = fs.existsSync(稿子文件)
    ? fs.readFileSync(稿子文件, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const 字数 = 稿子.reduce((a, l) => a + [...l].length, 0);
  const 长句 = 稿子.map((l, i) => [i + 1, [...l].length]).filter(([, n]) => n > 26);
  // 跟配音对不上的那几句：句数不同，或者同一句的字不一样
  const 对不上 = 稿子.length !== segs.length
    ? `稿子 ${稿子.length} 句，配音 ${segs.length} 句`
    : (() => {
      const 差 = 稿子.map((l, i) => [i + 1, l, segs[i].text.trim()]).filter(([, a, b]) => a !== b);
      return 差.length ? `第 ${差.map(([n]) => n).join('、')} 句跟配音里的词不一样` : null;
    })();

  // ⚠ **两个字数别摆在一起不说清楚。** 这儿数的是稿子里的字符（含标点），
  // manifest 里那个是配音时数的净字数 —— 语速也是拿净字数算的。
  // 摆一起不标注，看着就像其中一个错了
  const 稿子块 = !稿子.length ? '' : `<h3>稿子　<span class="sub-inline">${稿子.length} 句 · ${字数} 字（含标点，净 ${manifest.chars}）· ${manifest.cpm} 字/分</span></h3>
  ${对不上 ? `<div class="alarm">⚠ <b>稿子跟配音对不上</b>：${esc(对不上)} ——
  稿子改过但没重跑配音，<b>成片里还是旧词</b>。重跑 <code>tts-match.mjs</code> → <code>envelope</code> → <code>shoot</code> → <code>build</code>。</div>` : ''}
  <div class="script">
${稿子.map((l, i) => {
    const n = [...l].length;
    const 标 = plan.逐句?.[i]?.标 || [];
    let 文 = esc(l);
    for (const w of 标) 文 = 文.replace(esc(w), `<mark>${esc(w)}</mark>`);
    return `    <p${n > 26 ? ' class="over"' : ''}><span class="no">${i + 1}</span><span class="t">${文}</span><span class="n">${n}</span></p>`;
  }).join('\n')}
  </div>
  ${长句.length ? `<p class="sub warn-hot">⚠ 第 ${长句.map(([n, c]) => `${n} 句（${c} 字）`).join('、')}超了
  —— 频道方案 §3.2 的单句上限是 <b>26 字</b>，超了字幕会折到三行。</p>` : ''}`;

  const rows = segs.map((s, i) => {
    const 句 = plan.逐句[i] || {};
    const bg = bgOf[i + 1];
    const still = stills[i] && fs.existsSync(stills[i])
      ? `<img src="${rel(`stills/${String(i + 1).padStart(2, '0')}.jpg`)}" alt="第 ${i + 1} 句画面" loading="lazy">`
      : '<div class="noshot">没有场景图</div>';
    // 峰是**稿件自己标的**：动作表的注里写了「情绪峰」的那一句。
    // 全片只有一个峰（§四之二），所以这儿不做「取最强表情」那种猜。
    const 峰 = /情绪峰/.test(句._ || '');
    return `<div class="row${峰 ? ' punch' : ''}">
  <div class="shot">${still}<span class="ts">${secs(s.start)}</span></div>
  <div class="talk">
    <div class="beat">第 ${i + 1} 句${峰 ? ' · 全片情绪峰' : ''}</div>
    <p class="text">${esc(s.text)}</p>
    <div class="voice">
      <span class="pill">${esc(句.动作 || '—')}</span>
      ${替身[句.动作] ? `<span class="pill sub-pill" title="${esc(替身[句.动作].差在.replace(/\*\*/g, ''))}">替身 → ${esc(替身[句.动作].用)}</span>` : ''}
      <span class="pill alt">${esc(句.表情 || '—')}</span>
      ${(句.标 || []).map((w) => `<span class="pill mark">标 ${esc(w)}</span>`).join('')}
      <span class="meta">${secs(s.duration)} · ${s.chars} 字</span>
      <audio controls preload="none" src="${rel(`vo/seg${s.index}.mp3`)}"></audio>
    </div>
${bg?.首 ? `    <div class="bg-mark">${bg.i === 0 ? '开场背景' : '背景换到'} <b>${esc(bg.b.图)}</b> · ${bg.i === 0 ? '淡入' : esc(bg.b.转场 || '硬切')} · 运镜 ${esc(bg.b.运镜 || '静')}</div>\n` : ''}    ${句._ ? `<div class="meta note">${inline(句._)}</div>` : ''}
  </div>
</div>`;
  }).join('\n');

  const bgRows = plan.背景.map((b, i) => {
    const start = i === 0 ? 0 : segs[plan.背景[i - 1].到句 - 1].end;
    const end = segs[b.到句 - 1].end;
    const from2 = i === 0 ? 1 : plan.背景[i - 1].到句 + 1;
    return `<tr><td>${i + 1}</td><td class="ttl">${esc(b.图)}</td><td>句 ${from2}–${b.到句}</td>
<td class="mono">${clock(start)}–${clock(end)}　${secs(end - start)}</td>
<td>${i === 0 ? '淡入' : esc(b.转场 || '硬切')}</td><td>${esc(b.运镜 || '静')}</td><td class="tip">${inline(b._ || '')}</td></tr>`;
  }).join('\n');

  const pubAside = pub ? `<aside class="pub">
<div class="pub-row"><span class="k">档期</span><span class="v slot">${esc(日期)}　<em>已出片</em></span></div>
<div class="pub-row"><span class="k">标题</span><span class="v title">${esc(pub.标题)}</span></div>
${pub.备选.map((t) => `<div class="pub-row"><span class="k">备选</span><span class="v">${esc(t)}</span></div>`).join('\n')}
<div class="pub-row"><span class="k">关键词</span><span class="v tags">${esc(pub.关键词)}</span></div>
<div class="pub-row"><span class="k">话题</span><span class="v tags">${esc(pub.话题)}</span></div>
<div class="pub-row"><span class="k">简介</span><span class="v intro">${esc(pub.简介).replace(/\n{2,}/g, '<br><br>')}</span></div>
${coverText ? `<div class="pub-row"><span class="k">封面</span><span class="v">${esc(coverText.角标)}　<b>${(coverText.主标 || []).map(esc).join(' / ')}</b><br>
<span class="meta">${esc(coverText.副标 || '')}　页脚「${esc(coverText.页脚 || '')}」</span></span></div>` : ''}
</aside>` : '';

  const film = mp4
    ? `<div class="film with-pub"><div class="film-main">
<video src="${rel(encodeURIComponent(mp4))}" controls preload="metadata" playsinline></video>
<div class="film-note">成片　<code>${esc(mp4)}</code></div>
<div class="film-note"><a href="${rel('vo.mp3')}">vo.mp3</a>　·　<a href="${rel('字幕.ass')}">字幕.ass</a>　·　<a href="${rel('稿子.txt')}">稿子.txt</a></div>
</div>${pubAside}</div>`
    : `<div class="film-none">还没合片 —— <code>node shi-2d/build.mjs projects/老石/${esc(dirName)}</code></div>`;

  return {
    id, 篇名, 日期,
    nav: `<a class="nav-item" href="#${id}" data-target="${id}">
  ${封面 ? `<img class="nav-thumb" src="${rel(封面)}" alt="" loading="lazy">` : '<span class="nav-thumb ph"></span>'}
  <span class="nav-body">
    <span class="nav-title"><b class="nav-num">${no}</b>${esc(篇名)}</span>
    <span class="nav-st"><b class="${plan.测试片 ? 'st-test' : 'st-done'}">${plan.测试片 ? '测试片' : '已出片'}</b><span>${esc(日期)}</span></span>
    <span class="nav-meta">${secs(manifest.total)} · ${segs.length} 句 · ${plan.背景.length} 段背景</span>
  </span>
</a>`,
    html: `<section class="ep" id="${id}">
  <header>
    <h2>${esc(篇名)}${plan.测试片 ? ' <b class="badge">测试片</b>' : ''}</h2>
    <div class="facts">
      <span>${esc(日期)}</span>
      <span>片长 ${secs(manifest.total)}</span>
      <span>${segs.length} 句 · ${manifest.chars} 字</span>
      <span>${manifest.cpm} 字/分</span>
      <span>${esc(manifest.voice)} <code>${esc(manifest.rate)}</code></span>
      <span>1080×1920 · 30fps</span>
      <span>衬衫 ${esc(衬衫名)}</span>
      <span>${帧数} 帧</span>
    </div>
  </header>
  ${plan.测试片 ? `<div class="alarm">${inline(plan.测试片)}</div>` : ''}
  ${film}
  ${稿子块}
  <h3>逐句</h3>
  <div class="rows">
${rows}
  </div>
  <h3>背景与转场</h3>
  <div class="tw"><table><thead><tr><th>段</th><th>图</th><th>管到</th><th>时间</th><th>切入</th><th>运镜</th><th>为什么</th></tr></thead><tbody>
${bgRows}
  </tbody></table></div>
  ${封面 ? `<h3>封面</h3><div class="extras"><figure class="is-cover"><img src="${rel(封面)}" alt="封面" loading="lazy">
  <figcaption>竖版封面 1080×1920　<code>node shi-2d/cover.mjs projects/老石/${esc(dirName)}</code></figcaption></figure></div>` : ''}
  <details class="analysis" open>
    <summary>这一期为什么这么排<a class="src" href="${encodeURI('../../shi-2d/老石出片方案.md')}" target="_blank">老石出片方案.md ↗</a></summary>
    ${lines(plan._说明).filter((l) => l.trim()).map((l) => `<p>${inline(l)}</p>`).join('\n')}
    <p class="sub">机读的一份在 <code>projects/老石/${esc(dirName)}/动作表.json</code> ——
    <b>这张页不是稿件，改稿改那份</b>，改完重跑 <code>shoot.mjs</code> → <code>build.mjs</code> → 这张页。</p>
    <h3>人工核对</h3>
    <ul>
      <li class="task"><input type="checkbox" disabled> 逐句：画面和台词对得上（看上面那栏场景图）</li>
      <li class="task"><input type="checkbox" disabled> 一句只动了一样（换镜头 / 抬手 / 运镜 / 换表情）</li>
      <li class="task"><input type="checkbox" disabled> 全片只有一个峰，别处一律让路</li>
      <li class="task"><input type="checkbox" disabled> 换族那一刀踩在换背景那一句上</li>
      <li class="task"><input type="checkbox" disabled> 字幕带底 560 到头顶还有余量（量人物层最上一行非透明像素 ＋380，必须 &gt;560）</li>
      <li class="task"><input type="checkbox" disabled> 折行没把词劈开（数词／虚词那两条判据拦不住的，只能这儿看）</li>
      <li class="task"><input type="checkbox" disabled> 「张嘴」那几张定格姿势没有停超过两秒</li>
      <li class="task"><input type="checkbox" disabled> 缩到 210px 宽，封面主标还读得出</li>
      <li class="task"><input type="checkbox" disabled> 内容风控</li>
    </ul>
  </details>
</section>`,
  };
}

/* ---------- 页 ---------- */

/**
 * 版式跟老马那页是同一套（`joke-video/src/preview.ts` 的 `page()`）。
 * **没有去 import 它** —— 那边是 joke-video 工作区里的 TS，得挂 tsx 才跑得起来，
 * 而 shi-2d 这一套是仓库根上直接 `node` 跑的 .mjs。抄一份配色和骨架，
 * 换来的是这条线自己能跑；⚠ 代价是**改版式要改两处**。
 */
function page(title, nav, body) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root {
  --bg: #f4f1ea; --card: #fffdf8; --ink: #23303d; --dim: #6b7785;
  --line: #e0dace; --accent: #1f3a5f; --hot: #c8452e; --gold: #d8a53a;
}
@media (prefers-color-scheme: dark) {
  :root { --bg:#171a1d; --card:#20252a; --ink:#e8e4da; --dim:#9aa4ae;
          --line:#2f363d; --accent:#7fa8d8; --hot:#e2694f; --gold:#e0b954; }
}
* { box-sizing: border-box; }
body { margin:0; padding:32px 20px 80px; background:var(--bg); color:var(--ink);
  font:15px/1.7 "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",system-ui,sans-serif; }
.layout { max-width: 1360px; margin:0 auto; display:grid;
  grid-template-columns: 250px minmax(0,1fr); gap:34px; align-items:start; }
.wrap { min-width:0; }

/* ── 左侧目录 ── */
.side { position:sticky; top:24px; max-height:calc(100vh - 48px);
  display:flex; flex-direction:column; background:var(--card);
  border:1px solid var(--line); border-radius:14px; padding:16px 12px 12px; }
.side-head { font-size:13px; font-weight:700; color:var(--dim); letter-spacing:1px;
  padding:0 8px 12px; border-bottom:1px solid var(--line); margin-bottom:10px;
  display:flex; align-items:center; justify-content:space-between; }
.side-count { background:var(--accent); color:#fff; font-size:11px; font-weight:600;
  min-width:20px; height:20px; padding:0 6px; border-radius:10px;
  display:inline-flex; align-items:center; justify-content:center; }
/* min-height:0 不能省：flex 子项默认不肯缩到内容高度以下，
   少了它 overflow-y 不生效，条目一多侧栏就会顶穿 max-height */
.side-list { overflow-y:auto; min-height:0; display:flex; flex-direction:column; gap:4px; }
.nav-item { display:flex; gap:10px; align-items:center; padding:8px; border-radius:9px;
  text-decoration:none; color:inherit; border:1px solid transparent; transition:background .12s; }
.nav-item:hover { background:rgba(127,127,127,.1); }
.nav-item.active { background:rgba(31,58,95,.12); border-color:var(--accent); }
@media (prefers-color-scheme: dark) { .nav-item.active { background:rgba(127,168,216,.16); } }
.nav-thumb { width:34px; height:60px; object-fit:cover; border-radius:5px;
  border:1px solid var(--line); flex:none; display:block; }
.nav-thumb.ph { background:rgba(127,127,127,.12); }
.nav-body { display:flex; flex-direction:column; min-width:0; gap:1px; }
.nav-title { font-size:13px; font-weight:600; overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap; }
.nav-num { display:inline-block; min-width:16px; color:var(--dim); font-weight:400;
  font-size:11px; font-variant-numeric:tabular-nums; }
.nav-st { display:flex; align-items:center; gap:5px; font-size:11px; color:var(--dim); }
.nav-st b { font-size:10px; font-weight:700; padding:0 5px; border-radius:3px; }
.nav-meta { font-size:11px; color:var(--dim); }
.st-done { background:rgba(127,127,127,.22); color:var(--dim); }
/* 测试片跟成片必须一眼分得开 —— 试片是用来走通链路的，不是这条线的样片 */
.st-test { background:rgba(200,69,46,.16); color:var(--hot); }
.badge { background:var(--hot); color:#fff; font-size:10px; font-weight:700; padding:1px 6px;
  border-radius:3px; vertical-align:3px; }
.alarm { background:rgba(200,69,46,.09); border-left:3px solid var(--hot);
  padding:10px 14px; border-radius:0 8px 8px 0; margin-bottom:18px; font-size:13.5px; }
.side-top { margin-top:10px; padding-top:10px; border-top:1px solid var(--line);
  font-size:12px; color:var(--dim); text-decoration:none; text-align:center; }
.side-top:hover { color:var(--accent); }

/* ── 页顶那几张折叠卡 ── */
.card { background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:18px 26px; margin-bottom:18px; }
details.card[open] { padding-bottom:22px; }
details.fold > summary { cursor:pointer; list-style:none; display:flex; align-items:center; gap:8px; }
details.fold > summary::-webkit-details-marker { display:none; }
details.fold > summary::before { content:'▸'; color:var(--dim); font-size:13px; flex:none;
  transition:transform .15s; }
details.fold[open] > summary::before { transform:rotate(90deg); }
details.fold > summary h2 { margin:0; }
details.fold > summary:hover h2 { color:var(--accent); }
.sub-inline { font-size:12px; color:var(--dim); font-weight:400; letter-spacing:0; }

h1 { font-size:26px; margin:0 0 6px; letter-spacing:.5px; }
.sub { color:var(--dim); margin:8px 0 14px; font-size:13.5px; }
.warn-hot { color:var(--hot); }
.ep { background:var(--card); border:1px solid var(--line); border-radius:14px;
  padding:24px 26px 20px; margin-bottom:34px; scroll-margin-top:24px; }
.ep > header { border-bottom:1px solid var(--line); padding-bottom:14px; margin-bottom:20px; }
h2 { font-size:20px; margin:0 0 8px; }
h3 { font-size:15px; color:var(--dim); margin:26px 0 12px; font-weight:600; }
.rig-h { margin:22px 0 8px; font-size:15px; letter-spacing:.06em; color:var(--ink); }
.facts { display:flex; flex-wrap:wrap; gap:6px 18px; color:var(--dim); font-size:13px; }

/* 成片：竖版，别让它撑满一屏，跟右边的发布文案能同时看见 */
.film { display:flex; gap:22px; align-items:flex-start; margin-bottom:22px; }
.film.with-pub .film-main { flex:0 0 auto; }
.film.with-pub .pub { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:9px;
  border-left:2px solid var(--line); padding-left:16px; }
.film video { width:250px; max-height:60vh; border-radius:10px; border:1px solid var(--line);
  background:#000; display:block; }
.film-note { color:var(--dim); font-size:12px; padding-top:6px; }
.film-note a { color:var(--accent); }
.film-none { color:var(--dim); font-size:13px; margin-bottom:20px;
  padding:10px 14px; border:1px dashed var(--line); border-radius:8px; }
.pub-row { display:flex; gap:10px; align-items:baseline; font-size:13px; }
.pub-row .k { flex:0 0 40px; color:var(--dim); font-size:12px; }
.pub-row .v { flex:1 1 auto; min-width:0; word-break:break-word; }
.pub-row .v.title { font-size:16px; font-weight:700; line-height:1.35; }
.pub-row .v.tags { color:var(--dim); font-size:12px; line-height:1.5; }
.pub-row .v.intro { font-size:12.5px; line-height:1.7; color:var(--dim); white-space:pre-line; }
.pub-row .v.slot { font-variant-numeric:tabular-nums; }
.pub-row .v.slot em { font-style:normal; font-size:11px; padding:1px 6px; border-radius:9px;
  background:var(--line); color:var(--dim); }

/* ── 稿件库：还没拍的那几条 ── */
/* 一条一个折叠块。八条全摊开是八十来行表，进页面就吓人 */
.script-item { border:1px solid var(--line); border-radius:10px; padding:10px 14px; margin:10px 0;
  background:rgba(127,127,127,.04); }
.script-item > summary { display:flex; align-items:baseline; gap:9px; flex-wrap:wrap;
  color:var(--ink); font-weight:600; }
.script-item[open] > summary { margin-bottom:8px; border-bottom:1px solid var(--line); padding-bottom:8px; }
.script-item .pub-row { margin:3px 0; }
.script-item .pub-row .v.title { font-size:15px; }
/* 台词那一列是要读的，别用表格的小字 */
.tw td.line { font-size:15px; line-height:1.6; min-width:15em; }
.tw td.line.over { background:rgba(200,69,46,.07); }
.tw td.line .n { margin-left:8px; font-size:11px; color:var(--hot); font-weight:700; }
/* 缺的素材：虚线框 —— 跟逐句那儿的「替身」牌是同一套长相 */
.lack { display:inline-block; padding:0 6px; border:1px dashed var(--hot); border-radius:4px;
  color:var(--hot); font-size:11px; white-space:nowrap; }

/* ── 稿子整篇 ── */
/* 一句一行、行号在左、字数在右。**字号比逐句那栏大一档** ——
   这一块是拿来「读」的，不是拿来核画面的 */
.script { border:1px solid var(--line); border-radius:10px; padding:14px 18px;
  background:rgba(127,127,127,.05); }
.script p { margin:0; padding:5px 0; font-size:17px; line-height:1.75;
  display:flex; gap:12px; align-items:baseline; }
.script p + p { border-top:1px dashed rgba(127,127,127,.18); }
.script .no { flex:none; width:22px; text-align:right; color:var(--dim);
  font-size:12px; font-variant-numeric:tabular-nums; }
.script .t { flex:1 1 auto; min-width:0; }
.script .n { flex:none; color:var(--dim); font-size:11.5px;
  font-variant-numeric:tabular-nums; }
/* 超 26 字的句子：字幕会折到三行，读稿的时候就该看见 */
.script p.over { background:rgba(200,69,46,.07); border-radius:6px;
  box-shadow:-8px 0 0 rgba(200,69,46,.07), 8px 0 0 rgba(200,69,46,.07); }
.script p.over .n { color:var(--hot); font-weight:700; }
.script mark { background:#FFD400; color:#2A2622; padding:0 3px; border-radius:2px; }

/* ── 逐句 ── */
.rows { display:flex; flex-direction:column; gap:18px; }
.row { display:grid; grid-template-columns:150px 1fr; gap:20px; align-items:start;
  padding:14px; border-radius:10px; border:1px solid transparent; }
/* 峰只有一句，页面上也只该有一处高亮 */
.row.punch { border-color:var(--gold); background:rgba(216,165,58,.07); }
.shot { position:relative; }
.shot img { width:100%; border-radius:8px; display:block; border:1px solid var(--line); }
.noshot { aspect-ratio:9/16; display:grid; place-items:center; color:var(--dim);
  border:1px dashed var(--line); border-radius:8px; font-size:12px; }
.ts { position:absolute; left:6px; bottom:6px; background:rgba(0,0,0,.6); color:#fff;
  font-size:11px; padding:1px 6px; border-radius:4px; }
.beat { font-size:12px; color:var(--dim); letter-spacing:1px; }
.text { font-size:18px; margin:4px 0 10px; line-height:1.6; }
.voice { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:6px; }
.pill { background:var(--accent); color:#fff; font-size:12px; padding:2px 10px; border-radius:20px; }
.pill.alt { background:transparent; color:var(--accent); border:1px solid var(--accent); }
/* 替身牌：这一句用的不是稿子点名的那张图 —— 素材到了要回来换，所以得看得见 */
.pill.sub-pill { background:transparent; color:var(--hot); border:1px dashed var(--hot); cursor:help; }
.ok { color:var(--dim); }
/* 标黄那几处：页面上用同一个黄，跟成片里对得上 */
.pill.mark { background:#FFD400; color:#2A2622; font-weight:700; }
.voice audio { height:26px; flex:1 1 150px; min-width:120px; max-width:240px; }
.meta { color:var(--dim); font-size:12px; }
.meta.note { line-height:1.65; }
/* 换背景那一句在逐句里要看得见 —— 「切点尽量踩在换背景那一句上」是九条里的第 2 条，
   核这一条得能一眼看出哪几句是段首 */
.bg-mark { display:inline-block; margin:2px 0 6px; padding:2px 9px; border-radius:6px;
  background:rgba(31,58,95,.08); color:var(--accent); font-size:11.5px; }
@media (prefers-color-scheme: dark) { .bg-mark { background:rgba(127,168,216,.14); } }

.extras { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:16px; }
.extras figure { margin:0; }
.extras img { width:100%; border-radius:8px; border:1px solid var(--line); display:block; }
.extras figure.is-cover img { border:2px solid var(--gold); }
figcaption { font-size:12px; color:var(--dim); margin-top:6px; line-height:1.6; }
.sheet { margin:0 0 10px; }
.sheet img { width:100%; border-radius:8px; border:1px solid var(--line); display:block;
  background:#fff; }
.sheet.narrow img { max-width:420px; }
/* 衬衫配色：一格一个色。用过的压暗一档 —— 眼睛要落在还没用过的那几个上 */
.swatches { display:grid; grid-template-columns:repeat(auto-fill,minmax(215px,1fr)); gap:14px; margin:10px 0; }
.sw { margin:0; display:flex; gap:11px; align-items:flex-start; }
.sw .chip { width:44px; height:44px; border-radius:9px; border:1px solid var(--line); flex:none; }
.sw figcaption { display:flex; flex-direction:column; gap:2px; margin:0; }
.sw figcaption b { font-size:13.5px; color:var(--ink); }
.sw figcaption code { font-size:10.5px; }
.sw .note { font-size:11px; line-height:1.55; }
.sw .who { font-size:11px; color:var(--accent); }
.sw.used { opacity:.62; }
.sw.used .who { color:var(--dim); }

.analysis { margin-top:24px; border-top:1px solid var(--line); padding-top:14px; }
summary { cursor:pointer; color:var(--dim); font-size:14px; font-weight:600; }
.analysis p { margin:6px 0; font-size:14px; }
.analysis h3 { font-size:15px; margin:18px 0 8px; color:var(--ink); }
.analysis ul { margin:6px 0; padding-left:22px; font-size:14px; }
.analysis li.task { list-style:none; margin-left:-18px; }
summary .src { margin-left:auto; float:right; font-weight:600; font-size:12px; color:var(--accent);
  text-decoration:none; }
ol.nine { margin:6px 0 0; padding-left:22px; font-size:14px; line-height:1.9; }

/* 表可能很宽，让它自己横向滚，别把整页撑出横条 */
.tw { overflow-x:auto; margin:10px 0; }
.tw table { border-collapse:collapse; font-size:13px; min-width:100%; }
.tw th,.tw td { border:1px solid var(--line); padding:6px 9px; text-align:left;
  vertical-align:top; }
.tw th { background:rgba(127,127,127,.10); font-weight:700; white-space:nowrap; }
.tw td.ttl { font-weight:700; white-space:nowrap; }
.tw td.mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:11.5px; color:var(--dim);
  white-space:nowrap; }
.tw td.tip { color:var(--dim); font-size:12.5px; line-height:1.6; }
code { background:rgba(127,127,127,.16); padding:1px 6px; border-radius:4px; font-size:13px; }

/* 窄屏：侧栏收到顶部，横向滚 */
@media (max-width:900px){
  .layout { grid-template-columns:1fr; gap:20px; }
  .side { position:static; max-height:none; }
  .side-list { flex-direction:row; overflow-x:auto; padding-bottom:4px; }
  .nav-item { flex:none; width:190px; }
  .side-top { display:none; }
  .film { flex-direction:column; }
  .film.with-pub .pub { border-left:0; padding-left:0; border-top:2px solid var(--line); padding-top:12px; }
}
@media (max-width:640px){ .row{grid-template-columns:110px 1fr; gap:14px;} .text{font-size:16px;} }
</style>
</head>
<body id="top">
<div class="layout">
${nav}
<div class="wrap">
${body}
</div>
</div>
<script>
// 滚动到哪一节，左边就高亮哪一条。**盯的是目录项指到的那些块**，不是写死的 class
(function () {
  var items = [].slice.call(document.querySelectorAll('.nav-item'));
  var mark = function (id) {
    items.forEach(function (a) { a.classList.toggle('active', a.dataset.target === id); });
  };
  var seen = {};
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { seen[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0; });
    var best = null, bestV = 0;
    Object.keys(seen).forEach(function (id) { if (seen[id] > bestV) { bestV = seen[id]; best = id; } });
    if (best) mark(best);
  }, { threshold: [0, 0.15, 0.4, 0.75, 1], rootMargin: '-10% 0px -55% 0px' });
  items.forEach(function (a) {
    var el = document.getElementById(a.dataset.target);
    if (el) io.observe(el);
  });
  if (items.length) items[0].classList.add('active');
})();
// 点目录里的折叠卡要自己展开 —— 浏览器跳到一个收起来的 <details> 上是**什么都不显示**的，
// 用户只会觉得链接坏了。try/catch 不是摆设：不合法的 hash 会让 querySelector 抛
(function () {
  var open = function () {
    try {
      var el = location.hash.length > 1 && document.querySelector(location.hash);
      // ⚠ **祖先也要一起开。** 稿件库里那八条是嵌在卡片里的 <details>，
      // 只开自己的话页面上什么都不显示 —— 跟链接坏了看着一模一样
      for (var p = el; p; p = p.parentElement) if (p.tagName === 'DETAILS') p.open = true;
    } catch (err) {}
  };
  addEventListener('hashchange', open);
  open();
})();
</script>
</body>
</html>
`;
}

/* ---------- 跑 ---------- */

const dirs = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name)
  .sort();                                   // 目录名以日期打头，排序就是时间序

扫用色(dirs);              // 配色卡要标「哪个色用过」，得先把账本填上
const eps = dirs.map((d, i) => episode(d, i + 1)).filter(Boolean);
if (!eps.length) console.warn('⚠ 一期都没找到（要有 vo/manifest.json 和 动作表.json）');

const navCards = [
  ['_scripts', '稿件库', '八条待拍'],
  ['_rig', '他能做什么', '表情 · 姿势 · 动作'],
  ['_grammar', '镜头语言速查', '能做什么 / 做不了什么'],
  ['_todo', '还欠的', '素材缺口'],
].map(([id, t, m]) => `<a class="nav-item" href="#${id}" data-target="${id}">
  <span class="nav-thumb ph"></span>
  <span class="nav-body"><span class="nav-title">${t}</span><span class="nav-meta">${m}</span></span>
</a>`);

const nav = `<nav class="side" id="side">
  <div class="side-head">成片目录<span class="side-count">${eps.length}</span></div>
  <div class="side-list">${[...navCards, ...eps.map((e) => e.nav)].join('\n')}</div>
  <a class="side-top" href="#top">回到顶部</a>
</nav>`;

const body = `<h1>老石 · 稿件与成片</h1>
<p class="sub">共 ${eps.length} 期 —— 竖屏 1080×1920 商务／时事口播。
画面是<b>三层</b>：背景静图 ＋ 人物透明 PNG ＋ 烧进去的字幕，
链路在 <code>shi-2d/README.md</code>，镜头怎么排在 <code>shi-2d/老石出片方案.md</code>。</p>
<p class="sub">⚠ <b>这条线跟「醒木不响」没有关系</b> —— 那是说书／治愈／心理洞察那几条线的频道。
老石是独立的商务／时事新闻线，封面页脚、角标、简介里都不要出现那边的字眼。
<b>也跟 <code>3D数字人出片方案.md</code> 那条没有关系</b>：同一个人物、两套完全独立的做法。</p>
<p class="sub">这张页自己是生成物：<code>node shi-2d/index.mjs</code>（逐句场景图要重抠加 <code>--force</code>）。</p>
${稿件库卡(已出稿件)}
${rigCard()}
${grammarCard()}
${todoCard()}
${eps.map((e) => e.html).join('\n')}`;

const out = path.join(ROOT, 'index.html');
fs.writeFileSync(out, page('老石 · 稿件与成片', nav, body));
console.log(`${eps.length} 期：${eps.map((e) => e.篇名).join('　')}`);
console.log(out);
