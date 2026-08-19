/**
 * 冒烟测试：不碰网络，用假 TTS + 合成素材跑通整条管线。
 * 用途是改完 ass.ts / render.ts 后快速验证没把时间轴或滤镜图搞坏。
 *
 *   npx tsx src/smoke.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ROOT, ensureDir } from './config.js';
import { PROFILES, type Script, type Shot, type Timeline } from './types.js';
import { validate } from './steps/script.js';
import { synthesize, type TtsBackend } from './steps/tts.js';
import { collectShots } from './steps/footage.js';
import { render, planPieces } from './steps/render.js';
import { ffmpeg, run, runCapture, log } from './lib/util.js';

/**
 * 假 TTS：按字数估算时长，不联网、不烧 API 费用。
 *
 * 生成的是可听的正弦音而不是静音 —— 静音的话成片既黑屏又无声，
 * 没法用耳朵判断画音是否同步，也极容易被误当成管线故障。
 * 每行换一个音高，行与行的边界能直接听出来。
 */
class FakeTts implements TtsBackend {
  private n = 0;

  async synthesize(text: string, outFile: string): Promise<void> {
    const ms = Math.max(700, text.length * 185);
    const sec = ms / 1000;
    const freq = 320 + (this.n++ % 5) * 90;
    await ffmpeg([
      '-f', 'lavfi',
      '-i', `sine=frequency=${freq}:sample_rate=24000:duration=${sec.toFixed(3)}`,
      // 首尾淡入淡出，避免拼接处的爆音盖过要听的内容
      '-af', `volume=0.25,afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, sec - 0.08).toFixed(3)}:d=0.08`,
      '-c:a', 'libmp3lame', '-b:a', '96k', '-ac', '1', outFile,
    ]);
  }

  close(): void {}
}

const SCRIPT: Script = {
  title: '冒烟测试',
  lines: [
    { text: '1997年\\n11月17日 | 清晨', style: 'chip', speech: '', pauseAfterMs: 2400, clip: 'test_a' },
    { text: '北海道拓殖银行的营业厅还没开门', style: 'sub' },
    { text: '门外已经排起了看不到头的长队', style: 'sub', clip: 'test_b' },
    { text: '这是战后第一家倒闭的都市银行', style: 'sub', pauseAfterMs: 500 },
    { text: '银行', style: 'emph', stack: 1, clip: 'test_c' },
    { text: '没有失去所有客户', style: 'emph', stack: 1 },
    { text: '但失去的', style: 'emph', stack: 1, pauseAfterMs: 700 },
    { text: '是最好的客户', style: 'emphKey', stack: 1 },
    { text: '一周之后，山一证券宣布自主停业', style: 'sub', clip: 'test_d' },
    { text: '一个世纪的信用，在七天里烧完了', style: 'sub' },
  ],
};

/**
 * 合成测试素材，代替 Pexels 下载。
 * 横竖两版都造：竖版命名成 <name>_portrait.mp4，正好走 resolveClip 的竖版优先分支。
 */
async function makeClip(name: string, color: string, size: string): Promise<string> {
  const dir = ensureDir(path.join(CONFIG.assetsDir, 'manual'));
  const file = path.join(dir, `${name}.mp4`);
  if (fs.existsSync(file)) return file;
  await ffmpeg([
    '-f', 'lavfi', '-i', `gradients=s=${size}:d=3:c0=${color}:c1=0x0a1018:speed=0.05:n=2`,
    '-vf', 'format=yuv420p', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', file,
  ]);
  return file;
}

/**
 * 成片音频自检。
 *
 * 只看「有没有音轨」是不够的：loudnorm 内部跑在 192kHz，AAC 编码器封顶 96kHz，
 * 一不留神就编出 96kHz 单声道 —— 音轨在、时长对、ffprobe 一切正常，
 * 但一大批播放器就是不出声。所以采样率和声道数必须一起验。
 */
async function checkAudio(file: string): Promise<void> {
  const info = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=sample_rate,channels',
    '-of', 'default=nw=1:nk=1', file,
  ]);
  const [rate, channels] = info.trim().split(/\s+/).map(Number);
  if (rate !== 48000 || channels !== 2) {
    throw new Error(`${path.basename(file)} 音频是 ${rate}Hz/${channels}ch，应为 48000Hz/2ch`);
  }

  const { stderr } = await runCapture('ffmpeg', [
    '-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const mean = Number(/mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr)?.[1] ?? NaN);
  if (!(mean > -60)) {
    throw new Error(`${path.basename(file)} 平均电平 ${mean} dB，等于没声音`);
  }
  log('smoke', `${path.basename(file)} 音频 ${rate}Hz/${channels}ch，平均 ${mean.toFixed(1)}dB ✓`);
}

async function main() {
  validate(SCRIPT);
  log('smoke', 'script 校验通过');

  // 产物放 .smoke/ 而不是 projects/ —— projects/ 只该有真实作品。
  // 冒烟测试的音频是正弦测试音、画面是合成色块，混在一起太容易被误当成成片。
  const dir = ensureDir(path.join(ROOT, '.smoke'));
  fs.writeFileSync(path.join(dir, 'script.json'), JSON.stringify(SCRIPT, null, 2));

  const timeline = await synthesize(dir, SCRIPT, new FakeTts());

  // 时间轴自检：必须严格递增且无重叠
  for (let i = 1; i < timeline.lines.length; i++) {
    const prev = timeline.lines[i - 1];
    const cur = timeline.lines[i];
    if (cur.startMs < prev.endMs) throw new Error(`第 ${i} 行与上一行重叠`);
  }
  log('smoke', `时间轴 ${timeline.lines.length} 行，单调递增 ✓`);

  // 每个关键词造两条素材（<名>.mp4 和 <名>_2.mp4），这样镜头长于单条素材时
  // 能测到「放完切下一条」而不是循环重播
  for (const [n, c] of [['test_a', '0x1a2430'], ['test_b', '0x24303a'], ['test_c', '0x101820'], ['test_d', '0x2a3038']] as const) {
    await makeClip(n, c, '1920x1080');
    await makeClip(`${n}_2`, c, '1920x1080');
    await makeClip(`${n}_portrait`, c, '1080x1920');
    await makeClip(`${n}_portrait_2`, c, '1080x1920');
  }

  // 走真实的 collectShots：手动素材命中时不联网，分组和分朝向解析一并测到
  const shots: Shot[] = await collectShots(dir, SCRIPT, timeline);

  // 镜头必须无缝铺满整条音频：有空洞就意味着画面比音频短，结尾会被切掉
  if (shots[0].startMs !== 0) throw new Error('首个镜头没有从 0 开始');
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].startMs !== shots[i - 1].endMs) {
      throw new Error(`镜头 ${i - 1}/${i} 之间有 ${shots[i].startMs - shots[i - 1].endMs}ms 空洞`);
    }
  }
  if (shots[shots.length - 1].endMs !== timeline.totalMs) throw new Error('末镜头没有铺到音频结束');
  log('smoke', `${shots.length} 个镜头，无缝覆盖 ${(timeline.totalMs / 1000).toFixed(1)}s ✓`);

  // 竖版不能沿用横版素材，否则中心裁切只剩 28% 画幅
  for (const s of shots) {
    const land = s.clips.landscape ?? [];
    const port = s.clips.portrait ?? [];
    if (!port.length || !port.every((c) => /_portrait(_\d+)?\.mp4$/.test(c.file))) {
      throw new Error(`镜头 "${s.keyword}" 的竖版没走竖版专用素材：${port.map((c) => c.file)}`);
    }
    if (land.some((c) => port.some((q) => q.file === c.file))) {
      throw new Error(`镜头 "${s.keyword}" 横竖版共用了素材`);
    }
    if (land.length < 2) throw new Error(`镜头 "${s.keyword}" 只发现 ${land.length} 条素材，多条素材未被识别`);
  }
  log('smoke', '横竖版素材各自独立，每个镜头 ≥2 条 ✓');

  // 核心断言：镜头长于单条素材时必须切到下一条，而不是把同一条循环重播
  for (const p of ['landscape', 'portrait'] as const) {
    for (const s of shots) {
      const pieces = planPieces(s, PROFILES[p]);
      for (let i = 1; i < pieces.length; i++) {
        if (pieces[i].file === pieces[i - 1].file) {
          throw new Error(
            `[${p}] 镜头 "${s.keyword}" 连续两段用了同一条素材（${path.basename(pieces[i].file)}），说明在循环重播`,
          );
        }
      }
      const cover = pieces.reduce((n, x) => n + x.durMs, 0);
      if (cover !== s.endMs - s.startMs) {
        throw new Error(`[${p}] 镜头 "${s.keyword}" 片段总长 ${cover}ms ≠ 镜头 ${s.endMs - s.startMs}ms`);
      }
    }
  }
  log('smoke', '镜头内素材依次切换、无循环重播 ✓');

  for (const p of ['landscape', 'portrait']) {
    const out = await render(dir, SCRIPT, timeline, shots, PROFILES[p]);
    await checkAudio(out);
  }

  console.log('\n✓ 冒烟测试通过');
  console.log(`  产物：${dir}`);
  console.log('  注意：音频是正弦测试音（不是人声），画面是合成色块（不是素材）。');
  console.log('  它只用来验证时间轴、字幕和滤镜图没被改坏。');
  console.log('  要听真人声，跑：npm run vg -- script --topic "..." 然后 npm run vg -- all <项目名>');
}

main().catch((e) => {
  console.error('\n✗', e instanceof Error ? e.message : e);
  process.exit(1);
});
