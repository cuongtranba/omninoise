import { describe, expect, test } from "bun:test"

import { toThreeColor } from "./color"

const channels = (hex: string) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

describe("toThreeColor", () => {
  test("the achromatic ends of the scale land on black and white", () => {
    expect(toThreeColor("oklch(0% 0 0)")).toBe("#000000")
    expect(toThreeColor("oklch(100% 0 0)")).toBe("#ffffff")
  })

  test("a mid grey stays grey — all three channels agree", () => {
    const [r, g, b] = channels(toThreeColor("oklch(50% 0 0)"))
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1)
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(255)
  })

  test("the kit's accent converts to a red, not to the white three falls back to", () => {
    const hex = toThreeColor("oklch(71.2% 0.194 13.428)")
    const [r, g, b] = channels(hex)
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
    expect(hex).not.toBe("#ffffff")
  })

  test("lightness ordering is preserved", () => {
    const dark = channels(toThreeColor("oklch(23% 0.01 13)"))[0]
    const light = channels(toThreeColor("oklch(98% 0.003 13)"))[0]
    expect(light).toBeGreaterThan(dark)
  })

  test("a bare 0-1 lightness is read the same as its percentage", () => {
    expect(toThreeColor("oklch(0.5 0 0)")).toBe(toThreeColor("oklch(50% 0 0)"))
  })

  test("slash alpha is tolerated and ignored — three takes opacity separately", () => {
    expect(toThreeColor("oklch(50% 0 0 / 0.5)")).toBe(toThreeColor("oklch(50% 0 0)"))
  })

  test("anything three already understands passes straight through", () => {
    for (const css of ["#ff0000", "rgb(1, 2, 3)", "hotpink"]) {
      expect(toThreeColor(css)).toBe(css)
    }
  })

  test("out-of-gamut values clamp instead of producing a broken hex", () => {
    const hex = toThreeColor("oklch(99% 0.4 140)")
    expect(hex).toMatch(/^#[0-9a-f]{6}$/)
  })

  test("determinism", () => {
    expect(toThreeColor("oklch(71.2% 0.194 13.428)")).toBe(
      toThreeColor("oklch(71.2% 0.194 13.428)"),
    )
  })
})
