export interface QueryResult<T = Record<string, unknown>> {
  data: T[];
  meta: {
    total?: number;
    page?: number;
    per_page?: number;
    total_pages?: number;
    next_cursor?: string | null;
  };
}

export interface SqlFragment {
  sql: string;
  params: unknown[];
}
