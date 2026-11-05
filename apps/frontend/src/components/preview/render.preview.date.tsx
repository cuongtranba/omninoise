'use client';

import { FC } from 'react';
import {
  formatDate,
  fromUtc,
} from '@gitroom/frontend/components/layout/set.timezone';

export const RenderPreviewDate: FC<{ date: string }> = ({ date }) => {
  console.log(date);
  return <>{formatDate(fromUtc(date), 'mediumDateTime')}</>;
};
