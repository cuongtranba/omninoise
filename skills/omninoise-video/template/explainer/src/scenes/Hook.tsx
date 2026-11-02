import type React from "react"

import { Pop, Slide } from "../components/kinetic"
import { Grain, LightSweep, Plate, glow } from "../components/plate"
import { SIZE } from "../components/primitives"
import { Stage } from "../components/stage"
import { useCopy } from "../content/use-copy"
import { THEME } from "../generated/theme"
import { at } from "../timing"
import type { SceneComponent } from "./types"

// Spoken: "One idea," (0 - 0.4) "painted and built in a minute." (0.4 - 1).
// Cold open: the first headline line is on screen inside the first second.
// Cues are fractions of the scene, never frame counts, so a translation re-times itself.
const CUE = { top: 0.02, bottom: 0.4 }

export const Scene: SceneComponent = ({ durationInFrames }) => {
  const { hook } = useCopy()

  return (
    <Stage
      name="Hook"
      background={
        <>
          <Plate src="hook.jpg" durationInFrames={durationInFrames} zoom={[1.0, 1.22]} pan={[-30, 60]} dim={0.05} />
          <LightSweep at={2} frames={30} />
          <Grain />
        </>
      }
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 40, paddingBottom: 220 }}>
        <Line text={hook.top} at={at(CUE.top, durationInFrames)} />
        <Line text={hook.bottom} at={at(CUE.bottom, durationInFrames)} accent />
      </div>
    </Stage>
  )
}

const Line: React.FC<{ text: string; at: number; accent?: boolean }> = ({ text, at: cue, accent }) => (
  <Slide at={cue} x={-80}>
    <Pop at={cue + 3} from={0.6} rotate={-4}>
      <span
        style={{
          display: "block",
          fontSize: SIZE.hero,
          fontWeight: 700,
          lineHeight: 0.95,
          letterSpacing: "-0.04em",
          color: accent ? THEME.accent : THEME.foreground,
          ...glow(1.2),
        }}
      >
        {text}
      </span>
    </Pop>
  </Slide>
)
