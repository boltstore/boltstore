import type { RecordEvent } from "./types";
import { logger } from "../logger";

const sseControllers = new Map<string, ReadableStreamDefaultController>();
let sseCounter = 0;

export function createSseId(): string {
  sseCounter++;
  return `sse_${Date.now()}_${sseCounter}`;
}

export function addSseClient(id: string, controller: ReadableStreamDefaultController): void {
  sseControllers.set(id, controller);
  controller.enqueue(new TextEncoder().encode(":ok\n\n"));
}

export function removeSseClient(id: string): void {
  sseControllers.delete(id);
}

export function getSseClientCount(): number {
  return sseControllers.size;
}

export function broadcastSseEvent(event: RecordEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  const encoder = new TextEncoder();
  for (const [id, controller] of sseControllers) {
    try {
      controller.enqueue(encoder.encode(data));
    } catch {
      sseControllers.delete(id);
    }
  }
}

export function createSseResponse(): { response: Response; id: string } {
  const id = createSseId();
  const stream = new ReadableStream({
    start(controller) {
      addSseClient(id, controller);
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
