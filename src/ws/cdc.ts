import type { RecordEvent } from "./types";
import { broadcastEvent } from "./broadcast";

export function notifyRecordChange(
  event: "create" | "update" | "delete",
  database: string,
  collection: string,
  record: Record<string, unknown>,
  previous?: Record<string, unknown>
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
}
