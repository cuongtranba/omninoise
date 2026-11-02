import "@xyflow/react/dist/base.css"

import {
  Background,
  BackgroundVariant,
  getBezierPath,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react"
import React from "react"
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion"

import { EASE_OUT, HAIRLINE, RADIUS, Reveal, SAFE, SIZE } from "./primitives"
import { THEME } from "../generated/theme"
import { flowDash, FLOW_MODES, walkSchedule } from "../motion-math"

export type DiagramNode = {
  id: string
  position: { x: number; y: number }
  width: number
  height: number
  data: { label: string }
}

export type DiagramEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  /** Opt this edge out of `<Diagram flow>` — a relationship that carries nothing. */
  flowing?: boolean
}

export type DiagramFlow = {
  /** Frames for one packet to cross an edge. */
  cycleFrames?: number
  packets?: number
  /** `dashes` (default) marches the whole edge; `packets` sends discrete blips. */
  mode?: "dashes" | "packets"
}

export type DiagramGraph = {
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  order?: string[]
}

export type DiagramReveal = {
  at: number
  through: number
}

const MUTED_NODE_OPACITY = 0.35

/**
 * Handles are drawn rather than hidden. They are where an edge attaches, so
 * showing them is what makes a stroke read as *connected to this box* instead of
 * a line that happens to stop nearby — the same reason React Flow shows them.
 */
const HANDLE: React.CSSProperties = {
  width: 11,
  height: 11,
  borderRadius: "50%",
  background: THEME.background,
  border: `2px solid ${THEME.accent}`,
  pointerEvents: "none",
}

/**
 * The walk's frame math lives in `motion-math.ts` with the rest of it, where it
 * is tested without React Flow, a DOM or a renderer.
 */
const scheduleFor = (graph: DiagramGraph, reveal: DiagramReveal) =>
  walkSchedule(
    graph.order ?? graph.nodes.map(node => node.id),
    graph.edges,
    reveal.at,
    reveal.through,
  )

type KitNodeData = {
  label: string
  /** Handles on the top and bottom edges: a diagram that reads downwards. */
  vertical?: boolean
  revealAt?: number
  hasSubject?: boolean
  isSubject?: boolean
}

const KitNode: React.FC<NodeProps> = ({ id, data, width, height }) => {
  const nodeData = data as KitNodeData
  const frame = useCurrentFrame()
  const muted =
    Boolean(nodeData.hasSubject) &&
    !nodeData.isSubject &&
    nodeData.revealAt !== undefined &&
    frame >= nodeData.revealAt

  const body = (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // Padding and centred text: a two-line label in a fixed-width node
        // otherwise runs into its own border, which reads as a broken box
        // rather than a long name.
        padding: "0 16px",
        textAlign: "center",
        lineHeight: 1.2,
        border: `2px solid color-mix(in oklch, ${THEME.border}, ${THEME.muted} 45%)`,
        borderRadius: RADIUS.md,
        backgroundColor: THEME.surface,
        color: THEME.foreground,
        fontSize: SIZE.mono,
        fontWeight: 500,
        letterSpacing: "-0.01em",
        opacity: muted ? MUTED_NODE_OPACITY : 1,
      }}
    >
      <Handle
        type="target"
        position={nodeData.vertical ? Position.Top : Position.Left}
        style={HANDLE}
      />
      {nodeData.label}
      <Handle
        type="source"
        position={nodeData.vertical ? Position.Bottom : Position.Right}
        style={HANDLE}
      />
    </div>
  )

  if (nodeData.revealAt === undefined) {
    return body
  }

  // `rise={0}` — fade only, never translate.
  //
  // React Flow measures handle positions from the DOM and caches them. A node
  // that slides in is, at measurement time, displaced by `rise`; the cached
  // anchor keeps that displacement for the rest of the scene and every edge
  // hangs below its node by rise x zoom.
  //
  // It only ever showed in video: a still renders one settled frame and
  // measures the true position, so stills looked right while the render was
  // wrong — which is exactly why this survived several "fixes".
  //
  // No `until` either: the walk accumulates. An exit here empties the canvas
  // one step behind the walk and leaves `subject` with nothing to dim.
  return (
    <Reveal name={`node-${id}`} at={nodeData.revealAt} rise={0}>
      {body}
    </Reveal>
  )
}

const nodeTypes = { kit: KitNode }

type KitEdgeData = {
  revealAt?: number
  revealUntil?: number
  flowAt?: number
  flowCycleFrames?: number
  flowPackets?: number
  flowMode?: "dashes" | "packets"
}

/**
 * A custom edge is rendered *inside* React Flow's own edge `<svg>`, so it emits
 * bare `<path>` elements in flow-pane coordinates.
 *
 * The earlier version wrapped `<Trace>`/`<Flow>` in an `<EdgeLabelRenderer>`.
 * That portal exists for HTML labels and sits in a different coordinate space,
 * so a path built from `getBezierPath` came out offset from the handles it was
 * supposed to join — visibly below them, never touching the anchors.
 */
const KitEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}) => {
  const frame = useCurrentFrame()
  const edgeData = data as KitEdgeData | undefined
  const traced = edgeData?.revealAt !== undefined && edgeData.revealUntil !== undefined
  const flowing = edgeData?.flowAt !== undefined
  if (!edgeData || (!traced && !flowing)) {
    return null
  }

  const [d] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  // `pathLength={1}` normalises the stroke so the draw-in needs no measurement,
  // exactly as <Trace> does — the maths is the same, only the host element
  // differs.
  const drawOffset = traced
    ? interpolate(frame, [edgeData.revealAt!, edgeData.revealUntil!], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.bezier(...EASE_OUT),
      })
    : 0

  // The arrowhead is drawn by a marker, which ignores the dash pattern — so it
  // would sit at the target before the line reached it. Withhold it until the
  // stroke arrives.
  const arrived = !traced || frame >= edgeData.revealUntil!

  const mode = FLOW_MODES[edgeData.flowMode ?? "dashes"]
  const packets = flowing
    ? flowDash(
        frame,
        edgeData.flowAt!,
        edgeData.flowCycleFrames ?? 45,
        edgeData.flowPackets ?? mode.packets,
        mode.duty,
      )
    : undefined

  return (
    <>
      {/*
        Styled inline, not with presentation attributes: React Flow's base.css
        sets `.react-flow__edge-path { stroke-width: 1 }`, and a stylesheet rule
        outranks an attribute — which quietly reduced a 4px accent wire to a 1px
        grey hairline.
      */}
      <path
        id={id}
        d={d}
        pathLength={1}
        style={{
          fill: "none",
          stroke: THEME.accent,
          strokeWidth: 4,
          strokeLinecap: "round",
          strokeDasharray: 1,
          strokeDashoffset: drawOffset,
          // The glow is what separates a lit wire from a drawn one. Kept to the
          // accent so it cannot become a second colour.
          filter: `drop-shadow(0 0 7px ${THEME.accent})`,
        }}
        markerEnd={arrived ? markerEnd : undefined}
      />

      {packets && frame >= edgeData.flowAt! ? (
        <path
          d={d}
          pathLength={1}
          style={{
            fill: "none",
            stroke: THEME.foreground,
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeDasharray: packets.dasharray,
            strokeDashoffset: packets.dashoffset,
            filter: `drop-shadow(0 0 5px ${THEME.foreground})`,
          }}
        />
      ) : null}
    </>
  )
}

const edgeTypes = { kit: KitEdge }

export const Diagram: React.FC<{
  name: string
  graph: DiagramGraph
  /**
   * Height of the band the graph occupies. Like `<Space height>`, the component
   * owns its own box.
   */
  height?: number
  /**
   * Optional. Omit it and the graph is centred from its declared node bounds —
   * no measurement, so it stays deterministic. Hand-computing this is how a
   * graph ends up flush against the panel with its last node clipped.
   */
  viewport?: { x: number; y: number; zoom: number }
  reveal?: DiagramReveal
  subject?: string
  /**
   * Send packets down the edges once each has been drawn, turning a picture of
   * how the parts connect into a picture of what moves between them. Set an
   * edge's `flowing: false` to leave it a plain connection.
   */
  flow?: boolean | DiagramFlow
  /**
   * `down` attaches edges to the top and bottom of each node, so a graph laid
   * out in a column (a 9:16 frame) reads downwards instead of looping round
   * the sides. Default `right`.
   */
  direction?: "right" | "down"
  /** The dotted canvas. On by default: it gives the graph a surface to sit on. */
  background?: boolean | { gap?: number; size?: number }
}> = ({
  name,
  graph,
  viewport,
  height,
  reveal,
  subject,
  flow,
  direction = "right",
  background = true,
}) => {
  const dots = background === true ? {} : background || undefined
  const { width: frameWidth, height: frameHeight } = useVideoConfig()
  const boxWidth = frameWidth - SAFE.x * 2
  const boxHeight = height ?? frameHeight

  // Node positions and sizes are declared, never measured, so the graph's
  // extent is known without touching the DOM — which is what lets the centring
  // be exact in a headless render.
  const bounds = graph.nodes.reduce(
    (acc, node) => ({
      minX: Math.min(acc.minX, node.position.x),
      minY: Math.min(acc.minY, node.position.y),
      maxX: Math.max(acc.maxX, node.position.x + node.width),
      maxY: Math.max(acc.maxY, node.position.y + node.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  // Fit, then centre. Centring alone is not enough: a graph exactly as wide as
  // its box is perfectly centred *and* has its outermost handles, arrowheads and
  // glow clipped by the panel edge. The inset leaves room for all three, and the
  // zoom never goes above 1, so a small graph is centred rather than blown up.
  const graphWidth = bounds.maxX - bounds.minX
  const graphHeight = bounds.maxY - bounds.minY
  const inset = 48
  const fit = Math.min(
    1,
    (boxWidth - inset * 2) / Math.max(1, graphWidth),
    (boxHeight - inset * 2) / Math.max(1, graphHeight),
  )
  const view = viewport ?? {
    x: (boxWidth - graphWidth * fit) / 2 - bounds.minX * fit,
    y: (boxHeight - graphHeight * fit) / 2 - bounds.minY * fit,
    zoom: fit,
  }
  const schedule = reveal ? scheduleFor(graph, reveal) : undefined
  const flowConfig = flow === true ? {} : flow || undefined

  const nodes = graph.nodes.map(node =>
    schedule
      ? {
          ...node,
          type: "kit" as const,
          data: {
            label: node.data.label,
            vertical: direction === "down",
            // Node windows carry no `until` by construction — see WalkWindow.
            revealAt: schedule.nodes.get(node.id)?.at,
            hasSubject: subject !== undefined,
            isSubject: node.id === subject,
          },
        }
      : {
          ...node,
          type: "kit" as const,
          data: { label: node.data.label, vertical: direction === "down" },
        },
  )

  const edges =
    schedule || flowConfig
      ? graph.edges.map(edge => {
          const drawn = schedule?.edges.get(edge.id)
          // Flow starts where the stroke finishes, so a packet never appears on
          // a line the viewer has not seen drawn.
          const carries = flowConfig !== undefined && edge.flowing !== false
          return {
            ...edge,
            type: "kit" as const,
            // Direction is the whole point of a dataflow diagram, and a line
            // states connection without stating which way.
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: THEME.accent,
              width: 24,
              height: 24,
            },
            data: {
              revealAt: drawn?.at,
              revealUntil: drawn?.until,
              flowAt: carries ? (drawn?.until ?? 0) : undefined,
              flowCycleFrames: flowConfig?.cycleFrames,
              flowPackets: flowConfig?.packets,
              flowMode: flowConfig?.mode,
            },
          }
        })
      : graph.edges

  // The canvas sits at `background`, not `surface`: nodes are `surface`, and a
  // panel of the same colour left every box separated from its own canvas by
  // nothing but a 1.2:1 hairline. Two steps of tone is what makes a node read
  // as an object sitting on a surface.
  return (
    <div
      data-remotion-interactive={name}
      style={{
        width: "100%",
        height: boxHeight,
        backgroundColor: THEME.background,
        border: HAIRLINE,
        borderRadius: RADIUS.lg,
        overflow: "hidden",
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={view}
        fitView={false}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        {dots ? (
          <Background
            variant={BackgroundVariant.Dots}
            gap={dots.gap ?? 26}
            size={dots.size ?? 2}
            color={THEME.muted}
          />
        ) : null}
      </ReactFlow>
    </div>
  )
}
