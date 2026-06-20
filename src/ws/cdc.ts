import type { RecordEvent } from "./types";
import { broadcastEvent } from "./broadcast";
import { persistChange } from "./changes";
import { DatabasePool } from "../db/pool";

let cdcEnabled = false;

/** Enable change data capture. Called by server when sync or realtime is enabled. */
export function enableCDC(): void {
  cdcEnabled = true;
}

export function notifyRecordChange(
  event: "create" | "update" | "delete",
  database: string,
  collection: string,
  record: Record<string, unknown>,
  previous?: Record<string, unknown>,
  pool?: DatabasePool,
  principalId?: string
): number | undefined {
  if (!cdcEnabled) return;

  let seq: number | undefined;

  // Persist first to capture the rowid (seq) for real-time broadcasts
  if (pool) {
    seq = persistChange(pool, event, collection, record, previous, principalId);
  }

  const recordEvent: RecordEvent = {
    type: "event",
    event,
    collection,
    database,
    record,
    previous,
    seq,
  };

  broadcastEvent(recordEvent, pool);

  return seq;
}
