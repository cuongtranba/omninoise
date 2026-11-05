'use client';

import { FC } from 'react';
import {
  DatePreset,
  formatDate,
  fromUtc,
} from '@gitroom/frontend/components/layout/set.timezone';
export const UtcToLocalDateRender: FC<{
  date: string;
  format: DatePreset;
}> = (props) => {
  const { date, format } = props;
  return <>{formatDate(fromUtc(date), format)}</>;
};
