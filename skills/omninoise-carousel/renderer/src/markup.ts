/**
 * The only inline markup a slide string may carry:
 * `` `code` `` → a mono chip, `**word**` → accent colour and bold. No HTML.
 */

export type Part = { kind: "text" | "code" | "accent"; text: string }

const TOKEN = /`([^`]+)`|\*\*([^*]+)\*\*/g

export const parseMarkup = (input: string): Part[] => {
  const parts: Part[] = []
  let last = 0
  for (const m of input.matchAll(TOKEN)) {
    const at = m.index
    if (at > last) parts.push({ kind: "text", text: input.slice(last, at) })
    if (m[1] !== undefined) parts.push({ kind: "code", text: m[1] })
    else parts.push({ kind: "accent", text: m[2] ?? "" })
    last = at + m[0].length
  }
  if (last < input.length) parts.push({ kind: "text", text: input.slice(last) })
  return parts
}
