import { useParams, useSearchParams } from 'react-router';
import { ContinueIntegration } from '@gitroom/frontend/components/launches/continue.integration';
import { useLoggedIn } from '@gitroom/frontend/app/route.guard';

export default function Page() {
  const { provider } = useParams();
  const [searchParams] = useSearchParams();
  const logged = useLoggedIn();
  if (logged === undefined) {
    return null;
  }
  return (
    <ContinueIntegration
      searchParams={Object.fromEntries(searchParams)}
      provider={provider!}
      logged={logged}
    />
  );
}
