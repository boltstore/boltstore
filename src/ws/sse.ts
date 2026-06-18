import type { RecordEvent } from "./types";
import { applyRLS } from "../rls";
import { toBindings } from "../db/cast";
import type { DatabasePool } from "../db/pool";

interface SseClientInfo {
  controller: ReadableStreamDefaultController;
  database: string;
  userId?: string;
  email?: string;
  isAdmin: boolean;
}

const sseClients = new Map<string, SseClientInfo>();
let sseCounter = 0;

export function createSseId(): string {
  sseCounter++;
  return `sse_${Date.now()}_${sseCounter}`;
}

export function addSseClient(
  id: string,
  controller: ReadableStreamDefaultController,
  database: string,
  userId?: string,
  email?: string,
  isAdmin?: boolean
): void {
  sseClients.set(id, { controller, database, userId, email, isAdmin: isAdmin ?? false });
  controller.enqueue(new TextEncoder().encode(":ok\n\n"));
}

export function removeSseClient(id: string): void {
  sseClients.delete(id);
}

export function getSseClientCount(): number {
  return sseClients.size;
}

export function broadcastSseEvent(event: RecordEvent, pool?: DatabasePool): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  for (const [id, client] of sseClients) {
    if (client.database !== event.database) continue;

    if (pool && !client.isAdmin && client.userId && client.email) {
      const rlsCtx = { userId: client.userId, email: client.email };
      const rls = applyRLS(pool, event.collection, "read", rlsCtx);
      if (rls) {
        const recordId = event.record.id as string;
        if (recordId) {
          const db = pool.read();
          const sql = `SELECT 1 FROM "${event.collection}" WHERE id=? AND ${rls.whereClause}`;
          const row = db.query(sql).get(recordId, ...toBindings(rls.params));
          if (!row) continue;
        }
      }
    }

    try {
      client.controller.enqueue(encoder.encode(data));
    } catch {
      sseClients.delete(id);
    }
  }
}

export function createSseResponse(
  database: string,
  userId?: string,
  email?: string,
  isAdmin?: boolean
): { response: Response; id: string } {
  const id = createSseId();
  const stream = new ReadableStream({
    start(controller) {
      addSseClient(id, controller, database, userId, email, isAdmin);
    },
    cancel() {
      removeSseClient(id);
    },
  });

  const response = new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });

  return { response, id };
}
