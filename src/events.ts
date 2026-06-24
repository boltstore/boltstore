export interface QueryEvent {
  database: string;
  table?: string;
  operation: "select" | "insert" | "update" | "delete";
  sql: string;
  durationMs: number;
  rowCount: number;
  status: "ok" | "error";
  errorMessage?: string;
  timestamp: string;
}

export interface BoltstoreEvents {
  "server:start": (config: Record<string, unknown>) => void;
  "server:stop": () => void;
  "database:create": (database: string) => void;
  "database:delete": (database: string) => void;
  "database:import": (database: string) => void;
  "database:export": (database: string) => void;
  "table:create": (database: string, table: string) => void;
  "table:delete": (database: string, table: string) => void;
  "query": (event: QueryEvent) => void;
}

type Handler = (...args: any[]) => void;

export class EventEmitter {
  private handlers = new Map<string, Set<Handler>>();

  on<K extends keyof BoltstoreEvents>(event: K, handler: BoltstoreEvents[K]): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler as Handler);
  }

  off<K extends keyof BoltstoreEvents>(event: K, handler: BoltstoreEvents[K]): void {
    this.handlers.get(event)?.delete(handler as Handler);
  }

  emit<K extends keyof BoltstoreEvents>(event: K, ...args: Parameters<BoltstoreEvents[K]>): void {
    this.handlers.get(event)?.forEach(handler => {
      try { (handler as Function)(...args); }
      catch {}
    });
  }
}

// Reserved for the plugin system — no events are currently emitted to globalEmitter.
// Emit sites will be added when plugin loading lands (see plugin.ts).
// This is not dead code; it is intentionally reserved infrastructure.
export const globalEmitter = new EventEmitter();
