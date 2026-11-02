# Run OpenCut and its MCP server

Use when: making a montage-style video (`../montage.md`), or when the `opencut_*` tools fail. OpenCut is an open-source video editor. The montage style is built in it because an agent can drive a real editor through MCP and you can watch the timeline appear, and because the editor and its project stay on your machine.

Needs: Bun, Docker, Google Chrome, about 2 GB of disk. Nothing secret: the editor is local and has no account. The helper script opens Chrome with the macOS `open` command; on Linux, start Chrome yourself with `--remote-debugging-port=9334` and its own `--user-data-dir`.

`<skill-dir>` below is the folder the skill was installed into (for example `.agents/skills/omninoise-video`).

## Parts

| Part | Where | Notes |
|---|---|---|
| Editor | `~/opencut-classic` (override with `OPENCUT_REPO`), fork `kenimo49/opencut-classic` at `a7443ec8` | Next.js dev server on http://localhost:3300 |
| Its services | Docker project `opencut`, `compose.local.yml` in the editor folder | Postgres on 5442, Redis on 6389, Redis HTTP on 8099 (the defaults 5432, 6379, 8079 and 8089 are often taken by other containers) |
| Browser | Chrome profile `~/.omninoise-opencut-chrome`, CDP port 9334 | The window the edit happens in. Keep it separate from your everyday Chrome |
| MCP server | `<skill-dir>/opencut-mcp/` | Starts the browser session on the first tool call |

## Install (once)

```bash
cd ~ && git clone https://github.com/kenimo49/opencut-classic.git && cd opencut-classic && git checkout a7443ec8
# compose.local.yml: the upstream docker-compose.yml without the `web` service,
# with db, redis and serverless-redis-http bound to 127.0.0.1 on 5442, 6389 and 8099
sed -e 's#localhost:3000#localhost:3300#' -e 's#localhost:5432#localhost:5442#' -e 's#localhost:8079#localhost:8099#' \
    -e "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=$(openssl rand -hex 24)#" apps/web/.env.example | tr -d '\r' > apps/web/.env.local
docker compose -p opencut -f compose.local.yml up -d --wait
bun install
(cd apps/web && set -a && . ./.env.local && set +a && bun run db:migrate)
<skill-dir>/opencut-mcp/scripts/build-wasm.sh       # applies patches/, builds the WASM in a Rust container (~2 min)
cd <skill-dir>/opencut-mcp && bun install
```

The auth secret is a random local value for a local-only app; it guards nothing of yours.

Register the server in your agent's MCP config so the `opencut_*` tools appear in new sessions:

```json
{ "mcpServers": { "opencut": { "command": "bun", "args": ["<skill-dir>/opencut-mcp/src/index.ts"] } } }
```

## Start, check, stop

```bash
<skill-dir>/opencut-mcp/scripts/opencut.sh start      # services, dev server, Chrome window
<skill-dir>/opencut-mcp/scripts/opencut.sh status
bun <skill-dir>/opencut-mcp/scripts/call.ts --list    # the MCP answers: the opencut_* tools
<skill-dir>/opencut-mcp/scripts/opencut.sh stop       # Chrome stays open
```

A session sees the `opencut_*` tools only if it started after the server was registered; otherwise use `call.ts`, which speaks the same MCP. Run the plan against the editor with `OPENCUT_BASE_URL=http://localhost:3300 OPENCUT_CDP=http://127.0.0.1:9334 bun <skill-dir>/opencut-mcp/scripts/call.ts --batch build/en.json`.

## When something breaks

| Symptom | Cause and fix |
|---|---|
| `export failed: ... missing field effect_pass_groups` | The npm WASM is back (a `bun install` in the editor restores it). Run `build-wasm.sh`, then `opencut.sh restart` |
| `export failed: ... At least one effect pass is required` | `patches/0002` is not applied. `build-wasm.sh` applies it; restart |
| `failed to find 'New project' button` or a 30 s timeout on first call | The dev server is still compiling the editor. `opencut.sh status`, wait, call again |
| The canvas is 1920x1080 after a build | `opencut_project_settings` ran before the first clip; the first clip resets the canvas. The plan from `montage.ts` does it in the right order |
| Text far too big | `opencut_add_text` takes `fontPx` (canvas pixels), not OpenCut's own unit |
| `call.ts` hangs | Chrome on 9334 is closed: `opencut.sh start` |

## Check it worked

A smoke build: two clips, a caption, a punch, a ramp, a blur and a whip, exported to `/tmp`. `ffprobe` on the file must show `h264` 1080x1920 at 30 fps plus `aac`.
