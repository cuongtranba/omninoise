/**
 * Deterministic line-count estimate, used where a diagram needs node heights
 * before layout. Deliberately a little wide (0.58 em per character) so a guess
 * errs towards one line too many, never one too few.
 */
import { parseMarkup } from "./markup"

export const plain = (text: string): string =>
  parseMarkup(text)
    .map((p) => p.text)
    .join("")

export const textLines = (text: string, fontPx: number, widthPx: number, factor = 0.58): number => {
  const perLine = Math.max(4, Math.floor(widthPx / (fontPx * factor)))
  let lines = 1
  let used = 0
  for (const word of plain(text).split(/\s+/).filter(Boolean)) {
    const need = used === 0 ? word.length : word.length + 1
    if (used + need <= perLine) {
      used += need
    } else {
      lines += used === 0 ? Math.ceil(word.length / perLine) - 1 : Math.max(1, Math.ceil(word.length / perLine))
      used = word.length % perLine || perLine
    }
  }
  return lines
}
