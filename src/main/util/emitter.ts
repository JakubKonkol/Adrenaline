/** Minimal typed event emitter (listener errors are isolated from the emitter). */
export class Emitter<Events extends Record<string, unknown>> {
  private listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => void set.delete(listener);
  }

  once<K extends keyof Events>(event: K, listener: (payload: Events[K]) => void): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (p: Events[K]) => void)(payload);
      } catch {
        // A failing listener must not break the engine/event pipeline.
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}
