# Explainer template

A minimal Remotion project for the explainer style of the `omninoise-video` skill: two sample scenes
(`Hook`, `Outro`), two locales (`en`, `vi`), the kit's components (`Stage`, `Plate`, `Layer`, `Sprite`,
`LightSweep`, `Grain`, `glow`, `SIZE`, `THEME`, `at()`) and the `nv` narrated-video gate. Its timing comes
from measured audio rather than from a table someone maintains by hand.

Copy this folder to your workspace as `render/explainer/<slug>/`, without `node_modules`, `out` and
`public/voiceover/**/*.mp3`. Then replace `public/brand/logo.png` with your logo, `public/art/hook.jpg`
(a plain gradient) with a painted plate, and the sample text in `content/`, `claims.md` and `publish.yaml`.

```bash
bun install
nv sync            # writes src/generated/* from video.config.yaml and content/
nv status          # where the project is, and the one command to run next
bun run studio     # every scene is also its own composition
bun run typecheck && bun run lint && bun test
```

`nv` is the narrated-video kit, [cuongtranba/narrated-video](https://github.com/cuongtranba/narrated-video)
(release binaries, 0.12 or newer). Until the voice is recorded, `nv validate` fails exactly two checks, CHK-05 and CHK-06
(scenes are timed from an estimate and have no audio); every other check passes on the sample.

`nv status` derives its answer from the files here, so it is never a plan that has fallen out of date.

## How a change flows

Config and content are data; TypeScript is generated from them, in one
direction only:

```
video.config.yaml  ─┐
content/<locale>.yaml ├─→ nv sync ─→ src/generated/* ─→ components
measured audio     ─┘            └─→ package.json (the composition id)
```

Nothing flows back. **Every file under `src/generated/` is overwritten by
`nv sync`** — edit the YAML instead, and the type arrives with the value.

| I want to… | Edit |
| --- | --- |
| change a spoken line, or an on-screen string | `content/<locale>.yaml` |
| add or reorder a scene | `scenes:` in `video.config.yaml`, then `nv sync` |
| add a language | `locales.list` + a new `content/<code>.yaml` |
| change the palette | `theme:` in `video.config.yaml` |
| change how long a scene runs | record the narration — that IS the length |
| hand someone a readable script | nothing — run `nv script <locale>` |
| hold the cut to a length | `video.targetDuration`, then `nv status` |

Then: `nv sync`, `nv validate`, `bun run typecheck`.

## Two TypeScripts, on purpose

This project installs TypeScript twice, and it is not a mistake to tidy up:

| Package | Version | Who uses it |
| --- | --- | --- |
| `typescript-native` | 7.0.2 | `bun run typecheck` — the native compiler, and the one whose verdict counts |
| `typescript` | 6.0.3 | `bun run lint` — typescript-eslint parses with the 6.0 API |

TypeScript 7.0 is a native port that dropped the JavaScript compiler API, and
typescript-eslint has not yet been rebuilt against its replacement
([typescript-eslint#10940]). Until it is, a project can type-check with 7 or
lint with 6, and installing both is how it does both.

Two consequences worth knowing:

- **Run the scripts, not the binaries.** A bare `tsc` resolves to the 6.0
  compiler. `bun run typecheck` names the 7.0 one explicitly.
- **Only type-checking is split.** The lint config is not type-aware, so 6.0
  only parses syntax there — it never renders a second opinion about your types.

When typescript-eslint ships 7.x support, `typescript-native` folds back into
`typescript` and this section goes away.

[typescript-eslint#10940]: https://github.com/typescript-eslint/typescript-eslint/issues/10940

## Scene lengths are derived, not chosen

A scene lasts `leadFrames + narration + tailFrames`, with the cross-fade repaid
once per boundary. Only the two pads are a person's decision, and they are set
once in `defaults`. A narrated scene may not declare `durationInFrames`; that
refusal is what stops the hand-kept frame table from growing back.

Before any audio exists, lengths are estimated from character counts —
±15%, good enough to review layout. Anything estimated wears the **UNVOICED**
badge, in Studio and in a real render alike, with no way to switch it off. Run
`nv voiceover` and it goes away.

## Writing a scene

Copy `src/scenes/_template.tsx`, or `nv init --scene <Id>`. Three rules:

- Export exactly one symbol, named `Scene`. The generated registry imports it
  as `import { Scene as <Id> }`.
- Cue reveals as **fractions** of `durationInFrames` via `at()` — never frame
  counts. That is what lets a translation re-time itself instead of carrying its
  own table of cues.
- Read strings from `useCopy()`, never from a prop. A prop can be forgotten one
  level down, and that caption renders in English inside every other cut.

Scene modules hold no number about their own length, and never import
`src/generated/timeline`, `src/generated/registry`, or the config.

## Narration

This template uses `tts.provider: elevenlabs` and puts the key in the env var named by
`tts.apiKeyEnv` (see `.env.example`). To see real pacing without a key, set
`tts.provider: silence` (correctly-sized silent audio, no account, no network) and run
`nv voiceover`. For narration with word timing for the captions, run
`ELEVENLABS_API_KEY=... bun scripts/voiceover-timestamps.ts` (add `--locale vi` for Vietnamese),
then `nv sync`.

The `model` is per locale and it fails silently: a multilingual model can speak
a tonal language with the tones wrong and still return a clean 200 and a
plausible duration. Judge a new language by ear, not by the request succeeding.

The mp3 takes are not committed (they are gitignored; the manifests and alignment files are),
so copy `out/` and `public/voiceover/` out of a worktree before you remove it.
