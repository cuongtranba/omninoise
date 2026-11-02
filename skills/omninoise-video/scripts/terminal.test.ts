import { expect, test } from "bun:test";
import { scrubCast } from "./terminal.ts";

const ctx = { home: "/home/jane", user: "jane", host: "janes-mbp.local" };

test("scrubCast swaps home, user and host for neutral names and keeps the rest", () => {
	const cast = [
		'{"version":3,"term":{"cols":44,"rows":26}}',
		'[0.1,"o","jane@janes-mbp.local:/home/jane/work$ "]',
		'[0.2,"o","\\u001b[32mhello world\\u001b[0m\\r\\n"]',
	].join("\n");
	const out = scrubCast(cast, ctx);
	expect(out).toContain("~/work$ ");
	expect(out).toContain("hello world");
	expect(out).not.toContain("jane");
	expect(out).not.toContain("janes-mbp");
	expect(out.split("\n")[0]).toBe('{"version":3,"term":{"cols":44,"rows":26}}');
});

test("scrubCast refuses a cast that still contains an API key", () => {
	const cast = `{"version":3}\n[0.1,"o","key sk-ant-api03-${"A".repeat(20)}\\r\\n"]`;
	try {
		scrubCast(cast, ctx);
	} catch (e) {
		if (!(e instanceof Error)) throw e;
		return;
	}
	throw new Error("expected scrubCast to throw");
});

test("scrubCast refuses a string from the profile's ban list, whatever its case", () => {
	const cast = `{"version":3}\n[0.1,"o","ssh ops.INTERNAL.example.com\\r\\n"]`;
	try {
		scrubCast(cast, { ...ctx, ban: ["internal.example.com"] });
	} catch (e) {
		if (!(e instanceof Error)) throw e;
		return;
	}
	throw new Error("expected scrubCast to throw");
});

test("scrubCast lets the same line through when the profile bans nothing", () => {
	const cast = `{"version":3}\n[0.1,"o","ssh ops.internal.example.com\\r\\n"]`;
	expect(scrubCast(cast, ctx)).toContain("ops.internal.example.com");
});
