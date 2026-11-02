import React from "react"
import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion"

import { tabular } from "../fonts"
import type { FocusOn } from "../motion-math"
import { countValue, flowDash, focusTransform, staggerOffset } from "../motion-math"
import { THEME } from "../generated/theme"
import { EASE_OUT, Reveal } from "./primitives"

const EMPHASIS_DURATION = 12

export const Stagger: React.FC<{
  name: string
  at: number
  step: number
  durationInFrames: number
  children: React.ReactNode
}> = ({ name, at, step, durationInFrames, children }) => {
  const childArray = React.Children.toArray(children)
  return (
    <Interactive.Div name={name}>
      {childArray.map((child, i) => (
        <Reveal
          key={i}
          name={`${name}-${i}`}
          at={at + staggerOffset(i, step, childArray.length, durationInFrames)}
        >
          {child}
        </Reveal>
      ))}
    </Interactive.Div>
  )
}

export const Trace: React.FC<{
  name: string
  at: number
  until: number
  d: string
  stroke?: string
  strokeWidth?: number
  style?: React.CSSProperties
}> = ({ name, at, until, d, stroke = THEME.accent, strokeWidth = 3, style }) => {
  const frame = useCurrentFrame()
  const dashOffset = interpolate(frame, [at, until], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...EASE_OUT),
  })
  return (
    <Interactive.Div name={name} style={{ position: "absolute", inset: 0, ...style }}>
      <svg width="100%" height="100%" style={{ overflow: "visible" }}>
        <path
          d={d}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={dashOffset}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Interactive.Div>
  )
}

/**
 * Something travelling an edge, on a loop — a request, a record, a packet.
 *
 * `Trace` says the connection exists; `Flow` says it is carrying. Pair them on
 * the same `d` and the edge draws itself in, then starts moving.
 */
export const Flow: React.FC<{
  name: string
  d: string
  at?: number
  /** Frames for one packet to cross the whole path. */
  cycleFrames?: number
  packets?: number
  /**
   * `dashes` marches the whole edge, the way an animated React Flow edge reads —
   * best when the point is that traffic is continuous. `packets` sends a couple
   * of discrete blips, for when the point is the individual message.
   */
  mode?: "dashes" | "packets"
  stroke?: string
  strokeWidth?: number
  style?: React.CSSProperties
}> = ({
  name,
  d,
  at = 0,
  cycleFrames = 45,
  packets,
  mode = "dashes",
  stroke = THEME.foreground,
  strokeWidth = 4,
  style,
}) => {
  const frame = useCurrentFrame()
  const count = packets ?? (mode === "dashes" ? 9 : 2)
  const duty = mode === "dashes" ? 0.55 : 0.38
  const { dasharray, dashoffset } = flowDash(frame, at, cycleFrames, count, duty)

  if (frame < at) {
    return null
  }

  return (
    <Interactive.Div name={name} style={{ position: "absolute", inset: 0, ...style }}>
      <svg width="100%" height="100%" style={{ overflow: "visible" }}>
        <path
          d={d}
          pathLength={1}
          strokeDasharray={dasharray}
          strokeDashoffset={dashoffset}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    </Interactive.Div>
  )
}

export const Focus: React.FC<{
  name: string
  at: number
  on: FocusOn
  style?: React.CSSProperties
  children: React.ReactNode
}> = ({ name, at, on, style, children }) => {
  const frame = useCurrentFrame()
  const t = focusTransform(frame, at, on)
  return (
    <Interactive.Div
      name={name}
      style={{
        ...style,
        transformOrigin: `${on.x}px ${on.y}px`,
        transform: `scale(${t.scale})`,
      }}
    >
      {children}
    </Interactive.Div>
  )
}

export const Emphasis: React.FC<{
  name: string
  at: number
  kind: "underline" | "tint" | "weight"
  children: React.ReactNode
}> = ({ name, at, kind, children }) => {
  const frame = useCurrentFrame()
  const progress = interpolate(frame, [at, at + EMPHASIS_DURATION], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...EASE_OUT),
  })

  if (kind === "underline") {
    return (
      <Interactive.Div name={name} style={{ position: "relative", display: "inline-block" }}>
        {children}
        <span
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: 2,
            backgroundColor: THEME.accent,
            transformOrigin: "left center",
            transform: `scaleX(${progress})`,
          }}
        />
      </Interactive.Div>
    )
  }

  if (kind === "tint") {
    return (
      <Interactive.Div
        name={name}
        style={{
          position: "relative",
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 4,
          fontStyle: progress > 0 ? "italic" : "normal",
        }}
      >
        <span
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: THEME.accent,
            borderRadius: 4,
            opacity: progress * 0.18,
            pointerEvents: "none",
          }}
        />
        {children}
      </Interactive.Div>
    )
  }

  return (
    <Interactive.Div
      name={name}
      style={{
        display: "inline-block",
        fontWeight: frame >= at ? 700 : 400,
        opacity: frame >= at
          ? interpolate(frame, [at, at + EMPHASIS_DURATION], [0.6, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(...EASE_OUT),
            })
          : 1,
      }}
    >
      {children}
    </Interactive.Div>
  )
}

export const Count: React.FC<{
  name: string
  at: number
  until: number
  from: number
  to: number
  format?: (value: number) => string
  style?: React.CSSProperties
}> = ({ name, at, until, from, to, format = (n) => String(Math.round(n)), style }) => {
  const frame = useCurrentFrame()
  const value = countValue(frame, at, until, from, to)
  return (
    <Interactive.Div name={name} style={{ display: "inline", ...style, ...tabular }}>
      {format(value)}
    </Interactive.Div>
  )
}
