import React from "react"
import { AbsoluteFill, Img, staticFile } from "remotion"

import { bodyFamily, monoFamily } from "./fonts"
import type { Brand } from "./spec"
import { mix, SIZE, THEME } from "./theme"

type FrameProps = {
  series: string
  brand: Brand
  index: number
  total: number
  /** Cover shows the swipe hint. */
  swipe?: boolean
  children: React.ReactNode
}

/** The one template every slide sits in: brand header, series kicker, footer. */
export const Frame: React.FC<FrameProps> = ({ series, brand, index, total, swipe, children }) => (
  <AbsoluteFill
    style={{
      fontFamily: bodyFamily,
      color: THEME.foreground,
      backgroundColor: THEME.background,
      backgroundImage: [
        `radial-gradient(80% 45% at 15% 0%, ${mix(THEME.accent, 16)}, transparent 70%)`,
        `radial-gradient(70% 40% at 100% 100%, ${mix(THEME.accent, 8)}, transparent 70%)`,
        `linear-gradient(165deg, oklch(18% 0.035 165) 0%, oklch(14% 0.02 165) 50%, oklch(13% 0.004 210) 100%)`,
      ].join(", "),
    }}
  >
    <div style={{ position: "absolute", left: SIZE.margin, top: 54, display: "flex", alignItems: "center", gap: 18 }}>
      <Img src={staticFile("brand/logo.png")} style={{ width: 64, height: 64, borderRadius: 14, opacity: 0.85 }} />
      <span style={{ fontSize: 28, fontWeight: 600, color: mix(THEME.foreground, 80) }}>{brand.name}</span>
    </div>
    <div
      style={{
        position: "absolute",
        right: SIZE.margin,
        top: 54,
        height: 64,
        display: "flex",
        alignItems: "center",
        fontFamily: monoFamily,
        fontSize: 28,
        color: THEME.muted,
      }}
    >
      {index}/{total}
    </div>
    <div
      style={{
        position: "absolute",
        left: SIZE.margin,
        top: 142,
        fontSize: 26,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color: THEME.accent,
      }}
    >
      {series}
    </div>
    {children}
    <div
      style={{
        position: "absolute",
        left: SIZE.margin,
        bottom: 54,
        fontSize: 25,
        color: mix(THEME.muted, 85),
        fontWeight: 400,
      }}
    >
      {brand.footer}
    </div>
    {swipe ? (
      <div
        style={{
          position: "absolute",
          right: SIZE.margin,
          bottom: 40,
          fontSize: 56,
          fontWeight: 600,
          color: THEME.accent,
          lineHeight: 1,
        }}
      >
        →
      </div>
    ) : null}
  </AbsoluteFill>
)

/** Region between the kicker and the footer; slides lay out inside it. */
export const Body: React.FC<{ top?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({
  top = 214,
  style,
  children,
}) => (
  <div
    style={{
      position: "absolute",
      left: SIZE.margin,
      right: SIZE.margin,
      top,
      bottom: SIZE.height - 1226,
      display: "flex",
      flexDirection: "column",
      ...style,
    }}
  >
    {children}
  </div>
)

export const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 64 }) => (
  <h1 style={{ margin: 0, fontSize: size, lineHeight: 1.14, fontWeight: 700, letterSpacing: "-0.01em" }}>{children}</h1>
)

/** Highlighted strip pinned to the bottom of the body. */
export const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      marginTop: "auto",
      border: `2px solid ${THEME.accent}`,
      background: mix(THEME.accent, 10),
      borderRadius: 20,
      padding: "22px 30px",
      fontSize: 31,
      lineHeight: 1.35,
      fontWeight: 600,
    }}
  >
    {children}
  </div>
)
