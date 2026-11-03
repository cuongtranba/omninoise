'use client';

import { FC, useEffect } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';

export const FacebookComponent: FC = () => {
  const { facebookPixel } = useVariables();
  useEffect(() => {
    // like next/script, an id keeps the pixel from loading twice
    if (!facebookPixel || document.getElementById('fb-pixel')) {
      return;
    }
    const script = document.createElement('script');
    script.id = 'fb-pixel';
    script.text = `!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'/f.js');
fbq('init', '${facebookPixel}');
`;
    document.body.appendChild(script);
  }, [facebookPixel]);
  return null;
};
