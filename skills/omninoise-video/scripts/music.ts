#!/usr/bin/env bun
/**
 * Generate a montage's music with ElevenLabs Music (POST /v1/music, instrumental only).
 *
 *   ELEVENLABS_API_KEY=... bun music.ts <project-dir> [--force]   # or run it under your secret wrapper
 *
 * Reads music.prompt, music.bpm and music.seconds from shotlist.yaml and writes
 * audio/music.mp3 plus audio/music.json (prompt, song id, sha256). Skips the call when
 * the file exists, unless --force: every call spends Music credits. The key is read from
 * ELEVENLABS_API_KEY and sent as xi-api-key; it is never printed. A 401/403 means the key
 * has no Music access; stop and tell the owner, do not switch to another music source.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const project = resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const force = args.includes("--force");
const { music } = Bun.YAML.parse(readFileSync(join(project, "shotlist.yaml"), "utf8")) as {
	music: { prompt: string; bpm: number; seconds: number };
};
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
	console.error("ELEVENLABS_API_KEY is not set");
	process.exit(1);
}
const out = join(project, "audio/music.mp3");
if (existsSync(out) && !force) {
	console.log(`exists: ${out} (use --force to regenerate)`);
	process.exit(0);
}

// The tempo goes into the prompt as words: the API has no tempo field, and beats.ts
// measures the real tempo afterwards anyway.
const prompt = `${music.prompt.trim()} Steady ${music.bpm} BPM, four on the floor, instrumental, no vocals.`;
const res = await fetch("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128", {
	method: "POST",
	headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
	body: JSON.stringify({
		prompt,
		music_length_ms: Math.round(music.seconds * 1000),
		model_id: "music_v1",
		force_instrumental: true,
	}),
});
if (!res.ok) {
	console.error(`ElevenLabs Music failed: HTTP ${res.status} ${await res.text()}`);
	process.exit(1);
}
const bytes = Buffer.from(await res.arrayBuffer());
mkdirSync(join(project, "audio"), { recursive: true });
writeFileSync(out, bytes);
writeFileSync(
	join(project, "audio/music.json"),
	`${JSON.stringify(
		{
			provider: "elevenlabs-music",
			model: "music_v1",
			prompt,
			seconds: music.seconds,
			songId: res.headers.get("song-id") ?? res.headers.get("x-song-id"),
			sha256: createHash("sha256").update(bytes).digest("hex"),
			createdAt: new Date().toISOString(),
		},
		null,
		"\t",
	)}\n`,
);
console.log(`wrote ${out} (${bytes.length} bytes)`);
