import { describe, expect, test } from "bun:test"

import {
  countValue,
  FOCUS_DURATION,
  flowDash,
  focusTransform,
  packetPhases,
  staggerOffset,
  turntableRotation,
  walkSchedule,
} from "./motion-math"

describe("staggerOffset", () => {
  test("child 0 has no offset — it enters at the at cue itself", () => {
    expect(staggerOffset(0, 4, 5, 100)).toBe(0)
  })

  test("children enter step frames apart", () => {
    expect(staggerOffset(1, 4, 5, 100)).toBe(4)
    expect(staggerOffset(2, 4, 5, 100)).toBe(8)
    expect(staggerOffset(3, 4, 5, 100)).toBe(12)
  })

  test("never schedules a child past the scene's end", () => {
    const step = 30
    const childCount = 5
    const sceneDuration = 60
    for (let i = 0; i < childCount; i++) {
      expect(staggerOffset(i, step, childCount, sceneDuration)).toBeLessThan(sceneDuration)
    }
  })

  test("determinism: same arguments always yield the same offset", () => {
    const result1 = staggerOffset(2, 4, 5, 100)
    const result2 = staggerOffset(2, 4, 5, 100)
    expect(result1).toBe(result2)
  })

  test("offsets are non-negative", () => {
    for (let i = 0; i < 5; i++) {
      expect(staggerOffset(i, 4, 5, 100)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe("countValue", () => {
  test("before at: returns from", () => {
    expect(countValue(0, 10, 50, 0, 374)).toBe(0)
    expect(countValue(9, 10, 50, 0, 374)).toBe(0)
  })

  test("at or past until: returns to", () => {
    expect(countValue(50, 10, 50, 0, 374)).toBe(374)
    expect(countValue(60, 10, 50, 0, 374)).toBe(374)
  })

  test("between at and until: interpolates strictly between from and to", () => {
    const mid = countValue(30, 10, 50, 0, 374)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(374)
  })

  test("determinism: same frame always yields the same value", () => {
    const result1 = countValue(30, 10, 50, 0, 374)
    const result2 = countValue(30, 10, 50, 0, 374)
    expect(result1).toBe(result2)
  })

  test("interpolation is monotonically non-decreasing when from < to", () => {
    const vals = [10, 20, 30, 40, 50].map((f) => countValue(f, 10, 50, 0, 374))
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]!)
    }
  })
})

describe("focusTransform", () => {
  const on = { x: 500, y: 300, scale: 2 }

  test("before at: identity transform — no zoom, no translate", () => {
    const result = focusTransform(0, 10, on)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
    expect(result.scale).toBe(1)
  })

  test("at + FOCUS_DURATION: full transform applied", () => {
    const result = focusTransform(10 + FOCUS_DURATION, 10, on)
    expect(result.x).toBe(on.x)
    expect(result.y).toBe(on.y)
    expect(result.scale).toBe(on.scale)
  })

  test("determinism: same frame always yields the same transform", () => {
    const r1 = focusTransform(15, 10, on)
    const r2 = focusTransform(15, 10, on)
    expect(r1).toEqual(r2)
  })

  test("scale stays at or above 1 during transition", () => {
    for (let f = 0; f <= 10 + FOCUS_DURATION; f++) {
      expect(focusTransform(f, 10, on).scale).toBeGreaterThanOrEqual(1)
    }
  })
})

describe("walkSchedule", () => {
  const NODES = ["a", "b", "c"]
  const EDGES = [
    { id: "a-b", source: "a" },
    { id: "b-c", source: "b" },
  ]

  test("nodes enter in walk order, one step apart, starting at the at cue", () => {
    const { nodes } = walkSchedule(NODES, EDGES, 0, 60)
    // 5 items + 1 => step 10
    expect(nodes.get("a")?.at).toBe(0)
    expect(nodes.get("b")?.at).toBe(10)
    expect(nodes.get("c")?.at).toBe(20)
  })

  test("a node NEVER carries an until — Reveal reads until as a fade-out", () => {
    // The regression this covers: nodes were scheduled `until: at + step`, so
    // every box faded out one step after arriving and the finished diagram was
    // a row of edges pointing at nothing. `subject` (hold one node, dim the
    // rest) is only meaningful if nodes persist.
    const { nodes } = walkSchedule(NODES, EDGES, 0, 60)
    for (const id of NODES) {
      expect(nodes.get(id)?.until).toBeUndefined()
    }
  })

  test("an edge carries a finite until — Trace reads until as stroke-complete", () => {
    const { edges } = walkSchedule(NODES, EDGES, 0, 60)
    for (const edge of EDGES) {
      const window = edges.get(edge.id)
      expect(window?.until).toBeGreaterThan(window?.at ?? 0)
    }
  })

  test("an edge is anchored after its source node has entered", () => {
    const { nodes, edges } = walkSchedule(NODES, EDGES, 0, 60)
    for (const edge of EDGES) {
      expect(edges.get(edge.id)?.at).toBeGreaterThan(nodes.get(edge.source)?.at ?? 0)
    }
  })

  test("step is at least 1 even when the window is shorter than the item count", () => {
    const { nodes } = walkSchedule(NODES, EDGES, 0, 1)
    expect(nodes.get("b")?.at).toBe(1)
    expect(nodes.get("c")?.at).toBe(2)
  })

  test("determinism: same arguments always yield the same schedule", () => {
    const first = walkSchedule(NODES, EDGES, 5, 90)
    const second = walkSchedule(NODES, EDGES, 5, 90)
    expect([...first.nodes]).toEqual([...second.nodes])
    expect([...first.edges]).toEqual([...second.edges])
  })
})

describe("walkSchedule edge anchoring on a fork", () => {
  // config ─┐
  //         ├─> sync ──> generated      (the kit's own Architecture graph)
  // content ┘
  const nodeIds = ["config", "content", "sync", "generated"]
  const edges = [
    { id: "e1", source: "config", target: "sync" },
    { id: "e2", source: "content", target: "sync" },
    { id: "e3", source: "sync", target: "generated" },
  ]

  test("an edge never draws before BOTH of its endpoints have entered", () => {
    const { nodes, edges: drawn } = walkSchedule(nodeIds, edges, 0, 300)
    for (const edge of edges) {
      const at = drawn.get(edge.id)!.at
      expect(at).toBeGreaterThanOrEqual(nodes.get(edge.source)!.at)
      // Anchoring to the source alone put e1 a full step before `sync` arrived,
      // so the stroke reached into empty canvas.
      expect(at).toBeGreaterThanOrEqual(nodes.get(edge.target)!.at)
    }
  })

  test("a plain chain is unchanged by the fork rule", () => {
    const chain = [
      { id: "ab", source: "a", target: "b" },
      { id: "bc", source: "b", target: "c" },
    ]
    const { nodes, edges: drawn } = walkSchedule(["a", "b", "c"], chain, 0, 120)
    expect(drawn.get("ab")!.at).toBe(nodes.get("b")!.at)
    expect(drawn.get("bc")!.at).toBe(nodes.get("c")!.at)
  })
})

describe("flowDash", () => {
  test("packets divide the path evenly — the pattern repeats once per packet", () => {
    for (const packets of [1, 2, 4]) {
      const [dash, gap] = flowDash(0, 0, 60, packets).dasharray.split(" ").map(Number)
      expect(dash + gap).toBeCloseTo(1 / packets, 10)
      expect(dash).toBeGreaterThan(0)
      expect(gap).toBeGreaterThan(0)
    }
  })

  test("the offset stays inside one period, so the dash pattern never jumps", () => {
    const period = 1 / 3
    for (let frame = 0; frame < 400; frame++) {
      const { dashoffset } = flowDash(frame, 0, 45, 3)
      expect(dashoffset).toBeLessThanOrEqual(0)
      expect(dashoffset).toBeGreaterThan(-period)
    }
  })

  test("a packet crosses the whole path in cycleFrames", () => {
    const a = flowDash(10, 0, 60, 1).dashoffset
    const b = flowDash(11, 0, 60, 1).dashoffset
    expect(Math.abs(b - a)).toBeCloseTo(1 / 60, 10)
  })

  test("nothing moves before the at cue", () => {
    expect(flowDash(0, 30, 60, 2).dashoffset).toBe(flowDash(29, 30, 60, 2).dashoffset)
  })

  test("degenerate inputs stay finite rather than dividing by zero", () => {
    for (const args of [[0, 0, 0, 0], [5, 0, -10, -3]] as const) {
      const { dashoffset, dasharray } = flowDash(...args)
      expect(Number.isFinite(dashoffset)).toBe(true)
      for (const n of dasharray.split(" ").map(Number)) {
        expect(n).toBeGreaterThan(0)
      }
    }
  })

  test("a higher duty draws more of each slot, so the line reads as dashes not packets", () => {
    const packet = flowDash(0, 0, 60, 4, 0.38).dasharray.split(" ").map(Number)
    const dashy = flowDash(0, 0, 60, 4, 0.55).dasharray.split(" ").map(Number)
    expect(dashy[0]).toBeGreaterThan(packet[0])
    expect(dashy[0] + dashy[1]).toBeCloseTo(packet[0] + packet[1], 10)
  })

  test("duty stays inside the slot so a gap always remains", () => {
    for (const duty of [-1, 0, 0.5, 1, 4]) {
      const [dash, gap] = flowDash(0, 0, 60, 3, duty).dasharray.split(" ").map(Number)
      expect(dash).toBeGreaterThan(0)
      expect(gap).toBeGreaterThan(0)
    }
  })
})

describe("packetPhases", () => {
  test("returns one phase per packet, evenly spaced around the cycle", () => {
    const phases = [...packetPhases(0, 0, 60, 4)].sort((a, b) => a - b)
    expect(phases).toHaveLength(4)
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i] - phases[i - 1]).toBeCloseTo(0.25, 10)
    }
  })

  test("every phase is a position along the path, never outside it", () => {
    for (let frame = 0; frame < 300; frame++) {
      for (const p of packetPhases(frame, 0, 47, 3)) {
        expect(p).toBeGreaterThanOrEqual(0)
        expect(p).toBeLessThan(1)
      }
    }
  })

  test("a packet advances one full path per cycleFrames", () => {
    expect(packetPhases(25, 0, 50, 1)[0] - packetPhases(0, 0, 50, 1)[0]).toBeCloseTo(0.5, 10)
  })

  test("holds at the start before the at cue", () => {
    expect(packetPhases(3, 20, 60, 2)).toEqual(packetPhases(19, 20, 60, 2))
  })

  test("degenerate inputs still yield at least one usable phase", () => {
    const phases = packetPhases(9, 0, 0, 0)
    expect(phases.length).toBeGreaterThanOrEqual(1)
    for (const p of phases) expect(Number.isFinite(p)).toBe(true)
  })
})

describe("turntableRotation", () => {
  test("advances linearly with the frame", () => {
    expect(turntableRotation(90, 1) - turntableRotation(0, 1)).toBeCloseTo(Math.PI / 2, 10)
  })

  test("a start offset shifts the whole rotation", () => {
    expect(turntableRotation(0, 1, 90)).toBeCloseTo(Math.PI / 2, 10)
  })

  test("determinism and finiteness", () => {
    expect(turntableRotation(123, 0.4, 15)).toBe(turntableRotation(123, 0.4, 15))
    expect(Number.isFinite(turntableRotation(1e6, 0.4))).toBe(true)
  })
})
