# Montage style: real footage cut on the beat, assembled in OpenCut over MCP

A music-driven short in the CapCut "POV montage" style: shots of 1 to 2 s cut exactly on the beat, something moving in every shot (zoom punch, push-in, speed ramp with blur), whip and 3x3 grid transitions, short punchy captions, a warm grade and no voice. It is built in OpenCut, an open-source editor, because an agent can drive a real editor through MCP, you can watch the timeline appear, and the project stays on your machine. Read `omninoise.profile.yaml` at the workspace root first: its `brand.logo`, `brand.name` and `ban` list feed the scripts below.

Use it for screen-recording guides and demos ("how to use X"), product tours and anything where real footage says more than narration. The **terminal demo** style is this same pipeline built from real terminal runs (section 2b) and docs pages. The owner picks the style (SKILL.md, "Choose the style"); use the explainer style when the idea needs a spoken argument.

## The look

The numbers below were measured from a CapCut-style reference cut and are the defaults; the shotlist's `caption` block and `grade` change them.

| | Rule |
|---|---|
| Frame | 1080x1920, 30 fps, H.264/AAC, 30 to 40 s |
| Music | Instrumental, 120 to 128 BPM, steady pulse (`beats.ts` score above 2) |
| Cuts | On a beat, always. Hook shots 2 beats (~1 s); guide shots 3 to 4 beats; never longer than 2 s without a cut |
| Every shot moves | `punch` (1.0 → 1.15 in 3 frames, settle 1.06 → 1.09), `push` (1.0 → 1.08), `pull` (1.1 → 1.0) or `ramp` (middle 30% at 3x with blur 0 → 60 → 0). Alternate them |
| Transitions | `whip` (±35% slide over 3 frames each side plus a blur layer peaking at 90) most of the time; `grid` (nine tiles fill a 3x3 grid across the first beat of the next shot) at most twice; `flash` (a warm light leak, `build/flash.png`, at full opacity on the cut and gone 4 frames later; it also works into the end card) on the big hits; plain `cut` for jump cuts inside one recording |
| Grade | `eq=saturation=1.18:contrast=1.06,colortemperature=temperature=5600:mix=0.5` in prep (OpenCut has no grade effect) |
| Captions | 2 to 6 words, bold, 72 px, near-black on a mint box (`#3EE6AA`), centre at y +400 (71% of the height, inside the caption band), popping in on the cut. A caption may span two jump cuts (`captionShots: 2`) so a guide step stays readable. The first caption is the hook, from the omninoise-strategy skill's `references/hooks.md`, in English and Vietnamese, and the last guide shot pays it off |
| Brand | Logo at 72 px, top-left inside the safe area, 80% opacity, on every frame before the end card; end card: logo, title, your hub link, the channel name and handle, the channel's call to action (for example "Follow for daily AI build lessons") |

## 0. Tools

```bash
<skill-dir>/opencut-mcp/scripts/opencut.sh start     # OpenCut on :3300, its own Chrome on CDP 9334 (install: references/opencut.md)
<skill-dir>/opencut-mcp/scripts/opencut.sh status
```

Register the `opencut` MCP server (`<skill-dir>/opencut-mcp/src/index.ts`, see references/opencut.md); its `opencut_*` tools appear in a session started after that. Without them, the same calls go over MCP with `bun <skill-dir>/opencut-mcp/scripts/call.ts`.

## 1. Script the shots: `shotlist.yaml`

Write `render/montage/<slug>/shotlist.yaml`. One entry per shot, in order:

```yaml
id: <slug>
music: { prompt: "...", bpm: 124, seconds: 40 }     # seconds: total + a few
grade: "eq=saturation=1.18:contrast=1.06,colortemperature=temperature=5600:mix=0.5"
logo: ../../../brand/logo.png          # optional; defaults to brand.logo from the profile
caption: { fontPx: 72, y: 400, color: "#06140F", background: "#3EE6AA" }
shots:
  - id: calendar                   # footage/calendar.mp4, recorded from the block below
    beats: 4
    in: 6.5                        # seconds into the recording
    move: punch                    # punch | push | pull | ramp | still
    crop: { x: 0.55, y: 0.5, zoom: 1 }   # centre of the 9:16 window in a landscape recording; zoom > 1 crops tighter (keep <= 1.6)
    transition: whip               # into the next shot: whip | grid | cut
    caption: { en: "See the week on one calendar", vi: "Cả tuần gọn trên một calendar" }
    captionShots: 2
    record: { cdp: 9333, url: "...", viewport: { width: 1440, height: 900, scale: 2 }, steps: [...] }
  - id: calendar-b                 # a jump cut later in the same recording
    source: footage/calendar.mp4
    beats: 4
    in: 9.8
    move: push
end: { beats: 8, logoPx: 280, logoY: -330, lines: [ { text: "...", fontPx: 96, y: -60 } ] }
```

- **Every caption traces to `content/sources.yaml`**; write `claims.md` beside it, as for explainers. Vietnamese captions follow the omninoise-seo skill's `references/vietnamese-style.md`. A `\n` breaks a long line.
- A guide reads best as numbered steps, each two jump cuts of one recording under one caption.

## 2. Record the footage from a real browser (a terminal: 2b)

```bash
cd render/montage/<slug>
bun <skill-dir>/scripts/record.ts . <shot-id>
```

It opens its own tab on the given Chrome, plays the `steps` (`wait`, `scroll`, `hover`, `click`, `clickText`, `eval`, `goto`, `key`) and writes `footage/<shot-id>.mp4` from screenshots at the device scale (sharp, ~15 fps) with their real timing.

- **Which Chrome.** `cdp: 9334` is OpenCut's own window: a clean, logged-out profile, right for public pages (GitHub, YouTube, a public profile). A second port (9333 in these examples) is your own logged-in Chrome started with `--remote-debugging-port=9333`: use it only for pages that need the login (your Omninoise dashboard, for one), in one tab of your own, closed afterwards. Never drive a tab you or another agent already has open, and put back any setting a click changed (the calendar view, for one).
- **Viewport.** Default portrait 540x960 at 2x, native 1080x1920 frames. Desktop-only apps: `viewport: { width: 1440, height: 900, scale: 2 }`, then pick the 9:16 window with `crop`.
- **Let the app load.** The Omninoise dashboard needs about 5 to 8 s before a click works; wait first, then set `in` past the click.
- **Never show:** any string in the profile's `ban` list (an internal address, a private repo), an email, a token or API key page, another person's account. Hide them with `hide` (CSS selectors) or remove them with `before` (page JS run before recording). The screenshots carry page pixels only, never the address bar.
- **Review every recording** before using it: `ffmpeg -i footage/<id>.mp4 -vf "fps=1,scale=360:-1,tile=5x4" -frames:v 1 /tmp/<id>.png`, and look. Check that the page is the right one (a similar handle can be someone else's channel) and that the click happened.

## 2b. Record a real terminal (the terminal demo style)

A command is shown running for real, not redrawn. Give the shot a `terminal` block instead of `url`. The recorder types each step at a mint `$ ` prompt, runs it on a real PTY under asciinema (headless), scrubs the recording, then plays it back in a branded terminal window in its own tab and records that tab like any page.

```yaml
  - id: claude
    beats: 4
    in: 1.0
    move: push
    caption: { en: "1. Pipe the log in", vi: "1. Pipe log vào" }
    record:
      cdp: 9334
      terminal:
        cwd: /tmp/<slug>-demo          # throwaway demo folder, built by setup
        setup: "sh ./setup.sh"         # run in the project folder first, not recorded
        size: 44x26                    # cols x rows; 44 columns stay readable on a phone
        title: "Terminal"              # window title bar
        typing: 25                     # characters per second
        steps:
          - run: cat build.log | claude -p "Explain the failure in one line"
            pause: 1.5                 # held after the command finishes
          - comment: "# exit code"     # typed, not run
          - run: echo $?
      tail: 1
```

- **Demo folder only.** `setup.sh` builds everything the commands touch (a tiny git repo, a neutral `build.log`) under `/tmp`. Never `cd` into a real project, never resume a real chat, never print an env var.
- **The scrub.** The cast (`footage/<id>.cast`, text) has the home path replaced with `~` and the user and host names with `demo`. If it still holds an email, a key or token, or any string in the profile's `ban` list, nothing is saved and the recorder names the line: fix the step, do not loosen the check.
- **Real runs cost and vary.** The cast is reused on the next run, so the look (size, `in`, crop) can be re-tuned for free; pass `--fresh` to run the commands again. Keep commands short and pipe long output through `jq` or `head` so a line fits 44 columns.
- **Footage is one real run.** A caption still claims only what the source says; the output on screen is evidence of one run, not a promise. Say in `claims.md` that the terminal is a real run in a demo folder.
- Review the frames as for any recording, then `grep` the cast for anything private you can think of.

## 3. Music and beats

```bash
ELEVENLABS_API_KEY=... bun <skill-dir>/scripts/music.ts .   # key from the environment (use your secret wrapper if you have one); audio/music.mp3, once; --force spends credits again
bun <skill-dir>/scripts/beats.ts .                                                   # beats.json
```

`beats.ts` reports the measured tempo, the first beat and a score. Below 2 the pulse is unclear: regenerate the music instead of cutting to it. If `music.ts` gets 401 or 403, the key has no Music access: stop and tell the owner.

## 3b. Optional: the 3D pop-out (real people breaking out of the picture)

For footage of people (dancers, a presenter), a shot can carry `popout: { from: <landscape clip>, in: <s>, frame: [x, y, w, h] }`. The shot then plays inside a white-bordered picture floating on a mint perspective-grid stage, and the person is drawn over the border, so a hand, a kick or a head that crosses it comes out of the frame. Pick moments where a limb or the head crosses the picture (`frame` defaults to `[0.09, 0.25, 0.82, 0.5]`; narrow it to let arms break out at the sides).

```bash
mkdir -p /tmp/rvm && curl -sSLo /tmp/rvm/rvm_resnet50_fp32.torchscript https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_resnet50_fp32.torchscript
bun <skill-dir>/scripts/montage.ts matte .   # footage/<id>.mp4 + .alpha.mp4 per pop-out shot (uv, about 2 frames/s)
```

`matte.py` (Robust Video Matting) finds the person, glides a 9:16 window after them across the source frame and mattes that window at full resolution; `prep` builds the composite. Stock people footage must carry a licence that allows social-media use (Mixkit's Stock Video Free License does; its Restricted License does not), and review the matte at the edges (hair, fast hands) before cutting to it.

## 4. Prep and plan

```bash
bun <skill-dir>/scripts/montage.ts prep .              # build/prepped/<id>.mp4: 9:16 crop, grade, 30 fps
bun <skill-dir>/scripts/montage.ts plan .              # build/en.json
bun <skill-dir>/scripts/montage.ts plan . --locale vi  # build/vi.json
```

`prep` fails if a recording is too short for its shot and in-point; it prints the timeline (every cut on a beat). `plan` writes the whole edit as a list of opencut MCP calls: media, the main track in order (project settings right after the first clip, which resets the canvas), moves, whips and grids, captions, logo, end card, music with a fade, export.

## 5. Assemble in OpenCut over MCP

Run the plan against the editor (the OpenCut Chrome window shows the timeline being built):

```bash
OPENCUT_BASE_URL=http://localhost:3300 OPENCUT_CDP=http://127.0.0.1:9334 \
  bun <skill-dir>/opencut-mcp/scripts/call.ts --batch render/montage/<slug>/build/en.json   # without the env it looks for :3000
```

or make the same calls with the session's own `opencut_*` tools, in order, replacing each `"$name.field"` with that field of the earlier result saved `as` `name`. For a fix, edit `shotlist.yaml` and rebuild; the plan starts a fresh project each time, so a run is repeatable. To try one change by hand, `opencut_get_state` shows the timeline and `opencut_keyframes`, `opencut_set_params` and friends edit it before `opencut_export_file`.

## 6. Check

```bash
ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate:format=duration -of compact out/<slug>-1080x1920.mp4
ffmpeg -v error -y -i out/<slug>-1080x1920.mp4 -vf "fps=2,scale=180:320,tile=15x5" -frames:v 1 /tmp/sheet.png
bun <skill-dir>/scripts/montage.ts cuts . out/<slug>-1080x1920.mp4
```

- 1080x1920, h264 + aac, 30 fps, 30 to 40 s.
- `cuts`: every detected cut within 1 frame of its beat. A jump cut inside one recording may be too subtle to detect: check it by eye.
- Full-size frames: captions inside the band and readable, the logo top-left, the end card complete (long Vietnamese lines wrap), nothing from the "never show" list.

## 7. Hand off

- Project `README.md` (what, sources, music prompt and credits), `claims.md`, `publish.yaml`. The caption says "AI-generated music" ("Nhạc do AI tạo." in Vietnamese); no voice line unless there is a voice. A long caption needs a short `caption_threads` (Threads takes 500 characters with the link and tag; limits per platform are in the omninoise-seo skill).
- Covers: add a `cover:` block to `shotlist.yaml` (`lines`, `accent` index, `label`, `at` seconds into the render), then `bun <skill-dir>/scripts/montage.ts covers .` writes `out/cover-1080x1920.jpg` (Instagram) and `out/thumb-1280x720.jpg` (YouTube). Look at both.
- Before uploading, re-encode each cut to under about 10 MB (`ffmpeg -c:v libx264 -preset slow -crf 27 -c:a copy -movflags +faststart`): the browser upload can reject large files. Screen recordings shrink to about 5.5 MB with no visible loss.
- Commit `shotlist.yaml`, `beats.json`, `audio/music.json`, `claims.md`, `publish.yaml`, `README.md`. Never `footage/`, `build/`, `audio/*.mp3` or `out/`.
- Copy `out/`, `footage/` and `audio/` out of the worktree before `gh pr merge --delete-branch`.
- Scheduling and posting: the omninoise-platform skill (`omninoise publish render/montage/<slug> --at <UTC>`).
