import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Shot, Storyboard } from '../types';

/**
 * 缓存策略：把「决定这个镜头长什么样的所有输入」哈希成一个 key。
 * 改一版文案、调一个镜头，只有受影响的镜头重渲染，其余秒过。
 *
 * 输入包括：shot 对象本身 + 所有引用到的源文件的 mtime/size + 输出规格。
 * 用 mtime+size 而不是文件内容哈希 —— 4K 素材几十 MB，全量哈希比重渲染还慢。
 */
export function shotKey(shot: Shot, sb: Storyboard, projectRoot: string): string {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify(shot));
  h.update(`${sb.width}x${sb.height}@${sb.fps}`);
  for (const f of referencedFiles(shot)) {
    const abs = path.resolve(projectRoot, f);
    try {
      const st = fs.statSync(abs);
      h.update(`${f}:${st.size}:${st.mtimeMs}`);
    } catch {
      h.update(`${f}:MISSING`);
    }
  }
  return h.digest('hex').slice(0, 16);
}

function referencedFiles(shot: Shot): string[] {
  const out: string[] = [];
  if (shot.source) out.push(shot.source);
  if (shot.texture) out.push(shot.texture);
  if (shot.mask) out.push(shot.mask);
  if (shot.overlayFile) out.push(shot.overlayFile);
  for (const l of shot.layers ?? []) out.push(l.file);
  return out;
}

export function cachePath(buildDir: string, shot: Shot, key: string): string {
  return path.join(buildDir, 'shots', `${shot.id}.${key}.mp4`);
}

export function isCached(file: string): boolean {
  try {
    return fs.statSync(file).size > 1024;
  } catch {
    return false;
  }
}

/** 清掉同一 shot id 下的旧 key 产物，避免 build 目录无限膨胀 */
export function pruneOldVersions(buildDir: string, shotId: string, keepKey: string): void {
  const dir = path.join(buildDir, 'shots');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(`${shotId}.`) && !f.startsWith(`${shotId}.${keepKey}.`)) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {
        /* ignore */
      }
    }
  }
}
