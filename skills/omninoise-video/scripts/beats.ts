#!/usr/bin/env bun
/**
 * Find the beat grid of a montage's music, so every cut can land on a beat.
 *
 *   bun beats.ts <project-dir>            # reads shotlist.yaml (music.bpm), audio/music.mp3
 *
 * Decodes the track to mono PCM with ffmpeg, builds an onset envelope (positive energy
 * change per 10 ms hop), then tries every tempo within ±4% of music.bpm and every phase,
 * and keeps the grid whose beats sit on the strongest onsets. Writes beats.json:
 * { bpm, offset, beats: [s...], downbeats: [s...], score }. A steady electronic track
 * scores well above 2; a low score means the music has no clear pulse and the cuts
 * will feel random, so regenerate the music rather than cut to it.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const project = resolve(process.argv[2] ?? ".");
const shotlist = Bun.YAML.parse(readFileSync(join(project, "shotlist.yaml"), "utf8")) as {
	music: { bpm: number };
};
const audio = join(project, "audio/music.mp3");

const RATE = 11025;
const HOP = Math.round(RATE / 100); // 10 ms
const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", audio, "-ac", "1", "-ar", String(RATE), "-f", "f32le", "-"], {
	maxBuffer: 1 << 30,
});
if (pcm.status !== 0) throw new Error(`ffmpeg failed: ${pcm.stderr}`);
const samples = new Float32Array(pcm.stdout.buffer, pcm.stdout.byteOffset, pcm.stdout.byteLength / 4);

// Onset envelope: half-wave rectified change of log energy, normalised.
const frames = Math.floor(samples.length / HOP);
const energy = new Float64Array(frames);
for (let f = 0; f < frames; f++) {
	let sum = 0;
	for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += samples[i]! * samples[i]!;
	energy[f] = Math.log1p(sum);
}
const onset = new Float64Array(frames);
for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f]! - energy[f - 1]!);
const mean = onset.reduce((a, b) => a + b, 0) / frames || 1;
for (let f = 0; f < frames; f++) onset[f] = onset[f]! / mean;

const at = (seconds: number) => {
	const f = Math.round(seconds * 100);
	// Take the strongest onset within ±20 ms: decoders and attacks are not sample exact.
	return Math.max(onset[f - 2] ?? 0, onset[f - 1] ?? 0, onset[f] ?? 0, onset[f + 1] ?? 0, onset[f + 2] ?? 0);
};

const duration = frames / 100;
let best = { bpm: shotlist.music.bpm, offset: 0, score: -1 };
for (let bpm = shotlist.music.bpm * 0.96; bpm <= shotlist.music.bpm * 1.04; bpm += 0.05) {
	const period = 60 / bpm;
	for (let offset = 0; offset < period; offset += 0.005) {
		let score = 0;
		let n = 0;
		for (let t = offset; t < duration; t += period, n++) score += at(t);
		score /= n || 1;
		if (score > best.score) best = { bpm, offset, score };
	}
}

const period = 60 / best.bpm;
const beats: number[] = [];
for (let t = best.offset; t < duration - 0.01; t += period) beats.push(Number(t.toFixed(3)));
// Downbeat: the bar phase (of 4) whose beats carry the most onset energy.
let bar = 0;
let barScore = -1;
for (let phase = 0; phase < 4; phase++) {
	const s = beats.filter((_, i) => i % 4 === phase).reduce((a, t) => a + at(t), 0);
	if (s > barScore) [bar, barScore] = [phase, s];
}
const result = {
	bpm: Number(best.bpm.toFixed(2)),
	offset: Number(best.offset.toFixed(3)),
	score: Number(best.score.toFixed(2)),
	duration: Number(duration.toFixed(2)),
	beats,
	downbeats: beats.filter((_, i) => i % 4 === bar),
};
writeFileSync(join(project, "beats.json"), `${JSON.stringify(result, null, "\t")}\n`);
console.log(`bpm ${result.bpm}, first beat ${result.offset}s, ${beats.length} beats, score ${result.score}`);
