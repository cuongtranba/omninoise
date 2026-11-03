'use client';

import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { FC, useEffect } from 'react';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
export const IntegrationRedirectComponent: FC = () => {
  const offset = newDayjs().utcOffset();
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const newUrl = `${pathname}/continue?${searchParams.toString()}&timezone=${offset}`;
  useEffect(() => {
    navigate(newUrl);
  }, [newUrl]);
  return null;
};
