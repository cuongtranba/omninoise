import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { run } from './cli';
import { Context } from './context';

const openBrowser = (url: string) => {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => undefined);
  child.unref();
};

const confirm = async (question: string) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
};

const ctx: Context = {
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd(),
  openBrowser,
  confirm,
};

run(process.argv.slice(2), ctx).then((code) => {
  process.exitCode = code;
});
