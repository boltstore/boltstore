export function parseJSONInput(text: string): Record<string, unknown>[] {
  const trimmed = text.trim();

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw Object.assign(
        new Error("JSON input must be an array of objects or NDJSON (one object per line)."),
        { status: 400 }
      );
    }
    for (let i = 0; i < parsed.length; i++) {
      if (typeof parsed[i] !== "object" || parsed[i] === null || Array.isArray(parsed[i])) {
        throw Object.assign(
          new Error(`Row ${i}: Each element must be a JSON object, got ${typeof parsed[i]}.`),
          { status: 400 }
        );
      }
    }
    return parsed as Record<string, unknown>[];
  }

  if (trimmed.startsWith("{")) {
    const lines = trimmed.split("\n");
    const records: Record<string, unknown>[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      try {
        const obj = JSON.parse(line);
        if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
          throw Object.assign(
            new Error(`Line ${i + 1}: Each line must be a JSON object, got ${typeof obj}.`),
            { status: 400 }
          );
        }
        records.push(obj as Record<string, unknown>);
      } catch (err) {
        if ((err as { status?: number }).status) throw err;
        throw Object.assign(
          new Error(`Line ${i + 1}: Invalid JSON — ${(err as Error).message}`),
          { status: 400 }
        );
      }
    }

    if (records.length === 0) {
      throw Object.assign(
        new Error("JSON input must be an array of objects or NDJSON (one object per line)."),
        { status: 400 }
      );
    }

    return records;
  }

  throw Object.assign(
    new Error("JSON input must be an array of objects or NDJSON (one object per line)."),
    { status: 400 }
  );
}
