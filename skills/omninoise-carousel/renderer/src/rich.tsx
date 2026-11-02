import React from "react"

import { monoFamily } from "./fonts"
import { parseMarkup } from "./markup"
import { mix, THEME } from "./theme"

/** Renders a slide string with its inline markup: `code` chips and **accent** words. */
export const Rich: React.FC<{ text: string }> = ({ text }) => (
  <>
    {parseMarkup(text).map((part, i) => {
      if (part.kind === "code") {
        return (
          <span
            key={i}
            style={{
              fontFamily: monoFamily,
              fontWeight: 500,
              fontSize: "0.86em",
              color: THEME.accent,
              background: mix(THEME.foreground, 9),
              border: `1px solid ${mix(THEME.foreground, 14)}`,
              borderRadius: "0.3em",
              padding: "0.02em 0.3em",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            {part.text}
          </span>
        )
      }
      if (part.kind === "accent") {
        return (
          <span key={i} style={{ color: THEME.accent, fontWeight: 700 }}>
            {part.text}
          </span>
        )
      }
      return <React.Fragment key={i}>{part.text}</React.Fragment>
    })}
  </>
)
