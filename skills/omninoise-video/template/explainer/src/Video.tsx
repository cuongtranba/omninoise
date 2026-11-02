import React from "react"
import { Sequence, staticFile } from "remotion"
import { Audio } from "@remotion/media"
import { linearTiming, TransitionSeries } from "@remotion/transitions"
import { fade } from "@remotion/transitions/fade"

import type { CaptionSegment } from "./captions"
import { DraftBadge } from "./components/draft-badge"
import { Overlay } from "./components/overlay"
import { CopyProvider } from "./content/use-copy"
import { SCENE_COMPONENTS, SCENE_ORDER, type SceneId } from "./generated/registry"
import { TIMELINE, type Locale, type SceneTiming } from "./generated/timeline"
import type { SceneComponent } from "./scenes/types"

export interface ScheduledScene {
  readonly id: SceneId
  readonly Component: SceneComponent
  readonly timing: SceneTiming
}

/**
 * Joins the two generated files: the registry says WHAT plays and in what
 * order, the timeline says how long each one lasts in this language. They are
 * matched by id rather than by position so neither has to know the other's
 * ordering, and a scene the timeline has not heard of is dropped instead of
 * crashing a render halfway through.
 */
export const scheduleFor = (locale: Locale): readonly ScheduledScene[] =>
  SCENE_ORDER.flatMap((id) => {
    const timing = TIMELINE[locale].scenes.find((scene) => scene.id === id)
    return timing ? [{ id, Component: SCENE_COMPONENTS[id], timing }] : []
  })

/**
 * Where each scene's audio begins on the video's timeline, for the captions.
 *
 * A scene starts where the previous one ends minus the cross-fade that overlaps
 * them, and its voice starts `leadFrames` after that, which is where `<Audio>`
 * is mounted below.
 */
export const captionSegments = (locale: Locale): readonly CaptionSegment[] => {
  let from = 0
  return scheduleFor(locale).map(({ id, timing }) => {
    const segment = { id, from, leadFrames: timing.leadFrames }
    from += timing.durationInFrames - TIMELINE[locale].transitionFrames
    return segment
  })
}

/**
 * The cut: every scene, cross-faded, each with its own narration track.
 *
 * Audio is mounted per scene rather than as one track over the timeline, so a
 * line moves with its scene when the scene's length changes — which it does
 * every time the narration is re-synthesized, and again in every language.
 *
 * Two things here are corrections of the reference this kit is ported from, and
 * both are easy to undo by accident:
 *
 * 1. The <Audio> is inside `<Sequence from={leadFrames}>`, not at the scene's
 *    frame 0. A cross-fade overlaps two scenes; a line mounted at 0 therefore
 *    starts speaking while the PREVIOUS scene is still on screen. That survives
 *    review only because synthesized speech tends to open on a beat of near
 *    silence — it is wrong on every line, and audible on the ones that do not.
 * 2. The gate is `hasAudio` (does the mp3 exist on disk), not "is there a
 *    narration string". A project with a written script and no audio yet is the
 *    NORMAL state of a fresh clone with no API key: it must render silently,
 *    with the draft badge on, rather than abort on a missing asset.
 */
export const Video: React.FC<{ locale: Locale }> = ({ locale }) => (
  <CopyProvider locale={locale}>
    <TransitionSeries>
      {scheduleFor(locale).map(({ id, Component, timing }, index) => (
        <React.Fragment key={id}>
          {index > 0 ? (
            <TransitionSeries.Transition
              presentation={fade()}
              timing={linearTiming({ durationInFrames: TIMELINE[locale].transitionFrames })}
            />
          ) : null}
          <TransitionSeries.Sequence durationInFrames={timing.durationInFrames} name={id}>
            <Component
              durationInFrames={timing.durationInFrames}
              leadFrames={timing.leadFrames}
            />
            {timing.hasAudio ? (
              <Sequence from={timing.leadFrames} name={`Voice — ${id}`}>
                <Audio src={staticFile(`voiceover/${locale}/${id}.mp3`)} />
              </Sequence>
            ) : null}
          </TransitionSeries.Sequence>
        </React.Fragment>
      ))}
    </TransitionSeries>

    <Overlay segments={captionSegments(locale)} />
    <DraftBadge locale={locale} />
  </CopyProvider>
)
