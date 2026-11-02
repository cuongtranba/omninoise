import { expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { basename, join } from "node:path"

import { parseMarkup } from "./markup"
import { parsePost } from "./spec"

// The bundled sample, plus your workspace's posts when OMNINOISE_POSTS points at them.
const postsDirs = [join(import.meta.dir, "..", "example"), ...(process.env.OMNINOISE_POSTS ? [process.env.OMNINOISE_POSTS] : [])]
const specs = postsDirs.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)))

test("there is at least one post spec to check", () => {
  expect(specs.length).toBeGreaterThan(0)
})

for (const path of specs) {
  const file = basename(path)
  test(`${file} parses against the schema`, async () => {
    const post = parsePost(await Bun.file(path).json())
    expect(`${post.slug}.json`).toBe(file)
    expect(post.locales.en.slides.length).toBe(post.locales.vi.slides.length)
  })
}

test("an unknown slide type is rejected with its path", () => {
  const slide = { type: "carousel" }
  const locale = { series: "s", slides: [slide] }
  expect(() => parsePost({ slug: "x", claims: "c", sources: ["a"], locales: { en: locale, vi: locale } })).toThrow(
    /slides\[0\]\.type/,
  )
})

test("inline markup splits code chips and accent words", () => {
  expect(parseMarkup("Run `git commit` on **main** now")).toEqual([
    { kind: "text", text: "Run " },
    { kind: "code", text: "git commit" },
    { kind: "text", text: " on " },
    { kind: "accent", text: "main" },
    { kind: "text", text: " now" },
  ])
})
