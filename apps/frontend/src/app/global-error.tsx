import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { useRouteError } from 'react-router';

// Router errorElement: it replaces a root layout, so the variables context is
// not mounted here and the report can't be gated on its DSN. Without a Sentry
// client captureException is a no-op, and beforeSend already opens the report
// dialog for captured exceptions.
export default function GlobalError() {
  const error = useRouteError();
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="bg-[#0E0E0E] text-white min-h-screen w-screen flex flex-col gap-[12px] items-center justify-center">
      <h2 className="text-[20px]">
        Application error: a client-side exception has occurred
      </h2>
      <button
        className="underline hover:font-bold"
        onClick={() => window.location.reload()}
      >
        Refresh the page
      </button>
    </div>
  );
}
