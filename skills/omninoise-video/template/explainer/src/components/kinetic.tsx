import React from "react"
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"

import { THEME } from "../generated/theme"
import { EASE_OUT } from "./primitives"

/**
 * Short-form motion. Every sentence gets something that moves, and each piece
 * is a pure function of the frame: springs and interpolations, never a clock or
 * a random number, so a still and a render agree (CHK-28).
 */

interface SpringConfig {
  readonly damping: number
  readonly stiffness: number
  readonly mass: number
}

const SPRING: SpringConfig = { damping: 14, stiffness: 190, mass: 0.7 }

/** 0 before `at`, then a spring that overshoots slightly toward 1. */
export const useSpring = (at: number, config: Partial<SpringConfig> = {}): number => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - at, fps, config: { ...SPRING, ...config } })
}

/** Scales and fades in with a bounce: the default entrance for a card, chip or stamp. */
export const Pop: React.FC<{
  at: number
  from?: number
  rotate?: number
  style?: React.CSSProperties
  children: React.ReactNode
}> = ({ at, from = 0.7, rotate = 0, style, children }) => {
  const frame = useCurrentFrame()
  const progress = useSpring(at)
  const opacity = interpolate(frame, [at, at + 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <div
      style={{
        ...style,
        opacity,
        transform: `scale(${from + (1 - from) * progress}) rotate(${rotate * (1 - progress)}deg)`,
      }}
    >
      {children}
    </div>
  )
}

/** Slides in from the side (or below) on a spring. `x`/`y` are the start offsets in px. */
export const Slide: React.FC<{
  at: number
  x?: number
  y?: number
  style?: React.CSSProperties
  children: React.ReactNode
}> = ({ at, x = 0, y = 0, style, children }) => {
  const frame = useCurrentFrame()
  const progress = useSpring(at, { damping: 16, stiffness: 150 })
  const opacity = interpolate(frame, [at, at + 6], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })

  return (
    <div
      style={{
        ...style,
        opacity,
        transform: `translate(${x * (1 - progress)}px, ${y * (1 - progress)}px)`,
      }}
    >
      {children}
    </div>
  )
}

/** Types `text` out one character at a time, a block cursor following it. */
export const Typewriter: React.FC<{
  text: string
  at: number
  /** Frames the whole string takes. */
  frames: number
  cursor?: boolean
}> = ({ text, at, frames, cursor = true }) => {
  const frame = useCurrentFrame()
  const shown = Math.round(
    interpolate(frame, [at, at + frames], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  )
  const typing = frame >= at && shown < text.length

  return (
    <>
      {text.slice(0, shown)}
      {cursor && typing ? (
        <span
          style={{
            display: "inline-block",
            width: "0.55em",
            height: "1em",
            marginLeft: 4,
            verticalAlign: "text-bottom",
            backgroundColor: THEME.accent,
          }}
        />
      ) : null}
    </>
  )
}

/**
 * A mark drawn as SVG rather than typed as ✓ or ✕: neither glyph is in the
 * body face, and a fallback font would change between machines.
 */
export const Mark: React.FC<{
  kind: "check" | "cross"
  at: number
  size: number
  color?: string
}> = ({ kind, at, size, color = kind === "check" ? THEME.accent : THEME.danger }) => {
  const frame = useCurrentFrame()
  const draw = interpolate(frame, [at, at + 9], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...EASE_OUT),
  })
  const d = kind === "check" ? "M 10 27 L 21 38 L 42 14" : "M 12 12 L 40 40 M 40 12 L 12 40"

  return (
    <svg width={size} height={size} viewBox="0 0 52 52" style={{ flex: "none", overflow: "visible" }}>
      <path
        d={d}
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={draw}
        fill="none"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * The ambient layer under every scene: a slow-drifting glow and a faint grid.
 * It exists so the frame is never flat, and it carries no information.
 */
export const Backdrop: React.FC = () => {
  const frame = useCurrentFrame()
  const x = 50 + 22 * Math.sin(frame / 52)
  const y = 38 + 14 * Math.cos(frame / 67)

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundImage: [
          `radial-gradient(60% 38% at ${x}% ${y}%, color-mix(in oklch, ${THEME.accent} 16%, transparent), transparent 70%)`,
          `linear-gradient(color-mix(in oklch, ${THEME.border} 35%, transparent) 2px, transparent 2px)`,
          `linear-gradient(90deg, color-mix(in oklch, ${THEME.border} 35%, transparent) 2px, transparent 2px)`,
        ].join(", "),
        backgroundSize: "100% 100%, 108px 108px, 108px 108px",
        backgroundPosition: `0 0, 0 ${(frame * 0.6) % 108}px, 0 0`,
      }}
    />
  )
}
