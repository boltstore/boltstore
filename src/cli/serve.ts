import { startServer } from "../app";

export async function serveCommand(): Promise<void> {
  await startServer();
}