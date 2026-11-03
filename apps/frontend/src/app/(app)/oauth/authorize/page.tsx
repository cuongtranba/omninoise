import { OAuthAuthorize } from '@gitroom/frontend/components/oauth/authorize.component';
import { useLoggedIn } from '@gitroom/frontend/app/route.guard';

// signed-out visitors get the page too (sign in, or use self-hosted)
export default function OAuthAuthorizePage() {
  const logged = useLoggedIn();
  if (logged === undefined) {
    return null;
  }
  return <OAuthAuthorize logged={logged} />;
}
