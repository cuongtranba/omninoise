import { useCurrentFrame } from "remotion"

import { THEME_3D } from "../color"
import { Space } from "../components/space"
import { Reveal, Rule } from "../components/primitives"
import { Stage } from "../components/stage"
import { THEME } from "../generated/theme"
import { at } from "../timing"
import type { SceneComponent } from "./types"

/**
 * Two rules this template exists to demonstrate, both of which fail silently:
 *
 * - Materials take `THEME_3D`, never `THEME`. Three.js cannot parse the OKLCH
 *   the config is written in; it warns and leaves the colour white.
 * - `<Space>` owns its own height. A WebGL canvas cannot flex, so wrapping it
 *   in a sized div leaves the canvas at frame size inside a smaller box and the
 *   scene drifts off-centre.
 */

const CUE = { space: 0.2 }

export const Scene: SceneComponent = ({ durationInFrames, leadFrames }) => {
  const frame = useCurrentFrame()
  const rotation = frame * 0.04

  return (
    <Stage name="SpaceTemplate" heading="Replace this heading">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 36,
        }}
      >
        <Rule at={leadFrames} width={520} color={THEME.accent} />

        <Reveal name="Space" at={at(CUE.space, durationInFrames)}>
          <Space name="Cube" height={620} camera={{ position: [0, 0, 4], fov: 60 }}>
            <mesh rotation={[rotation * 0.7, rotation, 0]}>
              <boxGeometry args={[1.5, 1.5, 1.5]} />
              <meshStandardMaterial color={THEME_3D.accent} flatShading />
            </mesh>
          </Space>
        </Reveal>
      </div>
    </Stage>
  )
}
