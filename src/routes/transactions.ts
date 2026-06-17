import { Router } from "../router";
import { DatabaseManager } from "../db/manager";
import { executeTransaction, type TransactionOperation } from "../admin/transaction";
import { jsonResponse, errorResponse, safeErrorResponse, logAuditEvent, auditFromRequest } from "../server";
import { authenticateRequest, requireAdmin, type AuthConfig } from "../middleware/auth";

export function registerTransactionRoutes(
  router: Router,
  manager: DatabaseManager,
  authConfig: AuthConfig
): void {
  router.post("/api/admin/:database/transactions", async (req, params) => {
    const auth = await authenticateRequest(req, manager, params.database, authConfig);
    if (auth instanceof Response) return auth;
    const admin = requireAdmin(auth);
    if (admin) return admin;

    try {
      const { operations } = await req.json();
      if (!Array.isArray(operations)) return errorResponse("VALIDATION", "Field 'operations' must be an array.", 400);
      const pool = manager.get(params.database);
      const result = executeTransaction(pool, operations as TransactionOperation[]);
      logAuditEvent(auditFromRequest(req, {
        type: "transaction.execute",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "execute",
        success: true,
        details: { operationsCount: operations.length },
      }));
      return jsonResponse({ data: result });
    } catch (err) {
      logAuditEvent(auditFromRequest(req, {
        type: "transaction.execute",
        principalId: auth.principalId,
        principalType: auth.isApiKey ? "api_key" : "user",
        database: params.database,
        action: "execute",
        success: false,
        error: err instanceof Error ? err.message : "Transaction failed",
      }));
      return safeErrorResponse(err);
    }
  });
}