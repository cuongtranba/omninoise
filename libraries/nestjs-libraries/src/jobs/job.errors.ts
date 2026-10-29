/**
 * A failure that retrying cannot fix (the platform rejected the body, the
 * token cannot be refreshed, the reason was written for the customer). The
 * worker fails the job at once instead of scheduling another attempt.
 *
 * `type` carries what Temporal's `ApplicationFailure.type` used to:
 * 'bad_body', 'refresh_token', 'disconnect', 'published_with_error',
 * 'clipping_stop'.
 */
export class NonRetryable extends Error {
  readonly nonRetryable = true;

  constructor(
    message: string,
    public readonly type = 'non_retryable',
    public readonly details?: unknown[]
  ) {
    super(message);
    this.name = new.target.name;
  }

  // changeState stores JSON.stringify(err); an Error would serialise as {}.
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      details: this.details,
    };
  }
}

export const isNonRetryable = (err: unknown): err is NonRetryable =>
  err instanceof NonRetryable ||
  (!!err && typeof err === 'object' && (err as any).nonRetryable === true);

/** A provider call that ran past its time budget; its outcome is unknown. */
export class JobTimeout extends Error {
  constructor(message = 'Timed out') {
    super(message);
    this.name = 'JobTimeout';
  }
}

/** Rejects with JobTimeout when `fn` outlives `ms`; `fn` itself keeps running. */
export function withTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new JobTimeout()), ms);
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
