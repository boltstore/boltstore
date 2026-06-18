import { loadConfig } from "../config";
import { error as cliError, out } from "../cli-style";

export async function statusCommand(): Promise<void> {
  const config = await loadConfig();
  const healthUrl = `http://localhost:${config.port}/api/health`;

  try {
    const response = await fetch(healthUrl);
    const body = await response.json();
    out(JSON.stringify(body.data, null, 2));
  } catch {
    cliError("Server is not running.");
  }
}
