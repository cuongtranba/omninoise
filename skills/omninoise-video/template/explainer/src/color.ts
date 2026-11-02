import { THEME } from "./generated/theme"

/**
 * The config writes colour in OKLCH because the 2D renderer is Chrome, which
 * parses it natively and so quotes the palette exactly. Three.js does not: its
 * `Color.setStyle` understands hex, `rgb()`, `hsl()` and X11 names, warns on
 * anything else, and leaves the colour at its default — **white**. A 3D scene
 * built straight from `THEME` therefore renders in the wrong palette while
 * every check passes and the render exits 0.
 *
 * Converting here keeps the config the single source of the palette rather than
 * asking 3D scenes to hardcode a second copy of it in hex.
 */

const OKLCH = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*[\d.]+%?)?\s*\)$/i

const srgbFromLinear = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055

const channel = (linear: number): string => {
  const clamped = Math.min(1, Math.max(0, srgbFromLinear(linear)))
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, "0")
}

/** Convert a CSS colour to something three.js can read. Non-OKLCH passes through. */
export function toThreeColor(css: string): string {
  const match = OKLCH.exec(css.trim())
  if (!match) {
    return css
  }

  const [, rawL, rawC, rawH] = match
  const L = rawL.endsWith("%") ? parseFloat(rawL) / 100 : parseFloat(rawL)
  const C = parseFloat(rawC)
  const hue = (parseFloat(rawH) * Math.PI) / 180

  const a = C * Math.cos(hue)
  const b = C * Math.sin(hue)

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return (
    "#" +
    channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  )
}

/**
 * `THEME`, converted for use on a three.js material. Same keys, same source of
 * truth — reach for this inside a `<Space>` and for `THEME` everywhere else.
 */
export const THEME_3D: Readonly<Record<keyof typeof THEME, string>> = Object.fromEntries(
  Object.entries(THEME).map(([key, value]) => [key, toThreeColor(value)]),
) as Readonly<Record<keyof typeof THEME, string>>
