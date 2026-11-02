/**
 * The faces, and the guarantee that the first frame waits for them.
 *
 * FIX (the reference this kit is ported from gets this wrong): loading was
 * fired as a bare `void Promise.all(...)`, so nothing held the render back and
 * frames could composite before a face resolved — a still or the first frames
 * of a cut would ship in the fallback. `delayRender`/`continueRender` is the
 * only thing that makes typography deterministic.
 *
 * `bodyFamilyFor` is keyed by `Locale` on purpose. Adding a language to
 * `LOCALES` breaks THIS FILE until someone names a face for it, which is the
 * right place to be stopped: a face that covers latin can carry single
 * diacritics and silently drop the stacked ones another script is built from —
 * no missing-glyph box, just the wrong word. `fonts` in video.config.yaml is
 * the other half (`nv validate` reads each face's real cmap); the two must name
 * the same families.
 */

import { loadFont as loadBeVietnamPro } from "@remotion/google-fonts/BeVietnamPro"
import { loadFont as loadRobotoMono } from "@remotion/google-fonts/RobotoMono"
import { cancelRender, continueRender, delayRender } from "remotion"

import type { Locale } from "./generated/timeline"

// The `vietnamese` subset is REQUESTED, not merely available: an @font-face is
// injected only for the subsets asked for here, and a forgotten one falls back
// silently — another face fills in the missing glyphs and nothing on screen
// says so. These subsets and video.config.yaml's must agree; `nv validate`
// checks the config's half.
const body = loadBeVietnamPro("normal", {
  weights: ["400", "600", "700"],
  subsets: ["latin", "vietnamese"],
})

/** Anything the system itself writes: ids, counts, paths, exit codes. */
const mono = loadRobotoMono("normal", {
  weights: ["400", "500"],
  subsets: ["latin", "vietnamese"],
})

const fontsReady = delayRender("Loading fonts")

void Promise.all([body.waitUntilDone(), mono.waitUntilDone()])
  .then(() => continueRender(fontsReady))
  .catch((error: unknown) => cancelRender(error))

const FALLBACK = "ui-sans-serif, system-ui, sans-serif"

/**
 * Set in exactly one place — the `Stage` root — so every caption, label and
 * heading inherits it. A component that names its own body face is a component
 * that will still be in English when the rest of the frame is not.
 */
export const bodyFamilyFor: Readonly<Record<Locale, string>> = {
  en: `${body.fontFamily}, ${FALLBACK}`,
  // One face, with its `vietnamese` subset requested above, covers both cuts.
  vi: `${body.fontFamily}, ${FALLBACK}`,
}

export const monoFamily = `${mono.fontFamily}, ui-monospace, monospace`

/** Applied wherever a number must not reflow between frames. */
export const tabular = { fontVariantNumeric: "tabular-nums" } as const
