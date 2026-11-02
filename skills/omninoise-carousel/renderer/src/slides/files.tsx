import React from "react"

import { Body, Note, Title } from "../frame"
import { monoFamily } from "../fonts"
import { Rich } from "../rich"
import type { FileCard, Slide } from "../spec"
import { lineColor, mix, THEME } from "../theme"

type Files = Extract<Slide, { type: "files" }>

const Arrow: React.FC<{ up: boolean; label: string }> = ({ up, label }) => (
  <div style={{ display: "flex", flexDirection: "row-reverse", alignItems: "center", gap: 22, height: 84, paddingRight: 56 }}>
    <svg width="28" height="84" viewBox="0 0 28 84" style={{ transform: up ? "scaleY(-1)" : undefined }}>
      <line x1="14" y1="0" x2="14" y2="64" stroke={THEME.accent} strokeWidth="4" strokeLinecap="round" />
      <polygon points="3,60 25,60 14,80" fill={THEME.accent} />
    </svg>
    <span
      style={{
        fontFamily: monoFamily,
        fontSize: 28,
        fontWeight: 500,
        color: THEME.accent,
        background: mix(THEME.accent, 12),
        border: `1px solid ${mix(THEME.accent, 55)}`,
        borderRadius: 999,
        padding: "6px 22px",
      }}
    >
      {label}
    </span>
  </div>
)

const Card: React.FC<{ file: FileCard; lineSize: number }> = ({ file, lineSize }) => (
  <div>
    {file.reader ? (
      <div style={{ fontFamily: monoFamily, fontSize: 25, color: THEME.muted, marginBottom: 10, paddingLeft: 6 }}>
        {file.reader}
      </div>
    ) : null}
    <div
      style={{
        border: `1px solid ${THEME.border}`,
        borderRadius: 20,
        overflow: "hidden",
        background: mix(THEME.background, 85, THEME.surface),
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 24px",
          background: THEME.surface,
          borderBottom: `1px solid ${THEME.border}`,
        }}
      >
        {["oklch(68% 0.21 25)", "oklch(84% 0.15 85)", "oklch(82.6% 0.16 164.1)"].map((c) => (
          <span key={c} style={{ width: 14, height: 14, borderRadius: 7, background: mix(c, 70), flexShrink: 0 }} />
        ))}
        <span style={{ fontFamily: monoFamily, fontSize: 26, fontWeight: 500, marginLeft: 10, flex: 1 }}>{file.path}</span>
        {file.tag ? (
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: THEME.accent,
              border: `1px solid ${mix(THEME.accent, 60)}`,
              background: mix(THEME.accent, 10),
              borderRadius: 999,
              padding: "3px 16px",
              whiteSpace: "nowrap",
            }}
          >
            {file.tag}
          </span>
        ) : null}
      </div>
      <div style={{ padding: "20px 28px 24px", fontFamily: monoFamily, fontSize: lineSize, lineHeight: 1.5 }}>
        {file.lines.map((line, i) => (
          <div key={i} style={{ color: lineColor(line.tone), whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  </div>
)

export const FilesSlide: React.FC<{ slide: Files }> = ({ slide }) => {
  const rows = slide.files.reduce((n, f) => n + f.lines.length, 0)
  const lineSize = rows <= 6 ? 34 : rows <= 10 ? 31 : 28
  const linkAfter = slide.link ? Math.min(slide.link.from, slide.link.to) : -1
  return (
    <Body>
      <Title><Rich text={slide.title} /></Title>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 20 }}>
        {slide.files.map((file, i) => (
          <React.Fragment key={i}>
            <Card file={file} lineSize={lineSize} />
            {slide.link && linkAfter === i ? (
              <Arrow up={slide.link.to < slide.link.from} label={slide.link.label} />
            ) : i < slide.files.length - 1 ? (
              <div style={{ height: 30 }} />
            ) : null}
          </React.Fragment>
        ))}
      </div>
      {slide.note ? (
        <Note>
          <Rich text={slide.note} />
        </Note>
      ) : null}
    </Body>
  )
}
