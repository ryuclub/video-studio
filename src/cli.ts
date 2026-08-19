import fs from 'node:fs';
import path from 'node:path';
import { projectDir } from './config.js';
import {
  PROFILES,
  type Script,
  type Timeline,
  type Shot,
  type RenderProfile,
  type SlideScript,
  type SlideTimeline,
} from './types.js';
import { generateScript, validate } from './steps/script.js';
import { synthesize } from './steps/tts.js';
import { collectShots, writeCredits } from './steps/footage.js';
import { render } from './steps/render.js';
import { synthesizeSlide } from './steps/tts-slide.js';
import { renderSlide } from './steps/render-slide.js';

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string> } {
  const cmd = argv[0] ?? 'help';
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else if (!flags._) {
      flags._ = argv[i];
    }
  }
  return { cmd, flags };
}

/** 解析 --profile，非法值当场报错，而不是把 undefined 一路传进 render */
function profileList(which = 'both'): RenderProfile[] {
  const names = which === 'both' ? ['landscape', 'portrait'] : [which];
  return names.map((n) => {
    const p = PROFILES[n];
    if (!p) throw new Error(`未知的 --profile "${n}"，可选：landscape / portrait / both`);
    return p;
  });
}

function loadProject(name: string): { dir: string; script: Script } {
  if (!name) throw new Error('缺少项目名，用法：npm run vg -- <命令> <项目名>');
  const dir = path.isAbsolute(name) ? name : projectDir(name);
  const file = path.join(dir, 'script.json');
  if (!fs.existsSync(file)) throw new Error(`找不到 ${file}`);
  const script = JSON.parse(fs.readFileSync(file, 'utf8')) as Script;
  validate(script);
  return { dir, script };
}

/**
 * PPT 演示风格是另一条管线：稿件结构、配音方式、画面来源全都不一样。
 * 用 script.json 顶层的 style 字段分流，缺省是原来的空镜解说风。
 */
function loadSlideProject(name: string): { dir: string; script: SlideScript } | null {
  if (!name) return null;
  const dir = path.isAbsolute(name) ? name : projectDir(name);
  const file = path.join(dir, 'script.json');
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { style?: string };
  if (raw.style !== 'slide') return null;
  const script = raw as unknown as SlideScript;
  if (!script.narration?.trim()) throw new Error('slide 风格缺少 narration（解说词主稿）');
  if (!Array.isArray(script.slides) || !script.slides.length) throw new Error('slide 风格缺少 slides');
  return { dir, script };
}

async function runSlide(name: string, which: string, profiles: RenderProfile[]): Promise<void> {
  const loaded = loadSlideProject(name)!;
  const { dir, script } = loaded;
  const tlFile = path.join(dir, 'timeline.json');
  const needTts = which === 'all' || which === 'tts' || !fs.existsSync(tlFile);
  const timeline = needTts
    ? await synthesizeSlide(dir, script)
    : (JSON.parse(fs.readFileSync(tlFile, 'utf8')) as SlideTimeline);
  if (which === 'tts') return;
  for (const p of profiles) await renderSlide(dir, script, timeline, p);
}

function loadJson<T>(dir: string, name: string): T {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) throw new Error(`缺少 ${name}，先跑前置步骤`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

const HELP = `
vidgen — 文案驱动的解说视频管线

  npm run vg -- script --topic "1997年日本金融危机"
  npm run vg -- script --url https://example.com/article
  npm run vg -- tts      <项目名>
  npm run vg -- footage  <项目名>
  npm run vg -- render   <项目名> [--profile landscape|portrait|both]
  npm run vg -- all      <项目名>          # tts + footage + render
  npm run vg -- auto     --topic "..."     # 从选题一路到成片
  npm run vg -- credits  <项目名>          # 导出素材出处，贴进视频简介

项目目录在 projects/<日期_标题>/，中间产物（script.json / timeline.json /
shots.json / subtitle_*.ass）都可以手动改完再跑下一步。
`;

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case 'script': {
      const { dir } = await generateScript({
        topic: flags.topic,
        url: flags.url,
        note: flags.note,
      });
      console.log(`\n下一步：npm run vg -- all ${path.basename(dir)}`);
      break;
    }

    case 'tts': {
      if (loadSlideProject(flags._)) { await runSlide(flags._, 'tts', []); break; }
      const { dir, script } = loadProject(flags._);
      await synthesize(dir, script);
      break;
    }

    case 'footage': {
      const { dir, script } = loadProject(flags._);
      const timeline = loadJson<Timeline>(dir, 'timeline.json');
      const profiles = profileList(flags.profile);
      await collectShots(dir, script, timeline, profiles.map((p) => p.orientation));
      break;
    }

    case 'credits': {
      const { dir } = loadProject(flags._);
      const shots = loadJson<Shot[]>(dir, 'shots.json');
      console.log(`\n${fs.readFileSync(writeCredits(dir, shots), 'utf8')}`);
      break;
    }

    case 'render': {
      if (loadSlideProject(flags._)) {
        await runSlide(flags._, 'render', profileList(flags.profile));
        break;
      }
      const { dir, script } = loadProject(flags._);
      const timeline = loadJson<Timeline>(dir, 'timeline.json');
      const shots = loadJson<Shot[]>(dir, 'shots.json');
      for (const p of profileList(flags.profile)) {
        await render(dir, script, timeline, shots, p);
      }
      break;
    }

    case 'all': {
      if (loadSlideProject(flags._)) {
        await runSlide(flags._, 'all', profileList(flags.profile));
        break;
      }
      const { dir, script } = loadProject(flags._);
      const profiles = profileList(flags.profile);
      const timeline = await synthesize(dir, script);
      const shots = await collectShots(dir, script, timeline, profiles.map((p) => p.orientation));
      for (const p of profiles) await render(dir, script, timeline, shots, p);
      break;
    }

    case 'auto': {
      const profiles = profileList(flags.profile);
      const { dir, script } = await generateScript({
        topic: flags.topic,
        url: flags.url,
        note: flags.note,
      });
      const timeline = await synthesize(dir, script);
      const shots = await collectShots(dir, script, timeline, profiles.map((p) => p.orientation));
      for (const p of profiles) await render(dir, script, timeline, shots, p);
      console.log(`\n成片在 ${dir}`);
      break;
    }

    default:
      console.log(HELP);
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
