import type { Tone } from "./spec"

/** Same palette as the explainers (the explainers' generated/theme.ts). */
export const THEME = {
  accent: "oklch(82.6% 0.16 164.1)",
  background: "oklch(14% 0.02 165)",
  border: "oklch(32% 0.04 162)",
  danger: "oklch(68% 0.21 25)",
  foreground: "oklch(97.9% 0.008 157.1)",
  muted: "oklch(76% 0.02 160)",
  surface: "oklch(22% 0.03 163)",
  ok: "oklch(84% 0.18 150)",
} as const

export const mix = (color: string, pct: number, into = "transparent"): string =>
  `color-mix(in oklch, ${color} ${pct}%, ${into})`

import { SIZE as CANVAS } from "./spec"

export const SIZE = { ...CANVAS, margin: 80 } as const
export const CONTENT_W = SIZE.width - 2 * SIZE.margin
/** Content stops here; the footer sits below. */
export const CONTENT_BOTTOM = 1226
export const BODY_TOP = 214

export type ToneStyle = { text: string; border: string; fill: string; bar: string; dashed: boolean }

export const toneStyle = (tone: Tone = "plain"): ToneStyle => {
  switch (tone) {
    case "accent":
      return { text: THEME.foreground, border: THEME.accent, fill: mix(THEME.accent, 9), bar: THEME.accent, dashed: false }
    case "ok":
      return { text: THEME.foreground, border: THEME.ok, fill: mix(THEME.ok, 20), bar: THEME.ok, dashed: false }
    case "danger":
      return { text: THEME.foreground, border: THEME.danger, fill: mix(THEME.danger, 13), bar: THEME.danger, dashed: false }
    case "muted":
      return {
        text: THEME.muted,
        border: mix(THEME.muted, 55),
        fill: mix(THEME.surface, 70),
        bar: mix(THEME.muted, 60),
        dashed: true,
      }
    case "plain":
      return { text: THEME.foreground, border: THEME.border, fill: THEME.surface, bar: THEME.accent, dashed: false }
  }
}

/** Colour a mono line takes in a file card. */
export const lineColor = (tone: Tone = "plain"): string => {
  switch (tone) {
    case "accent":
      return THEME.accent
    case "ok":
      return THEME.ok
    case "danger":
      return THEME.danger
    case "muted":
      return mix(THEME.muted, 85)
    case "plain":
      return THEME.foreground
  }
}
