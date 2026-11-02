import { z } from "zod";

// Public MCP tool schemas. Also imported by tests to exercise validation
// without spinning up the MCP transport / Playwright.

export const AddTrackInput = z.object({
	type: z.enum(["video", "audio", "text", "graphic", "effect"]),
	index: z.number().int().optional(),
});

export const AddMediaInput = z.object({ filePath: z.string() });

export const InsertClipInput = z.object({
	mediaId: z.string(),
	elementType: z.enum(["video", "audio", "image"]),
	startTime: z.number().describe("Timeline position, seconds"),
	duration: z.number().optional().describe("Length on the timeline, seconds; default the whole source"),
	sourceIn: z.number().optional().describe("Where in the source the clip starts, seconds (default 0)"),
	name: z.string().optional(),
	trackId: z
		.string()
		.optional()
		.describe("Omit for auto placement: a span that overlaps existing clips opens a new overlay track"),
});

export const SplitAtInput = z.object({
	elementIds: z.array(z.string()),
	time: z.number(),
});

export const MoveInput = z.object({
	elementId: z.string(),
	newStartTime: z.number(),
	newTrackId: z.string().optional(),
});

export const TrimInput = z.object({
	elementId: z.string(),
	trimStart: z.number().optional(),
	trimEnd: z.number().optional(),
	startTime: z.number().optional(),
	duration: z.number().optional(),
});

export const DeleteInput = z.object({ elementIds: z.array(z.string()) });

export const ExportInput = z.object({
	format: z.enum(["mp4", "webm"]).default("mp4"),
	quality: z.enum(["low", "medium", "high"]).default("medium"),
	fps: z.number().optional(),
	includeAudio: z.boolean().default(true),
});

export const ExportToFileInput = ExportInput.extend({
	outPath: z.string().describe("Absolute path of the file to write (e.g. .../out/clip.mp4)"),
});

export const ScreenshotInput = z.object({ path: z.string().optional() });

export const NewProjectInput = z.object({ name: z.string().optional() });

export const ProjectSettingsInput = z.object({
	width: z.number().int().describe("Canvas width, px (1080 for 9:16)"),
	height: z.number().int().describe("Canvas height, px (1920 for 9:16)"),
	fps: z.number().int().default(30),
	background: z.string().default("#000000").describe("Hex colour behind the clips"),
});

// Param values an element can carry. Transform positions are px offsets from the
// canvas centre; scale 1 is the element's fitted size; opacity 0..1.
const ParamValue = z.union([z.number(), z.string(), z.boolean()]);

export const SetParamsInput = z.object({
	elementId: z.string(),
	params: z
		.record(ParamValue)
		.describe(
			'Element params to set, e.g. {"transform.positionX": -400, "transform.scaleX": 0.33, "transform.scaleY": 0.33, "opacity": 0.8}',
		),
});

export const AddTextInput = z.object({
	content: z.string(),
	startTime: z.number().describe("Seconds"),
	duration: z.number().describe("Seconds"),
	fontPx: z.number().default(72).describe("Font size in canvas pixels (converted to OpenCut's fontSize = px * 90 / canvasHeight)"),
	fontFamily: z.string().default("Arial"),
	fontWeight: z.enum(["normal", "bold"]).default("bold"),
	color: z.string().default("#ffffff"),
	x: z.number().default(0).describe("px offset from the canvas centre"),
	y: z.number().default(0).describe("px offset from the canvas centre (positive is down)"),
	backgroundColor: z.string().optional().describe("Hex; turns the text background box on"),
	name: z.string().optional(),
});

export const KeyframesInput = z.object({
	elementId: z.string(),
	property: z
		.enum([
			"transform.positionX",
			"transform.positionY",
			"transform.scaleX",
			"transform.scaleY",
			"transform.scale",
			"transform.rotate",
			"opacity",
			"volume",
		])
		.describe("transform.scale sets scaleX and scaleY together"),
	keys: z
		.array(
			z.object({
				t: z.number().describe("Seconds from the element's start"),
				value: z.number(),
				interpolation: z.enum(["linear", "hold", "bezier"]).optional(),
			}),
		)
		.describe("Keyframes; times are local to the element and clamped to its duration"),
});

export const RetimeInput = z.object({
	elementId: z.string(),
	rate: z.number().positive().describe("Playback rate: 2 plays twice as fast"),
	keepDuration: z
		.boolean()
		.default(false)
		.describe("false (default): the timeline length becomes sourceSpan / rate; true: keep the current length"),
});

export const EffectInput = z.object({
	elementId: z.string(),
	effectType: z.string().default("blur"),
	params: z.record(ParamValue).optional().describe('Static params, e.g. {"intensity": 20}'),
	paramKey: z.string().default("intensity").describe("Param to keyframe"),
	keys: z
		.array(z.object({ t: z.number(), value: z.number() }))
		.optional()
		.describe("Keyframes for paramKey; t is seconds from the element's start"),
});

export const EffectLayerInput = z.object({
	effectType: z.string().default("blur"),
	startTime: z.number().describe("Seconds"),
	duration: z.number().describe("Seconds"),
	params: z.record(ParamValue).optional(),
	paramKey: z.string().default("intensity"),
	keys: z.array(z.object({ t: z.number(), value: z.number() })).optional(),
});

// Minimal Zod → JSON Schema converter used to advertise tool inputs over
// the MCP protocol. Handles the shapes we actually use (string / number /
// boolean / enum / optional / default / array). Not a general converter.
export function zodToJson(schema: z.ZodType): Record<string, unknown> {
	if (schema instanceof z.ZodObject) {
		const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
		const properties: Record<string, unknown> = {};
		const required: string[] = [];
		for (const [key, val] of Object.entries(shape)) {
			properties[key] = zodFieldToJson(val as z.ZodType);
			if (!(val as z.ZodType).isOptional()) required.push(key);
		}
		return { type: "object", properties, required };
	}
	return { type: "object" };
}

export function zodFieldToJson(field: z.ZodType): Record<string, unknown> {
	const json = zodFieldToJsonBare(field);
	return field.description ? { ...json, description: field.description } : json;
}

function zodFieldToJsonBare(field: z.ZodType): Record<string, unknown> {
	if (field instanceof z.ZodObject) return zodToJson(field);
	if (field instanceof z.ZodRecord) {
		return { type: "object", additionalProperties: zodFieldToJson(field._def.valueType) };
	}
	if (field instanceof z.ZodUnion) {
		return { anyOf: (field._def.options as z.ZodType[]).map(zodFieldToJson) };
	}
	if (field instanceof z.ZodEffects) return zodFieldToJson(field._def.schema);
	if (field instanceof z.ZodString) return { type: "string" };
	if (field instanceof z.ZodNumber) return { type: "number" };
	if (field instanceof z.ZodBoolean) return { type: "boolean" };
	if (field instanceof z.ZodEnum) {
		return {
			type: "string",
			enum: (field as z.ZodEnum<[string, ...string[]]>).options,
		};
	}
	if (field instanceof z.ZodOptional) {
		return zodFieldToJson((field as z.ZodOptional<z.ZodType>)._def.innerType);
	}
	if (field instanceof z.ZodDefault) {
		return zodFieldToJson((field as z.ZodDefault<z.ZodType>)._def.innerType);
	}
	if (field instanceof z.ZodArray) {
		return {
			type: "array",
			items: zodFieldToJson((field as z.ZodArray<z.ZodType>)._def.type),
		};
	}
	return { type: "string" };
}
