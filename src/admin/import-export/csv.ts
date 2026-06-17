export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const len = text.length;

  let i = 0;
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
      } else {
        currentField += ch;
        i += 1;
      }
    } else {
      if (ch === '"') {
        if (currentField === "") {
          inQuotes = true;
          i += 1;
        } else {
          currentField += ch;
          i += 1;
        }
      } else if (ch === ",") {
        currentRow.push(currentField);
        currentField = "";
        i += 1;
      } else if (ch === "\r") {
        if (i + 1 < len && text[i + 1] === "\n") {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
          i += 2;
        } else {
          currentRow.push(currentField);
          rows.push(currentRow);
          currentRow = [];
          currentField = "";
          i += 1;
        }
      } else if (ch === "\n") {
        currentRow.push(currentField);
        rows.push(currentRow);
        currentRow = [];
        currentField = "";
        i += 1;
      } else {
        currentField += ch;
        i += 1;
      }
    }
  }

  if (currentField !== "" || currentRow.length > 0) {
    currentRow.push(currentField);
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  if (rows.length === 1 && rows[0].length === 1 && rows[0][0] === "") {
    return [];
  }

  return rows;
}

export function coerceCSVValue(value: string): unknown {
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  if (value === "" || value.toLowerCase() === "null") return null;
  if (/^-?\d+$/.test(value)) {
    const n = parseInt(value, 10);
    if (Number.isSafeInteger(n)) return n;
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    const n = parseFloat(value);
    if (!Number.isNaN(n)) return n;
  }
  return value;
}

export function recordsToCSV(records: Record<string, unknown>[], fields: string[]): string {
  const lines: string[] = [];
  lines.push(fields.map((f) => escapeCSVField(f)).join(","));
  for (const record of records) {
    const values = fields.map((field) => {
      const value = record[field];
      if (value === null || value === undefined) return "";
      if (typeof value === "object") {
        return escapeCSVField(JSON.stringify(value));
      }
      return escapeCSVField(String(value));
    });
    lines.push(values.join(","));
  }
  return lines.join("\n") + (records.length > 0 || fields.length > 0 ? "\n" : "");
}

function escapeCSVField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
