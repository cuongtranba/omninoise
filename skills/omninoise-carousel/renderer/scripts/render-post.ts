/**
 * bun run render-post <slug> [--posts <dir>] [--brand <dir>] [--out <dir>] [--profile <file>]
 * Renders every slide of both locales to <out>/<slug>/<locale>-<nn>.jpg.
 * Where the inputs come from: scripts/workspace.ts.
 */
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { LOCALES, parsePost } from "../src/spec"
import { loadWorkspace } from "./workspace"

const root = join(import.meta.dir, "..")
const slug = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"))
if (!slug) {
  console.error("usage: bun run render-post <slug> [--posts <dir>] [--brand <dir>] [--out <dir>] [--profile <file>]")
  process.exit(2)
}

const ws = loadWorkspace()
const post = parsePost(await Bun.file(join(ws.postsDir, `${slug}.json`)).json())

// The logo reaches Remotion through its public dir: a workspace logo is copied to a scratch public dir
// as brand/logo.png; with no workspace logo the placeholder in public/brand/ is used.
const scratch = join(root, ".workspace")
const publicDir = ws.logo ? join(scratch, "public") : join(root, "public")
if (ws.logo) {
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(join(publicDir, "brand"), { recursive: true })
  copyFileSync(ws.logo, join(publicDir, "brand/logo.png"))
}
mkdirSync(scratch, { recursive: true })

const run = (cmd: string[]) => {
  const p = Bun.spawnSync(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" })
  if (p.exitCode !== 0) process.exit(p.exitCode ?? 1)
}

const outDir = join(ws.outDir, post.slug)
mkdirSync(outDir, { recursive: true })

for (const loc of LOCALES) {
  const { series, slides } = post.locales[loc]
  for (let i = 0; i < slides.length; i++) {
    const n = String(i + 1).padStart(2, "0")
    const file = join(outDir, `${loc}-${n}.jpg`)
    const props = join(scratch, `${loc}-${n}.json`)
    writeFileSync(props, JSON.stringify({ slide: slides[i], series, index: i + 1, total: slides.length, brand: ws.brand }))
    run(["bunx", "remotion", "still", "src/index.ts", "Slide", file, `--props=${props}`, `--public-dir=${publicDir}`, "--image-format=jpeg", "--jpeg-quality=90"])
    const kb = Math.round(statSync(file).size / 1024)
    if (kb >= 1024) {
      console.error(`${file} is ${kb} KB, over the 1 MB limit`)
      process.exit(1)
    }
    console.log(`${file}  ${kb} KB`)
  }
}
rmSync(scratch, { recursive: true, force: true })
