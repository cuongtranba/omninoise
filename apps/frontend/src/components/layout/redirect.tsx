'use client';

import { FC, useEffect } from 'react';
import { useNavigate } from 'react-router';
export const Redirect: FC<{
  url: string;
  delay: number;
}> = (props) => {
  const { url, delay } = props;
  const navigate = useNavigate();
  useEffect(() => {
    setTimeout(() => {
      navigate(url);
    }, delay);
  }, []);
  return null;
};
