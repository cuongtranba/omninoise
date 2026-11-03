import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { CliError } from './context';

export type Media = { id: string; path: string; thumbnail?: string };

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/** The Public API, /public/v1. The Authorization header carries the raw key or `pos_` token, never "Bearer". */
export class Api {
  constructor(
    readonly url: string,
    private readonly secret: string
  ) {}

  private async send(
    method: string,
    path: string,
    init: {
      query?: Record<string, string | undefined>;
      body?: BodyInit;
      json?: unknown;
    } = {}
  ): Promise<any> {
    const target = new URL(`${this.url}/public/v1${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) target.searchParams.set(k, v);
    }
    const headers: Record<string, string> = { Authorization: this.secret };
    let body = init.body;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    let res: Response;
    try {
      res = await fetch(target, { method, headers, body });
    } catch (e: any) {
      throw new CliError(
        `Cannot reach ${target.origin}: ${e.cause?.message ?? e.message}`
      );
    }
    const text = await res.text();
    let data: any = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // keep the raw text
    }
    if (!res.ok) {
      const hint =
        res.status === 401
          ? ' (run "omninoise auth:login" or check OMNINOISE_API_KEY)'
          : '';
      throw new CliError(
        `${method} ${target.pathname} failed with HTTP ${res.status}${hint}: ${
          typeof data === 'string' ? data : JSON.stringify(data)
        }`
      );
    }
    return data;
  }

  me() {
    return this.send('GET', '/me');
  }

  integrations() {
    return this.send('GET', '/integrations');
  }

  posts(startDate: string, endDate: string) {
    return this.send('GET', '/posts', { query: { startDate, endDate } });
  }

  deletePost(id: string) {
    return this.send('DELETE', `/posts/${encodeURIComponent(id)}`);
  }

  analytics(integrationId: string, days: number) {
    return this.send('GET', `/analytics/${encodeURIComponent(integrationId)}`, {
      query: { date: String(days) },
    });
  }

  postAnalytics(postId: string, days: number) {
    return this.send('GET', `/analytics/post/${encodeURIComponent(postId)}`, {
      query: { date: String(days) },
    });
  }

  createPosts(body: unknown) {
    return this.send('POST', '/posts', { json: body });
  }

  async upload(file: string): Promise<Media> {
    let bytes: Buffer;
    try {
      bytes = await readFile(file);
    } catch (e: any) {
      throw new CliError(`Cannot read ${file}: ${e.message}`);
    }
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes], {
        type: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      }),
      basename(file)
    );
    const res = await this.send('POST', '/upload', { body: form });
    if (typeof res?.id !== 'string' || typeof res?.path !== 'string') {
      throw new CliError(`Unexpected upload response: ${JSON.stringify(res)}`);
    }
    return { id: res.id, path: res.path };
  }
}
