import { getAuth } from '@gitroom/nestjs-libraries/chat/async.storage';

export const checkAuth = (
  inputData: any,
  context: any
) => {
  const auth = getAuth();
  const authInfo = context?.mcp?.extra?.authInfo || auth;
  if (authInfo && context?.requestContext) {
    (context.requestContext as any).set(
      'organization',
      JSON.stringify(authInfo)
    );
    (context.requestContext as any).set('ui', 'false');
  }
};

// The error of a tool: the not found message for a record that does not exist
// (Prisma P2025), the fallback for any other database error, whose message
// names tables and queries, and the message of anything else
export const toolErrorMessage = (
  err: any,
  notFoundMessage: string,
  fallbackMessage: string
) =>
  err?.code === 'P2025'
    ? notFoundMessage
    : err?.clientVersion
    ? fallbackMessage
    : err?.message || fallbackMessage;
