/**
 * Where a carousel's inputs live: the posts folder, the logo and the brand text.
 *
 * Order for each, first hit wins:
 *   profile  --profile <file>, $OMNINOISE_PROFILE, else the nearest omninoise.profile.yaml above the
 *            current folder or above this renderer (true when the skill is installed in the workspace)
 *   posts    --posts <dir>, $OMNINOISE_POSTS, <profile folder>/render/cards/posts, then ./example
 *   brand    --brand <dir> (a folder holding the logo file named in brand.logo), else brand.logo from the profile
 *   out      --out <dir>, else <profile folder>/render/cards/out, else ./out
 */
import { existsSync, readFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import type { Brand } from "../src/spec"

export type Workspace = {
  postsDir: string
  outDir: string
  /** Absolute logo file, or undefined to use the placeholder in public/brand/. */
  logo?: string
  brand: Brand
  profileFile?: string
}

const NAME = "omninoise.profile.yaml"
const renderer = join(import.meta.dir, "..")

const flag = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const findUp = (start: string): string | undefined => {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, NAME))) return join(dir, NAME)
    if (dirname(dir) === dir) return undefined
  }
}

type Profile = { brand?: { name?: string; hub?: string; logo?: string } }

export const loadWorkspace = (argv: string[] = process.argv): Workspace => {
  const explicit = flag(argv, "--profile") ?? process.env.OMNINOISE_PROFILE
  const profileFile = explicit ? resolve(explicit) : (findUp(process.cwd()) ?? findUp(renderer))
  if (profileFile && !existsSync(profileFile)) throw new Error(`profile not found: ${profileFile}`)
  const profile = profileFile ? ((Bun.YAML.parse(readFileSync(profileFile, "utf8")) ?? {}) as Profile) : {}
  const root = profileFile ? dirname(profileFile) : undefined

  const postsFlag = flag(argv, "--posts") ?? process.env.OMNINOISE_POSTS
  const workspacePosts = root ? join(root, "render/cards/posts") : undefined
  const postsDir = postsFlag
    ? resolve(postsFlag)
    : workspacePosts && existsSync(workspacePosts)
      ? workspacePosts
      : join(renderer, "example")

  const brandFlag = flag(argv, "--brand")
  const logoName = profile.brand?.logo ? basename(profile.brand.logo) : undefined
  const logoPath = brandFlag
    ? logoName
      ? join(resolve(brandFlag), logoName)
      : undefined
    : profile.brand?.logo && root
      ? resolve(root, profile.brand.logo)
      : undefined
  if (brandFlag && !logoName) throw new Error("--brand needs brand.logo in the profile to name the logo file inside it")
  if (logoPath && !existsSync(logoPath)) throw new Error(`logo not found: ${logoPath}`)

  const outFlag = flag(argv, "--out")
  const outDir = outFlag ? resolve(outFlag) : root ? join(root, "render/cards/out") : join(renderer, "out")

  const hub = profile.brand?.hub
  const footer = hub ? hub.replace(/^https?:\/\//, "").replace(/\/$/, "") : ""
  return {
    postsDir,
    outDir,
    logo: logoPath,
    brand: { name: profile.brand?.name ?? "Example Channel", footer },
    profileFile,
  }
}
