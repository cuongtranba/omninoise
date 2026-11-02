import React from "react"
import { Composition, Folder, Still } from "remotion"

import { DraftBadge } from "./components/draft-badge"
import { Cover, Thumb } from "./cover"
import { Overlay } from "./components/overlay"
import { CopyProvider } from "./content/use-copy"
import {
  COMPOSITION_ID,
  DEFAULT_LOCALE,
  FPS,
  HEIGHT,
  LOCALES,
  TIMELINE,
  WIDTH,
} from "./generated/timeline"
import { scheduleFor, Video } from "./Video"

/**
 * Scenes are registered on their own as well as inside each cut, so
 * double-clicking a sequence in the Studio timeline opens that scene in
 * isolation — the difference between scrubbing a two-minute timeline to reach
 * beat seven and just opening it.
 *
 * Only the default locale gets that treatment: they exist for checking layout,
 * and one more entry per scene per language would bury the compositions anyone
 * actually renders.
 *
 * `leadFrames` is passed through so an isolated scene is timed exactly as it is
 * in the cut. A standalone that started its reveals at 0 would look right on its
 * own and land early everywhere else.
 */
const STANDALONE_SCENES = scheduleFor(DEFAULT_LOCALE).map(({ id, Component, timing }) => {
  const Standalone: React.FC = () => (
    <CopyProvider locale={DEFAULT_LOCALE}>
      <Component durationInFrames={timing.durationInFrames} leadFrames={timing.leadFrames} />
      <Overlay segments={[{ id, from: 0, leadFrames: timing.leadFrames }]} progress={false} />
      <DraftBadge locale={DEFAULT_LOCALE} />
    </CopyProvider>
  )
  // Built once at module scope: a component identity created during render
  // would be a different type every frame, remounting the scene under it.
  return { id, Standalone, durationInFrames: timing.durationInFrames }
})

/**
 * One composition per locale, derived from LOCALES × TIMELINE — so a new
 * language is a config edit plus a content file, never a change here.
 */
export const RemotionRoot: React.FC = () => (
  <>
    {LOCALES.map((locale) => (
      <Composition
        key={locale}
        id={COMPOSITION_ID[locale]}
        component={Video}
        defaultProps={{ locale }}
        durationInFrames={TIMELINE[locale].totalFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />
    ))}

    <Folder name="Scenes">
      {STANDALONE_SCENES.map(({ id, Standalone, durationInFrames }) => (
        <Composition
          key={id}
          id={id}
          component={Standalone}
          durationInFrames={durationInFrames}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      ))}
    </Folder>

    {/* Platform covers, one pair per locale: render with `bun run covers` (see src/cover.tsx). */}
    <Folder name="Covers">
      {LOCALES.map((locale) => (
        <React.Fragment key={locale}>
          <Still id={locale === DEFAULT_LOCALE ? "Cover" : `Cover-${locale}`} component={Cover} defaultProps={{ locale }} width={1080} height={1920} />
          <Still id={locale === DEFAULT_LOCALE ? "Thumb" : `Thumb-${locale}`} component={Thumb} defaultProps={{ locale }} width={1280} height={720} />
        </React.Fragment>
      ))}
    </Folder>
  </>
)
