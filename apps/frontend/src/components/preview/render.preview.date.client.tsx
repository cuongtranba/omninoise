'use client';

import { lazy, Suspense } from 'react';

const RenderPreviewDate = lazy(() =>
  import('@gitroom/frontend/components/preview/render.preview.date').then(
    (mod) => ({ default: mod.RenderPreviewDate })
  )
);

export const RenderPreviewDateClient = ({ date }: { date: string }) => {
  return (
    <Suspense fallback={null}>
      <RenderPreviewDate date={date} />
    </Suspense>
  );
};
