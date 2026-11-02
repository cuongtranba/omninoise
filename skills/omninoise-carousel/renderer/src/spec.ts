/**
 * The post spec: types and the loader that rejects a bad one.
 *
 * `parsePost` is the only way a JSON file becomes a `PostSpec`, so a typo in a
 * slide type or a missing field stops here with the path of the problem rather
 * than rendering a half-empty slide.
 */

export type Tone = "accent" | "danger" | "ok" | "muted" | "plain"
export type Item = { text: string; tone?: Tone }
export type Branch = { label: string; sub?: string; tone?: Tone }
export type Step = { label: string; sub?: string; code?: string; tone?: Tone; branches?: Branch[] }
export type FileLine = { text: string; tone?: Tone }
export type FileCard = { path: string; tag?: string; reader?: string; lines: FileLine[] }
export type Link = { from: number; to: number; label: string }
export type Row = { label: string; code: string }

export type Slide =
  | { type: "cover"; title: string[]; sub?: string }
  | { type: "points"; title: string; items: Item[]; note?: string }
  | { type: "quote"; title?: string; quote: string; source: string }
  | { type: "flow"; title: string; steps: Step[]; loop?: Link; note?: string; tip?: string }
  | { type: "files"; title: string; files: FileCard[]; link?: Link; note?: string }
  | { type: "save"; title: string; rows: Row[] }
  | { type: "close"; cta: string; link?: string }

export type LocaleName = "en" | "vi"
export type Locale = { series: string; slides: Slide[] }
export type PostSpec = {
  slug: string
  claims: string
  sources: string[]
  locales: Record<LocaleName, Locale>
  publish: unknown
}

export const SIZE = { width: 1080, height: 1350 } as const

/** What the frame prints around every slide: the channel's name and its one hub link. */
export type Brand = { name: string; footer: string }

export const LOCALES: readonly LocaleName[] = ["en", "vi"]

const TONES: readonly string[] = ["accent", "danger", "ok", "muted", "plain"]

type Obj = Record<string, unknown>

const fail = (path: string, what: string): never => {
  throw new Error(`${path}: ${what}`)
}

const obj = (v: unknown, path: string): Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : fail(path, "expected an object")

const str = (v: unknown, path: string): string =>
  typeof v === "string" && v.length > 0 ? v : fail(path, "expected a non-empty string")

const optStr = (v: unknown, path: string): string | undefined => (v === undefined ? undefined : str(v, path))

const int = (v: unknown, path: string): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fail(path, "expected a non-negative integer")

const arr = (v: unknown, path: string): unknown[] =>
  Array.isArray(v) && v.length > 0 ? v : fail(path, "expected a non-empty array")

const tone = (v: unknown, path: string): Tone | undefined => {
  if (v === undefined) return undefined
  return typeof v === "string" && TONES.includes(v) ? (v as Tone) : fail(path, `unknown tone ${JSON.stringify(v)}`)
}

const list = <T>(v: unknown, path: string, each: (item: unknown, path: string) => T): T[] =>
  arr(v, path).map((item, i) => each(item, `${path}[${i}]`))

const link = (v: unknown, path: string, max: number): Link => {
  const o = obj(v, path)
  const from = int(o.from, `${path}.from`)
  const to = int(o.to, `${path}.to`)
  if (from >= max || to >= max) fail(path, `from/to must be below ${max}`)
  return { from, to, label: str(o.label, `${path}.label`) }
}

const step = (v: unknown, path: string): Step => {
  const o = obj(v, path)
  return {
    label: str(o.label, `${path}.label`),
    sub: optStr(o.sub, `${path}.sub`),
    code: optStr(o.code, `${path}.code`),
    tone: tone(o.tone, `${path}.tone`),
    branches:
      o.branches === undefined
        ? undefined
        : list(o.branches, `${path}.branches`, (b, p) => {
            const bo = obj(b, p)
            return { label: str(bo.label, `${p}.label`), sub: optStr(bo.sub, `${p}.sub`), tone: tone(bo.tone, `${p}.tone`) }
          }),
  }
}

const slide = (v: unknown, path: string): Slide => {
  const o = obj(v, path)
  const type = o.type
  switch (type) {
    case "cover":
      return {
        type,
        title: list(o.title, `${path}.title`, str),
        sub: optStr(o.sub, `${path}.sub`),
      }
    case "points":
      return {
        type,
        title: str(o.title, `${path}.title`),
        items: list(o.items, `${path}.items`, (it, p) => {
          const io = obj(it, p)
          return { text: str(io.text, `${p}.text`), tone: tone(io.tone, `${p}.tone`) }
        }),
        note: optStr(o.note, `${path}.note`),
      }
    case "quote":
      return {
        type,
        title: optStr(o.title, `${path}.title`),
        quote: str(o.quote, `${path}.quote`),
        source: str(o.source, `${path}.source`),
      }
    case "flow": {
      const steps = list(o.steps, `${path}.steps`, step)
      return {
        type,
        title: str(o.title, `${path}.title`),
        steps,
        loop: o.loop === undefined ? undefined : link(o.loop, `${path}.loop`, steps.length),
        note: optStr(o.note, `${path}.note`),
        tip: optStr(o.tip, `${path}.tip`),
      }
    }
    case "files": {
      const files = list(o.files, `${path}.files`, (f, p): FileCard => {
        const fo = obj(f, p)
        return {
          path: str(fo.path, `${p}.path`),
          tag: optStr(fo.tag, `${p}.tag`),
          reader: optStr(fo.reader, `${p}.reader`),
          lines: list(fo.lines, `${p}.lines`, (l, lp) => {
            const lo = obj(l, lp)
            return { text: str(lo.text, `${lp}.text`), tone: tone(lo.tone, `${lp}.tone`) }
          }),
        }
      })
      return {
        type,
        title: str(o.title, `${path}.title`),
        files,
        link: o.link === undefined ? undefined : link(o.link, `${path}.link`, files.length),
        note: optStr(o.note, `${path}.note`),
      }
    }
    case "save":
      return {
        type,
        title: str(o.title, `${path}.title`),
        rows: list(o.rows, `${path}.rows`, (r, p) => {
          const ro = obj(r, p)
          return { label: str(ro.label, `${p}.label`), code: str(ro.code, `${p}.code`) }
        }),
      }
    case "close":
      return { type, cta: str(o.cta, `${path}.cta`), link: optStr(o.link, `${path}.link`) }
    default:
      return fail(`${path}.type`, `unknown slide type ${JSON.stringify(type)}`)
  }
}

const locale = (v: unknown, path: string): Locale => {
  const o = obj(v, path)
  return { series: str(o.series, `${path}.series`), slides: list(o.slides, `${path}.slides`, slide) }
}

export const parsePost = (raw: unknown): PostSpec => {
  const o = obj(raw, "post")
  const locales = obj(o.locales, "post.locales")
  return {
    slug: str(o.slug, "post.slug"),
    claims: str(o.claims, "post.claims"),
    sources: list(o.sources, "post.sources", str),
    locales: { en: locale(locales.en, "post.locales.en"), vi: locale(locales.vi, "post.locales.vi") },
    publish: o.publish,
  }
}

/** `wtguard-layers` → `WtguardLayers`. */
