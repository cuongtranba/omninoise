export const browserLocale = () =>
  navigator.languages?.[0] || navigator.language;

// the browser locale's clock, resolved once: 12h locales (h11, h12) are US
let browserUsesTwelveHours: boolean | undefined;
const browserClock = () => {
  if (browserUsesTwelveHours === undefined) {
    // hourCycle is missing from the es2020 typings of the resolved options
    const { hourCycle } = new Intl.DateTimeFormat(browserLocale(), {
      hour: 'numeric',
    }).resolvedOptions() as { hourCycle?: string };
    browserUsesTwelveHours = hourCycle === 'h11' || hourCycle === 'h12';
  }
  return browserUsesTwelveHours ? 'US' : 'GLOBAL';
};

export const isUSCitizen = () => {
  const userLanguage = localStorage.getItem('isUS') || browserClock();
  return userLanguage === 'US';
};
