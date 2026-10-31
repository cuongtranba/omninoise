import { expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';

// Architecture test: the MCP must not drift behind the web app. Every web route
// needs an MCP tool that mirrors it (`mirrors` on the tool) or an entry in
// EXCLUDED with the reason it has no MCP equivalent.

const root = join(__dirname, '../../../..');
const webRoutesDir = join(root, 'apps/backend/src/api/routes');
const publicRoutesDir = join(root, 'apps/backend/src/public-api/routes');
const toolsDir = join(__dirname, 'tools');

// Routes with no meaningful MCP equivalent: route key -> reason.
// Reasons shared by many EXCLUDED routes
const AUTH_FLOW =
  'sign-in, registration and account-activation flow, not an agent action';
const BILLING = 'billing and payments are not managed through the MCP';
const UPLOAD_TRANSPORT =
  'upload transport internals, the MCP uploads through upload-from-url and the upload widget';
const OAUTH_SERVER =
  'OAuth 2.0 server endpoints that authenticate the MCP and other clients themselves';
const ENTERPRISE =
  "server-to-server enterprise provisioning authenticated by a signed partner token in the body, not an organization user's action";

const EXCLUDED: Record<string, string> = {
  // auth.controller
  'GET /auth/can-register': AUTH_FLOW,
  'POST /auth/register': AUTH_FLOW,
  'POST /auth/login': AUTH_FLOW,
  'POST /auth/forgot': AUTH_FLOW,
  'POST /auth/forgot-return': AUTH_FLOW,
  'GET /auth/oauth-mobile-callback': AUTH_FLOW,
  'GET /auth/oauth/:provider': AUTH_FLOW,
  'POST /auth/activate': AUTH_FLOW,
  'POST /auth/resend-activation': AUTH_FLOW,
  'POST /auth/farcaster/signer': AUTH_FLOW,
  'GET /auth/farcaster/signer': AUTH_FLOW,
  'POST /auth/oauth/:provider/redirect': AUTH_FLOW,
  'POST /auth/oauth/:provider/exists': AUTH_FLOW,
  // billing.controller
  'GET /billing/check/:id': BILLING,
  'GET /billing/check-discount': BILLING,
  'POST /billing/apply-discount': BILLING,
  'POST /billing/finish-trial': BILLING,
  'GET /billing/is-trial-finished': BILLING,
  'POST /billing/embedded': BILLING,
  'POST /billing/subscribe': BILLING,
  'POST /billing/sync': BILLING,
  'GET /billing/portal': BILLING,
  'GET /billing/invoices': BILLING,
  'GET /billing/renewal': BILLING,
  'GET /billing': BILLING,
  'POST /billing/cancel': BILLING,
  'POST /billing/prorate': BILLING,
  'GET /billing/charges': BILLING,
  'POST /billing/refund-charges': BILLING,
  'POST /billing/cancel-subscription': BILLING,
  'GET /billing/coupon-info': BILLING,
  'POST /billing/apply-coupon': BILLING,
  'POST /billing/cancel-coupon': BILLING,
  'GET /billing/chatbase-refund/preview': BILLING,
  'POST /billing/chatbase-refund': BILLING,
  'POST /billing/add-subscription': BILLING,
  // clipping.widget.controller
  'GET /clipping-widget/status':
    'transport of the browser clipping widget, the MCP drives it through the clipping widget tools',
  // copilot.controller
  'POST /copilot/chat':
    'transport of the in-app copilot runtime, the MCP is the agent surface itself',
  'POST /copilot/agent':
    'transport of the in-app copilot runtime, the MCP is the agent surface itself',
  // media.controller
  'POST /media/upload-server': UPLOAD_TRANSPORT,
  'POST /media/save-media': UPLOAD_TRANSPORT,
  'POST /media/upload-simple': UPLOAD_TRANSPORT,
  'POST /media/:endpoint':
    'chunked upload transport internals, the MCP uploads through upload-from-url and the upload widget',
  // media.widget.controller
  'POST /media-widget/upload':
    'transport of the browser upload widget, the MCP drives it through the upload widget tools',
  'GET /media-widget/status':
    'transport of the browser upload widget, the MCP drives it through the upload widget tools',
  // monitor.controller
  'GET /monitor/queue/:name': 'queue health probe for operators',
  // enterprise.controller
  'POST /enterprise/create-user': ENTERPRISE,
  'POST /enterprise/url': ENTERPRISE,
  'POST /enterprise/delete-channel': ENTERPRISE,
  // integrations.controller
  'POST /integrations/provider/:id/connect':
    'page picker completed in the browser after the OAuth callback of the channel connect flow',
  'GET /integrations/telegram/updates':
    'step of the Telegram browser connect flow, finds the bot of the connect dialog',
  'POST /integrations/moltbook/register':
    'step of the Moltbook browser connect flow, registers the agent of the connect dialog',
  'GET /integrations/moltbook/status':
    'step of the Moltbook browser connect flow, polls the claim of the connect dialog',
  'GET /integrations/:id':
    'marketplace order lookup (the channel of a post bought through an order), not used by the web app and the MCP has no marketplace',
  // no.auth.integrations.controller
  'POST /integrations/social-connect/:integration':
    'OAuth callback of the channel connect flow, completed in the browser',
  'POST /integrations/public/provider/:id/connect':
    'provider page picker completed in the browser after the OAuth callback',
  'POST /integrations/extension-refresh':
    'called only by the browser extension',
  // oauth.controller
  'POST /oauth/register': OAUTH_SERVER,
  'GET /oauth/authorize': OAUTH_SERVER,
  'POST /oauth/authorize/self-hosted': OAUTH_SERVER,
  'POST /oauth/token': OAUTH_SERVER,
  'GET /oauth/userinfo': OAUTH_SERVER,
  'POST /oauth/userinfo': OAUTH_SERVER,
  'GET /oauth/hubspot/callback': OAUTH_SERVER,
  'POST /oauth/authorize': OAUTH_SERVER,
  // payment.controller
  'POST /payment/:provider': 'payment provider webhook receiver',
  // posts.controller
  'GET /posts/group/:group/debug-export':
    'support download for the super admin of the instance (403 for everyone else), an organization member can never use it',
  // public.controller
  'POST /public/agent': 'internal endpoint guarded by a server secret',
  'GET /public/posts/:id': 'unauthenticated public preview page of the browser',
  'GET /public/posts/:id/comments':
    'unauthenticated public preview page of the browser',
  'POST /public/posts/:id/comments':
    'comment written by an anonymous visitor of the public preview page',
  'POST /public/t': 'browser tracking pixel',
  'POST /public/modify-subscription': 'billing webhook from the payment side',
  'GET /public/stream': 'media proxy of the browser player',
  // root.controller
  'GET /': 'app liveness probe',
  // stripe.controller
  'POST /stripe': 'Stripe webhook receiver',
  // users.controller
  'GET /user/chatbase-token':
    'identity token of the support chat widget in the frontend',
  'POST /user/impersonate': 'sets the impersonation cookie of the browser',
  'POST /user/switch': 'sets the session cookie of the browser',
  'POST /user/change-org':
    'sets the selected-organization cookie of the browser',
  'POST /user/logout': 'clears the session cookie of the browser',
  'POST /user/t': 'browser tracking pixel',
};

const list = (dir: string, suffix: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith(suffix))
    .map((f) => join(dir, f));

// 'METHOD /full/path' keys of every route of the controllers in `dir`
const parseRoutes = (dir: string): string[] => {
  const decorator =
    /^[ \t]*@(Controller|Get|Post|Put|Delete|Patch|All)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/gm;
  const routes: string[] = [];
  for (const file of list(dir, '.controller.ts')) {
    const source = readFileSync(file, 'utf8');
    // a decorator argument that is not a plain string (array, template with
    // variables, constant) would be skipped silently, so refuse it
    const unsupported = source.match(
      /^[ \t]*@(Controller|Get|Post|Put|Delete|Patch|All)\(\s*[^'"`)\s][^\n]*/m
    );
    if (unsupported) {
      throw new Error(
        `Unsupported route decorator in ${file}: ${unsupported[0]}`
      );
    }
    let prefix = '';
    for (const [, kind, , path = ''] of source.matchAll(decorator)) {
      if (kind === 'Controller') {
        prefix = path;
        continue;
      }
      const key = `/${prefix}/${path}`
        .replace(/\/+/g, '/')
        .replace(/(.)\/$/, '$1');
      routes.push(`${kind.toUpperCase()} ${key}`);
    }
  }
  return routes;
};

const webRoutes = [...new Set(parseRoutes(webRoutesDir))];
const publicRoutes = [...new Set(parseRoutes(publicRoutesDir))];
const tools = toolList.map((Tool) => new Tool());
const mirrored = new Set(tools.flatMap((tool) => tool.mirrors));

test('the route parser finds the web and public API routes', () => {
  expect(webRoutes.length).toBeGreaterThan(100);
  expect(publicRoutes.length).toBeGreaterThan(20);
  expect(webRoutes).toContain('POST /posts');
  expect(webRoutes).toContain('GET /integrations/list');
  expect(webRoutes).toContain('GET /media/:id/status');
  expect(publicRoutes).toContain('POST /public/v1/posts');
});

test('every web route is mirrored by an MCP tool or excluded with a reason', () => {
  const uncovered = webRoutes.filter(
    (route) => !mirrored.has(route) && !(route in EXCLUDED)
  );
  expect(
    uncovered,
    `These web routes have no MCP counterpart:\n${uncovered.join('\n')}\n` +
      `Every web route needs an MCP tool (in ${toolsDir}, registered in tool.list.ts) whose \`mirrors\` lists the route and that calls the same service method, ` +
      `or an entry in EXCLUDED in ${__filename} with the specific reason it has no MCP equivalent.`
  ).toEqual([]);
});

test('every tool mirror points at an existing route', () => {
  const known = new Set([...webRoutes, ...publicRoutes]);
  const stale = tools.flatMap((tool) =>
    tool.mirrors
      .filter((route) => !known.has(route))
      .map((route) => `${tool.name}: ${route}`)
  );
  expect(stale, `Stale \`mirrors\` entries:\n${stale.join('\n')}`).toEqual([]);
});

test('EXCLUDED only lists existing routes that no tool mirrors', () => {
  const known = new Set(webRoutes);
  const listed = Object.keys(EXCLUDED);
  expect({
    stale: listed.filter((route) => !known.has(route)),
    alreadyMirrored: listed.filter((route) => mirrored.has(route)),
  }).toEqual({ stale: [], alreadyMirrored: [] });
});

test('tools go through services, never a repository or Prisma', () => {
  const offenders = list(toolsDir, '.ts').filter((file) =>
    /from\s+['"][^'"]*\.repository['"]|PrismaService|PrismaRepository/.test(
      readFileSync(file, 'utf8')
    )
  );
  expect(offenders).toEqual([]);
});
