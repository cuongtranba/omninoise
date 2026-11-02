# opencut-mcp

An MCP server that lets an agent edit video in [OpenCut](https://github.com/OpenCut-app/OpenCut) classic, the open-source CapCut alternative. The `omninoise-video` skill uses it to assemble montage-style clips: OpenCut is open source, runs on your machine with no account, and an MCP server lets an agent build the timeline instead of a person clicking.

Vendored from [kenimo49/opencut-mcp](https://github.com/kenimo49/opencut-mcp) (MIT, © ken imoto, see `LICENSE`) at `ead4a8d`. It drives the editor through `window.__editor` in a real browser, so it needs the fork [kenimo49/opencut-classic](https://github.com/kenimo49/opencut-classic) at `a7443ec8`, which exposes that object. The upstream OpenCut rewrite has no MCP server yet.

Setup, start, stop and repair: [../references/opencut.md](../references/opencut.md).

## What this copy changes from upstream

- **Real browser.** It attaches over CDP to a Chrome window of its own (`OPENCUT_CDP`, default `http://127.0.0.1:9334`, profile `~/.omninoise-opencut-chrome`) and reuses the open editor tab. You can watch the timeline being built, and the project survives each MCP process. Do not point it at your everyday Chrome. `OPENCUT_CDP=off` restores the original headless Playwright browser.
- **Lazy start.** The editor session starts on the first tool call, so the server can stay registered in your MCP config without failing when OpenCut is down.
- **New tools** for the montage style, each a thin wrapper over a `TimelineManager` or `ProjectManager` method at the pinned commit:

| Tool | What it does |
|---|---|
| `opencut_new_project` | Fresh, empty project in the editor tab |
| `opencut_project_settings` | Canvas size, fps and background. **Call it after the first clip**: inserting the first video or image resets the canvas to that file's size. |
| `opencut_set_params` | Static params: `transform.positionX/Y` (canvas px from the centre), `transform.scaleX/Y`, `transform.rotate`, `opacity` |
| `opencut_add_text` | Caption or title; `fontPx` is canvas pixels |
| `opencut_keyframes` | Keyframes on transform, opacity or volume; times are local to the element |
| `opencut_retime` | Constant speed; the element's length becomes `span / rate`. A ramp is three pieces. |
| `opencut_effect` | An effect (blur) on one element, with keyframes |
| `opencut_effect_layer` | An adjustment layer over a time range (blur across a cut) |
| `opencut_export_file` | Render in the browser and write the MP4 to disk |

- **Fixes:** `insert_clip` takes a source in-point (`sourceIn`) and finds the element it inserted (the original compared seconds with ticks); `export` no longer tries to return an `ArrayBuffer` as JSON; an export failure reports the editor's console error.

## Patches to OpenCut classic

`patches/` holds two fixes to bugs in OpenCut classic itself. `scripts/build-wasm.sh` applies both (and rebuilds the WASM compositor in a Rust container):

- `0001`: the compositor's `SceneEffect` descriptor expects `effect_pass_groups` but the JavaScript sends `effectPassGroups`, so any adjustment layer fails to render (`missing field effect_pass_groups`).
- `0002`: a clip effect with nothing to do (a blur at 0) yields an empty pass group, which the compositor rejects (`At least one effect pass is required`).

The published `opencut-wasm` 0.2.10 on npm does not match the JavaScript at the pinned commit either, so the WASM is always built from source.

## Calling it without an MCP client

`scripts/call.ts` speaks MCP over stdio to this server, for a session that has not loaded it or for a long build:

```bash
bun <skill-dir>/opencut-mcp/scripts/call.ts --list
bun <skill-dir>/opencut-mcp/scripts/call.ts opencut_get_state '{}'
bun <skill-dir>/opencut-mcp/scripts/call.ts --batch build/en.json   # "$name.field" refers to an earlier result saved "as": "name"
```

## Units

- Time: seconds everywhere (the editor stores ticks, 120 000 a second).
- Position: canvas pixels from the centre, y down.
- Scale 1: the element's size fitted inside the canvas. A 1080x1920 clip on a 1080x1920 canvas fills it at scale 1.
- Text: `fontPx` canvas pixels; OpenCut's own unit is `px * 90 / canvasHeight`.
