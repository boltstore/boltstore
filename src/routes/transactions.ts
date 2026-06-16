import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { executeTransaction, type TransactionOperation } from "../admin/transaction";
import { jsonResponse, errorResponse } from "../server";

export function registerTransactionRoutes(router: Router, manager: DatabaseManager): void {
  router.post("/api/admin/:database/transactions", async (req, params) => {
    try {
      const { operations } = await req.json();
      if (!Array.isArray(operations)) return errorResponse("VALIDATION", "Field 'operations' must be an array.", 400);
      const pool = manager.get(params.database);
      return jsonResponse({ data: executeTransaction(pool, operations as TransactionOperation[]) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transaction failed";
      return errorResponse("TRANSACTION_ERROR", message, (err as { status?: number }).status || 500);
    }
  });
}