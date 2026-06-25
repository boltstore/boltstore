export interface ApiError {
  code: string
  message: string
}

export interface ApiResponse<T> {
  data: T
  meta?: { total: number; limit: number; offset: number }
}

export interface AdminInfo {
  id: string
  email: string
}

export interface LoginResponse {
  token: string
  admin: AdminInfo
}

export interface StatusResponse {
  hasAdmins: boolean
}

export interface DatabaseInfo {
  id: string
  name: string
  path: string
  createdAt: string
  readonly?: boolean
}

export interface ApiKeyInfo {
  id: string
  label: string
  created_at: string
  last_used_at: string | null
}

export interface ApiKeyCreateResponse {
  id: string
  label: string
  key: string
}

export interface ActivityEntry {
  id: string
  action: string
  database_name: string | null
  target: string | null
  details: string | null
  ip: string | null
  created_at: string
  admin_email?: string | null
}

export interface HealthResponse {
  status: string
  version: string
  databases: number
}

export interface TableSchema {
  name: string
  columns: ColumnInfo[]
}

export interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

export interface ColumnDef {
  name: string
  type: string
  nullable?: boolean
  primary_key?: boolean
  auto_increment?: boolean
  unique?: boolean
  default?: string
  references?: { table: string; column: string }
}

export interface RecordQueryParams {
  fields?: string[]
  filter?: string
  search?: string
  sort?: string
  limit?: number
  offset?: number
}

export interface QueryResult {
  data: Record<string, unknown>[] | null
  meta?: { changes: number }
}

export interface DbConfig {
  cors_origins?: string[]
  [key: string]: unknown
}

export interface GlobalSettings {
  timezone: string
}

export interface AnalyticsOverview {
  databases: number
  queries: number
  writes: number
  avgLatencyMs: number
  errorCount: number
  totalStorageBytes: number
}

export interface DatabaseAnalytics {
  database: string
  queries: number
  writes: number
  avgLatencyMs: number
  errorCount: number
  rows_read: number
  storageBytes: number
  tableCount: number
  topTables: { table_name: string; calls: number; avg_ms: number; writes: number; total_rows: number }[]
}

export interface QueryLogEntry {
  id: number
  database: string
  table_name: string | null
  operation: string
  duration_ms: number
  row_count: number
  status: string
  error_msg: string | null
  timestamp: string
}

export interface StorageSnapshot {
  size_bytes: number
  table_count: number
  timestamp: string
}

export interface TopQuery {
  database: string
  table_name: string | null
  operation: string
  calls: number
  avg_ms: number
  total_rows: number
}
