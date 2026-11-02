#!/usr/bin/env bun
/**
 * Terminal footage for montage shots: run a scripted session of REAL commands under
 * asciinema, scrub it, and serve it as a branded player page that record.ts captures.
 *
 *   bun terminal.ts drive <spec.json>     # runs inside asciinema's PTY (used by recordCast)
 *
 * record.ts calls recordCast() then serveCastPlayer(); see its header for the shotlist shape.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

export type TerminalStep = { run: string; pause?: number } | { comment: string; pause?: number };
export type TerminalSpec = {
	cwd: string;
	setup?: string;
	size?: string; // "COLSxROWS", default 44x26
	title?: string;
	typing?: number; // chars per second, default 25
	steps: TerminalStep[];
};

const DEFAULT_SIZE = "44x26";
const PLAYER_VERSION = "3.10.0";
const MINT = "\x1b[38;2;62;230;170m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const parseSize = (size = DEFAULT_SIZE) => {
	const m = /^(\d+)x(\d+)$/.exec(size);
	if (!m) throw new Error(`terminal.size must look like 44x26, got ${size}`);
	return { cols: Number(m[1]), rows: Number(m[2]) };
};

// ---- drive: runs inside the PTY -------------------------------------------------------

const sleep = (s: number) => new Promise((ok) => setTimeout(ok, s * 1000));

async function typeOut(text: string, cps: number) {
	for (const ch of text) {
		process.stdout.write(ch);
		await sleep((1 / cps) * (0.5 + Math.random())); // jitter around the mean rate
	}
}

async function drive(spec: TerminalSpec) {
	const cps = spec.typing ?? 25;
	const prompt = () => process.stdout.write(`${MINT}$ ${RESET}`);
	for (const step of spec.steps) {
		prompt();
		await sleep(0.3);
		if ("run" in step) {
			await typeOut(step.run, cps);
			process.stdout.write("\n");
			spawnSync("sh", ["-c", step.run], {
				cwd: spec.cwd,
				stdio: "inherit",
				// Nobody can press q in a headless recording, so a pager (git diff, man) would hang it.
				env: { ...process.env, CLICOLOR: "1", TERM: process.env.TERM ?? "xterm-256color", PAGER: "cat", GIT_PAGER: "cat" },
			});
			await sleep(step.pause ?? 1);
		} else {
			process.stdout.write(DIM);
			await typeOut(step.comment, cps);
			process.stdout.write(`${RESET}\n`);
			await sleep(step.pause ?? 0.6);
		}
		await sleep(0.4);
	}
	prompt();
	await sleep(1);
}

if (import.meta.main && process.argv[2] === "drive") {
	const specFile = process.argv[3];
	if (!specFile) throw new Error("usage: terminal.ts drive <spec.json>");
	await drive(JSON.parse(readFileSync(specFile, "utf8")) as TerminalSpec);
	process.exit(0);
}

// ---- scrub ----------------------------------------------------------------------------

const LEAKS: Array<[string, RegExp]> = [
	["email address", /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
	["sk- key", /sk-[A-Za-z0-9_-]{10,}/],
	["GitHub token", /(ghp_|gho_|github_pat_)[A-Za-z0-9_]+/],
	["Slack token", /xox[abp]-/],
	["AWS access key", /AKIA[0-9A-Z]{16}/],
	["Bearer token", /Bearer [A-Za-z0-9._~+\/=-]{8,}/],
];

/**
 * Replace the machine's identity with neutral names, then refuse a cast that still holds
 * anything that looks like a secret, or any string from the profile's `ban` list (internal
 * hostnames, private repo names). The error names the pattern and the line, never the
 * matched text.
 */
export function scrubCast(text: string, ctx: { home: string; user: string; host: string; ban?: string[] }): string {
	let out = text;
	const swap = (needle: string, to: string) => {
		if (needle) out = out.split(needle).join(to);
	};
	swap(ctx.home, "~");
	const shortHost = ctx.host.split(".")[0] ?? "";
	swap(ctx.host, "demo"); // full name first, so its short form is not left dangling
	swap(shortHost, "demo");
	swap(ctx.user, "demo");
	const banned = (ctx.ban ?? []).filter(Boolean).map((b) => b.toLowerCase());
	out.split("\n").forEach((line, i) => {
		for (const [name, re] of LEAKS) {
			if (re.test(line)) throw new Error(`cast refused: ${name} found on line ${i + 1}`);
		}
		const lower = line.toLowerCase();
		if (banned.some((b) => lower.includes(b))) throw new Error(`cast refused: a banned string from the profile found on line ${i + 1}`);
	});
	return out;
}

// ---- record ---------------------------------------------------------------------------

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

/** footage/<id>.cast for a terminal shot: reused unless `fresh`; written only once scrubbed clean. */
export function recordCast(project: string, shotId: string, spec: TerminalSpec, opts: { fresh?: boolean; ban?: string[] } = {}): string {
	const footage = join(project, "footage");
	const castPath = join(footage, `${shotId}.cast`);
	if (existsSync(castPath) && !opts.fresh) return castPath;

	const { cols, rows } = parseSize(spec.size);
	if (spec.setup) {
		const s = spawnSync("sh", ["-c", spec.setup], { cwd: project, stdio: "inherit" });
		if (s.status !== 0) throw new Error(`terminal.setup failed (exit ${s.status})`);
	}
	const cwd = resolve(project, spec.cwd);
	if (!existsSync(cwd)) throw new Error(`terminal.cwd does not exist: ${cwd}`);

	const tmp = mkdtempSync(join(tmpdir(), "omninoise-cast-"));
	try {
		const specFile = join(tmp, "spec.json");
		const rawCast = join(tmp, "raw.cast");
		writeFileSync(specFile, JSON.stringify({ ...spec, cwd }));
		const command = `${shq(process.execPath)} ${shq(import.meta.path)} drive ${shq(specFile)}`;
		const r = spawnSync(
			"asciinema",
			["rec", "--headless", "--quiet", "--return", "--overwrite", "--window-size", `${cols}x${rows}`, "--idle-time-limit", "2", "-c", command, rawCast],
			{ stdio: ["ignore", "inherit", "inherit"] },
		);
		if (r.status !== 0) throw new Error(`asciinema failed (exit ${r.status})`);

		// The header names our own script and temp spec; the player does not need it.
		const [header, ...events] = readFileSync(rawCast, "utf8").split("\n");
		const head = JSON.parse(header!) as Record<string, unknown>;
		delete head.command;
		const text = [JSON.stringify(head), ...events].join("\n");
		const clean = scrubCast(text, { home: homedir(), user: userInfo().username, host: hostname(), ban: opts.ban });
		mkdirSync(footage, { recursive: true });
		const stage = `${castPath}.tmp`;
		writeFileSync(stage, clean);
		renameSync(stage, castPath);
		return castPath;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

// ---- player page ----------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function playerPage(o: { title: string; cols: number; rows: number; viewportWidth: number; viewportHeight: number }) {
	const margin = 16;
	const width = o.viewportWidth - margin * 2;
	// Natural height of the terminal at that width (char ~0.6em wide, line 1.333em), capped so
	// the window ends well above the caption zone (captions sit at 71% of the frame height).
	const natural = (width * o.rows * 1.3333) / (o.cols * 0.6);
	const termHeight = Math.round(Math.min(natural, o.viewportHeight * 0.61));
	return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/asciinema-player@${PLAYER_VERSION}/dist/bundle/asciinema-player.css">
<style>
html,body{margin:0;height:100%;background:#06140F;overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;padding-top:20px;box-sizing:border-box;
  background:radial-gradient(120% 60% at 50% 0%,#0C2A20 0%,#06140F 70%)}
.win{width:${width}px;border-radius:16px;overflow:hidden;background:#0B1F18;
  border:1px solid #1E4A3A;box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 0 1px rgba(62,230,170,.08)}
.bar{height:34px;display:flex;align-items:center;padding:0 14px;background:#10291F;border-bottom:1px solid #1E4A3A;position:relative}
.dot{width:11px;height:11px;border-radius:50%;margin-right:7px}
.title{position:absolute;left:0;right:0;text-align:center;color:#8FB5A5;
  font:600 13px/34px -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;letter-spacing:.02em}
#term{width:${width}px;height:${termHeight}px}
.asciinema-player-theme-omni{
  --term-color-foreground:#E8F5EF;--term-color-background:#0B1F18;
  --term-color-0:#0B1F18;--term-color-1:#FF6B6B;--term-color-2:#3EE6AA;--term-color-3:#F5D76E;
  --term-color-4:#6CB6FF;--term-color-5:#C792EA;--term-color-6:#5EEAD4;--term-color-7:#CBD9D2;
  --term-color-8:#4A6B5D;--term-color-9:#FF8E8E;--term-color-10:#7DFFC9;--term-color-11:#FFE48A;
  --term-color-12:#8FCBFF;--term-color-13:#DDB0FF;--term-color-14:#8FF5E3;--term-color-15:#FFFFFF}
.ap-wrapper,.ap-player{background:#0B1F18 !important}
</style></head>
<body>
<div class="win">
  <div class="bar"><span class="dot" style="background:#FF6B6B"></span><span class="dot" style="background:#F5D76E"></span><span class="dot" style="background:#3EE6AA"></span>
  <span class="title">${esc(o.title)}</span></div>
  <div id="term"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/asciinema-player@${PLAYER_VERSION}/dist/bundle/asciinema-player.min.js"></script>
<script>
const player = AsciinemaPlayer.create("/cast", document.getElementById("term"), {
  autoPlay: false, preload: true, controls: false, fit: "both", theme: "omni",
  idleTimeLimit: 2, loop: false, terminalLineHeight: 1.3333
});
window.__play = () => new Promise((done) => {
  player.addEventListener("ended", () => done());
  player.play();
});
</script>
</body></html>`;
}

/** Serve the cast inside the brand-styled player; `window.__play()` plays it and resolves at the end. */
export function serveCastPlayer(
	castPath: string,
	opts: { title: string; cols: number; rows: number; viewportWidth: number; viewportHeight?: number },
): { url: string; stop: () => void } {
	const html = playerPage({ viewportHeight: 960, ...opts });
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(req) {
			const path = new URL(req.url).pathname;
			if (path === "/") return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
			if (path === "/cast") return new Response(Bun.file(castPath), { headers: { "content-type": "text/plain" } });
			return new Response("not found", { status: 404 });
		},
	});
	return { url: server.url.href, stop: () => void server.stop(true) };
}
