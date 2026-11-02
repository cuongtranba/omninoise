/**
 * Synthesizes narration WITH word timing, for burned-in captions.
 *
 *   ELEVENLABS_API_KEY=... bun scripts/voiceover-timestamps.ts [--force] [--locale vi] [Scene ...]
 *
 * `nv voiceover` re-synthesizes every scene on every run and returns audio only,
 * so it cannot give a caption its timing. This calls ElevenLabs'
 * /with-timestamps endpoint instead (the key comes from ELEVENLABS_API_KEY and
 * goes only into the request header, never into an argument or a log), and writes
 * the same artefacts `nv voiceover` writes:
 *
 *   public/voiceover/<locale>/<Scene>.mp3    the take
 *   public/voiceover/<locale>/manifest.json  sha256 of the line, measured length (CHK-05..09)
 *
 * plus public/voiceover/<locale>/alignment.json: ElevenLabs' character timing,
 * untouched, which src/captions.ts turns into words.
 *
 * Only scenes whose line changed (or that have no alignment yet) are sent, so a
 * re-run after editing one line spends that line's characters and no others.
 * Run `nv sync` afterwards.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { mp3Seconds } from "./mp3"

const args = process.argv.slice(2)
const localeFlag = args.indexOf("--locale")
const LOCALE = localeFlag >= 0 ? (args[localeFlag + 1] ?? "en") : "en"
const PRICE_PER_1K = 0.15 // eleven_turbo_v2_5, as nv prices it

const root = join(import.meta.dir, "..")
const config = Bun.YAML.parse(readFileSync(join(root, "video.config.yaml"), "utf8")) as {
  video: { fps: number }
  scenes: (string | { id: string })[]
  tts: {
    costCapUsd: number
    outputFormat: string
    voices: Record<string, { voiceId: string; model: string; voiceSettings?: Record<string, number> }>
  }
}
const content = Bun.YAML.parse(readFileSync(join(root, "content", `${LOCALE}.yaml`), "utf8")) as {
  narration: Record<string, string>
}

const dir = join(root, "public", "voiceover", LOCALE)
const manifestPath = join(dir, "manifest.json")
const alignmentPath = join(dir, "alignment.json")
mkdirSync(dir, { recursive: true })

const readJson = <T>(path: string, fallback: T): T =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback

interface ManifestEntry {
  sha256: string
  seconds: number
  frames: number
  provider: string
  model: string
  voiceId: string
  bytes: number
}
const manifest = readJson<{ fps: number; provider: string; scenes: Record<string, ManifestEntry> }>(
  manifestPath,
  { fps: config.video.fps, provider: "elevenlabs", scenes: {} },
)
const alignment = readJson<Record<string, unknown>>(alignmentPath, {})

const force = args.includes("--force")
const only = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--locale")
const voice = config.tts.voices[LOCALE]
if (!voice) throw new Error(`video.config.yaml has no tts.voices.${LOCALE}`)
const apiKey = process.env.ELEVENLABS_API_KEY
if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set")
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

const sceneIds = config.scenes.map((scene) => (typeof scene === "string" ? scene : scene.id))
const todo = sceneIds.filter((id) => {
  if (only.length > 0 && !only.includes(id)) return false
  const line = content.narration[id]
  if (!line) return false
  const entry = manifest.scenes[id]
  return force || only.includes(id) || !entry || entry.sha256 !== sha256(line) || !alignment[id] || !existsSync(join(dir, `${id}.mp3`))
})

const characters = todo.reduce((sum, id) => sum + [...content.narration[id]!].length, 0)
const estimate = (characters / 1000) * PRICE_PER_1K
console.log(`${todo.length} scene(s) to synthesize: ${todo.join(", ") || "none"}`)
console.log(`${characters} characters, estimated $${estimate.toFixed(2)} (cap $${config.tts.costCapUsd.toFixed(2)})`)
if (estimate > config.tts.costCapUsd && !force) throw new Error("over tts.costCapUsd; pass --force")

for (const id of todo) {
  const line = content.narration[id]!
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice.voiceId}/with-timestamps?output_format=${config.tts.outputFormat}`
  const body = JSON.stringify({
    text: line,
    model_id: voice.model,
    ...(voice.voiceSettings ? { voice_settings: voice.voiceSettings } : {}),
  })
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "xi-api-key": apiKey }, body })
  if (!res.ok) throw new Error(`${id}: ElevenLabs answered ${res.status}: ${(await res.text()).slice(0, 400)}`)
  const response = (await res.json()) as {
    audio_base64: string
    alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
  }
  const audio = Buffer.from(response.audio_base64, "base64")
  writeFileSync(join(dir, `${id}.mp3`), audio)

  const seconds = mp3Seconds(audio)
  manifest.scenes[id] = {
    sha256: sha256(line),
    seconds: Math.round(seconds * 100) / 100,
    frames: Math.ceil(seconds * config.video.fps),
    provider: "elevenlabs",
    model: voice.model,
    voiceId: voice.voiceId,
    bytes: audio.length,
  }
  alignment[id] = response.alignment
  console.log(`${id.padEnd(12)} ${manifest.scenes[id]!.seconds.toFixed(2)}s ${manifest.scenes[id]!.frames}f  ${[...line].length} chars`)
}

const ordered = <T>(map: Record<string, T>) => Object.fromEntries(Object.keys(map).sort().map((key) => [key, map[key]!]))
writeFileSync(manifestPath, JSON.stringify({ ...manifest, fps: config.video.fps, scenes: ordered(manifest.scenes) }, null, 2) + "\n")
writeFileSync(alignmentPath, JSON.stringify(ordered(alignment)) + "\n")
console.log(`${characters} characters synthesized.`)
