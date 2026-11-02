import { describe, expect, test } from "bun:test"

import { captionAt, captionTrack, type CharacterAlignment } from "./captions"

// A tenth of a second per character, and a pause after each sentence.
const alignmentFor = (text: string, startAt = 0): CharacterAlignment => {
  const characters = [...text]
  const starts: number[] = []
  const ends: number[] = []
  let clock = startAt
  for (const character of characters) {
    starts.push(clock)
    clock += 0.1
    ends.push(clock)
    if (character === ".") clock += 0.6
  }
  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  }
}

const FPS = 30

describe("captionTrack", () => {
  const track = captionTrack(
    [
      { id: "One", from: 0, leadFrames: 10 },
      { id: "Two", from: 100, leadFrames: 20 },
    ],
    { One: alignmentFor("Stop trying to make it so."), Two: alignmentFor("Then stop.") },
    FPS,
  )

  test("shows one to three words per beat and closes a beat at a sentence end", () => {
    expect(track.map((beat) => beat.words.map((word) => word.text).join(" "))).toEqual([
      "Stop trying to",
      "make it so.",
      "Then stop.",
    ])
  })

  test("starts a scene's first caption when its voice starts, after the scene's lead", () => {
    // Audio is mounted leadFrames into the scene, so word 0 lands on from + lead.
    expect(track[0]!.from).toBe(10)
    expect(track[2]!.from).toBe(100 + 20)
  })

  test("never has two beats on screen at once, and highlights the word being spoken", () => {
    for (let index = 1; index < track.length; index++) {
      expect(track[index]!.from).toBeGreaterThanOrEqual(track[index - 1]!.to)
    }

    // "trying" starts 0.5 s into the first take: frame 10 + 15.
    expect(captionAt(track, 10 + 14)?.active).toBe(0)
    expect(captionAt(track, 10 + 15)?.active).toBe(1)
    expect(captionAt(track, 5)).toBeUndefined()
  })
})
