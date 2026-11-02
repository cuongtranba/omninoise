import React from "react"
import { Img, staticFile } from "remotion"

import { Body, Title } from "../frame"
import { monoFamily } from "../fonts"
import { Rich } from "../rich"
import type { Brand, Slide } from "../spec"
import { mix, THEME, toneStyle } from "../theme"

type Of<T extends Slide["type"]> = Extract<Slide, { type: T }>

/** Biggest size (96..132) at which the longest line still fits on one row. */
const coverSize = (lines: string[]): number => {
  const longest = Math.max(...lines.map((l) => [...l.replaceAll("**", "")].length))
  return Math.max(96, Math.min(132, Math.floor(960 / (longest * 0.55))))
}

export const CoverSlide: React.FC<{ slide: Of<"cover"> }> = ({ slide }) => {
  const size = coverSize(slide.title)
  return (
    <Body style={{ justifyContent: "center", paddingBottom: 40 }}>
      <div style={{ width: 120, height: 10, borderRadius: 5, background: THEME.accent, marginBottom: 44 }} />
      {slide.title.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: size,
            lineHeight: 1.04,
            fontWeight: 700,
            letterSpacing: "-0.025em",
            whiteSpace: "nowrap",
            marginRight: -60,
          }}
        >
          <Rich text={line} />
        </div>
      ))}
      {slide.sub ? (
        <div style={{ marginTop: 52, fontSize: 40, lineHeight: 1.3, color: THEME.muted, maxWidth: 880 }}>
          <Rich text={slide.sub} />
        </div>
      ) : null}
    </Body>
  )
}

/** Fewer, shorter items get bigger type; the cards then sit centred in the space below the title. */
const pointsSize = (items: { text: string }[]): number => {
  const chars = items.reduce((n, i) => n + i.text.length, 0)
  if (items.length <= 2 && chars < 220) return 46
  if (items.length <= 3 && chars < 260) return 44
  return 40
}

export const PointsSlide: React.FC<{ slide: Of<"points"> }> = ({ slide }) => (
  <Body>
    <Title><Rich text={slide.title} /></Title>
    <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1, justifyContent: "center", paddingBottom: 20 }}>
      {slide.items.map((item, i) => {
        const t = toneStyle(item.tone)
        return (
          <div
            key={i}
            style={{
              display: "flex",
              background: t.fill,
              border: `1px solid ${item.tone === "plain" || item.tone === undefined ? THEME.border : mix(t.border, 60)}`,
              borderRadius: 22,
              overflow: "hidden",
            }}
          >
            <div style={{ width: 12, background: t.bar, flexShrink: 0 }} />
            <div style={{ padding: "28px 34px", fontSize: pointsSize(slide.items), lineHeight: 1.36, color: t.text, fontWeight: 400 }}>
              <Rich text={item.text} />
            </div>
          </div>
        )
      })}
    </div>
    {slide.note ? (
      <div style={{ marginTop: "auto", fontSize: 32, fontStyle: "italic", color: THEME.muted, lineHeight: 1.35 }}>
        <Rich text={slide.note} />
      </div>
    ) : null}
  </Body>
)

export const QuoteSlide: React.FC<{ slide: Of<"quote"> }> = ({ slide }) => (
  <Body>
    {slide.title ? <Title><Rich text={slide.title} /></Title> : null}
    <div style={{ flex: 1, display: "flex", alignItems: "center", paddingBottom: 60 }}>
      <div style={{ borderLeft: `10px solid ${THEME.accent}`, paddingLeft: 36 }}>
        <div style={{ fontSize: 52, lineHeight: 1.3, fontWeight: 600 }}>
          “<Rich text={slide.quote} />”
        </div>
        <div style={{ marginTop: 36, fontFamily: monoFamily, fontSize: 28, color: THEME.muted }}>{slide.source}</div>
      </div>
    </div>
  </Body>
)

const Bookmark: React.FC = () => (
  <svg width="56" height="68" viewBox="0 0 56 68" style={{ flexShrink: 0 }}>
    <path
      d="M8 4 H48 a4 4 0 0 1 4 4 V64 L28 48 L4 64 V8 a4 4 0 0 1 4 -4 Z"
      fill={mix(THEME.accent, 20)}
      stroke={THEME.accent}
      strokeWidth="4"
      strokeLinejoin="round"
    />
  </svg>
)

export const SaveSlide: React.FC<{ slide: Of<"save"> }> = ({ slide }) => (
  <Body>
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <Bookmark />
      <Title size={72}><Rich text={slide.title} /></Title>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 40, flex: 1, justifyContent: "center", paddingBottom: 30 }}>
      {slide.rows.map((row, i) => (
        <div key={i}>
          <div style={{ fontSize: 34, color: THEME.muted, fontWeight: 600, marginBottom: 14 }}>{row.label}</div>
          <div
            style={{
              fontFamily: monoFamily,
              fontWeight: 500,
              fontSize: 38,
              lineHeight: 1.35,
              color: THEME.accent,
              background: THEME.surface,
              border: `1px solid ${THEME.border}`,
              borderRadius: 18,
              padding: "26px 32px",
              overflowWrap: "anywhere",
            }}
          >
            {row.code}
          </div>
        </div>
      ))}
    </div>
  </Body>
)

export const CloseSlide: React.FC<{ slide: Of<"close">; brand: Brand }> = ({ slide, brand }) => (
  <Body style={{ alignItems: "center", justifyContent: "center", textAlign: "center", paddingBottom: 30 }}>
    <Img src={staticFile("brand/logo.png")} style={{ width: 220, height: 220, borderRadius: 48 }} />
    <div style={{ marginTop: 36, fontSize: 58, fontWeight: 700 }}>{brand.name}</div>
    <div style={{ marginTop: 44, fontSize: 44, lineHeight: 1.3, fontWeight: 600, maxWidth: 820 }}>
      <Rich text={slide.cta} />
    </div>
    {slide.link ? (
      <div style={{ marginTop: 34, fontFamily: monoFamily, fontSize: 30, color: THEME.muted, overflowWrap: "anywhere" }}>
        {slide.link}
      </div>
    ) : null}
  </Body>
)
