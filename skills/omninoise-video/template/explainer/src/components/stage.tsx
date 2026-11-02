import React from "react"
import { AbsoluteFill } from "remotion"

import { useLocale } from "../content/use-copy"
import { bodyFamilyFor } from "../fonts"
import { THEME } from "../generated/theme"
import { HEIGHT } from "../generated/timeline"
import { Backdrop } from "./kinetic"
import { LAYOUT, Reveal, SAFE, SIZE } from "./primitives"

/**
 * The frame every scene is built inside: page tint, safe area, and the one
 * heading the viewer should read first.
 *
 * The footnote is PINNED to the bottom safe edge, out of the flow. In the flow
 * it reserved its height from the moment the scene mounted, so every scene
 * centred its content in a box that stopped ~200px short of the frame — ink
 * clustered high with a dead band underneath, which reads as a misaligned frame
 * rather than as a deliberate margin. Out of flow, `justifyContent: center`
 * means the middle of the picture.
 *
 * Scenes hand over `heading` and `footnote` rather than laying them out, so
 * every scene in the cut shares a rhythm without repeating a flexbox.
 */
export const Stage: React.FC<{
  name: string
  heading?: string
  headingAt?: number
  footnote?: string
  footnoteAt?: number
  /**
   * Space to keep clear at the bottom for the pinned footnote. Only a scene
   * whose content actually reaches the bottom needs it; a sparse scene leaves
   * it 0 and centres in the full frame, which is the point of pinning.
   */
  contentInsetBottom?: number
  /** Replaces the drawn backdrop, e.g. a Codex-painted `<Plate>` (see ./plate). */
  background?: React.ReactNode
  children: React.ReactNode
}> = ({
  name,
  heading,
  headingAt = 0,
  footnote,
  footnoteAt = 0,
  contentInsetBottom = 0,
  background,
  children,
}) => {
  const locale = useLocale()

  return (
    <AbsoluteFill
      name={name}
      style={{
        backgroundColor: THEME.background,
        color: THEME.foreground,
        fontFamily: bodyFamilyFor[locale],
      }}
    >
      {background ?? <Backdrop />}
      <AbsoluteFill
        style={{
          padding: `${LAYOUT.contentTop}px ${SAFE.x}px ${HEIGHT - LAYOUT.contentBottom}px`,
          display: "flex",
          flexDirection: "column",
          gap: 40,
        }}
      >
      {heading ? (
        <Reveal name="Heading" at={headingAt}>
          <h2
            style={{
              margin: 0,
              fontWeight: 700,
              fontSize: SIZE.heading,
              lineHeight: 1.15,
              letterSpacing: "-0.015em",
              maxWidth: 936,
              textWrap: "balance",
            }}
          >
            {heading}
          </h2>
        </Reveal>
      ) : null}

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          paddingBottom: contentInsetBottom,
        }}
      >
        {children}
      </div>

      {footnote ? (
        <Reveal
          name="Footnote"
          at={footnoteAt}
          style={{ position: "absolute", left: SAFE.x, right: SAFE.x, bottom: SAFE.bottom }}
        >
          <p
            style={{
              margin: 0,
              fontSize: SIZE.body,
              lineHeight: 1.45,
              color: THEME.muted,
              maxWidth: 936,
            }}
          >
            {footnote}
          </p>
        </Reveal>
      ) : null}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
