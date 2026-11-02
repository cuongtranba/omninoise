#!/usr/bin/env bun
/**
 * Record one montage shot from a real Chrome tab (CDP screencast) into footage/<id>.mp4.
 *
 *   bun record.ts <project-dir> <shot-id> [--keep-tab] [--fresh]
 *
 * The shot's `record` block in shotlist.yaml says where and what:
 *
 *   record:
 *     cdp: 9334                       # Chrome debugging port (see references/opencut.md)
 *     url: https://github.com/example/repo
 *     viewport: { width: 540, height: 960, scale: 2 }   # default: portrait, 1080x1920 frames
 *     hide: [".avatar", "header .email"]                # CSS selectors blanked before recording
 *     before: "document.querySelector('#private')?.remove()"   # page JS run before recording
 *     steps:                          # played while recording
 *       - wait: 1
 *       - scroll: 600, over: 1.5      # px, smoothly
 *       - hover: "a[href$='README.md']"
 *       - click: "a[href$='README.md']"
 *       - clickText: "Create Post"    # the smallest visible element whose text is exactly this
 *       - eval: "document.querySelector('.grid').scrollBy(0, 400)"   # anything else
 *       - goto: https://...
 *       - key: End
 *     tail: 0.5                       # seconds held after the last step
 *     capture: screenshot             # default: sharp frames at device scale, ~15 fps;
 *                                     # screencast: smooth ~30-60 fps but CSS pixels (540x960)
 *
 * A terminal shot has `terminal` instead of `url` (`cdp`, `viewport`, `tail`, `capture` keep
 * their meaning; `steps` are ignored). A scripted session of REAL commands runs under
 * asciinema (terminal.ts), the cast is scrubbed (home, user, host; secrets abort), served as a
 * branded player page, and that page is recorded like any other:
 *
 *   record:
 *     cdp: 9334
 *     terminal:
 *       cwd: /tmp/demo-folder   # required; must exist after `setup`
 *       setup: "sh ./setup.sh"        # optional; sh -c in the project dir before recording, not shown
 *       size: 44x26                   # cols x rows (default 44x26)
 *       title: "Terminal"             # window title bar text (default "Terminal")
 *       typing: 25                    # typed characters per second (default 25)
 *       steps:
 *         - run: claude -p "say hi"   # typed at the prompt, then executed with sh -c in cwd
 *           pause: 1.5                # seconds after it finishes (default 1)
 *         - comment: "# explain"      # typed but not executed, shown dim
 *     tail: 1
 *
 * The scrub also refuses any string in the profile's `ban` list (omninoise.profile.yaml).
 *
 * The cast is kept as footage/<id>.cast and reused on the next run; pass --fresh to run the
 * session again (the real commands run again, so their output changes).
 *
 * It opens its own tab (never drives a tab you already have open), records only page
 * pixels (no address bar), and closes the tab afterwards. Frames keep their capture
 * times, so the MP4 plays at the speed things happened, resampled to constant 30 fps.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProfile } from "./profile.ts";
import { recordCast, serveCastPlayer, type TerminalSpec } from "./terminal.ts";

type Step =
	| { wait: number }
	| { scroll: number; over?: number }
	| { hover: string }
	| { click: string }
	| { clickText: string }
	| { eval: string }
	| { goto: string }
	| { key: string };
type Record = {
	cdp?: number;
	url?: string;
	terminal?: TerminalSpec;
	viewport?: { width: number; height: number; scale?: number };
	hide?: string[];
	before?: string;
	steps?: Step[];
	tail?: number;
	capture?: "screenshot" | "screencast";
};

const [projectArg, shotId] = process.argv.slice(2);
if (!projectArg || !shotId) {
	console.error("usage: record.ts <project-dir> <shot-id> [--keep-tab] [--fresh]");
	process.exit(1);
}
const project = resolve(projectArg);
const list = Bun.YAML.parse(readFileSync(join(project, "shotlist.yaml"), "utf8")) as {
	shots: Array<{ id: string; record?: Record }>;
};
const rec = list.shots.find((s) => s.id === shotId)?.record;
if (!rec) throw new Error(`shot ${shotId} has no record block`);
const port = rec.cdp ?? 9334;
const viewport = { width: 540, height: 960, scale: 2, ...rec.viewport };

// A terminal shot records a served player page instead of rec.url, and its only step is to play the cast.
let player: ReturnType<typeof serveCastPlayer> | undefined;
if (rec.terminal) {
	const cast = recordCast(project, shotId, rec.terminal, { fresh: process.argv.includes("--fresh"), ban: loadProfile(project)?.profile.ban });
	const [cols, rows] = (rec.terminal.size ?? "44x26").split("x").map(Number) as [number, number];
	player = serveCastPlayer(cast, {
		title: rec.terminal.title ?? "Terminal",
		cols,
		rows,
		viewportWidth: viewport.width,
		viewportHeight: viewport.height,
	});
}
const pageUrl = player?.url ?? rec.url;
if (!pageUrl) throw new Error(`shot ${shotId}: record needs a url or a terminal block`);
const steps: Step[] = player ? [{ eval: "window.__play()" }] : (rec.steps ?? []);

const target = (await (
	await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })
).json()) as { id: string; webSocketDebuggerUrl: string };
const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
const send = <T = unknown>(method: string, params: object = {}) =>
	new Promise<T>((ok, fail) => {
		const id = ++nextId;
		pending.set(id, (m) => (m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result as T)));
		ws.send(JSON.stringify({ id, method, params }));
	});

const framesDir = join(project, "footage", `.${shotId}-frames`);
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const frames: Array<{ file: string; t: number }> = [];
let recording = false;

ws.onmessage = (ev) => {
	const m = JSON.parse(String(ev.data));
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)!(m);
		pending.delete(m.id);
	}
	if (m.method === "Page.screencastFrame") {
		// Arrival time, on the same clock as endedAt (metadata.timestamp is not).
		if (recording) saveFrame(m.params.data);
		send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {});
	}
};
await new Promise((ok) => (ws.onopen = ok));

const evaluate = (expression: string) =>
	send<{ exceptionDetails?: { text: string } }>("Runtime.evaluate", { expression, awaitPromise: true }).then((r) => {
		if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.text}`);
	});
const sleep = (s: number) => new Promise((ok) => setTimeout(ok, s * 1000));
const hideCss = (rec.hide ?? []).map((sel) => `${sel}{visibility:hidden !important}`).join("");
const settle = async () => {
	await sleep(0.3);
	await evaluate(`new Promise(r => document.readyState === "complete" ? r() : addEventListener("load", () => r(), { once: true }))`);
	await evaluate(`(() => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(
		`html{scrollbar-width:none}::-webkit-scrollbar{display:none}${hideCss}`,
	)}; document.head.append(s); })()`);
	await sleep(0.8);
};
const byText = (label: string) => `[...document.querySelectorAll("button, a, [role=button], div, span")]
	.filter(e => e.offsetParent && e.innerText?.trim() === ${JSON.stringify(label)})
	.sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)
	.map(e => e.closest("button, a, [role=button]") ?? e)[0]`; // innermost match, then its button
const centerOf = async (selector: string, text = false) => {
	const find = text ? byText(selector) : `document.querySelector(${JSON.stringify(selector)})`;
	const r = (await send<{ result: { value?: { x: number; y: number } } }>("Runtime.evaluate", {
		expression: `(() => { const el = ${find}; if (!el) return null;
			el.scrollIntoView({ block: "center", behavior: "instant" }); const b = el.getBoundingClientRect();
			return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`,
		returnByValue: true,
	})) as { result: { value?: { x: number; y: number } } };
	if (!r.result.value) throw new Error(`selector not found: ${selector}`);
	return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
	width: viewport.width,
	height: viewport.height,
	deviceScaleFactor: viewport.scale,
	mobile: viewport.width < viewport.height,
});
await send("Page.navigate", { url: pageUrl });
await settle();
if (rec.before) await evaluate(rec.before);
const capture = rec.capture ?? "screenshot";
const saveFrame = (data: string) => {
	const file = join(framesDir, `f${String(frames.length).padStart(6, "0")}.jpg`);
	writeFileSync(file, Buffer.from(data, "base64"));
	frames.push({ file, t: Date.now() / 1000 });
};
let grabbing: Promise<void> = Promise.resolve();
if (capture === "screencast") {
	await send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
	recording = true;
} else {
	// Screenshots honour the device scale (1080x1920 frames); the screencast does not.
	recording = true;
	grabbing = (async () => {
		while (recording) {
			const r = await send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 88, optimizeForSpeed: true });
			if (recording) saveFrame(r.data);
		}
	})();
}
const startedAt = Date.now() / 1000;

for (const step of steps) {
	if ("wait" in step) await sleep(step.wait);
	else if ("scroll" in step) {
		const ms = (step.over ?? 1) * 1000;
		await evaluate(`new Promise(r => { const y0 = scrollY, d = ${step.scroll}, t0 = performance.now();
			const tick = (t) => { const k = Math.min(1, (t - t0) / ${ms}); const e = k < .5 ? 2*k*k : 1 - (-2*k + 2)**2 / 2;
			scrollTo(0, y0 + d * e); k < 1 ? requestAnimationFrame(tick) : r(); }; requestAnimationFrame(tick); })`);
	} else if ("hover" in step || "click" in step || "clickText" in step) {
		const { x, y } =
			"clickText" in step ? await centerOf(step.clickText, true) : await centerOf("hover" in step ? step.hover : step.click);
		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
		if (!("hover" in step)) {
			// The mouse move gives the hover look; the click itself goes through the element,
			// because input events sent while a screenshot is being captured can be dropped.
			const find = "clickText" in step ? byText(step.clickText) : `document.querySelector(${JSON.stringify(step.click)})`;
			await evaluate(`(${find}).click()`);
		}
		await sleep(0.4);
	} else if ("eval" in step) {
		await evaluate(step.eval);
	} else if ("goto" in step) {
		await send("Page.navigate", { url: step.goto });
		await settle();
	} else if ("key" in step) {
		await send("Input.dispatchKeyEvent", { type: "keyDown", key: step.key, code: step.key });
		await send("Input.dispatchKeyEvent", { type: "keyUp", key: step.key, code: step.key });
	}
}
await sleep(rec.tail ?? 0.5);
recording = false;
const endedAt = Date.now() / 1000;
await grabbing;
if (capture === "screencast") await send("Page.stopScreencast");
ws.close();
player?.stop();
if (!process.argv.includes("--keep-tab")) await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`);

if (frames.length === 0) throw new Error("no frames: is the tab visible? Chrome paints only a shown tab");
// Concat list with each frame held until the next one; the last until the recording ended.
const lines = frames.map((f, i) => {
	const next = frames[i + 1]?.t ?? endedAt;
	return `file '${f.file}'\nduration ${Math.max(0.001, next - f.t).toFixed(3)}\n`;
});
lines.push(`file '${frames[frames.length - 1]!.file}'\n`);
writeFileSync(join(framesDir, "concat.txt"), lines.join(""));
const out = join(project, "footage", `${shotId}.mp4`);
const ff = spawnSync("ffmpeg", [
	"-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", join(framesDir, "concat.txt"),
	"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", out,
]);
if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
if (!process.env.RECORD_DEBUG) rmSync(framesDir, { recursive: true, force: true });
console.log(`wrote ${out}: ${frames.length} frames over ${(endedAt - startedAt).toFixed(1)} s`);
process.exit(0);
