import { randomBytes } from 'node:crypto';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError, Context } from './context';

export type Credentials = { url: string; token: string; orgId?: string };

export const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

/** Returns the URL, or throws a CliError instead of the TypeError `new URL` would. */
export const validUrl = (url: string) => {
  try {
    new URL(normalizeUrl(url));
  } catch {
    throw new CliError(`${normalizeUrl(url)} is not a valid URL`);
  }
  return url;
};

export const credentialsPath = (env: Context['env']) =>
  join(
    env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'),
    'omninoise',
    'credentials.json'
  );

export const readCredentials = async (
  env: Context['env']
): Promise<Credentials | undefined> => {
  let raw: string;
  try {
    raw = await readFile(credentialsPath(env), 'utf8');
  } catch (e: any) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
  const data = JSON.parse(raw);
  if (typeof data.url !== 'string' || typeof data.token !== 'string') {
    throw new CliError(
      `${credentialsPath(
        env
      )} is not a valid credentials file; run "omninoise auth:login" again`
    );
  }
  return data;
};

export const writeCredentials = async (
  env: Context['env'],
  credentials: Credentials
) => {
  const file = credentialsPath(env);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await chmod(dirname(file), 0o700);
  // The token never sits in a file with looser permissions: create a private temp file, then rename it over.
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(credentials, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temp, file);
  } catch (e) {
    await rm(temp, { force: true });
    throw e;
  }
};

export const deleteCredentials = async (env: Context['env']) => {
  const file = credentialsPath(env);
  const existed = (await readCredentials(env)) !== undefined;
  await rm(file, { force: true });
  return existed;
};

/**
 * Which instance and secret to use.
 *  1. OMNINOISE_API_KEY, with the URL from --url or OMNINOISE_URL. A profile's instance.url never picks it.
 *  2. The credentials file written by `auth:login`. An explicitly chosen URL must match it.
 */
export const resolveAuth = async (
  ctx: Context,
  explicitUrl?: string
): Promise<{ url: string; secret: string; source: 'env' | 'login' }> => {
  const chosen = explicitUrl || ctx.env.OMNINOISE_URL;
  const apiKey = ctx.env.OMNINOISE_API_KEY;
  if (apiKey) {
    if (!chosen) {
      throw new CliError(
        'OMNINOISE_API_KEY is set but no instance URL is known: set OMNINOISE_URL or pass --url'
      );
    }
    return { url: normalizeUrl(chosen), secret: apiKey, source: 'env' };
  }
  const stored = await readCredentials(ctx.env);
  if (!stored) {
    throw new CliError(
      'Not logged in. Run "omninoise auth:login --url <backend url>", or set OMNINOISE_API_KEY and OMNINOISE_URL.'
    );
  }
  if (chosen && normalizeUrl(chosen) !== normalizeUrl(stored.url)) {
    throw new CliError(
      `You are logged in to ${stored.url}, not ${normalizeUrl(
        chosen
      )}. Run "omninoise auth:login --url ${normalizeUrl(chosen)}".`
    );
  }
  return {
    url: normalizeUrl(stored.url),
    secret: stored.token,
    source: 'login',
  };
};
