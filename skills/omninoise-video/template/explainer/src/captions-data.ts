import en from "../public/voiceover/en/alignment.json"
import vi from "../public/voiceover/vi/alignment.json"
import type { CharacterAlignment } from "./captions"
import type { Locale } from "./generated/timeline"

/**
 * Per-locale word timing. English: ElevenLabs' own character timing, saved by
 * scripts/voiceover-timestamps.ts. Vietnamese: ElevenLabs Forced Alignment of the
 * takes, saved in the same shape. Keyed by
 * `Locale`, so adding a language breaks this file until its timing is named.
 */
export const ALIGNMENT: Readonly<Record<Locale, Readonly<Record<string, CharacterAlignment>>>> = {
  en,
  vi,
}
