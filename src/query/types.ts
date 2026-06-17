export type FilterOperator =
  | "$eq"
  | "$neq"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$in"
  | "$nin"
  | "$contains"
  | "$startsWith"
  | "$endsWith"
  | "$exists"
  | "$regexp";

export interface FieldFilter {
  [operator: string]: unknown;
}

export interface LogicalGroup {
  $and?: FilterExpression[];
  $or?: FilterExpression[];
  $not?: FilterExpression;
}

export type FilterExpression = Record<string, unknown> | LogicalGroup;

export type SortSpec = string;

export type AggregateFn = "$count" | "$sum" | "$avg" | "$min" | "$max";

export interface AggregateSpec {
  function: AggregateFn;
  field?: string;
  alias?: string;
}

export interface QueryParams {
  filter?: FilterExpression | FilterExpression[];
  sort?: SortSpec[];
  fields?: string[];
  cursor?: string;
  limit?: number;
  offset?: number;
  search?: string;
  searchFields?: string[];
  aggregate?: AggregateSpec;
  groupBy?: string;
  having?: FilterExpression;
}

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
