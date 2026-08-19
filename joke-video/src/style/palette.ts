// ── 调色板：朱红/藏青 + 和纸米白。一条片子只用 2 个角色色 + 1 个强调色 ──

export const P = {
  paper: '#F4EDE2', // 和纸米白（背景）
  paperDeep: '#E7DCC9', // 背景深一档
  primary: '#2B3A67', // 藏青（主角色块）
  secondary: '#C1352B', // 朱红（配角色块）
  neutral: '#8B7E6E', // 灰褐
  light: '#EFE6D8', // 米白（字幕纸片）
  accent: '#D9A31C', // 芥黄（笑点/关键词）
  ink: '#22283A', // 深墨（文字）
};

export function resolveColor(c: string | undefined, fallback = P.primary): string {
  if (!c) return fallback;
  if (c.startsWith('#')) return c;
  return (P as Record<string, string>)[c] ?? fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}

/** 混向亮度：amount=0 原色，1 完全灰。定格帧用 0.85 */
export function desaturate(hex: string, amount: number): string {
  if (amount <= 0) return hex;
  const [r, g, b] = hexToRgb(hex);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // 定格时整体再压暗一点，纸感更"沉"
  const dim = 1 - 0.06 * amount;
  return rgbToHex(
    (r + (lum - r) * amount) * dim,
    (g + (lum - g) * amount) * dim,
    (b + (lum - b) * amount) * dim
  );
}

/** 同色系加深，用于剪纸投影（绝不用纯黑） */
export function deepen(hex: string, k = 0.45): string {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHex(r * (1 - k), g * (1 - k), b * (1 - k));
}

export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/**
 * 每一帧渲染前构造一个「上色器」：所有绘制代码通过它取色，
 * 定格段只要把 desat 传进来，整帧自动变灰，不需要 SVG 滤镜。
 */
export function makeInk(desat: number) {
  return (c: string) => desaturate(resolveColor(c, c), desat);
}
export type Ink = ReturnType<typeof makeInk>;
