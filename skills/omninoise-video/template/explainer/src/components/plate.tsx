import React from "react"
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion"

import { THEME } from "../generated/theme"
import { EASE_OUT, LAYOUT } from "./primitives"

/**
 * Codex-painted art, put in motion (omninoise-video skill).
 *
 * Codex paints still pictures with no text (art.yaml); these components are how
 * Claude Code turns them into a moving frame: a slow camera on each plate,
 * parallax layers, a light sweep, film grain and frame-by-frame sprite sheets.
 * Everything is a pure function of the frame, so a still and a render agree.
 */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const

/**
 * A full-bleed painted plate with a camera move over the whole scene: zoom from
 * `zoom[0]` to `zoom[1]` and drift by `pan` pixels. The scrim keeps the logo band
 * and the caption band (y 1240-1460) readable on any picture.
 */
export const Plate: React.FC<{
  src: string
  durationInFrames: number
  zoom?: readonly [number, number]
  pan?: readonly [number, number]
  /** 0 keeps the painting as drawn; 1 darkens it to the background. */
  dim?: number
}> = ({ src, durationInFrames, zoom = [1.04, 1.16], pan = [0, -40], dim = 0.15 }) => {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [0, durationInFrames], [0, 1], { ...clamp, easing: Easing.inOut(Easing.sin) })
  const scale = zoom[0] + (zoom[1] - zoom[0]) * t

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: THEME.background }}>
      <Img
        src={staticFile(`art/${src}`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `translate(${pan[0] * t}px, ${pan[1] * t}px) scale(${scale})`,
        }}
      />
      <Scrim dim={dim} />
    </AbsoluteFill>
  )
}

/** Darkens the top UI band and the caption band; `dim` darkens the whole picture. */
export const Scrim: React.FC<{ dim?: number }> = ({ dim = 0.15 }) => {
  const bg = (pct: number) => `color-mix(in oklch, ${THEME.background} ${Math.round(pct)}%, transparent)`
  const capMid = ((LAYOUT.captionTop + LAYOUT.captionHeight / 2) / 1920) * 100

  return (
    <AbsoluteFill
      style={{
        background: [
          `linear-gradient(180deg, ${bg(70)} 0%, transparent 18%, transparent ${capMid - 16}%, ${bg(72)} ${capMid}%, ${bg(85)} 100%)`,
          bg(dim * 100),
        ].join(", "),
      }}
    />
  )
}

/**
 * A transparent layer that drifts against the plate behind it. `depth` 1 moves as
 * far as `travel`, 0.5 half of it: nearer layers move more, which reads as depth.
 */
export const Layer: React.FC<{
  src: string
  durationInFrames: number
  depth?: number
  travel?: readonly [number, number]
  enterAt?: number
  style?: React.CSSProperties
}> = ({ src, durationInFrames, depth = 1, travel = [0, -120], enterAt = 0, style }) => {
  const frame = useCurrentFrame()
  const t = interpolate(frame, [0, durationInFrames], [0, 1], clamp)
  const enter = interpolate(frame, [enterAt, enterAt + 18], [0, 1], { ...clamp, easing: Easing.bezier(...EASE_OUT) })

  return (
    <Img
      src={staticFile(`art/${src}`)}
      style={{
        position: "absolute",
        opacity: enter,
        transform: `translate(${travel[0] * depth * t}px, ${travel[1] * depth * t + (1 - enter) * 80}px) scale(${0.94 + 0.06 * enter})`,
        ...style,
      }}
    />
  )
}

/**
 * Plays a sprite sheet painted by Codex (`kind: sheet` in art.yaml): a grid of
 * cells read left to right, top to bottom, one cell every `framesPerCell` frames
 * from `at`, then gone. Blended with `screen`, so its dark pixels add no ink.
 */
export const Sprite: React.FC<{
  src: string
  at: number
  cols: number
  rows: number
  size: number
  framesPerCell?: number
  /** Cell height over width: a 1536x1024 sheet of 4x2 cells has 384x512 cells. */
  cellAspect?: number
  style?: React.CSSProperties
}> = ({ src, at, cols, rows, size, framesPerCell = 3, cellAspect = 512 / 384, style }) => {
  const frame = useCurrentFrame()
  const cell = Math.floor((frame - at) / framesPerCell)
  if (cell < 0 || cell >= cols * rows) return null
  const cellH = size * cellAspect
  const col = cell % cols
  const row = Math.floor(cell / cols)

  // A window one cell wide over the whole sheet, shifted to the current cell.
  return (
    <div style={{ position: "absolute", width: size, height: cellH, overflow: "hidden", mixBlendMode: "screen", ...style }}>
      <Img
        src={staticFile(`art/${src}`)}
        style={{
          position: "absolute",
          width: size * cols,
          height: cellH * rows,
          maxWidth: "none",
          left: -col * size,
          top: -row * cellH,
        }}
      />
    </div>
  )
}

/** A soft band of light crossing the frame once, from `at` for `frames` frames. */
export const LightSweep: React.FC<{ at: number; frames?: number; angle?: number; strength?: number }> = ({
  at,
  frames = 36,
  angle = 115,
  strength = 0.35,
}) => {
  const frame = useCurrentFrame()
  const p = interpolate(frame, [at, at + frames], [-40, 140], { ...clamp, easing: Easing.inOut(Easing.cubic) })
  if (frame < at || frame > at + frames) return null

  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        background: `linear-gradient(${angle}deg, transparent ${p - 18}%, color-mix(in oklch, ${THEME.accent} ${Math.round(strength * 100)}%, transparent) ${p}%, transparent ${p + 18}%)`,
      }}
    />
  )
}

/**
 * Film grain from SVG turbulence. The seed steps every two frames, derived from
 * the frame number, so it shimmers like film and still renders the same twice.
 */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame()
  const seed = Math.floor(frame / 2) % 97

  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${seed})`} />
      </svg>
    </AbsoluteFill>
  )
}

/** Text that glows in the accent: the house headline style on top of a painting. */
export const glow = (strength = 1): React.CSSProperties => ({
  textShadow: [
    `0 0 ${18 * strength}px color-mix(in oklch, ${THEME.accent} 70%, transparent)`,
    `0 0 ${48 * strength}px color-mix(in oklch, ${THEME.accent} 35%, transparent)`,
    `0 4px 18px ${THEME.background}`,
  ].join(", "),
})
