import React, { useMemo } from "react"
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion"

import { ALIGNMENT } from "../captions-data"
import { captionAt, captionTrack, type CaptionSegment } from "../captions"
import { useCopy, useLocale } from "../content/use-copy"
import { bodyFamilyFor } from "../fonts"
import { THEME } from "../generated/theme"
import { LAYOUT, SAFE, SIZE } from "./primitives"
import { useSpring } from "./kinetic"

/**
 * Burned-in captions: 1 to 3 words at a time, the word being spoken in the
 * accent. Most viewers watch muted, so this is the video's primary text.
 *
 * Sits in the lower-middle band (y 1240-1460), above the platform's bottom UI.
 * A dark plate and a stroke keep it readable on any scene.
 */
export const Captions: React.FC<{ segments: readonly CaptionSegment[] }> = ({ segments }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const locale = useLocale()

  const track = useMemo(
    () => captionTrack(segments, ALIGNMENT[locale], fps),
    [segments, locale, fps],
  )
  const shown = captionAt(track, frame)
  // Re-keying on the beat restarts the pop for every new caption.
  return shown ? <CaptionBeatView key={shown.beat.from} {...shown} /> : null
}

const CaptionBeatView: React.FC<{
  beat: { readonly from: number; readonly words: readonly { readonly text: string }[] }
  active: number
}> = ({ beat, active }) => {
  const progress = useSpring(beat.from, { damping: 12, stiffness: 260 })
  const locale = useLocale()

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: SAFE.x,
          right: SAFE.x,
          top: LAYOUT.captionTop,
          height: LAYOUT.captionHeight,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            transform: `scale(${0.86 + 0.14 * progress})`,
            fontFamily: bodyFamilyFor[locale],
            fontSize: SIZE.heading,
            fontWeight: 700,
            lineHeight: 1.12,
            textAlign: "center",
            letterSpacing: "-0.01em",
            padding: "14px 38px 18px",
            borderRadius: 32,
            backgroundColor: `color-mix(in oklch, ${THEME.background} 80%, transparent)`,
            WebkitTextStroke: `8px ${THEME.background}`,
            paintOrder: "stroke fill",
            maxWidth: "100%",
          }}
        >
          {beat.words.map((word, index) => (
            <React.Fragment key={index}>
              {index > 0 ? " " : null}
              <span style={{ color: index === active ? THEME.accent : THEME.foreground }}>
                {word.text}
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** A thin bar directly under the top safe area, filling as the video plays. */
export const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.x,
        right: SAFE.x,
        top: LAYOUT.bar.top,
        height: LAYOUT.bar.height,
        borderRadius: 999,
        backgroundColor: `color-mix(in oklch, ${THEME.foreground} 18%, transparent)`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
          height: "100%",
          backgroundColor: THEME.accent,
        }}
      />
    </div>
  )
}

/** The channel's mark (public/brand/logo.png), top-left inside the safe area, on every frame. */
export const Brand: React.FC = () => (
  <Img
    src={staticFile("brand/logo.png")}
    style={{
      position: "absolute",
      left: SAFE.x,
      top: LAYOUT.logo.top,
      width: LAYOUT.logo.size,
      height: LAYOUT.logo.size,
      borderRadius: 16,
      opacity: LAYOUT.logo.opacity,
    }}
  />
)

/**
 * The pictures are painted by Codex, so every frame says so: a small
 * label top-right, level with the logo, inside the safe area.
 */
export const ArtLabel: React.FC = () => {
  const { artLabel } = useCopy()
  const locale = useLocale()
  return (
    <span
      style={{
        fontFamily: bodyFamilyFor[locale],
        position: "absolute",
        right: SAFE.x,
        top: LAYOUT.logo.top + 18,
        padding: "6px 16px 8px",
        borderRadius: 999,
        fontSize: 26,
        fontWeight: 600,
        color: THEME.foreground,
        opacity: 0.8,
        backgroundColor: `color-mix(in oklch, ${THEME.background} 70%, transparent)`,
        border: `2px solid ${THEME.border}`,
      }}
    >
      {artLabel}
    </span>
  )
}

/** Everything that stays put while scenes change: progress, logo, AI-art label and captions. */
export const Overlay: React.FC<{
  segments: readonly CaptionSegment[]
  progress?: boolean
}> = ({ segments, progress = true }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    {progress ? <ProgressBar /> : null}
    <Brand />
    <ArtLabel />
    <Captions segments={segments} />
  </AbsoluteFill>
)
