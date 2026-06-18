import { DatabaseManager } from "../db/manager";
import { loadConfig } from "../config";
import { info, success, error as cliError, out } from "../cli-style";

export async function applicationsCommand(args: string[]): Promise<void> {
  const config = await loadConfig();
  const manager = new DatabaseManager({ dataDir: config.databasePath });

  try {
    try {
      const createIdx = args.indexOf("--create");
      if (createIdx >= 0) {
        const appName = args[createIdx + 1];
        if (!appName) {
          cliError("Usage: boltstore applications --create <application-name>");
          return;
        }

        const result = manager.createDatabase(appName);

        out("");
        success(`Application "${result.name}" created.`);
        out(`  DB ID:        ${result.id}`);
        out(`  DB Path:      ${result.path}`);
        out(`  Files Dir:    ${result.path.replace("/db/", "/files/").replace(/\/[^/]+\.db$/, "")}`);
        return;
      }
    } catch (err: unknown) {
      const e = err as { message?: string; status?: number };
      if (e.message) cliError(e.message);
      else cliError(String(err));
      return;
    }

    const renameIdx = args.indexOf("--rename");
    if (renameIdx >= 0) {
      const appRef = args[renameIdx + 1];
      const newName = args[renameIdx + 2];
      if (!appRef || !newName) {
        cliError("Usage: boltstore applications --rename <app-id-or-name> <new-name>");
        return;
      }

      const dbList = manager.listDatabases();
      const db = dbList.find((d) => d.id === appRef || d.name === appRef);
      if (!db) {
        cliError(`Application "${appRef}" not found.`);
        return;
      }

      const metaDb = manager.getMetaPool().write();
      metaDb.run("UPDATE _databases SET name=?, updated_at=? WHERE id=?", [newName, new Date().toISOString(), db.id]);
      success(`Renamed application "${db.name}" → "${newName}"`);
      return;
    }

    const deleteIdx = args.indexOf("--delete");
    if (deleteIdx >= 0) {
      const appRef = args[deleteIdx + 1];
      if (!appRef) {
        cliError("Usage: boltstore applications --delete <app-id-or-name>");
        return;
      }

      const dbList = manager.listDatabases();
      const db = dbList.find((d) => d.id === appRef || d.name === appRef);
      if (!db) {
        cliError(`Application "${appRef}" not found.`);
        return;
      }

      out("");
      cliError("⚠  WARNING: This action is IRREVERSIBLE!");
      out("");
      out(`  You are about to permanently delete application "${db.name}" (${db.id}):`);
      out(`    • Database file:  ${db.path}`);
      out(`    • All records will be lost`);
      out(`    • All uploaded files for this application will be deleted`);
      out("");

      const { prompt } = await import("../prompt");
      const confirm = await prompt(`  Type the application name "${db.name}" to confirm: `);

      if (confirm !== db.name) {
        cliError("Confirmation failed. Application was not deleted.");
        return;
      }

      manager.deleteDatabase(db.name);
      success(`Application "${db.name}" has been permanently deleted.`);
      return;
    }

    const databases = manager.listDatabases();
    if (databases.length === 0) {
      info("No applications found.");
    } else {
      out("");
      info(`Applications (${databases.length}):`);
      out("");
      for (const db of databases) {
        out(`  Application:  ${db.name}`);
        out(`  DB ID:        ${db.id}`);
        out(`  DB Path:      ${db.path}`);
        out(`  Files Dir:    ${db.path.replace("/db/", "/files/").replace(/\/[^/]+\.db$/, "")}`);
        out(`  Created:      ${db.createdAt}`);
        out("");
      }
    }
  } finally {
    manager.close();
  }
}
