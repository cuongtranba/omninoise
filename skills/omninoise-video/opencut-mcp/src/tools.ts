/**
 * Editor operations, callable both by the MCP server (src/index.ts) and by direct
 * scripts (scripts/demo.ts). Each function runs in the browser context via
 * evalInEditor and returns plain JSON.
 */
import { writeFileSync } from "node:fs";
import { evalInEditor, getSession, newProjectSession, takeConsoleErrors } from "./browser.js";

export type AddTrackInput = {
	type: "video" | "audio" | "text" | "graphic" | "effect";
	index?: number;
};

export type AddMediaInput = { filePath: string };

export type InsertClipInput = {
	mediaId: string;
	elementType: "video" | "audio" | "image";
	startTime: number;
	duration?: number;
	sourceIn?: number; // seconds into the source where the clip starts
	name?: string;
	trackId?: string; // if omitted, placement is mode:"auto" (recommended)
};

export type SplitAtInput = { elementIds: string[]; time: number };
export type MoveInput = { elementId: string; newStartTime: number; newTrackId?: string };
export type TrimInput = {
	elementId: string;
	trimStart?: number;
	trimEnd?: number;
	startTime?: number;
	duration?: number;
};
export type DeleteInput = { elementIds: string[] };
export type ExportInput = {
	format: "mp4" | "webm";
	quality: "low" | "medium" | "high";
	fps?: number;
	includeAudio: boolean;
};
export type ScreenshotInput = { path?: string };

export async function getState() {
	return evalInEditor<unknown>(`
		const e = window.__editor;
		const scene = e.scenes.getActiveScene();
		const tracks = scene ? scene.tracks : null;
		const summarize = (arr) => (arr ?? []).filter(Boolean).map(t => ({
			id: t.id,
			type: t.type,
			name: t.name,
			elementCount: t.elements?.length ?? 0,
			elements: (t.elements ?? []).map(el => ({
				id: el.id,
				type: el.type,
				name: el.name,
				startTime: el.startTime,
				duration: el.duration,
				mediaId: el.mediaId,
			})),
		}));
		return {
			projectId: e.project.getActiveOrNull()?.id ?? null,
			duration: e.timeline.getTotalDuration(),
			lastFrame: e.timeline.getLastFrameTime?.() ?? null,
			tracks: {
				main: summarize([tracks?.main]),
				overlay: summarize(tracks?.overlay),
				audio: summarize(tracks?.audio),
			},
			assets: e.media.getAssets?.().map(a => ({ id: a.id, name: a.name, type: a.type, duration: a.duration })) ?? [],
		};
	`);
}

export async function addTrack(input: AddTrackInput) {
	return evalInEditor<{ trackId: string }>(
		`
		const trackId = window.__editor.timeline.addTrack({ type: args.type, index: args.index ?? undefined });
		return { trackId };
		`,
		{ type: input.type, index: input.index ?? null },
	);
}

export async function addMedia(input: AddMediaInput) {
	const { page } = await getSession();
	const fs = await import("node:fs");
	const path = await import("node:path");
	if (!fs.existsSync(input.filePath)) {
		throw new Error(`file not found: ${input.filePath}`);
	}
	// The <input type="file"> is rendered by useFileUpload with display:none.
	// Wait for it to mount (may take a moment on initial project activation).
	await page.locator('input[type="file"]').first().waitFor({
		state: "attached",
		timeout: 15_000,
	});
	const inputEl = page.locator('input[type="file"]').first();
	await inputEl.setInputFiles(input.filePath);

	const initialCount = await evalInEditor<number>(
		`return window.__editor.media.getAssets?.().length ?? 0;`,
	);
	const filename = path.basename(input.filePath);
	const asset = await page.waitForFunction(
		({ initialCount, filename }) => {
			const assets = (window as unknown as {
				__editor: {
					media: {
						getAssets: () => Array<{
							id: string;
							name: string;
							duration: number;
							type: string;
						}>;
					};
				};
			}).__editor.media.getAssets?.();
			if (!assets || assets.length <= initialCount) return null;
			const match = assets.find((a) => a.name === filename) ?? assets[assets.length - 1];
			return match ?? null;
		},
		{ initialCount, filename },
		{ timeout: 30_000 },
	);
	return asset.jsonValue();
}

export async function insertClip(input: InsertClipInput) {
	return evalInEditor<unknown>(
		`
		const e = window.__editor;
		const asset = e.media.getAssets?.().find(a => a.id === args.mediaId);
		if (!asset) throw new Error("mediaId not found: " + args.mediaId);
		const src = asset.duration ?? args.duration ?? 5;
		const sourceIn = args.sourceIn ?? 0;
		const dur = args.duration ?? Math.max(0, src - sourceIn);

		// Convert seconds → MediaTime (integer ticks). Requires __opencut exposure from Phase 1.
		const toTicks = window.__opencut?.mediaTimeFromSeconds
			|| ((n) => { throw new Error("window.__opencut not exposed — rebuild classic with Phase 1 patch"); });
		const startTicks = toTicks({ seconds: args.startTime });
		const durTicks = toTicks({ seconds: dur });
		const srcTicks = toTicks({ seconds: src });
		const zero = toTicks({ seconds: 0 });

		const baseElement = {
			name: args.name ?? asset.name,
			startTime: startTicks,
			duration: durTicks,
			trimStart: toTicks({ seconds: sourceIn }),
			trimEnd: asset.type === "image" ? zero : toTicks({ seconds: Math.max(0, src - sourceIn - dur) }),
			sourceDuration: srcTicks,
			params: {},
		};

		let element;
		if (args.elementType === "audio") {
			// AudioElement is a discriminated union — uploads must carry sourceType.
			element = { ...baseElement, type: "audio", sourceType: "upload", mediaId: args.mediaId };
		} else if (args.elementType === "video" || args.elementType === "image") {
			element = { ...baseElement, type: args.elementType, mediaId: args.mediaId };
		} else {
			throw new Error("unsupported elementType: " + args.elementType);
		}

		// Placement: explicit if trackId given, else auto (create track on demand).
		// Empty tracks get pruned by CommandManager reactor, so pre-creating tracks
		// via addTrack + then inserting won't work — must insert in one shot.
		// Auto placement opens a new overlay track when the span overlaps existing
		// elements, so grid tiles and the logo stack above the main track.
		const placement = args.trackId
			? { mode: "explicit", trackId: args.trackId }
			: { mode: "auto", trackType: args.elementType === "image" ? "video" : args.elementType };

		const errors = [];
		const origError = console.error;
		console.error = (...msgs) => { errors.push(msgs.map(String).join(' ')); origError.apply(console, msgs); };
		try {
			e.timeline.insertElement({ element, placement });
		} finally {
			console.error = origError;
		}

		const after = e.scenes.getActiveScene().tracks;
		const all = [
			...(after.main?.elements ?? []).map(el => ({ ...el, trackId: after.main.id })),
			...after.overlay.flatMap(t => t.elements.map(el => ({ ...el, trackId: t.id }))),
			...after.audio.flatMap(t => t.elements.map(el => ({ ...el, trackId: t.id }))),
		];
		const newest = all.find(el => el.mediaId === args.mediaId && el.startTime === startTicks) ?? null;

		return {
			inserted: !!newest,
			elementId: newest?.id ?? null,
			trackId: newest?.trackId ?? null,
			totalDuration: e.timeline.getTotalDuration(),
			validationErrors: errors,
		};
		`,
		{ ...input },
	);
}

export async function splitAt(input: SplitAtInput) {
	return evalInEditor<unknown>(
		`
		const t = window.__opencut.mediaTimeFromSeconds({ seconds: args.time });
		window.__editor.timeline.splitElements({ elements: args.elementIds, time: t });
		return { ok: true, totalDuration: window.__editor.timeline.getTotalDuration() };
		`,
		{ ...input },
	);
}

export async function moveElement(input: MoveInput) {
	return evalInEditor<unknown>(
		`
		const move = {
			elementId: args.elementId,
			newStartTime: window.__opencut.mediaTimeFromSeconds({ seconds: args.newStartTime }),
		};
		if (args.newTrackId) move.newTrackId = args.newTrackId;
		window.__editor.timeline.moveElements({ moves: [move] });
		return { ok: true };
		`,
		{ ...input },
	);
}

export async function trimElement(input: TrimInput) {
	return evalInEditor<unknown>(
		`
		window.__editor.timeline.updateElementTrim({
			elementId: args.elementId,
			trimStart: args.trimStart ?? 0,
			trimEnd: args.trimEnd ?? 0,
			startTime: args.startTime ?? undefined,
			duration: args.duration ?? undefined,
		});
		return { ok: true };
		`,
		{ ...input },
	);
}

export async function deleteElements(input: DeleteInput) {
	return evalInEditor<unknown>(
		`
		window.__editor.timeline.deleteElements({ elements: args.elementIds });
		return { ok: true };
		`,
		{ ...input },
	);
}

export async function undo() {
	return evalInEditor<unknown>(`window.__editor.command.undo(); return { ok: true };`);
}

export async function redo() {
	return evalInEditor<unknown>(`window.__editor.command.redo(); return { ok: true };`);
}

export async function exportProject(input: ExportInput) {
	// The renderer returns an ArrayBuffer, which does not survive JSON; report its size only.
	return evalInEditor<unknown>(
		`
		const result = await window.__editor.renderer.exportProject({ options: args });
		return { success: result.success, error: result.error, bytes: result.buffer?.byteLength ?? 0 };
		`,
		{ ...input },
	);
}

export type ExportToFileInput = ExportInput & { outPath: string };

/** Render in the browser and write the file to disk (base64 in 4 MB pieces). */
export async function exportToFile(input: ExportToFileInput) {
	const { outPath, ...options } = input;
	takeConsoleErrors();
	const meta = await evalInEditor<{ success: boolean; error?: string; bytes: number }>(
		`
		const result = await window.__editor.renderer.exportProject({ options: args });
		window.__omninoiseExport = result.buffer ?? null;
		return { success: result.success, error: result.error, bytes: result.buffer?.byteLength ?? 0 };
		`,
		{ ...options },
	);
	if (!meta.success) {
		throw new Error(`export failed: ${meta.error ?? "unknown"}; console: ${takeConsoleErrors().join(" | ")}`);
	}
	const CHUNK = 4 * 1024 * 1024;
	const parts: Buffer[] = [];
	for (let offset = 0; offset < meta.bytes; offset += CHUNK) {
		const b64 = await evalInEditor<string>(
			`
			const bytes = new Uint8Array(window.__omninoiseExport, args.offset, Math.min(args.size, window.__omninoiseExport.byteLength - args.offset));
			let bin = "";
			for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
			return btoa(bin);
			`,
			{ offset, size: CHUNK },
		);
		parts.push(Buffer.from(b64, "base64"));
	}
	await evalInEditor(`window.__omninoiseExport = null; return true;`);
	writeFileSync(outPath, Buffer.concat(parts));
	return { outPath, bytes: meta.bytes };
}

// --- omninoise additions: the operations the montage style needs ---------------------

/** Shared in-page helpers: seconds → MediaTime and element → track lookup. */
const PRELUDE = `
	const e = window.__editor;
	const T = (seconds) => window.__opencut.mediaTimeFromSeconds({ seconds });
	const trackOf = (elementId) => {
		const trackId = e.timeline.findTrackIdForElement({ elementId });
		if (!trackId) throw new Error("element not found: " + elementId);
		return trackId;
	};
	const elementOf = (elementId) => e.timeline.getElementByRef({ trackId: trackOf(elementId), elementId });
`;

export async function newProject(input: { name?: string }) {
	const session = await newProjectSession();
	if (input.name) {
		await evalInEditor(
			`await window.__editor.project.renameProject({ id: args.id, name: args.name }); return true;`,
			{ id: session.projectId, name: input.name },
		);
	}
	return { projectId: session.projectId };
}

export type ProjectSettingsInput = { width: number; height: number; fps: number; background: string };

/** Note: inserting the first video/image resets the canvas to that asset, so call this after it. */
export async function projectSettings(input: ProjectSettingsInput) {
	return evalInEditor<unknown>(
		`
		const e = window.__editor;
		await e.project.updateSettings({ settings: {
			canvasSize: { width: args.width, height: args.height },
			canvasSizeMode: "custom",
			fps: { numerator: args.fps, denominator: 1 },
			background: { type: "color", color: args.background },
		} });
		return e.project.getActive().settings;
		`,
		{ ...input },
	);
}

export type SetParamsInput = { elementId: string; params: Record<string, number | string | boolean> };

export async function setParams(input: SetParamsInput) {
	return evalInEditor<unknown>(
		`${PRELUDE}
		const el = elementOf(args.elementId);
		e.timeline.updateElements({ updates: [{ trackId: trackOf(args.elementId), elementId: args.elementId, patch: { params: { ...el.params, ...args.params } } }] });
		return { ok: true, params: elementOf(args.elementId).params };
		`,
		{ ...input },
	);
}

export type AddTextInput = {
	content: string;
	startTime: number;
	duration: number;
	fontPx: number;
	fontFamily: string;
	fontWeight: "normal" | "bold";
	color: string;
	x: number;
	y: number;
	backgroundColor?: string;
	name?: string;
};

export async function addText(input: AddTextInput) {
	return evalInEditor<unknown>(
		`${PRELUDE}
		// OpenCut draws text at fontSize * canvasHeight / 90 px (text/typography.ts).
		const canvasHeight = e.project.getActive().settings.canvasSize.height;
		const params = {
			content: args.content,
			fontFamily: args.fontFamily,
			fontSize: (args.fontPx * 90) / canvasHeight,
			fontWeight: args.fontWeight,
			color: args.color,
			textAlign: "center",
			"transform.positionX": args.x,
			"transform.positionY": args.y,
			"transform.scaleX": 1,
			"transform.scaleY": 1,
			"transform.rotate": 0,
			opacity: 1,
		};
		if (args.backgroundColor) {
			params["background.enabled"] = true;
			params["background.color"] = args.backgroundColor;
		}
		const zero = T(0);
		e.timeline.insertElement({
			element: { type: "text", name: args.name ?? args.content.slice(0, 24), startTime: T(args.startTime), duration: T(args.duration), trimStart: zero, trimEnd: zero, params },
			placement: { mode: "auto", trackType: "text" },
		});
		const tracks = e.scenes.getActiveScene().tracks;
		const hit = tracks.overlay.flatMap(t => t.elements.map(el => ({ el, trackId: t.id })))
			.filter(x => x.el.type === "text" && x.el.params.content === args.content && x.el.startTime === T(args.startTime));
		const last = hit[hit.length - 1];
		return { elementId: last?.el.id ?? null, trackId: last?.trackId ?? null };
		`,
		{ ...input },
	);
}

export type KeyframesInput = {
	elementId: string;
	property: string;
	keys: Array<{ t: number; value: number; interpolation?: "linear" | "hold" | "bezier" }>;
};

export async function keyframes(input: KeyframesInput) {
	return evalInEditor<unknown>(
		`${PRELUDE}
		const trackId = trackOf(args.elementId);
		const paths = args.property === "transform.scale" ? ["transform.scaleX", "transform.scaleY"] : [args.property];
		const keyframes = paths.flatMap(propertyPath => args.keys.map(k => ({
			trackId, elementId: args.elementId, propertyPath, time: T(k.t), value: k.value, interpolation: k.interpolation ?? "linear",
		})));
		e.timeline.upsertKeyframes({ keyframes });
		return { ok: true, count: keyframes.length, animations: elementOf(args.elementId).animations ?? null };
		`,
		{ ...input },
	);
}

export type RetimeInput = { elementId: string; rate: number; keepDuration: boolean };

/**
 * Constant speed for one element. OpenCut's retime rescales the element's timeline
 * length (sourceSpan / rate); keepDuration restores the old length instead.
 * A ramp is three elements: split, then retime the middle one.
 */
export async function retime(input: RetimeInput) {
	return evalInEditor<unknown>(
		`${PRELUDE}
		const trackId = trackOf(args.elementId);
		const before = elementOf(args.elementId);
		e.timeline.updateElementRetime({ trackId, elementId: args.elementId, retime: { rate: args.rate, maintainPitch: false } });
		if (args.keepDuration) {
			e.timeline.updateElements({ updates: [{ trackId, elementId: args.elementId, patch: { duration: before.duration } }] });
		}
		const after = elementOf(args.elementId);
		return { ok: true, rate: after.retime?.rate, durationSeconds: after.duration / window.__opencut.TICKS_PER_SECOND };
		`,
		{ ...input },
	);
}

/** An effect element needs a numeric base value for the param it animates. */
function effectParams(input: { paramKey: string; params?: Record<string, number | string | boolean>; keys?: Array<{ t: number; value: number }> }) {
	const params = { ...(input.params ?? {}) };
	if (typeof params[input.paramKey] !== "number") params[input.paramKey] = input.keys?.[0]?.value ?? 15;
	return params;
}

export type EffectInput = {
	elementId: string;
	effectType: string;
	params?: Record<string, number | string | boolean>;
	paramKey: string;
	keys?: Array<{ t: number; value: number }>;
};

export async function effect(input: EffectInput) {
	input = { ...input, params: effectParams(input) };
	return evalInEditor<unknown>(
		`${PRELUDE}
		const trackId = trackOf(args.elementId);
		const effectId = e.timeline.addClipEffect({ trackId, elementId: args.elementId, effectType: args.effectType });
		if (!effectId) throw new Error("effect not added (unknown type or element cannot take effects): " + args.effectType);
		e.timeline.updateClipEffectParams({ trackId, elementId: args.elementId, effectId, params: args.params });
		for (const k of args.keys ?? []) {
			e.timeline.upsertEffectParamKeyframe({ trackId, elementId: args.elementId, effectId, paramKey: args.paramKey, time: T(k.t), value: k.value, interpolation: "linear" });
		}
		return { ok: true, effectId };
		`,
		{ ...input },
	);
}

export type EffectLayerInput = {
	effectType: string;
	startTime: number;
	duration: number;
	params?: Record<string, number | string | boolean>;
	paramKey: string;
	keys?: Array<{ t: number; value: number }>;
};

/** An adjustment layer: the effect applies to everything under it, e.g. a blur across a cut. */
export async function effectLayer(input: EffectLayerInput) {
	input = { ...input, params: effectParams(input) };
	return evalInEditor<unknown>(
		`${PRELUDE}
		const zero = T(0);
		e.timeline.insertElement({
			element: { type: "effect", name: args.effectType, effectType: args.effectType, params: args.params ?? {}, startTime: T(args.startTime), duration: T(args.duration), trimStart: zero, trimEnd: zero },
			placement: { mode: "auto", trackType: "effect" },
		});
		const found = e.scenes.getActiveScene().tracks.overlay.flatMap(t => t.elements.map(el => ({ el, trackId: t.id })))
			.filter(x => x.el.type === "effect" && x.el.startTime === T(args.startTime));
		const hit = found[found.length - 1];
		if (!hit) throw new Error("effect layer not inserted");
		if (args.keys?.length) {
			e.timeline.upsertKeyframes({ keyframes: args.keys.map(k => ({
				trackId: hit.trackId, elementId: hit.el.id, propertyPath: "params." + args.paramKey, time: T(k.t), value: k.value, interpolation: "linear",
			})) });
		}
		return { ok: true, elementId: hit.el.id, trackId: hit.trackId };
		`,
		{ ...input },
	);
}

export async function screenshot(input: ScreenshotInput) {
	const { page } = await getSession();
	const out = input.path ?? `/tmp/opencut-${Date.now()}.png`;
	await page.screenshot({ path: out, fullPage: false });
	return { path: out };
}
