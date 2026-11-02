#!/usr/bin/env bash
# Run the local OpenCut editor that the opencut MCP server drives.
#
#   <skill-dir>/opencut-mcp/scripts/opencut.sh start     # services, dev server on :3300, Chrome on CDP 9334
#   <skill-dir>/opencut-mcp/scripts/opencut.sh restart   # after build-wasm.sh
#   <skill-dir>/opencut-mcp/scripts/opencut.sh status
#   <skill-dir>/opencut-mcp/scripts/opencut.sh stop      # leaves Chrome open
#
# Install once: see references/opencut.md in the omninoise-video skill.
set -euo pipefail
repo="${OPENCUT_REPO:-$HOME/opencut-classic}"
port="${OPENCUT_PORT:-3300}"
cdp="${OPENCUT_CDP_PORT:-9334}"
log="$repo/.local/web.log"

up() { curl -s -o /dev/null -m 2 "http://localhost:$port/projects"; }

start_web() {
	mkdir -p "$repo/.local"
	(cd "$repo/apps/web" && nohup bunx next dev --turbopack -p "$port" >"$log" 2>&1 &)
	for _ in $(seq 1 60); do up && break; sleep 1; done
	up || { echo "dev server did not start; see $log" >&2; exit 1; }
	# The first request compiles the editor; warm it so the MCP does not time out.
	curl -s -o /dev/null -m 180 "http://localhost:$port/projects" || true
}

start_chrome() {
	curl -s -m 1 "http://127.0.0.1:$cdp/json/version" >/dev/null && return
	open -na "Google Chrome" --args --user-data-dir="$HOME/.omninoise-opencut-chrome" \
		--remote-debugging-port="$cdp" --no-first-run --no-default-browser-check "http://localhost:$port/projects"
	for _ in $(seq 1 20); do curl -s -m 1 "http://127.0.0.1:$cdp/json/version" >/dev/null && return; sleep 0.5; done
	echo "Chrome did not open CDP $cdp" >&2; exit 1
}

stop_web() { pkill -f "next dev --turbopack -p $port" || true; }

case "${1:-status}" in
start)
	docker compose -p opencut -f "$repo/compose.local.yml" up -d --wait
	up || start_web
	start_chrome
	echo "OpenCut on http://localhost:$port, Chrome CDP $cdp"
	;;
restart)
	stop_web; sleep 1; rm -rf "$repo/apps/web/.next"; start_web; start_chrome
	echo "restarted; reload the editor tab (the MCP's opencut_new_project does)"
	;;
stop)
	stop_web
	docker compose -p opencut -f "$repo/compose.local.yml" stop
	;;
status)
	docker compose -p opencut -f "$repo/compose.local.yml" ps --format '{{.Name}} {{.Status}}'
	up && echo "web: up on :$port" || echo "web: down"
	curl -s -m 1 "http://127.0.0.1:$cdp/json/version" >/dev/null && echo "chrome: CDP $cdp" || echo "chrome: not on CDP $cdp"
	;;
*) echo "usage: opencut.sh start|restart|status|stop" >&2; exit 1 ;;
esac
