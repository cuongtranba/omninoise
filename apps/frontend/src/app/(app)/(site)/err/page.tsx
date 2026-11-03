import { useT } from '@gitroom/react/translation/get.transation.service.client';

export default function Page() {
  const t = useT();
  return (
    <>
      <title>Error</title>
      <div>
        {t(
          'we_are_experiencing_some_difficulty_try_to_refresh_the_page',
          'We are experiencing some difficulty, try to refresh the page'
        )}
      </div>
    </>
  );
}
