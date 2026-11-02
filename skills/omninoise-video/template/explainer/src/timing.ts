/**
 * The two functions a scene needs to place something in time, mirroring the Go
 * core so a cue means the same thing to the validator and to the frame.
 *
 * Neither reads the timeline. A scene is TOLD how long it lasts; it never looks
 * its own length up, because a module that can read the table can also hold a
 * number that contradicts it.
 */

/**
 * A reveal cue expressed as a fraction of its scene, converted to a frame.
 *
 * This is what makes a second language nearly free. Cues tuned against one
 * voice and kept as absolute frames drift out of sync with the sentence
 * explaining them the moment a translation changes the scene's length; as
 * fractions they re-time themselves.
 */
export const at = (fraction: number, durationInFrames: number): number =>
  Math.round(fraction * durationInFrames)

export interface BeatSpan {
  readonly from: number
  readonly durationInFrames: number
}

/**
 * Relative beat lengths within a scene, scaled to whatever it lasts in this
 * language.
 *
 * Weights, not frames — a beat that should hold twice as long as its neighbour
 * says `2`, and stays twice as long when the scene grows. Each span's edges are
 * rounded from the CUMULATIVE fraction rather than from its own width, so the
 * spans tile the scene exactly: rounding each width independently leaves gaps
 * that flicker at the seams.
 */
export const beatSpans = (
  weights: readonly number[],
  durationInFrames: number,
): readonly BeatSpan[] => {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) {
    return []
  }

  let consumed = 0
  return weights.map((weight) => {
    const from = Math.round((consumed / total) * durationInFrames)
    consumed += weight
    return { from, durationInFrames: Math.round((consumed / total) * durationInFrames) - from }
  })
}
