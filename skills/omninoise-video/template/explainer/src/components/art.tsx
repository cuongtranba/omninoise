import React from "react"
import { Easing, interpolate, useCurrentFrame } from "remotion"

import { THEME } from "../generated/theme"
import { EASE_OUT, RADIUS, SIZE } from "./primitives"

/**
 * Pictures drawn in code for explainers: a video tile, channel chips with upload bars, a
 * calendar grid, a clock, a moon, avatars and a bar chart. Illustrations only; nothing here is
 * a screenshot, and no real account, post or media is drawn. Every piece is a pure function of
 * the frame.
 */

/** 0 before `from`, 1 after `to`, eased between. */
export const ramp = (frame: number, from: number, to: number): number =>
  interpolate(frame, [from, to], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...EASE_OUT),
  })

/** Linear 0 to 1, for things that should not ease (a meter draining, a spinner). */
export const lerp = (frame: number, from: number, to: number): number =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })

/** Fades a layer in at `from` and out at `until`, so one scene can hold several pictures. */
export const Layer: React.FC<{
  from: number
  until?: number
  style?: React.CSSProperties
  children: React.ReactNode
}> = ({ from, until = Number.MAX_SAFE_INTEGER, style, children }) => {
  const frame = useCurrentFrame()
  // Overlapping cross-fade: the next picture is already coming in while this one leaves.
  const opacity = interpolate(frame, [from - 4, from + 4, until - 4, until + 4], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  })
  if (opacity <= 0) return null
  return <div style={{ position: "absolute", inset: 0, opacity, ...style }}>{children}</div>
}

/** A rounded label chip: a goal, a check, a status. */
export const Chip: React.FC<{
  label: string
  tint?: string
  fill?: number
  size?: number
  style?: React.CSSProperties
  children?: React.ReactNode
}> = ({ label, tint = THEME.accent, fill = 0, size = SIZE.lead, style, children }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 18,
      padding: "12px 34px 16px",
      borderRadius: 999,
      border: `5px solid ${tint}`,
      color: fill > 0.5 ? THEME.background : THEME.foreground,
      backgroundColor: `color-mix(in oklch, ${tint} ${fill * 100}%, ${THEME.surface})`,
      fontSize: size,
      fontWeight: 700,
      whiteSpace: "nowrap",
      ...style,
    }}
  >
    {children}
    {label}
  </div>
)

/** A caption line under or beside a picture. */
export const Label: React.FC<{ children: React.ReactNode; color?: string; size?: number; style?: React.CSSProperties }> = ({
  children,
  color = THEME.muted,
  size = SIZE.body,
  style,
}) => (
  <span style={{ fontSize: size, fontWeight: 600, color, lineHeight: 1.15, ...style }}>{children}</span>
)

/** A video: a tall rounded tile with a play triangle. `tint` outlines it. */
export const VideoTile: React.FC<{ width: number; tint?: string; label?: string }> = ({ width, tint = THEME.accent, label }) => (
  <div
    style={{
      width,
      height: width * 1.5,
      boxSizing: "border-box",
      borderRadius: RADIUS.lg,
      border: `${Math.max(4, width * 0.035)}px solid ${tint}`,
      backgroundColor: THEME.surface,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: width * 0.08,
    }}
  >
    <svg width={width * 0.42} height={width * 0.42} viewBox="0 0 40 40" style={{ overflow: "visible" }}>
      <path d="M 10 5 L 10 35 L 34 20 Z" fill={tint} stroke={tint} strokeWidth={4} strokeLinejoin="round" />
    </svg>
    {label ? <Label size={Math.max(30, width * 0.17)}>{label}</Label> : null}
  </div>
)

/** A channel chip: a round monogram dot and the platform name, as plain text. */
export const ChannelChip: React.FC<{ label: string; tint?: string; fill?: number; size?: number; style?: React.CSSProperties }> = ({
  label,
  tint = THEME.foreground,
  fill = 0,
  size = SIZE.body,
  style,
}) => (
  <Chip
    label={label}
    tint={tint}
    fill={fill}
    size={size}
    style={{ padding: "10px 30px 14px 14px", gap: 16, ...style }}
  >
    <span
      style={{
        width: size * 1.05,
        height: size * 1.05,
        borderRadius: 999,
        flex: "none",
        backgroundColor: fill > 0.5 ? THEME.background : tint,
        color: fill > 0.5 ? tint : THEME.background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.62,
        fontWeight: 700,
      }}
    >
      {label.slice(0, 1)}
    </span>
  </Chip>
)

/** An upload bar: a rail with a fill of `progress` (0 to 1) and a label. */
export const UploadBar: React.FC<{ progress: number; width: number; label: string; tint?: string }> = ({
  progress,
  width,
  label,
  tint = THEME.accent,
}) => (
  <div style={{ width, display: "flex", flexDirection: "column", gap: 10 }}>
    <div style={{ height: 26, borderRadius: 13, backgroundColor: THEME.border, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${progress * 100}%`, borderRadius: 13, backgroundColor: tint }} />
    </div>
    <Label size={SIZE.label}>{label}</Label>
  </div>
)

/** A month grid (7 columns), a few cells lit. `lit` maps a cell index to a tint and a 0 to 1 amount. */
export const CalendarGrid: React.FC<{
  width: number
  rows: number
  lit?: Readonly<Record<number, { tint: string; amount: number }>>
}> = ({ width, rows, lit = {} }) => {
  const gap = 8
  const cell = (width - gap * 6) / 7
  return (
    <div style={{ width, display: "grid", gridTemplateColumns: `repeat(7, ${cell}px)`, gap }}>
      {Array.from({ length: 7 * rows }, (_, i) => {
        const l = lit[i]
        return (
          <div
            key={i}
            style={{
              height: cell * 0.82,
              borderRadius: RADIUS.md,
              boxSizing: "border-box",
              border: `3px solid color-mix(in oklch, ${l?.tint ?? THEME.border} ${(l?.amount ?? 0) * 100}%, ${THEME.border})`,
              backgroundColor: `color-mix(in oklch, ${l?.tint ?? THEME.surface} ${(l?.amount ?? 0) * 40}%, ${THEME.background})`,
            }}
          />
        )
      })}
    </div>
  )
}

/** An analog clock. `hour` is 0 to 12 (fractions allowed), `minute` 0 to 60. */
export const Clock: React.FC<{ size: number; hour: number; minute: number; tint?: string }> = ({ size, hour, minute, tint = THEME.accent }) => {
  const m = (minute / 60) * 360
  const h = ((hour % 12) / 12) * 360 + (minute / 60) * 30
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: "visible" }}>
      <circle cx={100} cy={100} r={92} fill={THEME.surface} stroke={tint} strokeWidth={9} />
      {Array.from({ length: 12 }, (_, i) => (
        <line key={i} x1={100} y1={18} x2={100} y2={i % 3 === 0 ? 34 : 27} stroke={THEME.muted} strokeWidth={i % 3 === 0 ? 7 : 4} strokeLinecap="round" transform={`rotate(${i * 30} 100 100)`} />
      ))}
      <line x1={100} y1={100} x2={100} y2={52} stroke={THEME.foreground} strokeWidth={10} strokeLinecap="round" transform={`rotate(${h} 100 100)`} />
      <line x1={100} y1={100} x2={100} y2={30} stroke={tint} strokeWidth={7} strokeLinecap="round" transform={`rotate(${m} 100 100)`} />
      <circle cx={100} cy={100} r={9} fill={tint} />
    </svg>
  )
}

/** A crescent moon with two stars. */
export const Moon: React.FC<{ size: number; tint?: string }> = ({ size, tint = THEME.foreground }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" style={{ overflow: "visible" }}>
    <path d="M 128 22 A 80 80 0 1 0 178 128 A 62 62 0 1 1 128 22 Z" fill={tint} />
    <path d="M 160 36 l 5 12 12 5 -12 5 -5 12 -5 -12 -12 -5 12 -5 Z" fill={THEME.accent} />
    <path d="M 186 86 l 3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill={THEME.accent} />
  </svg>
)

/** A person: head and shoulders in a circle. */
export const Avatar: React.FC<{ size: number; tint: string }> = ({ size, tint }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
    <circle cx={50} cy={50} r={46} fill={THEME.surface} stroke={tint} strokeWidth={6} />
    <circle cx={50} cy={40} r={16} fill={tint} />
    <path d="M 20 82 C 24 62 76 62 80 82 C 70 92 30 92 20 82 Z" fill={tint} />
  </svg>
)

/** A rising bar chart. `progress` (0 to 1) grows every bar toward its drawn height. */
export const BarChart: React.FC<{ width: number; height: number; heights: readonly number[]; progress: readonly number[] }> = ({
  width,
  height,
  heights,
  progress,
}) => {
  const gap = 22
  const bar = (width - gap * (heights.length - 1)) / heights.length
  return (
    <div style={{ width, height, display: "flex", alignItems: "flex-end", gap, borderBottom: `4px solid ${THEME.muted}` }}>
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            width: bar,
            height: height * h * (progress[i] ?? 0),
            borderRadius: `${RADIUS.md}px ${RADIUS.md}px 0 0`,
            backgroundColor: i === heights.length - 1 ? THEME.accent : `color-mix(in oklch, ${THEME.accent} 45%, ${THEME.surface})`,
          }}
        />
      ))}
    </div>
  )
}

/** A checkbox that ticks (`amount` 0 to 1). */
export const Checkbox: React.FC<{ size: number; amount: number }> = ({ size, amount }) => (
  <svg width={size} height={size} viewBox="0 0 52 52" style={{ flex: "none", overflow: "visible" }}>
    <rect x={3} y={3} width={46} height={46} rx={9} fill={`color-mix(in oklch, ${THEME.accent} ${amount * 100}%, transparent)`} stroke={amount > 0.5 ? THEME.accent : THEME.muted} strokeWidth={5} />
    <path d="M 12 27 L 22 37 L 41 15" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - amount} fill="none" stroke={THEME.background} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** A skeleton line: text drawn as a bar, so no real words are needed. */
export const Bar: React.FC<{ width: string | number; tint?: string }> = ({ width, tint = THEME.border }) => (
  <div style={{ height: 14, width, borderRadius: 7, backgroundColor: tint }} />
)
