import type { ChannelInput, ChannelName, ChannelOutput, EventName, EventPayload, IpcResult } from './ipc';

type GroupOf<K> = K extends `${infer G}:${string}` ? G : never;
type MethodOf<K, G extends string> = K extends `${G}:${infer M}` ? M : never;

type Invoker<C extends ChannelName> = [ChannelInput<C>] extends [void]
  ? () => Promise<IpcResult<ChannelOutput<C>>>
  : (input: ChannelInput<C>) => Promise<IpcResult<ChannelOutput<C>>>;

type Groups = {
  [G in GroupOf<ChannelName>]: { [M in MethodOf<ChannelName, G>]: Invoker<`${G}:${M}` & ChannelName> };
};

export interface AdrenalineEvents {
  /** Subscribes to a main → renderer event; returns the unsubscribe function. */
  on<E extends EventName>(event: E, listener: (payload: EventPayload<E>) => void): () => void;
}

/** `window.adrenaline`: the only bridge between the renderer and main (preload, contextBridge). */
export type AdrenalineApi = Groups & { events: AdrenalineEvents };

/** Splits `group:method` into its parts; shared by preload and tests. */
export function splitChannel(channel: string): [group: string, method: string] {
  const i = channel.indexOf(':');
  return [channel.slice(0, i), channel.slice(i + 1)];
}
