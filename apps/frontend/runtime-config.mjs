// Single owner of the env -> browser config mapping. The SPA is built once and
// configured at container start: scripts/write-runtime-config.mjs writes the
// result next to the bundle and the dev server serves it from memory. Only
// public values may be returned here, never raw server secrets.

/**
 * @param {Record<string, string | undefined>} env
 */
export const buildRuntimeConfig = (env) => ({
  storageProvider: env.STORAGE_PROVIDER,
  environment: env.NODE_ENV,
  backendUrl: env.NEXT_PUBLIC_BACKEND_URL,
  plontoKey: env.NEXT_PUBLIC_POLOTNO,
  stripeClient: env.STRIPE_PUBLISHABLE_KEY,
  isChatBase: !!env.CHATBASE_TOKEN,
  billingEnabled: !!env.STRIPE_PUBLISHABLE_KEY,
  discordUrl: env.NEXT_PUBLIC_DISCORD_SUPPORT,
  frontEndUrl: env.FRONTEND_URL,
  isGeneral: !!env.IS_GENERAL,
  genericOauth: !!env.POSTIZ_GENERIC_OAUTH,
  oauthLogoUrl: env.NEXT_PUBLIC_POSTIZ_OAUTH_LOGO_URL,
  oauthDisplayName: env.NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME,
  uploadDirectory: env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY,
  cloudflareUrl: env.CLOUDFLARE_BUCKET_URL || '',
  mainUrl: env.MAIN_URL || '',
  mcpUrl: env.MCP_URL,
  dub: !!env.STRIPE_PUBLISHABLE_KEY,
  facebookPixel: env.NEXT_PUBLIC_FACEBOOK_PIXEL,
  telegramBotName: env.TELEGRAM_BOT_NAME,
  neynarClientId: env.NEYNAR_CLIENT_ID,
  appleClientId: env.APPLE_CLIENT_ID,
  isSecured: !env.NOT_SECURED,
  disableImageCompression: !!env.DISABLE_IMAGE_COMPRESSION,
  disableXAnalytics: !!env.DISABLE_X_ANALYTICS,
  sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN,
  extensionId: env.EXTENSION_ID || '',
  googleAdsId: env.NEXT_PUBLIC_GTM_ID,
  googleAdsTrialTracking: env.NEXT_PUBLIC_TRACKING_TRIAL,
  recaptchaSiteKey: env.RECAPTCHA_SITE_KEY || '',
  mediaProcessing:
    env.STORAGE_PROVIDER === 'cloudflare' &&
    !!env.RUNPOD_API_KEY &&
    !!env.RUNPOD_ENDPOINT_ID,
  transloadit:
    env.TRANSLOADIT_AUTH && env.TRANSLOADIT_TEMPLATE
      ? [env.TRANSLOADIT_AUTH, env.TRANSLOADIT_TEMPLATE]
      : [],
  disableRegistration: env.DISABLE_REGISTRATION === 'true',
  datafastWebsiteId: env.DATAFAST_WEBSITE_ID || '',
  plausibleDomain: env.STRIPE_PUBLISHABLE_KEY
    ? env.IS_GENERAL
      ? 'postiz.com'
      : 'gitroom.com'
    : '',
});

// `<`, `>` and `&` are escaped so a value can never close the script tag if the
// text is ever inlined into HTML, and U+2028/U+2029 are not valid in older JS.
export const renderRuntimeConfigScript = (env) =>
  `window.__RUNTIME_CONFIG__=${JSON.stringify(buildRuntimeConfig(env))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')};\n`;
