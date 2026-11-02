#!/usr/bin/env bun
/**
 * Montage style: turn a project's shotlist.yaml and beats.json into graded footage and an
 * OpenCut build plan, then check the render against the beat grid.
 *
 *   bun montage.ts matte <project-dir>                 # pop-out shots: popout.from → footage/<id>.mp4 + .alpha.mp4 (matte.py, uv)
 *   bun montage.ts prep  <project-dir>                 # footage/<id>.mp4 → build/prepped/<id>.mp4 (9:16, graded, 30 fps)
 *   bun montage.ts plan  <project-dir> [--locale vi]   # → build/<locale>.json, a list of opencut MCP tool calls
 *   bun montage.ts cuts  <project-dir> <render.mp4>    # scene cuts in the render vs the beat grid
 *   bun montage.ts covers <project-dir>                # out/cover-1080x1920.jpg and out/thumb-1280x720.jpg (Chrome on CDP 9334)
 *
 * The plan is executed against the editor through the opencut MCP server, by the agent's
 * own opencut_* tools or by `bun <skill-dir>/opencut-mcp/scripts/call.ts --batch build/<locale>.json`.
 * Recipes (moves, transitions, captions, end card) are documented in ../montage.md (in the skill folder).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadProfile } from "./profile.ts";

type Locale = string;
type Shot = {
	id: string;
	source?: string;
	in?: number;
	beats: number;
	crop?: { x?: number; y?: number; zoom?: number };
	move?: "push" | "pull" | "punch" | "ramp" | "still";
	transition?: "cut" | "whip" | "grid" | "flash";
	caption?: Record<Locale, string>;
	captionShots?: number; // the caption stays up across this many shots (default 1)
	/**
	 * The 3D pop-out: the shot plays inside a white-bordered picture on a blurred backdrop, and the
	 * person, cut out by matte.py, is drawn over the border so whatever crosses it breaks out of
	 * the picture. `from` is the landscape source clip and `in` its start; `frame` is the picture
	 * as fractions [x, y, w, h] of the canvas.
	 */
	popout?: { from: string; in?: number; frame?: [number, number, number, number] };
};
type Line = { text: Record<Locale, string> | string; fontPx?: number; y: number; color?: string };
type Shotlist = {
	id: string;
	frame?: { width: number; height: number; fps: number };
	music: { prompt: string; bpm: number; seconds: number };
	grade?: string;
	logo?: string;
	caption?: { fontPx?: number; y?: number; color?: string; background?: string; font?: string };
	shots: Shot[];
	end: { beats: number; logoPx?: number; logoY?: number; lines: Line[] };
	/** Covers for publishing: hook lines (one in the accent colour), a series label, a frame of the render. */
	cover?: { lines: string[]; accent?: number; label?: string; at?: number };
};
type Beats = { bpm: number; beats: number[]; duration: number };
type Step = { tool: string; args: Record<string, unknown>; as?: string };

const [command, projectArg, ...rest] = process.argv.slice(2);
if (!command || !projectArg) {
	console.error("usage: montage.ts prep|plan|cuts|covers <project-dir> [--locale xx | render.mp4]");
	process.exit(1);
}
const project = resolve(projectArg);
const list = Bun.YAML.parse(readFileSync(join(project, "shotlist.yaml"), "utf8")) as Shotlist;
const frame = { width: 1080, height: 1920, fps: 30, ...list.frame };
const at = (p: string) => resolve(project, p);
// Logo and brand name: the shotlist wins, else the workspace profile (brand.logo is relative to the profile file).
const profile = loadProfile(project, process.argv);
const logoFile = list.logo ? at(list.logo) : profile?.profile.brand?.logo ? resolve(profile.dir, profile.profile.brand.logo) : undefined;

const run = (cmd: string, args: string[]) => {
	const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr}`);
	return r.stdout;
};
const probe = (file: string) => {
	const info = JSON.parse(
		run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]),
	) as { streams: Array<{ width: number; height: number }>; format: { duration?: string } };
	return { width: info.streams[0]!.width, height: info.streams[0]!.height, duration: Number(info.format.duration ?? 0) };
};

function loadBeats(): Beats {
	const file = join(project, "beats.json");
	if (!existsSync(file)) throw new Error("beats.json missing: run scripts/beats.ts first");
	return JSON.parse(readFileSync(file, "utf8")) as Beats;
}

/**
 * Where every shot sits on the timeline. Cuts land on beats; the first shot starts at 0
 * (the music's lead-in before its first beat belongs to it). A grid transition spends the
 * first beat of the incoming shot on the 3x3 grid.
 */
function layout(beats: Beats) {
	const period = 60 / beats.bpm;
	const beatAt = (i: number) => beats.beats[i] ?? beats.beats[beats.beats.length - 1]! + (i - beats.beats.length + 1) * period;
	let index = 0;
	const shots = list.shots.map((shot, k) => {
		const start = k === 0 ? 0 : beatAt(index);
		index += shot.beats;
		const end = beatAt(index);
		const gridIn = k > 0 && list.shots[k - 1]!.transition === "grid";
		return { shot, start, end, gridIn, bodyStart: gridIn ? start + period : start };
	});
	const endStart = beatAt(index);
	const endEnd = beatAt(index + list.end.beats);
	return { period, shots, endStart, endEnd };
}

/** Source seconds a shot consumes: a ramp plays its middle 30% at 3x. */
const RAMP = { head: 0.35, middle: 0.3, rate: 3 };
const sourceNeed = (seconds: number, move: Shot["move"]) =>
	move === "ramp" ? seconds * (1 - RAMP.middle) + seconds * RAMP.middle * RAMP.rate : seconds;

/** Seconds of footage a shot reads, from its in-point: its body plus a beat of room for grid tiles. */
const shotNeed = (s: { shot: Shot; end: number; bodyStart: number }, period: number) =>
	sourceNeed(s.end - s.bodyStart, s.shot.move) + period + 0.3;

/** Cut the person out of every pop-out shot that has no footage yet: footage/<id>.mp4 and .alpha.mp4. */
function matte() {
	const { shots, period } = layout(loadBeats());
	mkdirSync(join(project, "footage"), { recursive: true });
	for (const s of shots) {
		const pop = s.shot.popout;
		if (!pop || existsSync(join(project, `footage/${s.shot.id}.alpha.mp4`))) continue;
		const need = shotNeed(s, period) + 0.2;
		console.log(`${s.shot.id}: matting ${need.toFixed(2)} s of ${pop.from} from ${pop.in ?? 0} s`);
		console.log(
			run("uv", ["run", "-q", join(import.meta.dir, "matte.py"), at(pop.from), join(project, `footage/${s.shot.id}`), "--in", String(pop.in ?? 0), "--seconds", need.toFixed(2), "--width", String(frame.width), "--height", String(frame.height)]).trim(),
		);
	}
}

/**
 * The pop-out stage, build/stage.png: a mint perspective grid floor running to a glowing
 * horizon, the "3D simulation" room the picture floats in.
 */
function stage() {
	const W = frame.width;
	const H = frame.height;
	const hz = Math.round(H * 0.42);
	const z = `(${(H * 2.083).toFixed(0)}/(Y-${hz}))`; // depth of the floor row at screen y
	const gx = `((X-${W / 2})*${z}/${(W * 0.37).toFixed(0)})`; // floor x under screen x
	const near = (v: string, tol: string) => `lt(min(mod(${v},1),1-mod(${v},1)),${tol})`; // within tol of a whole unit
	const line = `if(gt(Y,${hz + 6}),max(${near(z, `1.6*${z}*${z}/${(H * 2.083).toFixed(0)}`)},${near(`abs(${gx})`, `1.6*${z}/${(W * 0.37).toFixed(0)}`)})*pow((Y-${hz})/${H - hz},0.8),0)`;
	const glow = `exp(-abs(Y-${hz})/${Math.round(H * 0.135)})`;
	run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${W}x${H},format=rgb24`, "-vf", `geq=r='6+20*${glow}+56*${line}':g='16+70*${glow}+214*${line}':b='13+50*${glow}+157*${line}',gblur=sigma=0.7`, "-frames:v", "1", join(project, "build/stage.png")]);
}

/**
 * The pop-out composite, as one ffmpeg filter graph over the graded shot [v], its matte [m] and
 * the stage [s]: the picture's soft drop shadow on the stage; the picture in a white border;
 * the person's shadow; the person on top of everything, so a limb crossing the border is in
 * front of it.
 */
function popoutGraph(rect: [number, number, number, number], seconds: number) {
	const W = frame.width;
	const H = frame.height;
	const [fx, fy, fw, fh] = [rect[0] * W, rect[1] * H, rect[2] * W, rect[3] * H].map((n) => Math.round(n / 2) * 2) as [number, number, number, number];
	const b = 14;
	const canvas = `s=${W}x${H}:r=${frame.fps}:d=${seconds.toFixed(3)}`;
	return [
		"[v]split=2[v1][v2]",
		"[m]split=2[m1][m2]",
		`color=black@0:${canvas},format=rgba,drawbox=x=${fx - b + 26}:y=${fy - b + 40}:w=${fw + 2 * b}:h=${fh + 2 * b}:color=black@0.7:t=fill,gblur=sigma=22[boxshadow]`,
		`[s][boxshadow]overlay=0:0:shortest=1[bg]`,
		`[v1]crop=${fw}:${fh}:${fx}:${fy},pad=${fw + 2 * b}:${fh + 2 * b}:${b}:${b}:white[pic]`,
		`[bg][pic]overlay=${fx - b}:${fy - b}:shortest=1[framed]`,
		`color=black:${canvas},format=yuva420p[blk]`,
		"[m1]gblur=sigma=12,lut=y=val*0.6[sm]",
		"[blk][sm]alphamerge[shadow]",
		"[framed][shadow]overlay=26:40:shortest=1[shaded]",
		"[v2]format=yuva420p[v2a]",
		"[v2a][m2]alphamerge[person]",
		"[shaded][person]overlay=0:0:shortest=1,format=yuv420p",
	].join(";");
}

function prep() {
	const { shots, period } = layout(loadBeats());
	mkdirSync(join(project, "build/prepped"), { recursive: true });
	if (list.shots.some((shot) => shot.popout)) stage();
	const aspect = frame.width / frame.height;
	for (const s of shots) {
		const { shot, start, end } = s;
		const src = at(shot.source ?? `footage/${shot.id}.mp4`);
		const info = probe(src);
		const need = shotNeed(s, period);
		const from = shot.in ?? 0;
		if (from + need > info.duration + 0.05) {
			throw new Error(`${shot.id}: needs ${need.toFixed(2)} s from ${from} s, source has ${info.duration.toFixed(2)} s; record longer or lower "in"`);
		}
		// The 9:16 window: as tall (or wide) as the source allows, divided by zoom, centred on crop.x/y.
		const zoom = shot.crop?.zoom ?? 1;
		let h = info.height;
		let w = h * aspect;
		if (w > info.width) [w, h] = [info.width, info.width / aspect];
		[w, h] = [Math.round(w / zoom / 2) * 2, Math.round(h / zoom / 2) * 2];
		const cx = (shot.crop?.x ?? 0.5) * info.width;
		const cy = (shot.crop?.y ?? 0.5) * info.height;
		const x = Math.round(Math.min(Math.max(cx - w / 2, 0), info.width - w));
		const y = Math.round(Math.min(Math.max(cy - h / 2, 0), info.height - h));
		const fit = [`crop=${w}:${h}:${x}:${y}`, `scale=${frame.width}:${frame.height}:flags=lanczos`];
		const filters = [...fit, ...(list.grade ? [list.grade] : []), `fps=${frame.fps}`, "format=yuv420p"].join(",");
		const out = join(project, `build/prepped/${shot.id}.mp4`);
		const cut = ["-ss", String(from), "-t", need.toFixed(3)];
		if (shot.popout) {
			// The matte gets the same window and frame rate as the picture, so the person lines up.
			const alpha = src.replace(/\.mp4$/, ".alpha.mp4");
			const graph = `[0:v]${filters}[v];[1:v]${[...fit, `fps=${frame.fps}`, "format=gray"].join(",")}[m];[2:v]fps=${frame.fps},format=yuv420p[s];${popoutGraph(shot.popout.frame ?? [0.09, 0.25, 0.82, 0.5], need)}`;
			const stagePng = ["-loop", "1", "-t", need.toFixed(3), "-i", join(project, "build/stage.png")];
			run("ffmpeg", ["-y", "-v", "error", ...cut, "-i", src, ...cut, "-i", alpha, ...stagePng, "-filter_complex", graph, "-an", "-c:v", "libx264", "-crf", "16", out]);
		} else {
			run("ffmpeg", ["-y", "-v", "error", ...cut, "-i", src, "-vf", filters, "-an", "-c:v", "libx264", "-crf", "16", out]);
		}
		console.log(`${shot.id}: ${start.toFixed(2)}-${end.toFixed(2)} s, ${need.toFixed(2)} s of source from ${from} s, crop ${w}x${h}+${x}+${y}`);
	}
	run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${frame.width}x${frame.height}`, "-frames:v", "1", join(project, "build/black.png")]);
	// The flash transition's light leak: white-hot near the upper right, warm orange towards the edges.
	const d = "min(1.5*hypot(X-0.7*W\\,Y-0.3*H)/H\\,1)";
	run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${frame.width}x${frame.height},format=rgba`, "-vf", `geq=r='255':g='255-140*${d}':b='245-225*${d}':a='255*(1-0.4*${d})'`, "-frames:v", "1", join(project, "build/flash.png")]);
}

function plan(locale: Locale) {
	const beats = loadBeats();
	const { period, shots, endStart, endEnd } = layout(beats);
	if (endEnd > beats.duration + 0.05) {
		throw new Error(`timeline needs ${endEnd.toFixed(2)} s of music, the track has ${beats.duration} s`);
	}
	const steps: Step[] = [];
	const add = (tool: string, args: Record<string, unknown>, as?: string) => steps.push(as ? { tool, args, as } : { tool, args });
	const text = (t: Record<Locale, string> | string) => (typeof t === "string" ? t : (t[locale] ?? t.en!));
	const W = frame.width;
	const H = frame.height;
	const cap = { fontPx: 64, y: 390, color: "#FFFFFF", background: "#0B1F17", font: "Arial", ...list.caption };

	add("opencut_new_project", { name: `${list.id}-${locale}` });
	for (const { shot } of shots) add("opencut_add_media", { filePath: join(project, `build/prepped/${shot.id}.mp4`) }, `m_${shot.id}`);
	add("opencut_add_media", { filePath: join(project, "build/black.png") }, "m_black");
	if (shots.some(({ shot }) => shot.transition === "flash")) add("opencut_add_media", { filePath: join(project, "build/flash.png") }, "m_flash");
	if (logoFile) add("opencut_add_media", { filePath: logoFile }, "m_logo");
	add("opencut_add_media", { filePath: join(project, "audio/music.mp3") }, "m_music");

	// 1. The main track, in time order. The first clip resets the canvas, so settings follow it.
	const pieces: Record<string, { first: string; last: string; lastLen: number }> = {};
	let settingsDone = false;
	const main = (args: Record<string, unknown>, as: string) => {
		add("opencut_insert_clip", args, as);
		if (!settingsDone) {
			add("opencut_project_settings", { ...frame, background: "#000000" });
			settingsDone = true;
		}
	};
	for (const { shot, end, gridIn, start, bodyStart } of shots) {
		if (gridIn) main({ mediaId: "$m_black.id", elementType: "image", startTime: start, duration: bodyStart - start }, `g_${shot.id}`);
		const d = end - bodyStart;
		const media = `$m_${shot.id}.id`;
		if (shot.move === "ramp") {
			const a = d * RAMP.head;
			const b = d * RAMP.middle;
			const c = d - a - b;
			main({ mediaId: media, elementType: "video", startTime: bodyStart, duration: a, sourceIn: 0 }, `${shot.id}_a`);
			main({ mediaId: media, elementType: "video", startTime: bodyStart + a, duration: b * RAMP.rate, sourceIn: a }, `${shot.id}_b`);
			add("opencut_retime", { elementId: `$${shot.id}_b.elementId`, rate: RAMP.rate });
			main({ mediaId: media, elementType: "video", startTime: bodyStart + a + b, duration: c, sourceIn: a + b * RAMP.rate }, `${shot.id}_c`);
			add("opencut_effect", { elementId: `$${shot.id}_b.elementId`, effectType: "blur", keys: [{ t: 0, value: 0 }, { t: b / 2, value: 60 }, { t: b, value: 0 }] });
			pieces[shot.id] = { first: `${shot.id}_a`, last: `${shot.id}_c`, lastLen: c };
		} else {
			main({ mediaId: media, elementType: "video", startTime: bodyStart, duration: d, sourceIn: 0 }, shot.id);
			pieces[shot.id] = { first: shot.id, last: shot.id, lastLen: d };
		}
	}
	main({ mediaId: "$m_black.id", elementType: "image", startTime: endStart, duration: endEnd - endStart }, "endcard");

	// 2. Moves: one per shot, on its scale.
	for (const { shot, end, bodyStart } of shots) {
		const d = end - bodyStart;
		const keys = {
			push: [{ t: 0, value: 1 }, { t: d, value: 1.08 }],
			pull: [{ t: 0, value: 1.1 }, { t: d, value: 1 }],
			punch: [{ t: 0, value: 1 }, { t: 0.1, value: 1.15 }, { t: 0.35, value: 1.06 }, { t: d, value: 1.09 }],
		}[shot.move as "push" | "pull" | "punch"];
		if (keys) add("opencut_keyframes", { elementId: `$${shot.id}.elementId`, property: "transform.scale", keys });
	}

	// 3. Transitions into the next shot (a flash may also lead into the end card).
	shots.forEach(({ shot, end }, k) => {
		if (shot.transition === "flash") {
			// A warm light leak burns out the cut: up over 3 frames, peak on the cut, gone 4 frames later.
			add("opencut_insert_clip", { mediaId: "$m_flash.id", elementType: "image", startTime: end - 0.1, duration: 0.23 }, `flash_${shot.id}`);
			add("opencut_keyframes", { elementId: `$flash_${shot.id}.elementId`, property: "opacity", keys: [{ t: 0, value: 0 }, { t: 0.1, value: 1 }, { t: 0.23, value: 0 }] });
		}
		const next = shots[k + 1];
		if (!next) return;
		if (shot.transition === "whip") {
			const out = pieces[shot.id]!;
			const into = pieces[next.shot.id]!;
			const swing = W * 0.35;
			add("opencut_keyframes", { elementId: `$${out.last}.elementId`, property: "transform.positionX", keys: [{ t: Math.max(0, out.lastLen - 0.1), value: 0 }, { t: out.lastLen, value: -swing }] });
			if (!next.gridIn) {
				add("opencut_keyframes", { elementId: `$${into.first}.elementId`, property: "transform.positionX", keys: [{ t: 0, value: swing }, { t: 0.1, value: 0 }] });
			}
			add("opencut_effect_layer", { effectType: "blur", startTime: end - 0.1, duration: 0.2, keys: [{ t: 0, value: 0 }, { t: 0.1, value: 90 }, { t: 0.2, value: 0 }] });
		}
		if (shot.transition === "grid") {
			// Nine tiles of the incoming shot fill a 3x3 grid one by one across its first beat.
			const cellW = W / 3;
			const cellH = H / 3;
			for (let i = 0; i < 9; i++) {
				const t0 = next.start + (i * period * 0.6) / 9;
				add("opencut_insert_clip", { mediaId: `$m_${next.shot.id}.id`, elementType: "video", startTime: t0, duration: next.bodyStart - t0, sourceIn: Math.min(i * 0.1, period) }, `tile_${next.shot.id}_${i}`);
				add("opencut_set_params", {
					elementId: `$tile_${next.shot.id}_${i}.elementId`,
					params: { "transform.scaleX": 0.32, "transform.scaleY": 0.32, "transform.positionX": ((i % 3) - 1) * cellW, "transform.positionY": (Math.floor(i / 3) - 1) * cellH },
				});
			}
		}
	});

	// 4. Captions: in the caption band, popping in on the cut.
	shots.forEach(({ shot, start }, k) => {
		if (!shot.caption) return;
		const end = shots[Math.min(shots.length - 1, k + (shot.captionShots ?? 1) - 1)]!.end;
		add("opencut_add_text", { content: text(shot.caption), startTime: start + 0.03, duration: end - start - 0.03, fontPx: cap.fontPx, fontFamily: cap.font, fontWeight: "bold", color: cap.color, x: 0, y: cap.y, backgroundColor: cap.background }, `c_${shot.id}`);
		add("opencut_keyframes", { elementId: `$c_${shot.id}.elementId`, property: "transform.scale", keys: [{ t: 0, value: 0.82 }, { t: 0.12, value: 1.04 }, { t: 0.2, value: 1 }] });
	});

	// 5. The logo on every frame before the end card (house style: ~72 px, top-left, inside
	// the safe area, ~80% opacity), then the end card.
	if (logoFile) {
		const logo = probe(logoFile);
		const fit = Math.min(W / logo.width, H / logo.height); // scale 1 = contained in the canvas
		const scaleFor = (px: number) => px / (logo.width * fit);
		add("opencut_insert_clip", { mediaId: "$m_logo.id", elementType: "image", startTime: 0, duration: endStart }, "logo");
		add("opencut_set_params", { elementId: "$logo.elementId", params: { "transform.scaleX": scaleFor(72), "transform.scaleY": scaleFor(72), "transform.positionX": -W / 2 + 48 + 36, "transform.positionY": -H / 2 + H * 0.1 + 36, opacity: 0.8 } });
		const big = list.end.logoPx ?? 300;
		add("opencut_insert_clip", { mediaId: "$m_logo.id", elementType: "image", startTime: endStart, duration: endEnd - endStart }, "endlogo");
		add("opencut_set_params", { elementId: "$endlogo.elementId", params: { "transform.scaleX": scaleFor(big), "transform.scaleY": scaleFor(big), "transform.positionY": list.end.logoY ?? -260 } });
		add("opencut_keyframes", { elementId: "$endlogo.elementId", property: "transform.scale", keys: [{ t: 0, value: scaleFor(big) * 0.85 }, { t: 0.15, value: scaleFor(big) * 1.03 }, { t: 0.3, value: scaleFor(big) }] });
	}
	list.end.lines.forEach((line, i) => {
		add("opencut_add_text", { content: text(line.text), startTime: endStart + 0.1 * (i + 1), duration: endEnd - endStart - 0.1 * (i + 1), fontPx: line.fontPx ?? 52, fontFamily: cap.font, fontWeight: "bold", color: line.color ?? "#FFFFFF", x: 0, y: line.y }, `end_${i}`);
	});

	// 6. Music under everything, faded out over the last beat.
	add("opencut_insert_clip", { mediaId: "$m_music.id", elementType: "audio", startTime: 0, duration: endEnd, sourceIn: 0 }, "music");
	add("opencut_keyframes", { elementId: "$music.elementId", property: "volume", keys: [{ t: endEnd - period, value: 0 }, { t: endEnd, value: -60 }] });

	const suffix = locale === "en" ? "" : `-${locale}`;
	add("opencut_export_file", { outPath: join(project, `out/${list.id}${suffix}-${frame.width}x${frame.height}.mp4`), format: "mp4", quality: "high", includeAudio: true });

	mkdirSync(join(project, "out"), { recursive: true });
	const file = join(project, `build/${locale}.json`);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(steps, null, "\t")}\n`);
	console.log(`wrote ${file}: ${steps.length} calls, ${endEnd.toFixed(2)} s (end card from ${endStart.toFixed(2)} s)`);
}

/** Compare the render's hard cuts with the beat grid; a montage cut should sit within a frame of a beat. */
function cuts(render: string) {
	const beats = loadBeats();
	const { shots } = layout(beats);
	// Screen recordings of dark UIs change little across a cut, so the threshold is low.
	const log = spawnSync("ffmpeg", ["-hide_banner", "-i", render, "-vf", "select='gt(scene,0.08)',metadata=print", "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr;
	const found = [...log.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
	const planned = shots.slice(1).map((s) => s.start);
	const frameDur = 1 / frame.fps;
	let worst = 0;
	for (const t of planned) {
		const near = found.filter((f) => Math.abs(f - t) < 0.5);
		const nearest = near.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), Number.POSITIVE_INFINITY);
		const off = Math.abs(nearest - t);
		if (Number.isFinite(off)) worst = Math.max(worst, off);
		console.log(`cut ${t.toFixed(3)} s → detected ${Number.isFinite(nearest) ? nearest.toFixed(3) : "none"} (${(off / frameDur).toFixed(1)} frames)`);
	}
	const missed = planned.filter((t) => !found.some((f) => Math.abs(f - t) < 0.5)).length;
	console.log(`${planned.length} planned cuts, ${planned.length - missed} found, worst offset ${(worst / frameDur).toFixed(1)} frames${missed ? `, ${missed} too subtle to detect (check by eye)` : ""}`);
}

/**
 * House-style covers: the hook in 2 to 4 lines with one in the
 * accent colour, the series label and the brand, words inside the centre 1080x1350, under 1 MB.
 * Drawn as HTML over a blurred frame of the render and captured in the OpenCut Chrome (CDP 9334),
 * because this ffmpeg has no drawtext.
 */
async function covers() {
	const c = list.cover;
	if (!c) throw new Error("shotlist.yaml has no cover block");
	mkdirSync(join(project, "build"), { recursive: true });
	const render = join(project, `out/${list.id}-1080x1920.mp4`);
	const still = join(project, "build/cover-frame.jpg");
	run("ffmpeg", ["-y", "-v", "error", "-ss", String(c.at ?? 20), "-i", render, "-frames:v", "1", "-q:v", "3", still]);
	if (!logoFile || !existsSync(logoFile)) throw new Error("no logo: set `logo` in shotlist.yaml or brand.logo in omninoise.profile.yaml");
	const logo = logoFile;
	const brandName = profile?.profile.brand?.name ?? "";
	const lines = c.lines.map((l, i) => `<div class="l${i === (c.accent ?? 1) ? " a" : ""}">${l}</div>`).join("");
	const page = (w: number, h: number, wide: boolean) => `<!doctype html><meta charset="utf-8"><style>
		*{margin:0;box-sizing:border-box} body{width:${w}px;height:${h}px;overflow:hidden;background:#000;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}
		.bg{position:absolute;inset:-40px;background:url("file://${still}") center/cover;filter:blur(${wide ? 6 : 10}px) brightness(.38) saturate(1.2)}
		.box{position:absolute;${wide ? "left:80px;top:0;bottom:0;width:760px" : "left:60px;right:60px;top:285px;height:1350px"};display:flex;flex-direction:column;justify-content:center;${wide ? "" : "align-items:center;text-align:center"}}
		.tag{display:inline-block;background:#3EE6AA;color:#06140F;font-weight:800;font-size:${wide ? 30 : 44}px;padding:${wide ? "8px 20px" : "12px 28px"};border-radius:999px;margin-bottom:${wide ? 26 : 40}px;align-self:${wide ? "flex-start" : "center"}}
		.l{color:#fff;font-weight:900;font-size:${wide ? 92 : 132}px;line-height:1.02;letter-spacing:-.02em;text-shadow:0 6px 30px rgba(0,0,0,.6)}
		.a{color:#3EE6AA}
		.brand{display:flex;align-items:center;gap:18px;margin-top:${wide ? 34 : 56}px;color:#fff;font-weight:700;font-size:${wide ? 30 : 42}px;${wide ? "" : "justify-content:center"}}
		.brand img{width:${wide ? 56 : 80}px;height:${wide ? 56 : 80}px;border-radius:14px}
		${wide ? `.shot{position:absolute;right:70px;top:60px;bottom:60px;aspect-ratio:9/16;background:url("file://${still}") center/cover;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.6);border:3px solid #3EE6AA}` : ""}
	</style><div class="bg"></div>${wide ? '<div class="shot"></div>' : ""}<div class="box">${c.label ? `<div class="tag">${c.label}</div>` : ""}${lines}<div class="brand"><img src="file://${logo}">${brandName}</div></div>`;

	const shoot = async (html: string, w: number, h: number, out: string) => {
		const file = join(project, `build/${out.replace(/\W+/g, "-")}.html`);
		writeFileSync(file, html);
		const t = (await (await fetch("http://127.0.0.1:9334/json/new?about:blank", { method: "PUT" })).json()) as { id: string; webSocketDebuggerUrl: string };
		const ws = new WebSocket(t.webSocketDebuggerUrl);
		let id = 0;
		const wait = new Map<number, (m: { result: { data?: string } }) => void>();
		const send = (method: string, params: object = {}) =>
			new Promise<{ result: { data?: string } }>((ok) => { wait.set(++id, ok); ws.send(JSON.stringify({ id, method, params })); });
		ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); wait.get(m.id)?.(m); wait.delete(m.id); };
		await new Promise((ok) => (ws.onopen = ok));
		await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
		await send("Page.navigate", { url: `file://${file}` });
		await new Promise((ok) => setTimeout(ok, 1500));
		const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
		writeFileSync(join(project, "out", out), Buffer.from(shot.result.data!, "base64"));
		ws.close();
		await fetch(`http://127.0.0.1:9334/json/close/${t.id}`);
		console.log(`wrote out/${out}`);
	};
	await shoot(page(1080, 1920, false), 1080, 1920, "cover-1080x1920.jpg");
	await shoot(page(1280, 720, true), 1280, 720, "thumb-1280x720.jpg");
}

if (command === "matte") matte();
else if (command === "prep") prep();
else if (command === "covers") await covers();
else if (command === "plan") plan(rest[rest.indexOf("--locale") + 1] && rest.includes("--locale") ? rest[rest.indexOf("--locale") + 1]! : "en");
else if (command === "cuts") cuts(resolve(rest[0]!));
else throw new Error(`unknown command ${command}`);
