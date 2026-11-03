'use client';

import { lazy, Suspense } from 'react';

const ChangeDirComponent = lazy(() =>
  import('@gitroom/frontend/components/new-layout/change.dir').then((mod) => ({
    default: mod.ChangeDir,
  }))
);

export const ChangeDirClient = () => {
  return (
    <Suspense fallback={null}>
      <ChangeDirComponent />
    </Suspense>
  );
};
