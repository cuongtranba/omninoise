export class CliError extends Error {}

export type Sink = { write(text: string): unknown };

/** Everything the CLI touches outside its own code, so a caller (or a test) can run it in isolation. */
export type Context = {
  env: Record<string, string | undefined>;
  stdout: Sink;
  stderr: Sink;
  cwd: string;
  /** Opens a URL in the user's browser. */
  openBrowser: (url: string) => void | Promise<void>;
  /** Asks a yes/no question; true means yes. */
  confirm: (question: string) => Promise<boolean>;
};

export const printJson = (ctx: Context, value: unknown): void => {
  ctx.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};
