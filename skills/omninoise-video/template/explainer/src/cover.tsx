/**
 * Cover art for the platforms, rendered as stills from the same theme and faces
 * as the cut, so a thumbnail never drifts from the video it sells.
 *
 * - `Cover` 1080x1920: Instagram Reels cover (`cover_url`), and the frame to pick
 *   by hand on TikTok and Facebook. The words sit inside the centre 1080x1350,
 *   which is what Instagram's 4:5 profile grid shows.
 * - `Thumb` 1280x720: the YouTube custom thumbnail.
 *
 * Per video, only `COVERS` changes: for each locale, the hook split into lines
 * (the `accent` lines are drawn in the accent colour) and the series label. The
 * Vietnamese cut has its own pair (`Cover-vi`, `Thumb-vi`), since the Vietnamese
 * file is the one posted to Facebook and TikTok.
 */
import React from "react"
import { AbsoluteFill, Img, staticFile } from "remotion"

import { bodyFamilyFor } from "./fonts"
import { THEME } from "./generated/theme"
import type { Locale } from "./generated/timeline"

type CoverCopy = {
  lines: readonly { text: string; accent?: boolean }[]
  series: string
  /** Path under public/, drawn full-bleed under a dark scrim. */
  background?: string
}

export const COVERS: Readonly<Record<Locale, CoverCopy>> = {
  en: {
    lines: [{ text: "One idea," }, { text: "painted and built", accent: true }, { text: "in a minute." }],
    series: "Example series",
    background: "art/hook.jpg",
  },
  vi: {
    lines: [{ text: "Một ý tưởng," }, { text: "vẽ và dựng xong", accent: true }, { text: "trong một phút." }],
    series: "Chuyên mục mẫu",
    background: "art/hook.jpg",
  },
}

const Grid: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: THEME.background,
      backgroundImage: [
        `radial-gradient(70% 45% at 50% 42%, color-mix(in oklch, ${THEME.accent} 22%, transparent), transparent 70%)`,
        `linear-gradient(color-mix(in oklch, ${THEME.border} 35%, transparent) 2px, transparent 2px)`,
        `linear-gradient(90deg, color-mix(in oklch, ${THEME.border} 35%, transparent) 2px, transparent 2px)`,
      ].join(", "),
      backgroundSize: "100% 100%, 108px 108px, 108px 108px",
    }}
  />
)

const Background: React.FC<{ cover: CoverCopy }> = ({ cover }) =>
  cover.background ? (
    <AbsoluteFill>
      <Img src={staticFile(cover.background)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, color-mix(in oklch, ${THEME.background} 55%, transparent) 0%, color-mix(in oklch, ${THEME.background} 88%, transparent) 55%, ${THEME.background} 100%)`,
        }}
      />
    </AbsoluteFill>
  ) : (
    <Grid />
  )

const Brand: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ display: "flex", alignItems: "center", gap: size * 0.35 }}>
    <Img src={staticFile("brand/logo.png")} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
    <span style={{ fontSize: size * 0.42, fontWeight: 700, color: THEME.foreground, letterSpacing: "-0.01em" }}>
      Example Channel
    </span>
  </div>
)

const Series: React.FC<{ size: number; cover: CoverCopy }> = ({ size, cover }) => (
  <span
    style={{
      alignSelf: "flex-start",
      padding: `${size * 0.3}px ${size * 0.7}px`,
      borderRadius: 999,
      border: `3px solid ${THEME.accent}`,
      color: THEME.accent,
      fontSize: size,
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    }}
  >
    {cover.series}
  </span>
)

const Hook: React.FC<{ size: number; cover: CoverCopy }> = ({ size, cover }) => (
  <h1 style={{ margin: 0, fontSize: size, fontWeight: 700, lineHeight: 1.02, letterSpacing: "-0.03em" }}>
    {cover.lines.map((line) => (
      <span key={line.text} style={{ display: "block", color: line.accent ? THEME.accent : THEME.foreground }}>
        {line.text}
      </span>
    ))}
  </h1>
)

export const Cover: React.FC<{ locale: Locale }> = ({ locale }) => (
  <AbsoluteFill style={{ fontFamily: bodyFamilyFor[locale], color: THEME.foreground }}>
    <Background cover={COVERS[locale]} />
    {/* Brand above the 4:5 crop, words inside it (y 285 to 1635). */}
    <AbsoluteFill style={{ padding: "150px 90px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <Brand size={110} />
      <div style={{ display: "flex", flexDirection: "column", gap: 56, paddingBottom: 260 }}>
        <Series size={40} cover={COVERS[locale]} />
        <Hook size={108} cover={COVERS[locale]} />
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
)

export const Thumb: React.FC<{ locale: Locale }> = ({ locale }) => (
  <AbsoluteFill style={{ fontFamily: bodyFamilyFor[locale], color: THEME.foreground }}>
    <Background cover={COVERS[locale]} />
    {/* The mark fills the empty right half; it stays behind the words. */}
    <Img
      src={staticFile("brand/logo.png")}
      style={{ position: "absolute", right: 60, top: 170, width: 330, height: 330, borderRadius: 72, opacity: 0.9 }}
    />
    <AbsoluteFill style={{ padding: "56px 72px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
      <Brand size={72} />
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        <Series size={26} cover={COVERS[locale]} />
        {/* Four lines need a smaller size to fit the 720 px height. */}
        <Hook size={COVERS[locale].lines.length > 3 ? 78 : 94} cover={COVERS[locale]} />
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
)
