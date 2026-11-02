/**
 * The diagram slide. Node heights are computed up front (from `textLines`) so
 * the arrows and the loop curve can be drawn in absolute coordinates; each
 * node box has an explicit height and centres its content, so a wrong guess
 * costs spacing, not alignment. When the stack would not fit, every size is
 * scaled down together.
 */
import React from "react"

import { textLines } from "../fit"
import { Body, Note, Title } from "../frame"
import { monoFamily } from "../fonts"
import { Rich } from "../rich"
import type { Branch, Slide, Step } from "../spec"
import { BODY_TOP, CONTENT_BOTTOM, CONTENT_W, mix, THEME, toneStyle } from "../theme"

type Flow = Extract<Slide, { type: "flow" }>

type NodeLayer = { kind: "node"; step: Step; index: number; x: number; w: number; h: number; y: number }
type BranchBox = { branch: Branch; x: number; w: number }
type BranchLayer = { kind: "branches"; boxes: BranchBox[]; h: number; y: number }
type Layer = NodeLayer | BranchLayer

const ARROW = THEME.muted

const nodeHeight = (step: Step, w: number, s: number): number => {
  const textW = (w - 2 * 30 * s - (step.tone === "ok" ? 60 * s : 0)) / 1
  const label = textLines(step.label, 38 * s, textW, 0.6) * 38 * 1.22 * s
  const sub = step.sub ? 8 * s + textLines(step.sub, 28 * s, textW, 0.58) * 28 * 1.3 * s : 0
  const code = step.code ? 12 * s + 28 * 1.3 * s + 18 * s : 0
  return 2 * 24 * s + label + sub + code
}

const branchHeight = (b: Branch, w: number, s: number): number => {
  const textW = w - 2 * 20 * s
  const label = textLines(b.label, 32 * s, textW, 0.6) * 32 * 1.22 * s
  const sub = b.sub ? 6 * s + textLines(b.sub, 24 * s, textW, 0.58) * 24 * 1.3 * s : 0
  return 2 * 20 * s + label + sub
}

const buildLayers = (steps: Step[], loop: boolean, s: number): { layers: Layer[]; heights: number[] } => {
  const nodeW = loop ? 620 : 800
  const nodeX = loop ? 0 : (CONTENT_W - nodeW) / 2
  const rowW = loop ? nodeW : CONTENT_W
  const layers: Layer[] = []
  const heights: number[] = []
  steps.forEach((step, index) => {
    const h = nodeHeight(step, nodeW, s)
    layers.push({ kind: "node", step, index, x: nodeX, w: nodeW, h, y: 0 })
    heights.push(h)
    if (step.branches?.length) {
      const n = step.branches.length
      const gap = 24 * s
      const bw = (rowW - gap * (n - 1)) / n
      const boxes = step.branches.map((branch, i) => ({ branch, x: i * (bw + gap), w: bw }))
      const bh = Math.max(...boxes.map((b) => branchHeight(b.branch, b.w, s)))
      layers.push({ kind: "branches", boxes, h: bh, y: 0 })
      heights.push(bh)
    }
  })
  return { layers, heights }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

const Head: React.FC<{ x: number; y: number; dir: "down" | "left" }> = ({ x, y, dir }) => (
  <polygon
    points={dir === "down" ? `${x - 11},${y - 18} ${x + 11},${y - 18} ${x},${y}` : `${x + 18},${y - 11} ${x + 18},${y + 11} ${x},${y}`}
    fill={ARROW}
  />
)

const Check: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" style={{ flexShrink: 0 }}>
    <circle cx="22" cy="22" r="21" fill={THEME.ok} />
    <path d="M12 23 L19 30 L32 15" fill="none" stroke={THEME.background} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const NodeBox: React.FC<{ layer: NodeLayer; s: number }> = ({ layer, s }) => {
  const { step } = layer
  const t = toneStyle(step.tone)
  return (
    <div
      style={{
        position: "absolute",
        left: layer.x,
        top: layer.y,
        width: layer.w,
        height: layer.h,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 18 * s,
        padding: `0 ${30 * s}px`,
        borderRadius: 22 * s,
        border: `${3 * s}px ${t.dashed ? "dashed" : "solid"} ${t.border}`,
        background: t.fill,
        color: t.text,
      }}
    >
      {step.tone === "ok" ? <Check size={42 * s} /> : null}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 38 * s, lineHeight: 1.22, fontWeight: 700 }}>
          <Rich text={step.label} />
        </div>
        {step.sub ? (
          <div style={{ marginTop: 8 * s, fontSize: 28 * s, lineHeight: 1.3, color: THEME.muted }}>
            <Rich text={step.sub} />
          </div>
        ) : null}
        {step.code ? (
          <div
            style={{
              marginTop: 12 * s,
              display: "inline-block",
              fontFamily: monoFamily,
              fontWeight: 500,
              fontSize: 28 * s,
              lineHeight: 1.3,
              color: THEME.accent,
              background: mix(THEME.background, 60),
              border: `1px solid ${mix(THEME.accent, 40)}`,
              borderRadius: 12 * s,
              padding: `${6 * s}px ${14 * s}px`,
            }}
          >
            {step.code}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const BranchRow: React.FC<{ layer: BranchLayer; s: number }> = ({ layer, s }) => (
  <>
    {layer.boxes.map((box, i) => {
      const t = toneStyle(box.branch.tone)
      return (
        <div
          key={i}
          style={{
            position: "absolute",
            left: box.x,
            top: layer.y,
            width: box.w,
            height: layer.h,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            textAlign: "center",
            padding: `0 ${20 * s}px`,
            borderRadius: 20 * s,
            border: `${3 * s}px ${t.dashed ? "dashed" : "solid"} ${t.border}`,
            background: t.fill,
            color: t.text,
          }}
        >
          <div style={{ fontSize: 32 * s, lineHeight: 1.22, fontWeight: 700 }}>
            <Rich text={box.branch.label} />
          </div>
          {box.branch.sub ? (
            <div style={{ marginTop: 6 * s, fontSize: 24 * s, lineHeight: 1.3, color: THEME.muted }}>
              <Rich text={box.branch.sub} />
            </div>
          ) : null}
        </div>
      )
    })}
  </>
)

const Arrows: React.FC<{ layers: Layer[] }> = ({ layers }) => {
  const out: React.ReactNode[] = []
  const stroke = { stroke: ARROW, strokeWidth: 3.5, fill: "none", strokeLinecap: "round" as const }
  for (let i = 0; i < layers.length - 1; i++) {
    const a = layers[i]
    const b = layers[i + 1]
    if (!a || !b) continue
    const ya = a.y + a.h
    const yb = b.y
    const ym = (ya + yb) / 2
    if (a.kind === "node" && b.kind === "node") {
      const cx = a.x + a.w / 2
      out.push(
        <g key={i}>
          <line x1={cx} y1={ya} x2={cx} y2={yb - 14} {...stroke} />
          <Head x={cx} y={yb} dir="down" />
        </g>,
      )
    } else if (a.kind === "node" && b.kind === "branches") {
      const cx = a.x + a.w / 2
      out.push(
        <g key={i}>
          {b.boxes.map((box, j) => {
            const bx = box.x + box.w / 2
            return (
              <g key={j}>
                <path d={`M ${cx} ${ya} C ${cx} ${ym}, ${bx} ${ym}, ${bx} ${yb - 14}`} {...stroke} />
                <Head x={bx} y={yb} dir="down" />
              </g>
            )
          })}
        </g>,
      )
    } else if (a.kind === "branches" && b.kind === "node") {
      const cx = b.x + b.w / 2
      out.push(
        <g key={i}>
          {a.boxes.map((box, j) => {
            const bx = box.x + box.w / 2
            return <path key={j} d={`M ${bx} ${ya} C ${bx} ${ym}, ${cx} ${ym}, ${cx} ${yb - 14}`} {...stroke} />
          })}
          <Head x={cx} y={yb} dir="down" />
        </g>,
      )
    }
  }
  return <>{out}</>
}

export const FlowSlide: React.FC<{ slide: Flow }> = ({ slide }) => {
  const titleLines = textLines(slide.title, 64, CONTENT_W, 0.6)
  const titleH = titleLines * 64 * 1.14
  const tipH = slide.tip ? 70 : 0
  const noteH = slide.note ? 2 * 22 + textLines(slide.note, 31, CONTENT_W - 64, 0.58) * 31 * 1.35 + 4 : 0
  const top = BODY_TOP + titleH + 40 + tipH
  const avail = CONTENT_BOTTOM - top - (noteH ? noteH + 40 : 0)

  const loop = slide.loop !== undefined
  let s = 1
  let built = buildLayers(slide.steps, loop, s)
  const count = built.layers.length
  for (; s > 0.55; s -= 0.03) {
    built = buildLayers(slide.steps, loop, s)
    if (sum(built.heights) + (count - 1) * 44 * s <= avail) break
  }
  const { layers, heights } = built
  const gap = count > 1 ? Math.min(84 * s, (avail - sum(heights)) / (count - 1)) : 0
  const used = sum(heights) + gap * (count - 1)
  let y = Math.min(24, Math.max(0, (avail - used) / 2))
  for (const layer of layers) {
    layer.y = y
    y += layer.h + gap
  }
  const nodes = layers.filter((l): l is NodeLayer => l.kind === "node")

  let loopEl: React.ReactNode = null
  if (slide.loop) {
    const from = nodes[slide.loop.from]
    const to = nodes[slide.loop.to]
    if (from && to) {
      const xr = from.x + from.w
      const yf = from.y + from.h / 2
      const yt = to.y + to.h / 2
      const dx = 150
      const midY = (yf + yt) / 2
      loopEl = (
        <>
          <svg width={CONTENT_W} height={avail} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <path
              d={`M ${xr} ${yf} C ${xr + dx} ${yf}, ${xr + dx} ${yt}, ${xr + 16} ${yt}`}
              stroke={THEME.accent}
              strokeWidth={4}
              fill="none"
              strokeLinecap="round"
              strokeDasharray="1 0"
            />
            <polygon points={`${xr + 20},${yt - 12} ${xr + 20},${yt + 12} ${xr + 2},${yt}`} fill={THEME.accent} />
          </svg>
          <div
            style={{
              position: "absolute",
              left: xr + dx * 0.75 + 16,
              top: midY,
              width: CONTENT_W - (xr + dx * 0.75 + 16),
              transform: "translateY(-50%)",
              fontSize: 28,
              lineHeight: 1.25,
              fontWeight: 600,
              color: THEME.accent,
            }}
          >
            <Rich text={slide.loop.label} />
          </div>
        </>
      )
    }
  }

  return (
    <Body>
      <Title>
        <Rich text={slide.title} />
      </Title>
      {slide.tip ? (
        <div style={{ marginTop: 22 }}>
          <span
            style={{
              display: "inline-block",
              fontSize: 27,
              fontWeight: 600,
              color: THEME.accent,
              border: `1.5px solid ${mix(THEME.accent, 60)}`,
              background: mix(THEME.accent, 10),
              borderRadius: 999,
              padding: "6px 24px",
            }}
          >
            <Rich text={slide.tip} />
          </span>
        </div>
      ) : null}
      <div style={{ position: "relative", marginTop: 40, height: avail, flexShrink: 0 }}>
        <svg width={CONTENT_W} height={avail} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <Arrows layers={layers} />
        </svg>
        {layers.map((layer, i) =>
          layer.kind === "node" ? <NodeBox key={i} layer={layer} s={s} /> : <BranchRow key={i} layer={layer} s={s} />,
        )}
        {loopEl}
      </div>
      {slide.note ? (
        <Note>
          <Rich text={slide.note} />
        </Note>
      ) : null}
    </Body>
  )
}
