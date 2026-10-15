import type { z } from 'zod';
import { type ChannelName, type IpcResult, ipcChannels } from '@shared/contracts/ipc';
import { AppError } from '@shared/errors';

/** The part of `ipcMain` used here; injected so the registry can be tested without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcInvokeEventLike, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcInvokeEventLike {
  senderFrame: { url: string } | null;
}

type Input<C extends ChannelName> = z.output<(typeof ipcChannels)[C]['input']>;
type Output<C extends ChannelName> = z.input<(typeof ipcChannels)[C]['output']>;
export type Handler<C extends ChannelName> = (input: Input<C>) => Output<C> | Promise<Output<C>>;

export interface IpcRegistryDeps {
  ipcMain: IpcMainLike;
  /** True only for the app's own renderer (file:// index.html or the dev server origin). */
  isTrustedSender: (url: string) => boolean;
  onError?: (channel: string, error: unknown) => void;
}

/**
 * Registers typed handlers: checks the sender, validates input and output with the channel's Zod schemas and maps
 * failures to `{ ok: false, error: { code, message } }` (01-architektura.md, IPC).
 */
export function createIpcRegistry(deps: IpcRegistryDeps) {
  const registered = new Set<string>();

  function handle<C extends ChannelName>(channel: C, impl: Handler<C>): void {
    const schema = ipcChannels[channel];
    registered.add(channel);
    deps.ipcMain.handle(channel, async (event, raw): Promise<IpcResult<unknown>> => {
      const url = event.senderFrame?.url ?? '';
      if (!deps.isTrustedSender(url)) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted sender' } };
      }
      const parsed = schema.input.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        };
      }
      try {
        const result = await impl(parsed.data as Input<C>);
        const out = schema.output.safeParse(result);
        if (!out.success) {
          deps.onError?.(channel, out.error);
          return { ok: false, error: { code: 'INTERNAL', message: 'Invalid response' } };
        }
        return { ok: true, data: out.data };
      } catch (error) {
        if (error instanceof AppError) return { ok: false, error: error.toShape() };
        deps.onError?.(channel, error);
        return { ok: false, error: { code: 'INTERNAL', message: 'Unexpected error' } };
      }
    });
  }

  function dispose(): void {
    for (const channel of registered) deps.ipcMain.removeHandler(channel);
    registered.clear();
  }

  return { handle, dispose };
}

export type IpcRegistry = ReturnType<typeof createIpcRegistry>;
