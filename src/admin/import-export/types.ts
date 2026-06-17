export interface ImportOptions {
  format?: "csv" | "json";
  autoCreate?: boolean;
  dryRun?: boolean;
  hasHeader?: boolean;
  maxRows?: number;
}

export interface ImportResult {
  imported: number;
  failed: number;
  errors?: ImportError[];
  collection?: {
    name: string;
    schema: unknown[];
  };
  dryRun: boolean;
}

export interface ImportError {
  row: number;
  message: string;
}

export interface ExportOptions {
  format?: "csv" | "json";
  filter?: Record<string, unknown>;
  sort?: string;
  direction?: "asc" | "desc";
  fields?: string[];
  limit?: number;
  offset?: number;
}

export interface ExportResult {
  data: string;
  meta: {
    recordCount: number;
    format: "csv" | "json";
    collection: string;
  };
}

export const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"]);
