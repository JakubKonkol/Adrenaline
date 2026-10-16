import { spawn } from 'node:child_process';
import { AppError } from '@shared/errors';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Written to stdin, then closed (adb pair asks for the code: it never appears in the process list or logs). */
  input?: string;
  cwd?: string;
}

/** Runs one tool. Tests replace it with a stub that answers like adb/sdb/tizen. */
export type ProcessRunner = (exe: string, args: string[], opts: RunOptions) => Promise<RunResult>;

const MAX_OUTPUT = 256 * 1024;

/**
 * Characters allowed in an argument passed through cmd.exe (Tizen CLI is a .bat file). Everything else — % & | < > ^ !
 * " and line breaks — is refused instead of escaped: values come from our own folders and validated user input.
 */
const CMD_SAFE = /^[A-Za-z0-9 _.,:()\\/+=@-]+$/;

export function cmdLine(exe: string, args: string[]): string {
  for (const part of [exe, ...args]) {
    if (!CMD_SAFE.test(part)) throw new AppError('BAD_REQUEST', 'unsupported character in a path or value');
  }
  const quote = (s: string) => (/[ ()]/.test(s) ? `"${s}"` : s);
  // cmd /s /c "<line>": the outer quotes are removed, the rest runs as written.
  return `"${[quote(exe), ...args.map(quote)].join(' ')}"`;
}

/** spawn without a shell (array of arguments), hidden window, timeout, output limit, cancel. */
export const runProcess: ProcessRunner = (exe, args, opts) =>
  new Promise((resolve, reject) => {
    const bat = /\.(bat|cmd)$/i.test(exe);
    const child = bat
      ? spawn(process.env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', cmdLine(exe, args)], {
          shell: false,
          windowsHide: true,
          windowsVerbatimArguments: true,
          ...(opts.cwd ? { cwd: opts.cwd } : {}),
        })
      : spawn(exe, args, { shell: false, windowsHide: true, ...(opts.cwd ? { cwd: opts.cwd } : {}) });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const take = (current: string, chunk: Buffer) =>
      current.length < MAX_OUTPUT ? current + chunk.toString('utf8') : current;
    child.stdout?.on('data', (d: Buffer) => (stdout = take(stdout, d)));
    child.stderr?.on('data', (d: Buffer) => (stderr = take(stderr, d)));
    const kill = () => {
      if (child.exitCode === null) child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    const onAbort = () => kill();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (error) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr, timedOut });
    });
    if (opts.input !== undefined) child.stdin?.end(`${opts.input}\n`);
    else child.stdin?.end();
  });
