export function createCache<T>(ttlMs: number) {
  const store = new Map<string, { value: T; expiresAt: number }>();

  const periodicCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) store.delete(key);
    }
  }, Math.min(ttlMs, 60_000));
  if (typeof periodicCleanup.unref === "function") periodicCleanup.unref();

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    invalidate(pattern?: string): void {
      if (!pattern) { store.clear(); return; }
      for (const key of store.keys()) {
        if (key.startsWith(pattern)) store.delete(key);
      }
    },
    destroy(): void {
      clearInterval(periodicCleanup);
      store.clear();
    },
  };
}
