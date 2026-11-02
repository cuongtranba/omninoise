import { registerRoot } from "remotion"

import { RemotionRoot } from "./Root"

registerRoot(RemotionRoot)

export { Count, Emphasis, Flow, Focus, Stagger, Trace } from "./components/motion"
export { Beam, Datastore, Rack, Space } from "./components/space"
export { Diagram } from "./components/diagram"
export { THEME_3D, toThreeColor } from "./color"
export type {
  FlowDash,
  FocusOn,
  FocusTransformResult,
  WalkEdge,
  WalkSchedule,
  WalkWindow,
} from "./motion-math"
export {
  countValue,
  flowDash,
  focusTransform,
  packetPhases,
  staggerOffset,
  turntableRotation,
  walkSchedule,
} from "./motion-math"
