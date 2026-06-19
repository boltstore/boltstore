/**
 * Transaction API — execute multiple SQL operations atomically.
 *
 * All operations in a transaction either succeed together or fail together.
 * Supports a mix of read (SELECT) and write (INSERT, UPDATE, DELETE) operations.
 *
 * @module boltstore/admin/transaction
 */

import { DatabasePool } from "../db/pool";
import { toBindings } from "../db/cast";

/** A single operation within a transaction. */
export interface TransactionOperation {
  /** SQL statement to execute (parameterized). */
  sql: string;
  /** Parameters to bind (positional). */
  params?: unknown[];
}

/** Result of a single operation within a transaction. */
export interface OperationResult {
  /** 0-based index of the operation in the batch. */
  index: number;
  /** For SELECT operations: the returned rows. */
  rows?: Record<string, unknown>[];
  /** Number of columns in SELECT results. */
  columns?: string[];
  /** For write operations: number of rows changed. */
  changes?: number;
  /** For INSERT operations: the last inserted row ID. */
  lastInsertRowid?: number | bigint;
}

/** Result of an entire batch transaction. */
export interface TransactionResult {
  /** Whether all operations succeeded. */
  success: boolean;
  /** Per-operation results. */
  results: OperationResult[];
}

/**
 * Execute multiple SQL operations within a single write transaction.
 *
 * If any operation fails, the entire batch is rolled back and an error is thrown.
 * SELECT results are captured; write operations return change counts and row IDs.
 *
 * `POST /api/admin/:database/transactions`
 */
export function executeTransaction(
  pool: DatabasePool,
  operations: TransactionOperation[]
): TransactionResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw Object.assign(
      new Error("At least one operation is required."),
      { status: 400 }
    );
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i] as unknown as Record<string, unknown>;
    if (!op.sql || typeof op.sql !== "string" || op.sql.trim().length === 0) {
      throw Object.assign(
        new Error(`Operation ${i}: each operation requires a "sql" field with a SQL statement.`),
        { status: 400 }
      );
    }
  }

  return pool.writeTransaction(() => {
    const db = pool.write();
    const results: OperationResult[] = [];

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const params = Array.isArray(op.params) ? op.params : [];

      const trimmed = op.sql.trim().toUpperCase();
      const isSelect =
        trimmed.startsWith("SELECT") ||
        trimmed.startsWith("PRAGMA") ||
        trimmed.startsWith("EXPLAIN") ||
        trimmed.startsWith("WITH");

      if (isSelect) {
        const rows = db.query(op.sql).all(...toBindings(params)) as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        results.push({ index: i, rows, columns });
      } else {
        db.run(op.sql, toBindings(params));
        const changesQuery = db.query("SELECT changes() as cnt").get() as { cnt: number } | null;
        const rowIdQuery = db.query("SELECT last_insert_rowid() as id").get() as { id: number } | null;
        results.push({
          index: i,
          changes: changesQuery?.cnt ?? 0,
          lastInsertRowid: rowIdQuery?.id ?? 0,
        });
      }
    }

    return { success: true, results };
  });
}