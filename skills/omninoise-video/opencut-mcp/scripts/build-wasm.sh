#!/usr/bin/env bash
# Build OpenCut classic's WASM compositor from source, with our patches, and install it
# over the npm copy. Needed because the published opencut-wasm 0.2.10 does not match the
# JavaScript at the pinned commit, and upstream mis-names a field (patches/0001).
# Rust runs in a throwaway container; nothing is installed on the Mac.
#
#   <skill-dir>/opencut-mcp/scripts/build-wasm.sh [~/opencut-classic]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="${1:-$HOME/opencut-classic}"
cd "$repo"

for p in "$here"/patches/*.patch; do
	if git apply --reverse --check "$p" 2>/dev/null; then
		echo "already applied: $(basename "$p")"
	else
		git apply "$p" && echo "applied: $(basename "$p")"
	fi
done

docker run --rm -v "$PWD":/src -v opencut-cargo:/usr/local/cargo/registry -w /src rust:1 bash -c '
	set -e
	rustup target add wasm32-unknown-unknown >/dev/null
	command -v wasm-pack >/dev/null || curl -sSfL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh >/dev/null
	wasm-pack build rust/wasm --target bundler --out-dir pkg --release
	chown -R '"$(id -u):$(id -g)"' rust/wasm/pkg target
'

# node_modules/opencut-wasm is a symlink into bun's store; copy through it.
cp rust/wasm/pkg/opencut_wasm* node_modules/opencut-wasm/
echo "installed $(shasum rust/wasm/pkg/opencut_wasm_bg.wasm | cut -c1-12) into node_modules/opencut-wasm"
echo "restart the dev server (docs/runbooks/opencut.md) so the editor loads it"
