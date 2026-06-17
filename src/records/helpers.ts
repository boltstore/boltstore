import { generateSecureId } from "@boltstore/utils";

function generateId(): string {
  return generateSecureId("rec");
}

function now(): string {
  return new Date().toISOString();
}

export { generateId, now };
