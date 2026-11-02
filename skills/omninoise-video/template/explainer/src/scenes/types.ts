import type React from "react"

/**
 * Everything a scene is told, and everything it is allowed to know about time.
 *
 * A scene module carries NO number about its own length — no duration, no tail,
 * no fallback. Those live in video.config.yaml, because the validator reads the
 * config and cannot execute TypeScript; two surfaces would be two ways to
 * disagree, and the one that lies is always the one nobody is looking at.
 */
export interface SceneProps {
  /**
   * The scene's full length, lead and tail included. Every reveal is cued as a
   * FRACTION of this via at(fraction, durationInFrames) — that is what lets a
   * translation re-time itself instead of needing its own table of cues.
   */
  readonly durationInFrames: number
  /** Frames of silence before the voice starts. Cue anything that must precede it. */
  readonly leadFrames: number
}

export type SceneComponent = React.FC<SceneProps>
