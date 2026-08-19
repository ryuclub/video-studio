// ── 封面：取笑点后的彩色帧 + 大字纸片 ─────────────────────────────────
//
// 规则见 封面设计规范-COVER.md，三条铁律：
//   ① 绝不剧透笑点（大字里不许出现 highlight 那个词）
//   ② 大字和标题不重复（封面卖惨，标题追问，唱双簧）
//   ③ 用彩色帧不用定格灰帧（灰调在信息流里不跳眼）
//
// 这里只做①的机器校验——②③是人的判断，机器只能提醒。

import { W, H, FPS, FONT, GROUND, SLOT, SNAKE, SNAKE_DY, ACCOUNT } from './config.js';
import { P, makeInk } from './style/palette.js';
import { piece, tornRect, n } from './style/papercut.js';
import { escapeXml } from './subtitle.js';
import { renderFrame, toScreen, stageAt, type RenderCtx } from './render.js';
import { lineText, type JokeCfg } from './types.js';

export interface CoverOpts {
  /** 封面大字。不给就自动生成 */
  title?: string;
  /** 右下角署名，默认用 config.ts 的 ACCOUNT，传 'none' 关掉 */
  tag?: string;
  /** 情绪符号，传 'none' 关掉 */
  mark?: string;
  /** 取帧时刻（秒）。默认笑点 + 0.6s */
  at?: number;
  cam?: { zoom: number; tx: number; ty: number };
}

/** 规范里的默认推镜：主角偏左中，配角只露半个头 */
export const COVER_CAM = { zoom: 1.9, tx: 170, ty: -740 };

const isWide = (ch: string) => /[⺀-鿿가-퟿＀-｠　-〿]/.test(ch);
const textWidth = (s: string, fs: number) =>
  [...s].reduce((w, ch) => w + (isWide(ch) ? fs : fs * 0.55), 0);

/**
 * 自动标题：没指定时从段子里推。
 *
 * 优先用第一句（提问句）——它建立了情境但不含答案，天然不剧透。
 * 去掉标点、截到 8 字以内。这只是个能用的兜底，**上线前应该手写一句**，
 * 规范第二节列了三种写法（第一人称卖惨 > 第三人称叙述 > 互动求助）。
 */
export function autoTitle(cfg: JokeCfg): string {
  const first = cfg.lines.find((l) => l.beat !== 'punch') ?? cfg.lines[0];
  const raw = (first ? lineText(first) : cfg.id).replace(/[，。！？、,.!?…—～~"'「」（）()]/g, '');
  const chars = [...raw];
  if (chars.length <= 8) return chars.join('');
  // 超了就砍到 7 字加省略号，别硬截出半个词
  return chars.slice(0, 7).join('') + '…';
}

/** ①的机器校验：大字里不能出现笑点词 */
export function checkTitle(cfg: JokeCfg, title: string): string[] {
  const warn: string[] = [];
  const punch = cfg.lines.find((l) => l.beat === 'punch');
  const spoiler = punch?.highlight;
  if (spoiler && title.includes(spoiler)) {
    warn.push(`大字里出现了笑点词「${spoiler}」—— 封面剧透，片子就白做了`);
  }
  if (punch && title.replace(/[，。！？]/g, '') === lineText(punch).replace(/[，。！？]/g, '')) {
    warn.push('大字就是笑点句本身，等于把包袱写在封面上');
  }
  const pubTitle = cfg.title ?? cfg.hook;
  if (pubTitle && title.replace(/[，。！？…「」]/g, '') === pubTitle.replace(/[，。！？…「」]/g, '')) {
    warn.push(`大字和标题「${pubTitle}」是同一句 —— 浪费了唯一的视觉资源，两者该唱双簧`);
  }
  const len = [...title].length;
  if (len < 4) warn.push(`大字只有 ${len} 字，太短撑不住画面（建议 4–8 字）`);
  if (len > 10) warn.push(`大字 ${len} 字，信息流里的缩略图上会看不清（建议 4–8 字）`);
  return warn;
}

/** 大字纸片：字号自适应，最大 150px，最宽占画幅 82% */
function bigTitle(title: string, top = 320): string {
  const maxW = W * 0.82;
  let fs = 150;
  while (fs > 60 && textWidth(title, fs) > maxW - 80) fs -= 2;

  const padX = 40;
  const padY = 26;
  const boxW = textWidth(title, fs) + padX * 2;
  const boxH = fs * 1.28 + padY * 2;
  const x = (W - boxW) / 2;
  const ink = makeInk(0);

  return `<g transform="rotate(-2 ${n(W / 2)} ${n(top + boxH / 2)})">
  ${piece(tornRect(x, top, boxW, boxH, 4242, 2.2, 20), ink(P.light), { dx: 7, dy: 10, shadowAlpha: 0.2 })}
  <text x="${n(W / 2)}" y="${n(top + padY + fs * 0.92)}" font-family="${FONT}" font-size="${fs}"
    font-weight="800" fill="${ink(P.ink)}" text-anchor="middle" xml:space="preserve">${escapeXml(title)}</text>
</g>`;
}

/** 情绪符号：芥黄 + 米白描边，保证压在任何底色上都看得清 */
function emotionMark(mark: string, x: number, y: number): string {
  const ink = makeInk(0);
  const fs = 132;
  return `<g transform="rotate(9 ${n(x)} ${n(y)})">
  <text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${fs}" font-weight="800"
    text-anchor="middle" stroke="${ink(P.light)}" stroke-width="14" stroke-linejoin="round"
    fill="none">${escapeXml(mark)}</text>
  <text x="${n(x)}" y="${n(y)}" font-family="${FONT}" font-size="${fs}" font-weight="800"
    text-anchor="middle" fill="${ink(P.accent)}">${escapeXml(mark)}</text>
</g>`;
}

/** 右下角署名：账号名。做到第十条时观众会认出这是同一个号 */
function signature(tag: string): string {
  const ink = makeInk(0);
  const fs = 34;
  const padX = 24;
  const padY = 14;
  const boxW = textWidth(tag, fs) + padX * 2;
  const boxH = fs * 1.3 + padY * 2;
  // 右侧 15% 会被点赞栏盖住，所以往左让一点
  const x = W - boxW - 96;
  const y = H - boxH - 380;
  return `<g transform="rotate(1.5 ${n(x + boxW / 2)} ${n(y + boxH / 2)})">
  ${piece(tornRect(x, y, boxW, boxH, 909, 1.4, 14), ink(P.primary), { dx: 4, dy: 6, shadowAlpha: 0.2 })}
  <text x="${n(x + boxW / 2)}" y="${n(y + padY + fs * 0.88)}" font-family="${FONT}" font-size="${fs}"
    font-weight="700" fill="${ink(P.paper)}" text-anchor="middle">${escapeXml(tag)}</text>
</g>`;
}

/** 出封面 SVG */
export function coverSvg(ctx: RenderCtx, opts: CoverOpts = {}): { svg: string; title: string; at: number } {
  const { tl } = ctx;
  const cfg = tl.cfg;
  const title = opts.title ?? cfg.cover?.title ?? autoTitle(cfg);
  const tag = opts.tag ?? cfg.cover?.tag ?? ACCOUNT;
  const mark = opts.mark ?? cfg.cover?.mark ?? '?!';
  // 笑点后 0.6s：角色嘴张着、表情最夸张。定格之前，所以还是彩色的
  const at = opts.at ?? cfg.cover?.at ?? Math.min(tl.punchEnd + 0.6, tl.freezeStart - 0.05);
  const nChar = cfg.characters.length;
  // 两个角色要都进画，推镜得拉开；单角色才用规范里那个 1.9 的紧景
  const autoCam = nChar > 1 ? { zoom: 1.28, tx: 0, ty: -430 } : COVER_CAM;
  const cam = opts.cam ?? (cfg.cover?.cam as any) ?? autoCam;

  // 情绪符号浮在笑点说话者头部右上方。
  // 偏移量用舞台坐标算再换算到画面，这样改 cam.zoom 时相对关系不会跑掉；
  // 直接加画面像素的话，一改推镜符号就飞到脸上去了。
  const punchWho = cfg.lines.find((l) => l.beat === 'punch')?.who;
  const ch = cfg.characters.find((c) => c.id === punchWho) ?? cfg.characters[0];
  const snake = ch?.rig === 'serpentine';
  const px = snake
    ? ch?.side === 'left' ? SNAKE.left : SNAKE.right
    : ch?.side === 'left' ? SLOT.left : SLOT.right;
  const anchorY = GROUND + (snake ? (ch?.side === 'left' ? SNAKE_DY.left : SNAKE_DY.right) : 0);
  // 蛇头就在锚点上，人的头在锚点上方约 620（双脚中心量到头顶）
  const head = toScreen(cam, px + 130, anchorY - (snake ? 300 : 760));

  const overlay = [
    bigTitle(title, cfg.cover?.top ?? 320),
    mark !== 'none' ? emotionMark(mark, head.x, head.y) : '',
    tag !== 'none' ? signature(tag) : '',
  ].join('\n');

  // 角色强制全员出场（封面要展示阵容），**道具只取取帧那一刻真正在场的**。
  //
  // 两者语义不同：把道具也全塞进来的话，蛋、碎蛋壳、锅、材料、炉子、蛋糕、
  // 蛋壳车会叠成一坨——它们本来就分属不同镜头，不该同时出现。
  const propsHere = stageAt(tl, Math.min(at, tl.freezeStart - 0.001)).filter((id) =>
    (cfg.props ?? []).some((p) => p.id === id)
  );
  const allOn: RenderCtx = {
    ...ctx,
    forceStage: [...cfg.characters.map((c) => c.id), ...propsHere],
  };
  const svg = renderFrame(allOn, Math.round(at * FPS), {
    cam,
    desat: 0, // 铁律③：封面必须是彩色帧
    hideSubtitle: true,
    hideHook: true,
    overlay,
  });
  return { svg, title, at };
}

/** 安全区辅助线：3:4 裁切框 + 抖音 UI 遮挡区 */
export function safeZoneOverlaySvg(): string {
  const cropH = 1440; // 九宫格裁 3:4
  const cropY = (H - cropH) / 2;
  return `<g>
  <rect x="0" y="${n(cropY)}" width="${W}" height="${n(cropH)}" fill="none"
    stroke="#00C2FF" stroke-width="6" stroke-dasharray="24 16"/>
  <text x="24" y="${n(cropY + 44)}" font-family="${FONT}" font-size="30" fill="#00C2FF" font-weight="700">3:4 九宫格裁切框</text>
  <rect x="0" y="${n(H * 0.8)}" width="${W}" height="${n(H * 0.2)}" fill="#000" opacity="0.42"/>
  <text x="24" y="${n(H * 0.8 + 50)}" font-family="${FONT}" font-size="30" fill="#fff" font-weight="700">底部 20%：昵称文案遮挡</text>
  <rect x="${n(W * 0.85)}" y="0" width="${n(W * 0.15)}" height="${H}" fill="#000" opacity="0.42"/>
  <text x="${n(W * 0.85 + 10)}" y="${n(H * 0.5)}" font-family="${FONT}" font-size="26" fill="#fff"
    font-weight="700" transform="rotate(90 ${n(W * 0.85 + 10)} ${n(H * 0.5)})">右侧 15%：点赞栏遮挡</text>
</g>`;
}
