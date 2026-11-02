#!/usr/bin/env node
/**
 * opencut-mcp — MCP server that drives OpenCut classic via Playwright + window.__editor.
 *
 * All actual editor work lives in ./tools; this file is only the MCP wire-up.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { closeSession } from "./browser.js";
import {
	AddMediaInput,
	AddTrackInput,
	DeleteInput,
	AddTextInput,
	EffectInput,
	EffectLayerInput,
	ExportInput,
	ExportToFileInput,
	InsertClipInput,
	KeyframesInput,
	NewProjectInput,
	ProjectSettingsInput,
	RetimeInput,
	SetParamsInput,
	MoveInput,
	ScreenshotInput,
	SplitAtInput,
	TrimInput,
	zodToJson,
} from "./schemas.js";
import * as tools from "./tools.js";

const server = new Server(
	{ name: "opencut-mcp", version: "0.2.0-omninoise" },
	{ capabilities: { tools: {} } },
);

const emptyInputSchema = { type: "object", properties: {} } as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
	tools: [
		{ name: "opencut_get_state", description: "Read timeline duration + track / element summary.", inputSchema: emptyInputSchema },
		{ name: "opencut_add_track", description: "Add a video/audio/text/graphic/effect track. Returns trackId.", inputSchema: zodToJson(AddTrackInput) },
		{ name: "opencut_add_media", description: "Upload a local file as MediaAsset. Returns { id, name, duration, type }.", inputSchema: zodToJson(AddMediaInput) },
		{ name: "opencut_insert_clip", description: "Insert an element referencing a MediaAsset onto a track.", inputSchema: zodToJson(InsertClipInput) },
		{ name: "opencut_split_at", description: "Split element(s) at time. Undoable via opencut_undo.", inputSchema: zodToJson(SplitAtInput) },
		{ name: "opencut_move", description: "Move element start (optionally to a new track).", inputSchema: zodToJson(MoveInput) },
		{ name: "opencut_trim", description: "Update element trim / duration.", inputSchema: zodToJson(TrimInput) },
		{ name: "opencut_delete", description: "Delete element(s).", inputSchema: zodToJson(DeleteInput) },
		{ name: "opencut_undo", description: "Undo the last command.", inputSchema: emptyInputSchema },
		{ name: "opencut_redo", description: "Redo the last undone command.", inputSchema: emptyInputSchema },
		{ name: "opencut_export", description: "Render in the browser and report success and size only; use opencut_export_file to get the file.", inputSchema: zodToJson(ExportInput) },
		{ name: "opencut_screenshot", description: "Screenshot the editor viewport for debugging.", inputSchema: zodToJson(ScreenshotInput) },
		{ name: "opencut_new_project", description: "Open a fresh, empty project in the editor tab. Returns projectId.", inputSchema: zodToJson(NewProjectInput) },
		{ name: "opencut_project_settings", description: "Set canvas size, fps and background. Call it AFTER inserting the first video/image: the first clip resets the canvas to its own size.", inputSchema: zodToJson(ProjectSettingsInput) },
		{ name: "opencut_set_params", description: "Set an element's static params: transform.positionX/Y (px from centre), transform.scaleX/Y, transform.rotate, opacity, or text params.", inputSchema: zodToJson(SetParamsInput) },
		{ name: "opencut_add_text", description: "Add a text element (caption, title, end card) on a text track.", inputSchema: zodToJson(AddTextInput) },
		{ name: "opencut_keyframes", description: "Keyframe a transform/opacity/volume property of an element (zoom punch, push-in, whip offset, fade). Times are local to the element.", inputSchema: zodToJson(KeyframesInput) },
		{ name: "opencut_retime", description: "Set a constant playback rate on a video/audio element. For a speed ramp, split the clip and retime the middle piece.", inputSchema: zodToJson(RetimeInput) },
		{ name: "opencut_effect", description: "Add an effect (blur) to one element, with optional keyframes of one param.", inputSchema: zodToJson(EffectInput) },
		{ name: "opencut_effect_layer", description: "Add an adjustment layer (blur) over a time range; it affects everything below it. Use it for whip blur across a cut.", inputSchema: zodToJson(EffectLayerInput) },
		{ name: "opencut_export_file", description: "Render in the browser and write the file to outPath on disk. Returns { outPath, bytes }.", inputSchema: zodToJson(ExportToFileInput) },
	],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
	const { name, arguments: args } = request.params;
	try {
		const result = await runTool(name, args ?? {});
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
	} catch (err) {
		const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
		return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
	}
});

async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
	switch (name) {
		case "opencut_get_state": return tools.getState();
		case "opencut_add_track": return tools.addTrack(AddTrackInput.parse(args));
		case "opencut_add_media": return tools.addMedia(AddMediaInput.parse(args));
		case "opencut_insert_clip": return tools.insertClip(InsertClipInput.parse(args));
		case "opencut_split_at": return tools.splitAt(SplitAtInput.parse(args));
		case "opencut_move": return tools.moveElement(MoveInput.parse(args));
		case "opencut_trim": return tools.trimElement(TrimInput.parse(args));
		case "opencut_delete": return tools.deleteElements(DeleteInput.parse(args));
		case "opencut_undo": return tools.undo();
		case "opencut_redo": return tools.redo();
		case "opencut_export": return tools.exportProject(ExportInput.parse(args));
		case "opencut_screenshot": return tools.screenshot(ScreenshotInput.parse(args));
		case "opencut_new_project": return tools.newProject(NewProjectInput.parse(args));
		case "opencut_project_settings": return tools.projectSettings(ProjectSettingsInput.parse(args));
		case "opencut_set_params": return tools.setParams(SetParamsInput.parse(args));
		case "opencut_add_text": return tools.addText(AddTextInput.parse(args));
		case "opencut_keyframes": return tools.keyframes(KeyframesInput.parse(args));
		case "opencut_retime": return tools.retime(RetimeInput.parse(args));
		case "opencut_effect": return tools.effect(EffectInput.parse(args));
		case "opencut_effect_layer": return tools.effectLayer(EffectLayerInput.parse(args));
		case "opencut_export_file": return tools.exportToFile(ExportToFileInput.parse(args));
		default: throw new Error(`unknown tool: ${name}`);
	}
}

async function main() {
	// omninoise: the editor session starts on the first tool call, so the server can be
	// registered for the whole repo without failing when OpenCut is not running.
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
	process.on(sig, async () => {
		await closeSession();
		process.exit(0);
	});
}

main().catch((err) => {
	console.error("fatal:", err);
	process.exit(1);
});
