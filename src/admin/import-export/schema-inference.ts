export function inferColumnType(value: unknown): string {
  if (value === null || value === undefined) return "TEXT";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") {
    if (Number.isInteger(value)) return "INTEGER";
    return "REAL";
  }
  return "TEXT";
}

export function inferSchema(records: Record<string, unknown>[]): { name: string; type: string }[] {
  const columnTypeMap = new Map<string, string>();

  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const inferred = inferColumnType(value);
      const existing = columnTypeMap.get(key);

      if (!existing) {
        columnTypeMap.set(key, inferred);
      } else if (existing !== inferred) {
        const typeRank: Record<string, number> = { BOOLEAN: 1, INTEGER: 2, REAL: 3, TEXT: 4, BLOB: 5, DATETIME: 5 };
        const currentRank = typeRank[existing] ?? 0;
        const newRank = typeRank[inferred] ?? 0;
        if (newRank > currentRank) {
          columnTypeMap.set(key, inferred);
        }
      }
    }
  }

  return Array.from(columnTypeMap.entries()).map(([name, type]) => ({ name, type }));
}
