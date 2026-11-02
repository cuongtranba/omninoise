import React from "react"
import { AbsoluteFill } from "remotion"

import { monoFamily, tabular } from "../fonts"
import { THEME } from "../generated/theme"
import { TIMELINE, type Locale } from "../generated/timeline"
import { RADIUS, SAFE, SIZE } from "./primitives"

/**
 * Marks a cut whose scene lengths are guesses.
 *
 * A scene with no measured audio is timed from a character count — accurate to
 * roughly ±15%, fine for reviewing layout, wrong for anything anyone will
 * watch. There is no prop to turn this off and it renders in `remotion render`
 * exactly as it does in Studio, because a silent draft that LOOKS finished is
 * how a wrong cut ships: it leaves the machine looking like the real thing and
 * nobody downstream can tell. Run `nv voiceover` and it disappears on its own.
 */
export const DraftBadge: React.FC<{ locale: Locale }> = ({ locale }) => {
  const timeline = TIMELINE[locale]
  if (timeline.complete) {
    return null
  }

  // A `literal` scene has no line to measure and is not a draft, so it is
  // neither counted against the total nor reported as missing.
  const narrated = timeline.scenes.filter((scene) => scene.source !== "literal")
  const unvoiced = narrated.filter((scene) => scene.source !== "measured" || !scene.hasAudio)

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: SAFE.x,
          bottom: SAFE.bottom,
          backgroundColor: THEME.accent,
          color: THEME.background,
          fontFamily: monoFamily,
          fontSize: SIZE.label,
          fontWeight: 500,
          letterSpacing: "0.01em",
          borderRadius: RADIUS.sm,
          padding: "10px 20px",
          ...tabular,
        }}
      >
        {`UNVOICED — ${unvoiced.length}/${narrated.length} scenes estimated · nv voiceover`}
      </div>
    </AbsoluteFill>
  )
}
