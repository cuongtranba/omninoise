import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

// Characterization of the backend over HTTP, booted through main.ts itself so
// the pipes, filters, body parsers, cookies and CORS are the production ones.
// These are the wire contracts the SPA (customFetch + layout.context.tsx), the
// public API clients and nginx (which strips /api/) rely on; a replacement
// for any route must keep them.

process.env.JWT_SECRET ||= 'main-spec-secret';
process.env.FRONTEND_URL ||= 'http://localhost:4200';
process.env.NEXT_PUBLIC_BACKEND_URL ||= 'http://localhost:3000';
process.env.STORAGE_PROVIDER ||= 'local';
process.env.UPLOAD_DIRECTORY ||= '/tmp/main-spec-uploads';

const run = randomBytes(6).toString('hex');
const prisma = new PrismaClient();
let base: string;
type Session = { org: string; auth: string };
const sessions = new Map<'a' | 'b', Session>();
const session = (name: 'a' | 'b') => sessions.get(name)!;

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

const signIn = async (name: 'a' | 'b') => {
  const user = await prisma.user.create({
    data: {
      email: `${name}-${run}@postiz.test`,
      providerName: 'LOCAL',
      timezone: 0,
      activated: true,
    },
  });
  const org = await prisma.organization.create({
    data: {
      name: `main-spec-${name}-${run}`,
      apiKey: `main-spec-${name}-${run}`,
    },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: org.id, role: 'SUPERADMIN' },
  });
  sessions.set(name, {
    org: org.id,
    auth: AuthService.signJWT({ id: user.id }),
  });
};

const call = (path: string, init: RequestInit = {}) =>
  fetch(base + path, { redirect: 'manual', ...init });

const json = (auth: string, body: unknown, headers = {}) => ({
  method: 'POST',
  headers: { auth, 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  execFileSync(
    'node_modules/.bin/prisma',
    [
      'db',
      'push',
      '--skip-generate',
      '--schema',
      'libraries/nestjs-libraries/src/database/prisma/schema.prisma',
    ],
    { env: process.env, stdio: 'pipe' }
  );
  await signIn('a');
  await signIn('b');

  const port = await freePort();
  process.env.PORT = String(port);
  base = `http://127.0.0.1:${port}`;
  // main.ts boots and listens on import, the way node runs it in production
  await import('@gitroom/backend/main');
  // wait for the liveness route, polling instead of sleeping a fixed time
  for (;;) {
    const up = await fetch(base + '/').then(
      (r) => r.ok,
      () => false
    );
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(async () => {
  const orgs = [...sessions.values()].map((s) => s.org);
  await prisma.signatures.deleteMany({
    where: { organizationId: { in: orgs } },
  });
  await prisma.userOrganization.deleteMany({
    where: { organizationId: { in: orgs } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.user.deleteMany({
    where: { email: { endsWith: `-${run}@postiz.test` } },
  });
  await prisma.$disconnect();
});

test('the backend serves internal paths and leaves the /api prefix to nginx', async () => {
  const { auth } = session('a');

  const internal = await call('/signatures', { headers: { auth } });
  const prefixed = await call('/api/signatures', { headers: { auth } });

  expect(internal.status).toBe(200);
  expect({ status: prefixed.status, body: await prefixed.json() }).toEqual({
    status: 404,
    body: {
      message: 'Cannot GET /api/signatures',
      error: 'Not Found',
      statusCode: 404,
    },
  });
});

test('a browser route without a valid session answers 401 with an empty body, clears the auth cookie and sends logout', async () => {
  const response = await call('/signatures', {
    headers: { auth: 'not-a-jwt' },
  });

  expect({
    status: response.status,
    body: await response.text(),
    logout: response.headers.get('logout'),
    cookie: response.headers.get('set-cookie'),
  }).toEqual({
    status: 401,
    body: '',
    logout: 'true',
    cookie: expect.stringMatching(
      /^auth=; Max-Age=-1; Domain=[^;]+; Path=\/; Expires=[^;]+; HttpOnly; Secure; SameSite=None$/
    ),
  });
});

test('an invalid DTO body is refused with the list of class-validator messages', async () => {
  const response = await call(
    '/signatures',
    json(session('a').auth, { content: 123 })
  );

  expect({ status: response.status, body: await response.json() }).toEqual({
    status: 400,
    body: {
      message: [
        'content must be a string',
        'autoAdd should not be null or undefined',
        'autoAdd must be a boolean value',
      ],
      error: 'Bad Request',
      statusCode: 400,
    },
  });
});

test('a created signature comes back with its dates as ISO strings, not Date objects', async () => {
  const { auth, org } = session('a');

  const created = await call(
    '/signatures',
    json(auth, { content: '<p>characterized</p>', autoAdd: false })
  );
  const { id } = await created.json();
  const list = await (await call('/signatures', { headers: { auth } })).json();

  expect(created.status).toBe(201);
  expect(list).toContainEqual({
    id,
    organizationId: org,
    content: '<p>characterized</p>',
    autoAdd: false,
    createdAt: expect.stringMatching(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
    ),
    updatedAt: expect.stringMatching(
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/
    ),
    deletedAt: null,
  });
});

test('showorg cannot reach an organization the user is not a member of', async () => {
  const [a, b] = [session('a'), session('b')];
  const { id } = await (
    await call(
      '/signatures',
      json(b.auth, { content: '<p>b</p>', autoAdd: false })
    )
  ).json();

  const asB = await call('/signatures', {
    headers: { auth: a.auth, showorg: b.org },
  });

  // an unknown showorg falls back to the user's own organization, no 403
  expect(asB.status).toBe(200);
  expect((await asB.json()).map((s: { id: string }) => s.id)).not.toContain(id);
});

test('the public API refuses a missing or unknown key with 401 and a msg body', async () => {
  const missing = await call('/public/v1/integrations');
  const unknown = await call('/public/v1/integrations', {
    headers: { authorization: `unknown-${run}` },
  });

  expect([
    { status: missing.status, body: await missing.json() },
    { status: unknown.status, body: await unknown.json() },
  ]).toEqual([
    { status: 401, body: { msg: 'No API Key found' } },
    { status: 401, body: { msg: 'Invalid API key' } },
  ]);
});

test('JSON bodies over the 100 kB default are refused, except on /posts which accepts up to 50 MB', async () => {
  const { auth } = session('a');
  const padding = 'x'.repeat(200_000);

  const signature = await call(
    '/signatures',
    json(auth, { content: padding, autoAdd: false })
  );
  // an invalid post is refused by validation, so nothing is created
  const post = await call('/posts', json(auth, { type: 'none', padding }));

  expect([signature.status, post.status]).toEqual([413, 400]);
});

test('a preflight from the frontend origin allows credentials and the session headers', async () => {
  const response = await call('/signatures', {
    method: 'OPTIONS',
    headers: {
      origin: process.env.FRONTEND_URL!,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'auth,showorg,content-type',
    },
  });

  expect({
    status: response.status,
    origin: response.headers.get('access-control-allow-origin'),
    credentials: response.headers.get('access-control-allow-credentials'),
    headers: response.headers.get('access-control-allow-headers'),
    exposed: response.headers.get('access-control-expose-headers'),
  }).toEqual({
    status: 204,
    origin: process.env.FRONTEND_URL,
    credentials: 'true',
    headers:
      'Content-Type,Authorization,auth,showorg,impersonate,x-postiz-org,x-postiz-include-deleted,x-copilotkit-runtime-client-gql-version',
    exposed:
      'reload,onboarding,activate,x-copilotkit-runtime-client-gql-version',
  });
});
