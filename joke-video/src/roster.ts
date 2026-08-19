// ── 角色形象花名册：一份定义，分镜手册和预览页共用 ────────────────────
//
// 形象原稿（美术给的 svg）统一放 `assets/characters/`，是**唯一真源**。
// 代码里的 rig 只是把原稿参数化好让它能动，改形象要先改 svg 再同步代码。
//
// 加新角色：往 assets/characters/ 放 svg，在这里登记一条，重跑
// `npm run shotdoc` 和 `npm run preview`。

import { existsSync, readFileSync } from 'node:fs';
import { n } from './style/papercut.js';
import { W, GROUND } from './config.js';
import { serpentine } from './rigs/serpentine.js';
import { human } from './rigs/human.js';
import { turtle } from './rigs/turtle.js';
import { mouse } from './rigs/mouse.js';
import { cat } from './rigs/cat.js';
import type { CharState } from './rigs/state.js';

export interface RosterEntry {
  key: string;
  label: string;
  /** json 里怎么写。还没做骨架的填 '—' */
  usage: string;
  note: string;
  /** 形象原稿路径，没有原稿（纯代码画的）就留空 */
  svg?: string;
  /**
   * 这个角色默认用哪个音色（src/cast.ts 里的选角名）。
   *
   * 是**建议值**不是硬绑定——同一条片子里到底会不会撞车，
   * 取决于实际用到哪几个角色，出片前跑 `npm run lines` 查。
   */
  voice?: string;
  /**
   * 有没有做成可动骨架。
   * false = 只是原稿入库了，还不能用在片子里（没有口型、眨眼、走路）。
   * 素材库照样显示，但会标出来——**别在 json 里引用没做骨架的角色**，preflight 会拦。
   */
  rigged: boolean;
  draw: (ink: (c: string) => string) => string;
}

/**
 * 直接把原稿 svg 画出来（不做骨架，纯静态展示）。
 *
 * 新角色扔进 assets/characters/ 就能在素材库里看到，不用先写一套 rig。
 * 等真有稿件要用它了再做骨架——**先入库、后做动**，避免为用不上的角色写代码。
 */
export function drawStaticSvg(file: string, ink: (c: string) => string, targetW = 560): string {
  if (!existsSync(file)) return '';
  const raw = readFileSync(file, 'utf8');
  const vb = raw.match(/viewBox="([\d.\s-]+)"/);
  const [, , vw, vh] = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 1024, 1024];
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>[\s\S]*$/, '');
  // 颜色过 ink()，定格去色才生效；没写 fill 的路径（纯黑线稿）补一个默认深墨
  const inked = inner
    .replace(/fill="(#[0-9a-fA-F]{3,8})"/g, (_m, c) => `fill="${ink(c)}"`)
    .replace(/<path (?![^>]*fill=)/g, `<path fill="${ink('#22283A')}" `);
  const scale = targetW / vw;
  // 先摆到角色站位（画面中央、地平线上），再做局部缩放——
  // 少了外层这一下，图会画到画布左上角外面去，渲出来是一片空白
  return (
    `<g transform="translate(${n(W / 2)},${n(GROUND)}) translate(${n(-targetW / 2)},${n(-vh * scale)}) scale(${n(
      scale
    )})">` +
    inked +
    `</g>`
  );
}

export function baseState(over: Partial<CharState>): CharState {
  return {
    id: '_',
    x: W / 2,
    y: GROUND,
    scale: 1.25,
    facing: 1,
    mouth: 0,
    eyes: 'normal',
    brows: 'normal',
    bob: 0,
    breath: 1,
    lean: 0,
    shakeX: 0,
    shakeY: 0,
    opacity: 1,
    t: 0.4,
    color: '#2B3A67',
    accent: '#EFE6D8',
    ...over,
  };
}

export const ROSTER: RosterEntry[] = [
  {
    key: 'turtle-kid',
    label: '小龟',
    usage: '"rig": "turtle", "variant": "kid"',
    note: '呆毛 + 高光圆眼 + 粉腮。线稿描边风',
    svg: 'assets/characters/turtle-kid.svg',
    voice: '童声',
    rigged: true,
    draw: (ink) => turtle(baseState({ variant: 'kid', length: 520 }), ink, 7),
  },
  {
    key: 'turtle-mom',
    label: '龟妈妈',
    usage: '"rig": "turtle", "variant": "mom"',
    note: '眉毛 + 两道皱纹，壳更大更深',
    svg: 'assets/characters/turtle-mom.svg',
    voice: '老太太',
    rigged: true,
    draw: (ink) => turtle(baseState({ variant: 'mom', length: 760, facing: -1 }), ink, 9),
  },
  {
    key: 'mouse',
    label: '老鼠',
    usage: '"rig": "mouse", "length": 520',
    note: '**无描边扁平版**，跟乌龟的线稿描边、蛇的剪纸都不是一套。一条片子里别混风格。朝右（乌龟朝左）',
    svg: 'assets/characters/mouse.svg',
    voice: '精灵',
    rigged: true,
    draw: (ink) => mouse(baseState({ length: 520 }), ink, 21),
  },
  {
    key: 'cat-night',
    label: '夜猫',
    usage: '"rig": "cat", "length": 620',
    note: '**渐变剪影风**，深紫身 + 橙色发光眼。⚠ 嘴不能动（原稿胡须鼻子嘴在同一条路径里），别当主讲角色，适合旁边盯着看或只给一两句短台词',
    svg: 'assets/characters/cat-night.svg',
    voice: '反派',
    rigged: true,
    draw: (ink) => cat(baseState({ length: 620 }), ink, 31),
  },
  {
    key: 'cat-day',
    label: '猫 · 白天',
    usage: '"rig": "cat", "variant": "day", "length": 620',
    note: '夜猫的同一副剪影换暖色（橘猫 + 墨绿眼）。白天戏用这个，夜猫摆进晨光里一眼穿帮。⚠ 嘴不能动这条照旧',
    svg: 'assets/characters/cat-night.svg',
    voice: '大叔',
    rigged: true,
    draw: (ink) => cat(baseState({ length: 620, variant: 'day' }), ink, 33),
  },
  {
    key: 'serpentine',
    label: '长条动物',
    usage: '"rig": "serpentine", "length": 560',
    note: '蛇 / 鱼 / 虫。身体是正弦曲线，剪纸风',
    voice: '大块头',
    rigged: true,
    draw: (ink) => serpentine(baseState({ length: 560, color: '#C1352B' }), ink, 11),
  },
  {
    key: 'human-child',
    label: '人物 · 小孩',
    usage: '"rig": "human", "proportion": "child"',
    note: '约 4 头身，动作快而弹',
    voice: '童声',
    rigged: true,
    draw: (ink) => human(baseState({ proportion: 'child', color: '#C1352B' }), ink, 13),
  },
  {
    key: 'human-adultM',
    label: '人物 · 成年男',
    usage: '"rig": "human", "proportion": "adultM"',
    note: '标准成年比例',
    voice: '青年男',
    rigged: true,
    draw: (ink) => human(baseState({ proportion: 'adultM', color: '#2B3A67' }), ink, 15),
  },
  {
    key: 'squirrel',
    label: '松鼠',
    usage: '—　（还没做骨架）',
    note: '线稿描边风，大尾巴 + 捧东西的手势。**只入库了原稿，还不能用在片子里**',
    svg: 'assets/characters/squirrel.svg',
    voice: '少女',
    rigged: false,
    draw: (ink) => drawStaticSvg('assets/characters/squirrel.svg', ink, 620),
  },
  {
    key: 'rabbit-line',
    label: '兔子 · 线稿头像',
    usage: '—　（还没做骨架）',
    note: '**纯黑线稿风**，只有头 + 长耳 + 大黑眼，没有身体。跟其余风格都不是一套。**只入库了原稿**',
    svg: 'assets/characters/rabbit-line.svg',
    voice: '女童',
    rigged: false,
    draw: (ink) => drawStaticSvg('assets/characters/rabbit-line.svg', ink, 560),
  },
  {
    key: 'rabbit-white',
    label: '兔子 · 白兔全身',
    usage: '—　（还没做骨架）',
    note: '奶白身 + 黄肚兜 + 橙耳内衬，全身站姿。跟松鼠同属线稿描边一族，能凑一条片子。**只入库了原稿**',
    svg: 'assets/characters/rabbit-white.svg',
    voice: '女童',
    rigged: false,
    draw: (ink) => drawStaticSvg('assets/characters/rabbit-white.svg', ink, 520),
  },
  {
    key: 'human-elder',
    label: '人物 · 老人',
    usage: '"rig": "human", "proportion": "elder"',
    note: '前倾 10°、动作慢 30%',
    voice: '老爷爷',
    rigged: true,
    draw: (ink) => human(baseState({ proportion: 'elder', color: '#8B7E6E', hair: 'white' }), ink, 17),
  },
];
