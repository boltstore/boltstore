import { DatabasePool } from "../../db/pool";
import { validateIdentifier } from "@boltstore/utils";
import { getCollection } from "../../collections";
import { listRecords } from "../../records";
import { recordsToCSV } from "./csv";
import { ExportOptions, ExportResult } from "./types";

export function exportData(
  pool: DatabasePool,
  collection: string,
  options: ExportOptions = {}
): ExportResult {
  validateIdentifier(collection, "collection name");

  const format = options.format ?? "json";

  let exportFields: string[];
  if (options.fields && options.fields.length > 0) {
    exportFields = options.fields;
  } else {
    try {
      const info = getCollection(pool, collection);
      exportFields = info.schema.map((c: { name: string }) => c.name);
    } catch {
      exportFields = [];
    }
  }

  const records = listRecords(pool, collection, {
    filter: options.filter,
    sort: options.sort,
    direction: options.direction,
    limit: options.limit,
    offset: options.offset,
  });

  const filtered = exportFields.length > 0
    ? records.map((rec: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const f of exportFields) {
          if (f in rec) out[f] = rec[f];
        }
        return out;
      })
    : records;

  if (format === "csv") {
    const fields = exportFields.length > 0 ? exportFields : Array.from(
      new Set<string>(filtered.flatMap((r: Record<string, unknown>) => Object.keys(r)))
    );

    const csv = recordsToCSV(filtered, fields);

    return {
      data: csv,
      meta: {
        recordCount: records.length,
        format: "csv",
        collection,
      },
    };
  }

  return {
    data: JSON.stringify({
      data: filtered,
      meta: {
        recordCount: records.length,
        format: "json",
        collection,
      },
    }),
    meta: {
      recordCount: records.length,
      format: "json",
      collection,
    },
  };
}