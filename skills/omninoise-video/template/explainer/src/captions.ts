/**
 * Burned-in captions, timed from the voice.
 *
 * ElevenLabs' /with-timestamps endpoint returns, for each take, when every
 * character starts and ends (scripts/voiceover-timestamps.ts saves that
 * untouched in public/voiceover/<locale>/alignment.json). This module turns it
 * into words, groups the words into short beats, and places each beat on the
 * video's frame timeline, where the audio of a scene starts `leadFrames` after
 * the scene itself.
 *
 * Pure functions of data: no React, no clock. The overlay only asks "which beat
 * is on at this frame".
 */

export interface CharacterAlignment {
  readonly characters: readonly string[]
  readonly character_start_times_seconds: readonly number[]
  readonly character_end_times_seconds: readonly number[]
}

export interface Word {
  readonly text: string
  readonly start: number
  readonly end: number
}

/** Splits the character timing into words; punctuation stays attached to its word. */
export const wordsFrom = (alignment: CharacterAlignment): readonly Word[] => {
  const words: Word[] = []
  let text = ""
  let start = 0
  let end = 0

  alignment.characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (text) words.push({ text, start, end })
      text = ""
      return
    }
    if (!text) start = alignment.character_start_times_seconds[index] ?? 0
    text += character
    end = alignment.character_end_times_seconds[index] ?? end
  })
  if (text) words.push({ text, start, end })

  return words
}

const CLAUSE_END = /[.,;:!?]$/

export interface BeatOptions {
  readonly maxWords: number
  /** Characters on one caption line at the caption size; longer beats wrap. */
  readonly maxChars: number
}

export const DEFAULT_BEATS: BeatOptions = { maxWords: 3, maxChars: 17 }

/** Groups words into beats of one to `maxWords`, closing a beat at every clause end. */
export const beatsFrom = (
  words: readonly Word[],
  options: BeatOptions = DEFAULT_BEATS,
): readonly (readonly Word[])[] => {
  const beats: Word[][] = []
  let current: Word[] = []

  for (const word of words) {
    const joined = [...current, word].map((w) => w.text).join(" ")
    if (current.length > 0 && (current.length >= options.maxWords || joined.length > options.maxChars)) {
      beats.push(current)
      current = []
    }
    current.push(word)
    if (CLAUSE_END.test(word.text)) {
      beats.push(current)
      current = []
    }
  }
  if (current.length > 0) beats.push(current)

  return beats
}

export interface CaptionBeat {
  /** First frame the beat is on screen. */
  readonly from: number
  /** First frame it is no longer on screen. */
  readonly to: number
  readonly words: readonly { readonly text: string; readonly from: number }[]
}

export interface CaptionSegment {
  readonly id: string
  /** Frame the scene begins on the video's timeline. */
  readonly from: number
  /** Frames between the scene's start and its voice. */
  readonly leadFrames: number
}

/** A beat lingers this long after its last word, unless the next beat arrives first. */
const HOLD_SECONDS = 0.2
/** A pause longer than this blanks the caption instead of holding it. */
const MAX_BRIDGE_SECONDS = 0.45

/** Every beat of the video, in absolute frames, in order and never overlapping. */
export const captionTrack = (
  segments: readonly CaptionSegment[],
  alignments: Readonly<Record<string, CharacterAlignment>>,
  fps: number,
  options: BeatOptions = DEFAULT_BEATS,
): readonly CaptionBeat[] => {
  const beats: CaptionBeat[] = []

  for (const segment of segments) {
    const alignment = alignments[segment.id]
    if (!alignment) continue

    const origin = segment.from + segment.leadFrames
    const grouped = beatsFrom(wordsFrom(alignment), options)

    grouped.forEach((beat, index) => {
      const first = beat[0]!
      const last = beat[beat.length - 1]!
      const next = grouped[index + 1]?.[0]
      const bridged = next !== undefined && next.start - last.end < MAX_BRIDGE_SECONDS
      const endSeconds = bridged ? next.start : last.end + HOLD_SECONDS

      beats.push({
        from: origin + Math.round(first.start * fps),
        to: origin + Math.round(endSeconds * fps),
        words: beat.map((word) => ({ text: word.text, from: origin + Math.round(word.start * fps) })),
      })
    })
  }

  // A scene's final beat holds past its audio; the next scene's lead keeps the
  // two apart, but the guarantee belongs here, not in the config.
  return beats.map((beat, index) => {
    const next = beats[index + 1]
    return next && beat.to > next.from ? { ...beat, to: next.from } : beat
  })
}

/** The beat on screen at `frame`, and which of its words is being spoken. */
export const captionAt = (
  track: readonly CaptionBeat[],
  frame: number,
): { readonly beat: CaptionBeat; readonly active: number } | undefined => {
  const beat = track.find((candidate) => frame >= candidate.from && frame < candidate.to)
  if (!beat) return undefined

  let active = 0
  beat.words.forEach((word, index) => {
    if (frame >= word.from) active = index
  })
  return { beat, active }
}
