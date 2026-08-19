import { MsEdgeTTS } from "msedge-tts";
import fs from "node:fs";
import path from "node:path";
import { ffmpegVersion, hasRubberband } from "./chain";
import { PRESETS, byId, BASE_VOICES } from "./presets";
import { render, OUT_DIR } from "./render";

const SAMPLE = "各位老铁，今天咱们聊一个特别离谱的事儿。你听我说完，保证你笑出声。";

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "doctor") {
    console.log(await ffmpegVersion());
    const rb = await hasRubberband();
    console.log(`rubberband 滤镜：${rb ? "可用 —— 音高/共振峰可独立调" : "缺失 —— 会退化成锁死模式，建议换 full build 的 ffmpeg"}`);
    console.log(`Node：${process.version}`);
    return;
  }

  if (cmd === "voices") {
    const filter = rest[0];
    const list = await new MsEdgeTTS().getVoices();
    const rows = list
      .filter((v) => (filter ? v.ShortName.includes(filter) : /^(zh|ja)-/.test(v.Locale)))
      .map((v) => `${v.ShortName.padEnd(36)} ${v.Gender.padEnd(7)} ${v.FriendlyName}`);
    console.log(rows.join("\n"));
    console.log(`\n共 ${rows.length} 个（默认只列中文/日语，加参数可过滤，如 npm run voices -- ja-JP）`);
    return;
  }

  if (cmd === "one") {
    const id = rest[0];
    const text = rest[1] ?? SAMPLE;
    const p = byId(id);
    if (!p) {
      console.error(`没有这个预设：${id}\n可用：${PRESETS.map((x) => x.id).join(", ")}`);
      process.exit(1);
    }
    const r = await render({ text, voice: p.base, params: p, prosody: p.prosody, outName: p.id });
    console.log(`${p.name} → ${r.file}  ${r.duration.toFixed(2)}s`);
    return;
  }

  if (cmd === "all") {
    const text = rest[0] ?? SAMPLE;
    const manifest: any[] = [];
    for (const p of PRESETS) {
      process.stdout.write(`${p.name.padEnd(12)} `);
      try {
        const r = await render({ text, voice: p.base, params: p, prosody: p.prosody, outName: p.id });
        manifest.push({ id: p.id, name: p.name, group: p.group, base: p.base, pitch: p.pitch, formant: p.formant, tempo: p.tempo, file: path.basename(r.file), duration: Number(r.duration.toFixed(3)) });
        console.log(`✓ ${r.duration.toFixed(2)}s`);
      } catch (e: any) {
        console.log(`✗ ${e.message}`);
      }
    }
    fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify({ text, generatedAt: new Date().toISOString(), items: manifest }, null, 2));
    console.log(`\n${manifest.length}/${PRESETS.length} 个已生成 → ${OUT_DIR}`);
    return;
  }

  console.log(`用法：
  npm run doctor              检查 ffmpeg / rubberband / Node
  npm run lab                 启动网页试听台（推荐）
  npm run all -- "台词文本"     批量生成全部 ${PRESETS.length} 个预设到 out/
  npm run one -- <预设id> "台词" 只生成一个
  npm run voices [-- 关键词]    列出可用基础音色

预设：${PRESETS.map((x) => x.id).join(", ")}
基础音色内置 ${BASE_VOICES.length} 个常用项`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
