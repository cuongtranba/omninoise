---
name: omninoise-video
description: Make a short vertical video for a channel run on Omninoise, end to end, in one of three styles - a narrated explainer with Codex-painted art animated in Remotion, a CapCut-style montage of real screen recordings cut on the beat of AI music and assembled in OpenCut over its MCP server, or a terminal demo (the same montage built from real commands run in a terminal and the docs pages behind them) - from a backlog idea to a rendered, checked MP4. Use when asked to make, render, restyle or redo a clip, explainer, montage, demo, guide, product tour or short video; for a "CapCut style", "fast cut", "beat-synced", "OpenCut" or "screen recording" video; to add AI art, images, backgrounds, animation frames or effects to a video; to write or rewrite a video script or its hook (English and Vietnamese); or to run the per-item pipeline. Scheduling and posting is the omninoise-platform skill's job.
---

# omninoise-video: one idea to one finished clip

Read `omninoise.profile.yaml` at the workspace root first. It holds your brand name, your logo, the strings that must never appear in a video (`ban`) and the language order per channel. If you have none, copy `references/profile.example.yaml` from the omninoise-platform skill (installed beside this one) to your workspace root. `<skill-dir>` below is the folder this skill was installed into.

Codex paints the pictures. Claude Code writes the script, lays the pictures out in Remotion scenes and puts them in motion. The narrated-video kit (`nv`) times everything from the measured voice and gates it with 42 checks. The split exists because each tool does one thing well: an image model is good at mood and bad at text and layout, and a scene written in code is exact, repeatable and translatable.

Work in a task worktree on its own branch. Never commit to your main branch.

## Choose the style

The owner picks the style for each video. If the request names one ("explainer", "montage", "CapCut style", "terminal demo", "show it running for real"), use it. If it does not, ask before writing anything, offering the three rows below with the one that fits the idea best first.

| Style | Fits | How |
|---|---|---|
| **Explainer** | One idea argued in 30 to 40 s of narration: a lesson, a concept, a story | The steps below: Codex art, Remotion, the `nv` kit |
| **Montage** | Real footage says it best: a how-to guide, a product tour, a demo; or the owner asks for a fast-cut, CapCut-style, beat-synced video | [montage.md](montage.md): screen recordings from a real browser, AI music, cuts on the beat, assembled in OpenCut through the `opencut` MCP server |
| **Terminal demo** | A command-line tool doing its job (`claude -p`, `codex exec`, any CLI), shown running for real, with the docs page that states each rule | [montage.md](montage.md) with terminal shots (section 2b): real commands in a throwaway demo folder, scrubbed before saving, plus docs pages with the quoted sentence highlighted; no voice |

Everything else in this file is the explainer path.

## 0. Tools

```bash
export PATH="/tmp/nv012:$PATH"; nv version || {          # nv 0.12 or newer
  mkdir -p /tmp/nv012 && cd /tmp/nv012 &&
  gh release download v0.12.0 -R cuongtranba/narrated-video -p 'nv-darwin-arm64.tar.gz' --clobber &&
  tar xzf nv-darwin-arm64.tar.gz && cd -; }
codex features list | grep image_generation             # must say true; no OPENAI_API_KEY needed
```

Use the release asset that matches your machine. You also need Bun and ffmpeg.

## 1. Pick and source the idea

1. Take the next item from your workspace's `content/backlog/` that is not in `content/published.jsonl` (the omninoise-strategy skill describes both files).
2. Read its source. Every factual sentence must quote a source in `content/sources.yaml`; cut what has none.
3. Write the hook first, in English and in Vietnamese, from the patterns in the omninoise-strategy skill (`references/hooks.md`). It opens a gap the viewer has to close ("How to…" / "Cách để…", "The real reason…" / "Lý do thật sự…", "Stop…" / "Đừng… nữa"). Draft three from different patterns, read them out loud, and keep the one that makes you want the answer. English: 8 words or fewer. Vietnamese: about 12 syllables or fewer, written from the meaning, not translated. Every promise in it must be paid off by a sourced line.
4. Write the narration as the answer to the hook: one idea, 30 to 40 s (about 450 to 600 characters in English at 16.4 characters per second). Set up the pain first and land the answer in the second half, not the next sentence. End with the channel's call to action (for example "Follow for daily AI build lessons."). Vietnamese lines follow the omninoise-seo skill's `references/vietnamese-style.md`. In `claims.md`, note the hook's pattern and the line that pays it off.

## 2. Scaffold the project

Copy `<skill-dir>/template/explainer/` to `render/explainer/<slug>/` in your workspace, without `node_modules`, `out` and `public/voiceover/**/*.mp3`. It is a minimal working project: two sample scenes (`Hook`, `Outro`), two locales and every component this skill teaches. Copy your logo (`brand.logo` in the profile) over `public/brand/logo.png`. Then:

- `video.config.yaml`: `video.id`, `scenes`, locales, `glossary`, `printedLiterals`, the palette under `theme`.
- `content/<locale>.yaml`: `narration` per scene and every on-screen string under `copy`.
- `src/scenes/<Id>.tsx`, one per scene, exporting `Scene`; cues as fractions with `at()`. Start a new scene from `src/scenes/_template.tsx`.
- `claims.md` (each spoken line beside its source sentence) and `publish.yaml`.
- `bun install && nv sync`.

## 3. Paint the art with Codex

Write `art.yaml` beside the config (the template has one plate to start from):

```yaml
frame: { width: 1080, height: 1920 }
style: >        # shared by every picture: palette, medium, light, and the bans below
  ... near-black green, mint #3EE6AA glow, warm white highlights ... Keep the band from 62% to
  80% of the height dark and low in detail. Absolutely no text, letters, numbers, logos, user
  interface, watermarks, signatures, people or faces.
assets:
  - { id: hook, kind: plate, prompt: "..." }                        # full frame, becomes public/art/hook.jpg
  - { id: canvases, kind: layer, prompt: "..." }                    # transparent PNG, for parallax
  - { id: burst, kind: sheet, size: 1536x1024, grid: 4x2, prompt: "eight stages of ..." }  # sprite sheet
```

Rules for the brief:

- **One picture per scene sentence**, so the picture changes every 2 to 3 seconds. Plates for mood; a `layer` when something should float at its own depth; a `sheet` for an effect that must animate (a burst, a spark, smoke).
- **No words in a picture.** Models garble text, and a word in a bitmap escapes the fact gate and translation. Remotion draws every word.
- **Leave room.** Say where the subject sits (upper third, centre) and keep the caption band (y 1240 to 1460, 62 to 80% of the height) dark.
- **Illustration, not evidence.** Never paint a real product screen, account, post, person or brand. If a scene must show the product, draw it in code (`src/components/art.tsx`).

Draw:

```bash
cd render/explainer/<slug>
bun <skill-dir>/scripts/codex-art.ts . --jobs 3     # draws what is missing
bun <skill-dir>/scripts/codex-art.ts . --force hook # redraw one picture
```

It runs one read-only `codex exec` per picture (about 45 s each), takes the image only from that Codex session's own folder (never "the newest image", which can be another agent's), and writes `public/art/<id>.jpg` (plates, cover-cropped to the frame), `public/art/<id>.png` (layers and sheets, alpha kept) and `art/manifest.json`. A failed or stalled picture is cut off after 15 minutes; rerun the same command and only the missing ones are drawn.

**Review before building on it.** Make a contact sheet and look at every picture, including its edges:

```bash
ffmpeg -v error -y $(for f in public/art/*.jpg; do printf -- '-i %s ' $f; done) -filter_complex "$(n=$(ls public/art/*.jpg | wc -l); for i in $(seq 0 $((n-1))); do printf '[%d]scale=270:480[v%d];' $i $i; done; for i in $(seq 0 $((n-1))); do printf '[v%d]' $i; done; printf 'hstack=%d' $n)" /tmp/contact.jpg
```

Redraw any picture with text, a face, a logo, a seam or noise strip, the wrong palette, or a busy caption band. For a sheet, check on a coloured background that the alpha is real and the cells line up.

## 4. Put the art in motion

`src/components/plate.tsx` is already in the template, with its `Stage` `background` prop, the `ArtLabel` in `overlay.tsx` and the `hero`/`giant` steps in `SIZE`. Each scene passes a painted background to `Stage`:

```tsx
<Stage name="Gate" background={<>
  <Plate src="gate.jpg" durationInFrames={durationInFrames} zoom={[1.0, 1.16]} pan={[0, 50]} />
  <LightSweep at={done} />
  <Grain />
</>}>
  <Sprite src="burst.png" at={done} cols={4} rows={2} size={700} />   {/* behind a position: relative headline */}
  ...
```

| Piece | Use it for |
|---|---|
| `Plate` | Every scene: a slow camera move (zoom in to build tension, out to reveal) plus the scrim that keeps the logo and captions readable. Alternate directions between scenes. |
| `Layer` | A transparent picture at its own depth; nearer layers travel further. |
| `Sprite` | A Codex sprite sheet, one cell every `framesPerCell` frames, `screen`-blended. Put the headline above it (`position: relative`). |
| `LightSweep` | One pass of light on the beat a sentence lands. |
| `Grain` | Film grain; ties painted plates and drawn UI together. |
| `glow()` | Headlines over a painting. |

Everything stays a pure function of the frame (no clock, no `Math.random`). Type comes from `SIZE`, colour from `THEME` (the gate checks both). The "AI-generated art" label stays on every frame.

## 5. Voice, gate, render, look

```bash
ELEVENLABS_API_KEY=... bun scripts/voiceover-timestamps.ts   # English; only changed lines are sent. Add --locale vi for Vietnamese
nv sync && nv validate                                  # 42 checks, none disabled
bun run typecheck && bun run lint && bun test
bunx remotion render <CompositionId> out/<slug>-1080x1920.mp4 --codec h264
bun run covers                                          # COVERS in src/cover.tsx; a plate makes a good `background`
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact out/<slug>-1080x1920.mp4
ffmpeg -v error -y -i out/<slug>-1080x1920.mp4 -vf "fps=1/2,scale=270:480,tile=8x2" -frames:v 1 /tmp/sheet.jpg
```

The key is read from the environment and goes only into the request header. If you keep keys in a secret manager, run the command under its wrapper; never put a key in a file or an argument. Until the voice is recorded, `nv validate` fails exactly CHK-05 and CHK-06 on the template (scenes are timed from an estimate and have no audio).

Film grain makes the H.264 large (about 32 MB for 31 s), and a large file can be rejected by the browser upload. Before scheduling, re-encode each cut to about 8 MB and look at one full-size frame again:

```bash
ffmpeg -v error -y -i out/<slug>-1080x1920.mp4 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart -c:a copy /tmp/<slug>.mp4
```

Read the frame sheet and a few full-size frames: the headline must be readable over the painting, the caption band clear, an effect never on top of the word it decorates, the label and logo legible. Fix and re-render until it reads.

## 6. Hand off

- Update the project README (what, art, sources, voice characters spent).
- Commit `public/art/`, `art.yaml` and `art/manifest.json`; never `art/raw/`, `art/logs/`, `out/` or mp3 takes.
- **Copy `out/` (and `art/raw/` if you may redraw) out of the worktree before you remove it** (for example with `gh pr merge --delete-branch`): removing a worktree deletes every gitignored file in it, and a first render and its paid voice takes can be lost that way.
- Scheduling and posting: the omninoise-platform skill (`omninoise publish <project-dir> --at <UTC>`, or the MCP tools). Captions follow the omninoise-seo skill and say "AI-generated voice and art"; a channel whose `language` is `vi-first` gets the Vietnamese cut and caption first, English below.
- Companion carousel: every video topic also gets an image-and-diagram carousel built from the same `claims.md`. Use the omninoise-carousel skill.
