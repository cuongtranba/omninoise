import { Diagram, type DiagramGraph } from "../components/diagram"
import { Rule } from "../components/primitives"
import { Stage } from "../components/stage"
import { THEME } from "../generated/theme"
import { at } from "../timing"
import type { SceneComponent } from "./types"

// `walked` ends the build-up well before the scene does, so the finished graph
// is on screen — and carrying — while the narration explains it.
const CUE = { walk: 0.15, walked: 0.6 }

const graph: DiagramGraph = {
  nodes: [
    { id: "input", position: { x: 0, y: 0 }, width: 220, height: 72, data: { label: "Input" } },
    { id: "process", position: { x: 300, y: 0 }, width: 220, height: 72, data: { label: "Process" } },
    { id: "output", position: { x: 600, y: 0 }, width: 220, height: 72, data: { label: "Output" } },
  ],
  edges: [
    { id: "e1", source: "input", target: "process" },
    { id: "e2", source: "process", target: "output" },
  ],
}

export const Scene: SceneComponent = ({ durationInFrames, leadFrames }) => (
  <Stage name="FlowTemplate" heading="Replace this heading">
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

      <Diagram
          name="Pipeline"
          graph={graph}
          height={620}
          reveal={{ at: at(CUE.walk, durationInFrames), through: at(CUE.walked, durationInFrames) }}
          // Drop `flow` when the edges are relationships rather than traffic;
          // keep it when something actually travels them, which is most of the
          // time a pipeline is worth a scene. Per-edge: `flowing: false`.
          flow
      />
    </div>
  </Stage>
)
