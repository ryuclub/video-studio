import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { MsEdgeTTS } from "msedge-tts";
import { BASE_VOICES, PRESETS, GROUPS, TONE_MODULES } from "./presets";
import { render, CACHE_DIR, OUT_DIR } from "./render";
import { hasRubberband, buildFilter } from "./chain";

const PORT = Number(process.env.PORT ?? 5178);
const PUBLIC = path.resolve(__dirname, "..", "public");

const send = (res: http.ServerResponse, code: number, body: any, type = "application/json; charset=utf-8") => {
  const buf = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(buf);
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC, "index.html")), "text/html; charset=utf-8");
    }

    if (url.pathname === "/api/presets") {
      return send(res, 200, {
        presets: PRESETS,
        groups: GROUPS,
        baseVoices: BASE_VOICES,
        toneModules: TONE_MODULES,
        rubberband: await hasRubberband(),
      });
    }

    if (url.pathname === "/api/voices") {
      const list = await new MsEdgeTTS().getVoices();
      return send(
        res,
        200,
        list
          .filter((v) => /^(zh|ja)-/.test(v.Locale))
          .map((v) => ({ id: v.ShortName, label: `${v.ShortName.replace(/Neural$/, "")} · ${v.Gender === "Female" ? "女" : "男"}`, lang: v.Locale })),
      );
    }

    if (url.pathname === "/api/render" && req.method === "POST") {
      const b = await readBody(req);
      const text = String(b.text ?? "").trim();
      if (!text) return send(res, 400, { error: "台词是空的，先填一句话再试听" });
      const params = {
        pitch: Number(b.pitch ?? 1),
        formant: Number(b.formant ?? 1),
        tempo: Number(b.tempo ?? 1),
        tone: Array.isArray(b.tone) ? b.tone : [],
      };
      const r = await render({
        text,
        voice: String(b.voice || "zh-CN-YunxiNeural"),
        params,
        prosody: b.prosody,
        outName: b.save ? String(b.save).replace(/[^\w-]/g, "_") : undefined,
      });
      const { filter } = await buildFilter(params);
      return send(res, 200, {
        audio: `/audio/${b.save ? "out" : "cache"}/${path.basename(r.file)}`,
        duration: r.duration,
        degraded: r.degraded,
        cached: r.cached,
        filter,
        savedTo: b.save ? r.file : null,
      });
    }

    if (url.pathname.startsWith("/audio/")) {
      const [, , bucket, name] = url.pathname.split("/");
      const dir = bucket === "out" ? OUT_DIR : CACHE_DIR;
      const file = path.join(dir, path.basename(decodeURIComponent(name)));
      if (!file.startsWith(dir) || !fs.existsSync(file)) return send(res, 404, { error: "音频不在了，重新生成一次" });
      const stat = fs.statSync(file);
      res.writeHead(200, { "content-type": "audio/wav", "content-length": stat.size, "cache-control": "public, max-age=3600" });
      return fs.createReadStream(file).pipe(res);
    }

    if (url.pathname === "/api/export" && req.method === "POST") {
      const b = await readBody(req);
      const file = path.join(OUT_DIR, "voices.selected.json");
      fs.writeFileSync(file, JSON.stringify(b, null, 2));
      return send(res, 200, { file });
    }

    return send(res, 404, { error: "没有这个地址" });
  } catch (e: any) {
    return send(res, 500, { error: e?.message ?? String(e) });
  }
});

server.listen(PORT, () => {
  console.log(`音色实验室 → http://localhost:${PORT}`);
  hasRubberband().then((rb) => {
    if (!rb) console.log("注意：ffmpeg 没带 rubberband，音高与共振峰无法独立调，界面里会提示");
  });
});
