import { Reveal, Rule, SIZE } from "../components/primitives"
import { Stage } from "../components/stage"
import { THEME } from "../generated/theme"
import { at } from "../timing"
import type { SceneComponent } from "./types"

/**
 * What `nv init --scene <Id>` copies. Rename the file, not the export.
 *
 * The export MUST stay `Scene`: src/generated/registry.ts is written as
 * `import { Scene as <Id> }`, so a renamed or defaulted export is a compile
 * error in a generated file rather than an undefined component at frame 240.
 *
 * On-screen strings belong in content/<locale>.yaml under `copy`, read here
 * through `useCopy()` — never taken as a prop. Add your section there, run
 * `nv sync`, and `const { yourSection } = useCopy()` is typed.
 */

/** Reveal cues, as fractions of the scene. Never frame counts — see ../timing. */
const CUE = { detail: 0.45 }

export const Scene: SceneComponent = ({ durationInFrames, leadFrames }) => (
  <Stage name="Template" heading="Replace this heading">
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 36,
      }}
    >
      {/*
        Cued at `leadFrames`: the lead is the silence before the line starts, so
        this lands exactly as the voice does. Anything that must already be on
        screen when the sentence begins is cued at 0 instead.
      */}
      <Rule at={leadFrames} width={520} color={THEME.accent} />

      <Reveal name="Detail" at={at(CUE.detail, durationInFrames)}>
        <p
          style={{
            margin: 0,
            fontSize: SIZE.lead,
            lineHeight: 1.4,
            color: THEME.muted,
            maxWidth: 1400,
          }}
        >
          Replace this line, and cue the next one as a fraction of the scene.
        </p>
      </Reveal>
    </div>
  </Stage>
)
