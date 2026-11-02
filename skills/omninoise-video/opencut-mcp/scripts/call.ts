#!/usr/bin/env bun
/**
 * Call opencut-mcp tools over real MCP (stdio), for sessions that have not loaded the
 * server and for batch builds. The server attaches to the same editor tab every time,
 * so state carries over between runs.
 *
 *   bun scripts/call.ts --list
 *   bun scripts/call.ts opencut_get_state '{}'
 *   bun scripts/call.ts --batch build.json      # [{ "tool": "...", "args": {...}, "as": "name" }, ...]
 *
 * In a batch, "$name.field" in a string arg is replaced by that field of an earlier
 * result saved with "as" (e.g. "$shot1.elementId").
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type Step = { tool: string; args?: Record<string, unknown>; as?: string };

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const transport = new StdioClientTransport({
	command: "bun",
	args: [join(root, "src/index.ts")],
	env: { ...process.env } as Record<string, string>,
	stderr: "inherit",
});
const client = new Client({ name: "omninoise-call", version: "1.0.0" });
await client.connect(transport);

const saved: Record<string, Record<string, unknown>> = {};
const resolve = (value: unknown): unknown => {
	if (typeof value === "string" && value.startsWith("$")) {
		const [name, field] = value.slice(1).split(".");
		const hit = saved[name!]?.[field!];
		if (hit === undefined) throw new Error(`unresolved reference ${value}`);
		return hit;
	}
	if (Array.isArray(value)) return value.map(resolve);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)]));
	}
	return value;
};

async function call({ tool, args = {}, as }: Step): Promise<void> {
	const result = await client.callTool({ name: tool, arguments: resolve(args) as Record<string, unknown> });
	const text = (result.content as Array<{ type: string; text?: string }>).map((c) => c.text ?? "").join("\n");
	console.log(`# ${tool}${as ? ` as ${as}` : ""}\n${text}`);
	if (result.isError) throw new Error(`${tool} failed`);
	if (as) saved[as] = JSON.parse(text);
}

const [first, second] = process.argv.slice(2);
let failed = false;
try {
	if (first === "--list") {
		const { tools } = await client.listTools();
		for (const t of tools) console.log(`${t.name}\t${t.description}`);
	} else if (first === "--batch") {
		for (const step of JSON.parse(readFileSync(second!, "utf8")) as Step[]) await call(step);
	} else if (first) {
		await call({ tool: first, args: second ? JSON.parse(second) : {} });
	} else {
		console.error("usage: call.ts --list | <tool> '<json>' | --batch <file.json>");
		failed = true;
	}
} catch (err) {
	console.error(String(err));
	failed = true;
} finally {
	await client.close();
}
process.exit(failed ? 1 : 0);
