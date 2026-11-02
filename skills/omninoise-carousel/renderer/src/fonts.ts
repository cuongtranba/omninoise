/**
 * Faces, and the guarantee that the first frame waits for them. Both subsets
 * are REQUESTED (latin + vietnamese): a forgotten subset falls back silently
 * and drops stacked diacritics without any missing-glyph box.
 */
import { loadFont as loadBeVietnamPro } from "@remotion/google-fonts/BeVietnamPro"
import { loadFont as loadRobotoMono } from "@remotion/google-fonts/RobotoMono"
import { cancelRender, continueRender, delayRender } from "remotion"

const body = loadBeVietnamPro("normal", { weights: ["400", "600", "700"], subsets: ["latin", "vietnamese"] })
const mono = loadRobotoMono("normal", { weights: ["400", "500"], subsets: ["latin", "vietnamese"] })

const ready = delayRender("Loading fonts")
void Promise.all([body.waitUntilDone(), mono.waitUntilDone()])
  .then(() => continueRender(ready))
  .catch((error: unknown) => cancelRender(error))

const FALLBACK = "ui-sans-serif, system-ui, sans-serif"

export const bodyFamily = `${body.fontFamily}, ${FALLBACK}`
export const monoFamily = `${mono.fontFamily}, ui-monospace, monospace`
