import {
  mkdirSync,
  mkdtempSync,
  statSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { stringify } from 'yaml';
import { run } from './cli';
import { Context } from './context';

// ---- Fixtures: a fake Omninoise server that records every request, and a small project on disk ----

type Seen = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

const servers: Server[] = [];
afterEach(() => {
  for (const s of servers.splice(0)) {
    s.close();
    s.closeAllConnections();
  }
});

const startServer = async () => {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      const path = req.url!.split('?')[0];
      seen.push({ method: req.method!, path, headers: req.headers, body });
      const base = `http://${req.headers.host}`;
      const json = (value: unknown) =>
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(value));
      if (
        path === '/.well-known/oauth-authorization-server/mcp-oauth-dynamic'
      ) {
        return json({
          authorization_endpoint: `${base}/oauth/authorize`,
          token_endpoint: `${base}/oauth/token`,
          registration_endpoint: `${base}/oauth/register`,
        });
      }
      if (path === '/oauth/register') return json({ client_id: 'pcd_test' });
      if (path === '/oauth/token') {
        return json({
          access_token: 'pos_secrettoken',
          token_type: 'bearer',
          id: 'org1',
        });
      }
      if (path === '/public/v1/me') {
        return json({
          organization: { id: 'org1', name: 'Acme' },
          user: { id: 'u1', name: 'Ada' },
        });
      }
      if (path === '/public/v1/upload') {
        const name = /filename="([^"]+)"/.exec(body)![1];
        return json({ id: `media-${name}`, path: `${base}/uploads/${name}` });
      }
      if (path === '/public/v1/posts') return json([{ postId: 'p1' }]);
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return {
    seen,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
};

const PROFILE = {
  instance: { url: 'https://omninoise.example.com/api' },
  brand: { name: 'Example', hub: 'https://example.com/links' },
  ban: ['internal.example.com'],
  hashtag_ban: ['studio'],
  ai_disclosure: {
    en: 'AI-generated (voice|music|art)',
    vi: '(Giọng đọc|Nhạc|Hình) do AI tạo',
  },
  channels: {
    youtube: {
      integration: 'yt1',
      language: 'en',
      footer: 'All channels: https://example.com/links',
      hashtags: [2, 3],
    },
    facebook: {
      integration: 'fb1',
      language: 'vi-first',
      footer: 'Theo dõi: https://example.com/links',
      hashtags: [1, 2],
    },
  },
};

const PUBLISH = {
  title: 'Demo',
  caption: 'Hello. AI-generated voice.',
  link: 'https://example.org/post',
  hashtags: { youtube: ['a', 'b'], youtube_tags: ['x'], facebook: ['f1'] },
  caption_vi_first:
    'Xin chào. Giọng đọc do AI tạo.\n\nHello. AI-generated voice.',
  title_vi: 'Bản demo',
};

/** A project folder `proj` with a profile above it and the files publish needs. */
const makeProject = (publish: Record<string, unknown> = PUBLISH) => {
  const root = mkdtempSync(join(tmpdir(), 'omninoise-cli-'));
  const dir = join(root, 'projects', 'proj');
  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(join(root, 'omninoise.profile.yaml'), stringify(PROFILE));
  writeFileSync(join(dir, 'publish.yaml'), stringify(publish));
  for (const f of [
    'proj-1080x1920.mp4',
    'proj-vi-1080x1920.mp4',
    'thumb-1280x720.jpg',
  ]) {
    writeFileSync(join(dir, 'out', f), 'bytes');
  }
  return { root, dir };
};

const exec = async (
  argv: string[],
  env: Record<string, string>,
  openBrowser: Context['openBrowser'] = () => undefined
) => {
  let stdout = '';
  let stderr = '';
  const code = await run(argv, {
    env,
    cwd: tmpdir(),
    stdout: { write: (s) => (stdout += s) },
    stderr: { write: (s) => (stderr += s) },
    openBrowser,
    confirm: async () => false,
  });
  return { code, stdout, stderr };
};

const AT = '2026-11-05T12:00:00Z';

// ---- publish ----

test('publish --dry-run builds each channel its own cut, caption and footer without touching the network', async () => {
  const { dir } = makeProject();
  const { code, stdout } = await exec(
    ['publish', dir, '--at', AT, '--dry-run'],
    {}
  );
  const media = 'https://omninoise.example.com/uploads/dry';

  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toEqual({
    type: 'schedule',
    date: AT,
    shortLink: false,
    tags: [],
    creationMethod: 'CLI',
    posts: [
      {
        integration: { id: 'yt1' },
        value: [
          {
            content:
              'Hello. AI-generated voice.\n#a #b\n\nFull write-up: https://example.org/post\nAll channels: https://example.com/links\n#Shorts',
            image: [
              {
                id: 'dry',
                path: `${media}/proj-1080x1920.mp4`,
                thumbnail: `${media}/thumb-1280x720.jpg`,
              },
            ],
          },
        ],
        settings: {
          __type: 'youtube',
          title: 'Demo #Shorts',
          type: 'public',
          selfDeclaredMadeForKids: 'no',
          tags: [{ value: 'x', label: 'x' }],
        },
      },
      {
        integration: { id: 'fb1' },
        value: [
          {
            content:
              'Xin chào. Giọng đọc do AI tạo.\n\nHello. AI-generated voice.\n#f1\n\nFull write-up: https://example.org/post\nTheo dõi: https://example.com/links',
            image: [{ id: 'dry', path: `${media}/proj-vi-1080x1920.mp4` }],
          },
        ],
        settings: { __type: 'facebook', post_type: 'post', title: 'Bản demo' },
      },
    ],
  });
});

test.each([
  [
    'a banned string',
    { ...PUBLISH, link: 'https://internal.example.com/x' },
    'internal.example.com',
  ],
  ['no AI disclosure', { ...PUBLISH, caption: 'Hello.' }, 'AI disclosure'],
  [
    'hashtags out of range',
    { ...PUBLISH, hashtags: { ...PUBLISH.hashtags, youtube: ['a'] } },
    'hashtags.youtube',
  ],
])(
  'publish refuses %s before anything reaches the server',
  async (_name, publish, message) => {
    const { dir } = makeProject(publish);
    const { seen, url } = await startServer();
    const { code, stderr } = await exec(['publish', dir, '--at', AT], {
      OMNINOISE_API_KEY: 'key-123',
      OMNINOISE_URL: url,
    });

    expect(code).toBe(1);
    expect(stderr).toContain(message);
    expect(seen).toEqual([]);
  }
);

test('publish uploads the files, then POSTs the posts with the raw key and creationMethod CLI', async () => {
  const { dir } = makeProject();
  const { seen, url } = await startServer();
  const { code, stdout } = await exec(['publish', dir, '--at', AT], {
    OMNINOISE_API_KEY: 'key-123',
    OMNINOISE_URL: url,
  });

  expect(code).toBe(0);
  expect(seen.map((r) => `${r.method} ${r.path}`)).toEqual([
    'POST /public/v1/upload',
    'POST /public/v1/upload',
    'POST /public/v1/upload',
    'POST /public/v1/posts',
  ]);
  const posted = seen[3];
  expect(posted.headers.authorization).toBe('key-123');
  const body = JSON.parse(posted.body);
  expect(body.creationMethod).toBe('CLI');
  expect(body.posts[1].value[0].image).toEqual([
    {
      id: 'media-proj-vi-1080x1920.mp4',
      path: `${url}/uploads/proj-vi-1080x1920.mp4`,
    },
  ]);
  expect(JSON.parse(stdout).result).toEqual([{ postId: 'p1' }]);
});

// ---- auth:login ----

/** Plays the browser: opens the authorize URL's redirect_uri with a code and the given state. */
const approve =
  (state?: string, seenStatus?: { status?: number }): Context['openBrowser'] =>
  async (authorizeUrl) => {
    const u = new URL(authorizeUrl);
    const callback = new URL(u.searchParams.get('redirect_uri')!);
    callback.searchParams.set('code', 'authcode');
    callback.searchParams.set('state', state ?? u.searchParams.get('state')!);
    const res = await fetch(callback);
    if (seenStatus) seenStatus.status = res.status;
  };

test('auth:login registers, exchanges the code and saves a 0600 credentials file that auth:status then uses', async () => {
  const { seen, url } = await startServer();
  const config = mkdtempSync(join(tmpdir(), 'omninoise-config-'));
  const env = { XDG_CONFIG_HOME: config };

  const login = await exec(['auth:login', '--url', url], env, approve());
  const file = join(config, 'omninoise', 'credentials.json');

  expect(login.code).toBe(0);
  expect(login.stdout).not.toContain('pos_secrettoken');
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
    url,
    token: 'pos_secrettoken',
    orgId: 'org1',
  });

  const status = await exec(['auth:status'], env);
  expect(status.code).toBe(0);
  expect(status.stdout).toContain('Acme');
  const me = seen.find((r) => r.path === '/public/v1/me')!;
  expect(me.headers.authorization).toBe('pos_secrettoken');
});

test('auth:login rejects a callback with the wrong state and saves nothing', async () => {
  const { seen, url } = await startServer();
  const config = mkdtempSync(join(tmpdir(), 'omninoise-config-'));
  const reply: { status?: number } = {};

  const login = await exec(
    ['auth:login', '--url', url],
    { XDG_CONFIG_HOME: config },
    approve('forged', reply)
  );

  expect(login.code).toBe(1);
  expect(reply.status).toBe(400);
  expect(seen.some((r) => r.path === '/oauth/token')).toBe(false);
  expect(existsSync(join(config, 'omninoise', 'credentials.json'))).toBe(false);
});
