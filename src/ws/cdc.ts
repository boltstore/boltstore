import type { RecordEvent } from "./types";
import { broadcastEvent } from "./broadcast";
import { persistChange } from "./changes";
import { DatabasePool } from "../db/pool";

export function notifyRecordChange(
  event: "create" | "update" | "delete",
  database: string,
  collection: string,
  record: Record<string, unknown>,
  previous?: Record<string, unknown>,
  pool?: DatabasePool,
  principalId?: string
): void {
  const recordEvent: RecordEvent = {
    type: "event",
    event,
    collection,
    database,
    record,
    previous,
  };

  broadcastEvent(recordEvent);

  if (pool) {
    persistChange(pool, event, collection, record, previous, principalId);
  }
}
