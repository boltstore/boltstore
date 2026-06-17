/**
 * Minimal YAML parser for Boltstore config files.
 *
 * Supports only the flat key-value structures used in boltstore.yaml.
 * No anchors, aliases, multi-line strings, or deep nesting.
 *
 * @module boltstore/yaml
 */

/**
 * Parse a simple YAML string into a plain object.
 * Supports: comments, key: value pairs, arrays (indented `-` items).
 */
export function parseYaml(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = raw.split("\n");
  let currentKey: string | null = null;
  let currentArray: unknown[] = [];

  function flushArray(): void {
    if (currentKey && currentArray.length > 0) {
      result[currentKey] = currentArray;
    }
    currentKey = null;
    currentArray = [];
  }

  for (const line of lines) {
    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Array item (indented with - )
    const arrayMatch = line.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && currentKey) {
      currentArray.push(coerceValue(arrayMatch[1].trim()));
      continue;
    }

    // Not an array item — flush any pending array
    if (currentKey && currentArray.length > 0) {
      flushArray();
    }

    // Key: value pair
    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      flushArray();
      const key = kvMatch[1];
      const rawValue = kvMatch[2].trim();

      // Check if next line might start an array (empty value + indented list follows)
      if (rawValue === "" || rawValue === "null" || rawValue === "~") {
        // Could be an array start — set currentKey to collect items
        if (rawValue === "" || rawValue === "null") {
          result[key] = rawValue === "null" ? null : "";
        } else {
          result[key] = null;
        }
        // Don't set currentKey for empty strings — wait for indented items
        currentKey = key;
        currentArray = [];
      } else {
        result[key] = coerceValue(rawValue);
      }
    }
  }

  // Flush any remaining array at EOF
  flushArray();

  return result;
}

/** Coerce a YAML scalar value to the appropriate JS type. */
function coerceValue(val: string): unknown {
  // Unquoted null/none
  if (val === "null" || val === "~" || val === "none") return null;
  // Unquoted booleans
  if (val === "true" || val === "TRUE" || val === "True") return true;
  if (val === "false" || val === "FALSE" || val === "False") return false;
  // Remove surrounding quotes (single or double)
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    return val.slice(1, -1);
  }
  // Integer
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  // Float
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // String
  return val;
}