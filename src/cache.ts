export function createCache<T>(ttlMs: number, maxSize = 1000) {
  const store = new Map<string, { value: T; expiresAt: number }>();

  // Track insertion order for LRU eviction when the cache exceeds maxSize.
  const insertionOrder: string[] = [];

  const evictIfNeeded = () => {
    if (store.size > maxSize) {
      const oldest = insertionOrder.shift();
      if (oldest) store.delete(oldest);
    }
  };

  const periodicCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
        const idx = insertionOrder.indexOf(key);
        if (idx !== -1) insertionOrder.splice(idx, 1);
      }
    }
  }, Math.min(ttlMs, 60_000));
  if (typeof periodicCleanup.unref === "function") periodicCleanup.unref();

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        const idx = insertionOrder.indexOf(key);
        if (idx !== -1) insertionOrder.splice(idx, 1);
        return;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      insertionOrder.push(key);
      evictIfNeeded();
    },
    invalidate(pattern?: string): void {
      if (!pattern) {
        store.clear();
        insertionOrder.length = 0;
        return;
      }
      for (const key of store.keys()) {
        if (key.startsWith(pattern)) {
          store.delete(key);
          const idx = insertionOrder.indexOf(key);
          if (idx !== -1) insertionOrder.splice(idx, 1);
        }
      }
    },
    destroy(): void {
      clearInterval(periodicCleanup);
      store.clear();
      insertionOrder.length = 0;
    },
  };
}
