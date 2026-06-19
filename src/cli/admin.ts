import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { createAdminUser } from "../auth/users";
import { info, success, error as cliError, out } from "../cli-style";

export async function adminCommand(args: string[]): Promise<void> {
  const subcommand = args[1];

  if (subcommand === "databases") {
    const { applicationsCommand } = await import("./applications");
    args[0] = "applications";
    return applicationsCommand(args);
  }

  if (subcommand === "init" || !subcommand) {
    const { prompt, promptPassword } = await import("../prompt");

    if (!subcommand) {
      out("");
      info("This will create a new admin account for the Boltstore server.");
      out("  Admin accounts can manage databases, collections, and users.");
      out("  Regular users are created via the register endpoint in each app database.");
      out("");
      const { prompt: confirmPrompt } = await import("../prompt");
      const confirm = await confirmPrompt("Proceed with creating an admin account? [Y/n]: ");
      if (confirm.toLowerCase() === "n" || confirm.toLowerCase() === "no") {
        info("Cancelled.");
        return;
      }
    }

    out("");
    info("Create an admin account for the Boltstore server.");

    const name = (await prompt("  Name (optional): ")) || undefined;
    const email = await prompt("  Email: ");
    const password = await promptPassword("  Password (min 8 chars): ");

    if (!email || !password) {
      cliError("Email and password are required.");
      return;
    }

    const config = await loadConfig();
    const manager = new DatabaseManager({ dataDir: config.databasePath });

    try {
      const metaPool = manager.getMetaPool();
      const user = await createAdminUser(metaPool, email.trim(), password, name?.trim() || undefined);

      out("");
      success(`Admin account created (source: ${user.source}).`);
      out(`  ID:    ${user.id}`);
      out(`  Email: ${user.email}`);
      if (user.name) out(`  Name:  ${user.name}`);
      out("");
      info("You can now log in at POST /api/_system/auth/login");
      out(`  { "email": "${user.email}", "password": "..." }`);
      out("");
    } finally {
      manager.close();
    }
  } else {
    cliError("Usage: boltstore admin | boltstore applications");
  }
}
