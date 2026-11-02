# Connect or reconnect a channel

Only the owner signs in, types passwords, captchas and 2FA codes, and approves a consent screen. An agent prepares the link and checks the result.

1. If the platform needs developer app keys you have not added yet, add them to the instance's environment first and redeploy (the app's own setup page lists which keys).
2. Get a connect link: `integrationConnectTool` with the provider `identifier` (from `integrationProvidersTool`; `reconnectChannelId` to reconnect). It returns a link valid for one hour. Or open the dashboard, **Add Channel**, and pick the provider.
3. The owner opens the link, signs in as the **brand account** (not a personal one) and approves the consent screen.
4. Back in the dashboard, finish any **Configure Channel** step. A YouTube brand channel needs the channel picked, or the integration stays `inBetweenSteps` and every post to it fails.
5. Check with `integrationList` or `omninoise channels`: the channel is listed, not `disabled`, not `refreshNeeded`, not `inBetweenSteps`. Write its id into `channels.<kind>.integration` in the profile.

If the dashboard calendar spins for about 60 seconds, that is the AI chat endpoint timing out when no `OPENAI_API_KEY` is set. It is not an error and the API is unaffected; wait, or use the API.

## Platform notes

- **TikTok.** The app must list every scope the instance requests (six), or TikTok shows "scope" on its error page. A sandbox app only works for its target users. Use the "Tiktok" tile, not "TikTok (Business)".
- **Facebook.** Grant the one page only, not "all current and future pages".
- **YouTube.** Pick the brand account. On an unverified-app screen choose Advanced, then "Go to <your domain> (unsafe)", and tick every permission.
- **Instagram.** Use "Instagram (Standalone)". The account must be a Professional (Creator) account. While your Meta app is in Development mode it must also be an **Instagram Tester** on that app, with the invite accepted in Instagram > Settings > Apps and websites > Tester Invites. Without the tester role the instance answers 409 "Invalid API key" and logs nothing.
- **Threads.** The account must be a Threads tester on your Meta app and must have accepted the invite in Threads > Settings > Account > Website permissions.
- **Meta apps in Development mode** publish posts only app roles can see. Put the app Live, then check a post logged out.
- **Consent clicks.** Instagram and Threads consent buttons sometimes ignore the first click. Click again with a real mouse click at the coordinates of a screenshot. To see why a connect failed, watch `POST /integrations/social-connect/<provider>` in the browser's network tab.
- **Do not change the owner's personal accounts.** Connect and edit only the brand accounts.
