#!/usr/bin/env bun
// Draws a project's art with Codex image generation, one `codex exec` session per asset.
//
//   bun <skill-dir>/scripts/codex-art.ts <project-dir> [--only a,b] [--force a,b] [--jobs 3] [--timeout-min 15]
//
// Reads <project>/art.yaml (style + assets), writes:
//   art/raw/<id>.png        the picture exactly as Codex made it (gitignored)
//   art/logs/<id>.log       the Codex transcript (gitignored)
//   public/art/<id>.jpg     plates, cover-cropped to the frame (committed; what Remotion loads)
//   public/art/<id>.png     layers and sheets, alpha kept (committed)
//   art/manifest.json       id, kind, prompt, Codex session, sha256 and size of each asset (committed)
//
// An asset whose raw file exists is skipped, so a rerun only draws what is missing or forced.
// A picture is accepted only from the Codex session that drew it ($CODEX_HOME/generated_images/<session>),
// never "the newest image": other Codex work running at the same time must not become a frame.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

type Kind = "plate" | "layer" | "sheet";
type Asset = { id: string; kind: Kind; size?: string; grid?: string; prompt: string };
type Brief = { style: string; frame?: { width: number; height: number }; assets: Asset[] };
type Entry = Asset & { session: string; sha256: string; width: number; height: number; file: string; drawn: string };

const args = process.argv.slice(2);
const projectArg = args.find((a) => !a.startsWith("--") && !isFlagValue(a));
if (!projectArg) {
  console.error("usage: codex-art.ts <project-dir> [--only a,b] [--force a,b] [--jobs N] [--timeout-min M]");
  process.exit(2);
}
const project = resolve(projectArg);
const only = listFlag("--only");
const force = listFlag("--force");
const jobs = Number(flag("--jobs") ?? 3);
const timeoutMs = Number(flag("--timeout-min") ?? 15) * 60_000;
const codexHome = process.env.CODEX_HOME ?? join(homedir(), ".codex");

const brief = Bun.YAML.parse(readFileSync(join(project, "art.yaml"), "utf8")) as Brief;
const frame = brief.frame ?? { width: 1080, height: 1920 };
for (const dir of ["art/raw", "art/logs", "public/art"]) mkdirSync(join(project, dir), { recursive: true });
const manifestPath = join(project, "art/manifest.json");
const manifest: Record<string, Entry> = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

const todo = brief.assets.filter((a) => {
  if (only && !only.includes(a.id)) return false;
  return force?.includes(a.id) || !existsSync(rawPath(a.id));
});
console.log(`codex-art: ${todo.length} to draw (${todo.map((a) => a.id).join(", ") || "none"}), ${jobs} at a time`);

const failed: string[] = [];
const queue = [...todo];
await Promise.all(
  Array.from({ length: Math.max(1, jobs) }, async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try {
        manifest[a.id] = await draw(a);
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        console.log(`  ✓ ${a.id} ${manifest[a.id].width}x${manifest[a.id].height} (session ${manifest[a.id].session})`);
      } catch (e) {
        failed.push(a.id);
        console.error(`  ✗ ${a.id}: ${(e as Error).message}`);
      }
    }
  }),
);

// Prepare every asset that has a raw file, so a changed frame size or kind takes effect without redrawing.
for (const a of brief.assets) if (existsSync(rawPath(a.id))) prepare(a);

if (failed.length) {
  console.error(`codex-art: failed ${failed.join(", ")}; rerun the same command to retry only those.`);
  process.exit(1);
}

async function draw(a: Asset): Promise<Entry> {
  const prompt = promptFor(a);
  const logPath = join(project, "art/logs", `${a.id}.log`);
  // read-only: the built-in image_gen tool needs no file access, and Codex must not touch the repo or git.
  const proc = Bun.spawn(
    ["codex", "exec", "--json", "-s", "read-only", "--skip-git-repo-check", "-C", join(project, "art"), "-"],
    { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  clearTimeout(timer);
  writeFileSync(logPath, `${prompt}\n\n--- stdout ---\n${out}\n--- stderr ---\n${err}`);
  const session = sessionId(out + "\n" + err);
  if (!session) throw new Error(`no Codex session id (exit ${code}); see ${logPath}`);
  const dir = join(codexHome, "generated_images", session);
  const pngs = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => join(dir, f)).sort((x, y) => statSync(x).mtimeMs - statSync(y).mtimeMs)
    : [];
  if (pngs.length === 0) throw new Error(`session ${session} made no image (exit ${code}${code !== 0 ? ", timed out or failed" : ""}); see ${logPath}`);
  // The prompt asks for one image; if Codex retried, its last attempt is the one it settled on.
  const picked = pngs[pngs.length - 1];
  copyFileSync(picked, rawPath(a.id));
  const { width, height } = probe(rawPath(a.id));
  return {
    ...a,
    session,
    sha256: createHash("sha256").update(readFileSync(picked)).digest("hex"),
    width,
    height,
    file: publicName(a),
    drawn: new Date().toISOString(),
  };
}

function promptFor(a: Asset): string {
  const size = a.size ?? (a.kind === "sheet" ? "1536x1024" : "1024x1536");
  const lines = [
    "Use your image generation tool to create exactly ONE image. Do not run shell commands, do not write files, do not touch git.",
    `Size: ${size}${size === "1024x1536" ? " (vertical, for a 9:16 phone video; it will be cover-cropped to 1080x1920, so keep the subject inside the centre 85% of the width)" : ""}.`,
    a.kind === "plate" ? "" : "Background: fully transparent (real alpha), no backdrop, no ground shadow.",
    a.kind === "sheet"
      ? `This is a sprite sheet for frame-by-frame animation: a ${a.grid ?? "4x2"} grid (columns x rows) of equal cells, read left to right, top to bottom. Same object, same scale and same centre in every cell; only the animation stage changes. No grid lines, borders or numbers.`
      : "",
    `Style: ${brief.style.trim()}`,
    `Subject: ${a.prompt.trim()}`,
    "When the image is done, reply with one line describing it.",
  ];
  return lines.filter(Boolean).join("\n");
}

function prepare(a: Asset) {
  const src = rawPath(a.id);
  const dst = join(project, "public/art", publicName(a));
  const vf =
    a.kind === "plate"
      ? `scale=${frame.width}:${frame.height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${frame.width}:${frame.height}`
      : "null";
  const args = ["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf];
  if (a.kind === "plate") args.push("-q:v", "3");
  const r = Bun.spawnSync([...args, dst]);
  if (r.exitCode !== 0) throw new Error(`ffmpeg failed on ${a.id}: ${r.stderr.toString()}`);
}

function probe(file: string) {
  const r = Bun.spawnSync(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = r.stdout.toString().trim().split(",").map(Number);
  return { width, height };
}

function sessionId(text: string): string | undefined {
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "thread.started" && ev.thread_id) return ev.thread_id;
    } catch {}
  }
  return text.match(/session id:\s*([0-9a-f-]{36})/)?.[1];
}

function rawPath(id: string) {
  return join(project, "art/raw", `${id}.png`);
}
function publicName(a: Asset) {
  return `${a.id}.${a.kind === "plate" ? "jpg" : "png"}`;
}
function flag(name: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
function listFlag(name: string) {
  return flag(name)?.split(",").map((s) => s.trim()).filter(Boolean);
}
function isFlagValue(a: string) {
  const i = args.indexOf(a);
  return i > 0 && ["--only", "--force", "--jobs", "--timeout-min"].includes(args[i - 1]);
}
