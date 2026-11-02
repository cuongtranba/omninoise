import { createHash, randomBytes } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { credentialsPath, normalizeUrl, writeCredentials } from './config';
import { CliError, Context } from './context';

const METADATA_PATH =
  '/.well-known/oauth-authorization-server/mcp-oauth-dynamic';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

type Endpoints = {
  authorization: string;
  token: string;
  registration: string;
};

const asEndpoints = (data: any): Endpoints | undefined =>
  typeof data?.authorization_endpoint === 'string' &&
  typeof data?.token_endpoint === 'string' &&
  typeof data?.registration_endpoint === 'string'
    ? {
        authorization: data.authorization_endpoint,
        token: data.token_endpoint,
        registration: data.registration_endpoint,
      }
    : undefined;

/**
 * RFC 8414 metadata first, from the backend URL and then from its origin (behind a path prefix such as /api
 * the /.well-known route may not reach the backend). Without it, derive the endpoints from the backend URL.
 */
export const discoverEndpoints = async (
  backend: string,
  env: Context['env']
): Promise<Endpoints> => {
  const origin = new URL(backend).origin;
  for (const base of new Set([backend, origin])) {
    try {
      const res = await fetch(`${base}${METADATA_PATH}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const found = asEndpoints(await res.json());
        if (found) return found;
      }
    } catch {
      // try the next candidate
    }
  }
  const frontend = normalizeUrl(
    env.OMNINOISE_FRONTEND_URL || backend.replace(/\/api$/, '')
  );
  return {
    authorization: `${frontend}/oauth/authorize`,
    token: `${backend}/oauth/token`,
    registration: `${backend}/oauth/register`,
  };
};

const failureText = async (res: Response) => {
  const text = await res.text();
  return text.slice(0, 300);
};

/** Listens on 127.0.0.1 for the browser redirect and resolves with the authorization code. */
const listenForCode = (expectedState: string) => {
  let finish!: (r: { code?: string; error?: CliError }) => void;
  const result = new Promise<{ code?: string; error?: CliError }>((resolve) => {
    finish = resolve;
  });
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const reply = (status: number, text: string) =>
      res
        .writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(text);
    if (url.searchParams.get('state') !== expectedState) {
      reply(400, 'Login failed: state mismatch. Go back to the terminal.');
      finish({
        error: new CliError('Login aborted: the callback state did not match'),
      });
      return;
    }
    const denied = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    if (denied || !code) {
      reply(400, 'Login was not approved. Go back to the terminal.');
      finish({
        error: new CliError(
          `Login was not approved${denied ? `: ${denied}` : ''}`
        ),
      });
      return;
    }
    reply(
      200,
      'Logged in. You can close this tab and go back to the terminal.'
    );
    finish({ code });
  });
  const ready = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as AddressInfo).port)
    );
  });
  return { server, ready, result };
};

export const login = async (ctx: Context, urlOption?: string) => {
  const chosen = urlOption || ctx.env.OMNINOISE_URL;
  if (!chosen) {
    throw new CliError(
      'Pass the backend URL: omninoise auth:login --url https://your-host/api'
    );
  }
  const backend = normalizeUrl(chosen);
  try {
    new URL(backend);
  } catch {
    throw new CliError(`${backend} is not a valid URL`);
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');

  // The redirect URI must match the registered one exactly, so listen first and register that exact port.
  const listener = listenForCode(state);
  let timer: NodeJS.Timeout | undefined;
  try {
    const port = await listener.ready;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const endpoints = await discoverEndpoints(backend, ctx.env);

    const registered = await fetch(endpoints.registration, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Omninoise CLI',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    });
    if (!registered.ok) {
      throw new CliError(
        `Registering the CLI failed (HTTP ${
          registered.status
        }): ${await failureText(registered)}`
      );
    }
    const clientId = (await registered.json()).client_id;
    if (typeof clientId !== 'string') {
      throw new CliError('The server did not return a client_id');
    }

    const authorize = new URL(endpoints.authorization);
    authorize.searchParams.set('client_id', clientId);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    ctx.stdout.write(
      `Opening your browser to approve the login. If it does not open, visit:\n${authorize.toString()}\n`
    );
    const timeout = new Promise<{ code?: string; error?: CliError }>(
      (resolve) => {
        timer = setTimeout(
          () =>
            resolve({ error: new CliError('Login timed out after 5 minutes') }),
          LOGIN_TIMEOUT_MS
        );
      }
    );
    try {
      await ctx.openBrowser(authorize.toString());
    } catch {
      // the URL is printed above
    }
    const outcome = await Promise.race([listener.result, timeout]);
    if (outcome.error || !outcome.code) throw outcome.error!;

    const exchanged = await fetch(endpoints.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: outcome.code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    if (!exchanged.ok) {
      throw new CliError(
        `Exchanging the code failed (HTTP ${
          exchanged.status
        }): ${await failureText(exchanged)}`
      );
    }
    const token = await exchanged.json();
    if (typeof token.access_token !== 'string') {
      throw new CliError('The server did not return an access token');
    }
    await writeCredentials(ctx.env, {
      url: backend,
      token: token.access_token,
      orgId: typeof token.id === 'string' ? token.id : undefined,
    });
    ctx.stdout.write(
      `Logged in to ${backend}${
        token.id ? ` (organization ${token.id})` : ''
      }.\nCredentials saved to ${credentialsPath(ctx.env)}\n`
    );
  } finally {
    if (timer) clearTimeout(timer);
    listener.server.close();
    listener.server.closeAllConnections();
  }
};
