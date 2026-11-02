export const FOCUS_DURATION = 20

export interface FocusOn {
  readonly x: number
  readonly y: number
  readonly scale: number
}

export interface FocusTransformResult {
  readonly x: number
  readonly y: number
  readonly scale: number
}

export function staggerOffset(
  childIndex: number,
  step: number,
  childCount: number,
  sceneDuration: number,
): number {
  const maxOffset = Math.max(0, sceneDuration - 1)
  const totalSpan = (childCount - 1) * step
  if (totalSpan <= maxOffset) {
    return childIndex * step
  }
  const compressedStep = childCount > 1 ? Math.floor(maxOffset / (childCount - 1)) : 0
  return Math.min(childIndex * compressedStep, maxOffset)
}

export function countValue(
  frame: number,
  atFrame: number,
  untilFrame: number,
  from: number,
  to: number,
): number {
  if (frame <= atFrame) return from
  if (frame >= untilFrame) return to
  const progress = (frame - atFrame) / (untilFrame - atFrame)
  return from + progress * (to - from)
}

/**
 * Fraction of each packet's slot that is drawn. The rest is the gap, so a
 * packet reads as a moving segment rather than a solid line.
 */
const FLOW_DUTY = 0.38

/**
 * How each flow mode spends its slot. Shared so the standalone `<Flow>` and the
 * diagram's own edge renderer cannot drift into looking like two effects.
 */
export const FLOW_MODES = {
  dashes: { packets: 9, duty: 0.55 },
  packets: { packets: 2, duty: 0.38 },
} as const

export type FlowMode = keyof typeof FLOW_MODES

export interface FlowDash {
  /** `stroke-dasharray` for a path drawn with `pathLength={1}`. */
  readonly dasharray: string
  readonly dashoffset: number
}

/**
 * A continuously moving dash pattern along a path, for showing that something
 * travels an edge rather than merely that the edge exists.
 *
 * Normalised against `pathLength={1}`, so nothing is measured from the DOM —
 * a headless renderer never fires the observers that would report a real path
 * length, and a measured animation is one that differs between capture tabs.
 */
export function flowDash(
  frame: number,
  at: number,
  cycleFrames: number,
  packets: number,
  duty: number = FLOW_DUTY,
): FlowDash {
  const count = Math.max(1, Math.floor(packets) || 1)
  const cycle = Math.max(1, cycleFrames)
  const period = 1 / count
  // Clamped away from both ends: at 0 there is no dash to see, at 1 the gaps
  // close and a marching line becomes a solid one that appears not to move.
  const dash = period * Math.min(0.85, Math.max(0.1, duty))
  const travelled = Math.max(0, frame - at) / cycle
  return {
    dasharray: `${dash} ${period - dash}`,
    // Negative, so the pattern advances from source toward target. Reduced
    // modulo one period because the pattern repeats — keeping the number small
    // avoids precision drift over a long scene.
    dashoffset: -(travelled % period),
  }
}

/**
 * Positions of N packets travelling a path, each in `[0, 1)`. The 3D analogue
 * of `flowDash`: a caller places a mesh at `lerp(from, to, phase)`.
 */
export function packetPhases(
  frame: number,
  at: number,
  cycleFrames: number,
  packets: number,
): readonly number[] {
  const count = Math.max(1, Math.floor(packets) || 1)
  const cycle = Math.max(1, cycleFrames)
  const travelled = Math.max(0, frame - at) / cycle
  return Array.from({ length: count }, (_, i) => (travelled + i / count) % 1)
}

/** Y-axis rotation in radians for a turntable, as a pure function of the frame. */
export function turntableRotation(
  frame: number,
  degreesPerFrame: number,
  startDegrees = 0,
): number {
  return ((startDegrees + frame * degreesPerFrame) * Math.PI) / 180
}

export function focusTransform(
  frame: number,
  atFrame: number,
  on: FocusOn,
): FocusTransformResult {
  const progress = Math.min(Math.max((frame - atFrame) / FOCUS_DURATION, 0), 1)
  return {
    x: on.x * progress,
    y: on.y * progress,
    scale: 1 + (on.scale - 1) * progress,
  }
}

/**
 * When one item of a diagram walk enters, and — for an edge only — when it has
 * finished drawing.
 *
 * `until` is optional because the two consumers read it differently, and the
 * walk must not hand the same window to both. `Trace` treats `until` as the
 * frame the stroke FINISHES; an edge needs one. `Reveal` treats `until` as the
 * frame the element FADES OUT; a node must not have one.
 */
export interface WalkWindow {
  readonly at: number
  readonly until?: number
}

export interface WalkSchedule {
  readonly nodes: ReadonlyMap<string, WalkWindow>
  readonly edges: ReadonlyMap<string, WalkWindow>
}

export interface WalkEdge {
  readonly id: string
  readonly source: string
  readonly target: string
}

/**
 * Spread a graph's nodes and edges across `at`..`through` so the diagram reads
 * as a walk: a node enters, then the edge leaving it draws, then the next node.
 *
 * An edge is anchored to the LATER of its two endpoints, so it draws only once
 * both boxes it joins are on screen. Anchoring to the source alone holds on a
 * chain and fails the moment the graph forks or joins: on a `config + content
 * -> sync` graph the first stroke reached into empty canvas a full step before
 * `sync` arrived.
 *
 * Nodes are scheduled with no end frame ON PURPOSE — see `WalkWindow`. They
 * once carried `until: at + step`, which fed `Reveal` a fade-out and left the
 * finished diagram as a row of edges pointing at nothing.
 */
export function walkSchedule(
  nodeIds: readonly string[],
  edges: readonly WalkEdge[],
  at: number,
  through: number,
): WalkSchedule {
  const step = Math.max(1, Math.floor((through - at) / (nodeIds.length + edges.length + 1)))

  const nodes = new Map<string, WalkWindow>()
  nodeIds.forEach((id, i) => {
    nodes.set(id, { at: at + i * step })
  })

  const edgeWindows = new Map<string, WalkWindow>()
  for (const edge of edges) {
    const enters =
      at + Math.max(nodeIds.indexOf(edge.source) + 1, nodeIds.indexOf(edge.target)) * step
    edgeWindows.set(edge.id, { at: enters, until: enters + step })
  }

  return { nodes, edges: edgeWindows }
}
