import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, projectDir, ensureDir, slugify } from '../config.js';
import type { Script } from '../types.js';
import { log } from '../lib/util.js';

const SYSTEM = `你是中文解说类短视频的文案作者，风格参照日本社会/经济纪实解说：克制、有史料密度、靠事实本身产生冲击力，绝不煽情浮夸。

你的输出是一个 JSON 对象，不带任何前言、解释或 Markdown 代码块。

结构：
{
  "title": "视频标题，18 字以内，要有钩子但不做标题党",
  "lines": [ ... ]
}

每个 line 的字段：
- text: 屏幕上显示的文字
- style: "chip" | "sub" | "emph" | "emphKey"
- stack: 数字，可选
- clip: 英文素材检索关键词，2-4 个词，可选
- speech: 可选，送去配音的文本；不填则等于 text
- pauseAfterMs: 可选，该句后的停顿毫秒数

四种 style 的用法：

chip —— 情境角标。格式 "1997年\\n11月17日 | 清晨"，竖线分隔时间与场景，\\n 手动换行。
  只在场景切换时用，全片不超过 4 个。chip 不配音，必须写 "speech": ""，
  并用 pauseAfterMs 给它 1800-2600 的停留时间。
  **竖线右边必须是具体信息，不能是类目名。** 角标占着画面最好的位置，
  写"访日客数""失业率"这种类目等于什么都没说 —— 观众要的是那个数。
  好："2026年\\n上半年 | 访日客2108万人\\n同比 -2.0%" / "1997年\\n11月17日 | 北海道拓殖银行 破绽"
  坏："2026年8月\\n上半年 | 访日客数" / "1997年\\n11月 | 东京"
  右边最多两行，每行 12 字以内 —— 再长竖版会被自动缩字，缩多了就看不清了。

sub —— 常规解说，底部单行字幕。每行 12-22 字，一句话说完一件事。这是主体，占八成。

emph / emphKey —— 强调段，画面中央逐行堆叠。这是全片的情绪落点。
  用法：连续若干行共用同一个 stack 编号，最后一行（也只有最后一行）用 emphKey。
  每行 4-9 字。中间可以放一行没有信息量、只负责制造顿挫的转折词（如"但失去的"）。
  全片最多 2 组，一组 3-5 行。组的第一行给 clip。

clip 关键词写英文，描述画面而不是概念。三条硬规矩（都是踩出来的）：

  1. **不要为具体的人检索。** 稿子提到某个人（导演、母亲、官员、股民）时，
     clip 给场景或物件，不要给 older woman / businessman 这类人物词 ——
     免费图库里只有欧美 stock people，画面主体一旦是人，观众会把 TA 认成
     稿子里说的那个人，等于替稿子说了一句它没说的话。
  2. **不要用跨行业歧义大的术语。** 3d modeling 在图库里的主导内容是牙科口扫，
     semiconductor 多半是实验室摆拍，trading floor 是纽约证交所。
     换成能直接看懂的画面：computer screen glow / office at night。
  3. **找不到贴切的就用宽泛的。** 空影院、城市夜景、屏幕光、键盘、走廊、雨窗
     这类"什么场合都能用"的镜头，重复用两三次也没关系 ——
     宁可平淡，不要离谱。
  好："empty office night" / "crowd waiting outside bank" / "tokyo street 1990s"
  坏："financial crisis" / "despair" / "economic collapse"
  平均每 2-3 行给一个 clip，不给的行沿用上一个镜头。

写作要求：
- 开头三行之内必须抛出一个具体的、反直觉的事实或数字，不要铺垫背景
- 全片 55-75 行，配音时长约 3-4 分钟
- 用具体的数字、日期、人名、地名。没有把握的数字就不要写，宁可模糊表述
- 不用"令人震惊""细思极恐""你敢信"这类词
- 不写"大家好""欢迎收看"，直接进入内容
- 结尾落在一个具体的事实或一句克制的判断上，不喊口号、不求关注`;

function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('模型返回里找不到 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** 从网页抓正文，作为写稿素材 */
async function fetchArticle(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; vidgen/0.1)' },
  });
  if (!res.ok) throw new Error(`抓取失败 ${res.status}: ${url}`);
  const html = await res.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 40000);
}

export interface ScriptOptions {
  topic?: string;
  url?: string;
  /** 额外要求，比如"侧重制度层面""控制在 2 分钟" */
  note?: string;
}

export async function generateScript(opts: ScriptOptions): Promise<{ dir: string; script: Script }> {
  if (!CONFIG.anthropicKey) throw new Error('缺少 ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey: CONFIG.anthropicKey });

  let userPrompt: string;
  let source: string;

  if (opts.url) {
    log('script', `抓取 ${opts.url}`);
    const article = await fetchArticle(opts.url);
    source = opts.url;
    userPrompt =
      `下面是一篇文章的正文。把它改写成一条解说视频的脚本。\n` +
      `只用文中出现的事实，不要补充文章里没有的数据。\n\n` +
      `<article>\n${article}\n</article>`;
  } else if (opts.topic) {
    source = opts.topic;
    userPrompt =
      `选题：${opts.topic}\n\n` +
      `就这个选题写一条解说视频的脚本。只写你有把握的事实；` +
      `任何具体数字如果没有把握，改成不带数字的表述。`;
  } else {
    throw new Error('必须提供 --topic 或 --url');
  }

  if (opts.note) userPrompt += `\n\n补充要求：${opts.note}`;

  log('script', `调用 ${CONFIG.model} 写稿…`);
  const res = await client.messages.create({
    model: CONFIG.model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = extractJson(text) as Script;
  parsed.source = source;
  parsed.createdAt = new Date().toISOString();
  validate(parsed);

  const dir = ensureDir(projectDir(slugify(parsed.title)));
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(parsed, null, 2), 'utf8');
  log('script', `${parsed.lines.length} 行 → ${path.join(dir, 'script.json')}`);
  return { dir, script: parsed };
}

/** 结构校验：模型偶尔会违反堆叠规则，这里挡住，别让错误流到下游 */
export function validate(script: Script): void {
  if (!script.title || !Array.isArray(script.lines) || script.lines.length === 0) {
    throw new Error('script 缺少 title 或 lines');
  }
  const groups = new Map<number, number[]>();
  script.lines.forEach((l, i) => {
    if (!l.text && l.style !== 'chip') throw new Error(`第 ${i} 行 text 为空`);
    if (!['chip', 'sub', 'emph', 'emphKey'].includes(l.style)) {
      throw new Error(`第 ${i} 行 style 非法: ${l.style}`);
    }
    if (l.stack !== undefined) {
      if (!groups.has(l.stack)) groups.set(l.stack, []);
      groups.get(l.stack)!.push(i);
    }
  });
  for (const [gid, idx] of groups) {
    // 同组必须连续
    for (let k = 1; k < idx.length; k++) {
      if (idx[k] !== idx[k - 1] + 1) throw new Error(`stack 组 ${gid} 的行不连续`);
    }
    const keys = idx.filter((i) => script.lines[i].style === 'emphKey');
    if (keys.length > 1) throw new Error(`stack 组 ${gid} 有多个 emphKey`);
    if (keys.length === 1 && keys[0] !== idx[idx.length - 1]) {
      throw new Error(`stack 组 ${gid} 的 emphKey 不在最后一行`);
    }
  }
}
