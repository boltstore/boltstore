import type {
  ApiResponse,
  LoginResponse,
  StatusResponse,
  DatabaseInfo,
  ApiKeyInfo,
  ApiKeyCreateResponse,
  ActivityEntry,
  HealthResponse,
  TableSchema,
  ColumnDef,
  RecordQueryParams,
  QueryResult,
  DbConfig,
  AdminInfo,
  GlobalSettings,
  AnalyticsOverview,
  DatabaseAnalytics,
  QueryLogEntry,
  StorageSnapshot,
  TopQuery,
} from "./types"

export type {
  ActivityEntry,
  AnalyticsOverview,
  TopQuery,
  QueryLogEntry,
  ApiKeyInfo,
  DatabaseAnalytics,
  DatabaseInfo,
  HealthResponse,
}

const STORAGE_TOKEN = "boltstore_session"
const memoryStore = new Map<string, string>()

const CACHE_TTL = 60_000
const responseCache = new Map<string, { data: unknown; timestamp: number }>()

function storage(): {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
} {
  if (typeof sessionStorage !== "undefined") return sessionStorage
  return {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => { memoryStore.set(k, v) },
    removeItem: (k) => { memoryStore.delete(k) },
  }
}

function getBaseUrl(): string {
  return window.location.origin
}

function getToken(): string | null {
  return storage().getItem(STORAGE_TOKEN)
}

export function saveSession(token: string) {
  storage().setItem(STORAGE_TOKEN, token)
}

export function clearSession() {
  storage().removeItem(STORAGE_TOKEN)
}

export function hasSession(): boolean {
  return !!getToken()
}

class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = "ApiClientError"
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getBaseUrl()
  if (!baseUrl) throw new ApiClientError(0, "NO_URL", "Server URL not configured")

  const method = (options.method || "GET").toUpperCase()
  const token = getToken()
  const cacheKey = `${method}:${path}:${token || ""}`

  if (method === "GET") {
    const cached = responseCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data as T
    }
  } else {
    responseCache.clear()
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${baseUrl}${path}`, { ...options, headers })

  if (res.status === 401) {
    let message = "Unauthorized"
    try {
      const body = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {}
    clearSession()
    throw new ApiClientError(401, "UNAUTHORIZED", message)
  }

  if (!res.ok) {
    let code = "UNKNOWN"
    let message = "An error occurred"
    try {
      const body = await res.json()
      if (body?.error?.code) code = body.error.code
      if (body?.error?.message) message = body.error.message
    } catch {}
    throw new ApiClientError(res.status, code, message)
  }

  const ct = res.headers.get("content-type") || ""
  if (ct.includes("application/json")) {
    const data = await res.json() as T
    if (method === "GET") {
      responseCache.set(cacheKey, { data, timestamp: Date.now() })
    }
    return data
  }
  // Non-JSON response — throw instead of casting to T, which would hide bugs
  const text = await res.text().catch(() => "")
  throw new ApiClientError(res.status, "UNEXPECTED_RESPONSE", `Expected JSON but got ${ct}: ${text.slice(0, 200)}`)
}

export function clearResponseCache() {
  responseCache.clear()
}

export const api = {
  // Auth
  getStatus: () => request<ApiResponse<StatusResponse>>("/api/admin/status"),
  setup: (email: string, password: string) =>
    request<ApiResponse<AdminInfo>>("/api/admin/setup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<ApiResponse<LoginResponse>>("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<ApiResponse<AdminInfo>>("/api/admin/me"),
  logout: () =>
    request<ApiResponse<{ loggedOut: boolean }>>("/api/admin/logout", {
      method: "POST",
    }),

  // Health
  health: () => request<HealthResponse>("/api/health"),

  // Databases
  listDatabases: () => request<ApiResponse<DatabaseInfo[]>>("/api/databases"),
  getDatabase: (name: string) => request<ApiResponse<DatabaseInfo>>(`/api/databases/${encodeURIComponent(name)}`),
  createDatabase: (name: string, group?: string) =>
    request<ApiResponse<DatabaseInfo>>("/api/databases", {
      method: "POST",
      body: JSON.stringify({ name, group }),
    }),
  renameDatabase: (name: string, newName: string) =>
    request<ApiResponse<{ name: string }>>(`/api/databases/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: newName }),
    }),
  deleteDatabase: (name: string) =>
    request<ApiResponse<{ deleted: boolean }>>(`/api/databases/${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),

  // Config
  getConfig: (name: string) =>
    request<ApiResponse<DbConfig>>(`/api/databases/${encodeURIComponent(name)}/config`),
  updateConfig: (name: string, config: Partial<DbConfig>) =>
    request<ApiResponse<DbConfig>>(`/api/databases/${encodeURIComponent(name)}/config`, {
      method: "PATCH",
      body: JSON.stringify(config),
    }),

  // API Keys
  listKeys: (db: string) =>
    request<ApiResponse<ApiKeyInfo[]>>(`/api/databases/${encodeURIComponent(db)}/keys`),
  createKey: (db: string, label: string) =>
    request<ApiResponse<ApiKeyCreateResponse>>(`/api/databases/${encodeURIComponent(db)}/keys`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  rotateKey: (db: string, keyId: string) =>
    request<ApiResponse<{ id: string; key: string }>>(
      `/api/databases/${encodeURIComponent(db)}/keys/${encodeURIComponent(keyId)}/rotate`,
      { method: "POST" },
    ),
  revokeKey: (db: string, keyId: string) =>
    request<ApiResponse<{ revoked: boolean }>>(
      `/api/databases/${encodeURIComponent(db)}/keys/${encodeURIComponent(keyId)}`,
      { method: "DELETE" },
    ),

  // Tables
  listTables: (db: string) =>
    request<ApiResponse<string[]>>(`/api/databases/${encodeURIComponent(db)}/tables`),
  getDatabaseSchema: (db: string) =>
    request<ApiResponse<{ name: string; columns: unknown[] }[]>>(`/api/databases/${encodeURIComponent(db)}/tables/schema`),
  createTable: (db: string, name: string, columns: ColumnDef[]) =>
    request<ApiResponse<{ name: string; columns: ColumnDef[] }>>(
      `/api/databases/${encodeURIComponent(db)}/tables`,
      { method: "POST", body: JSON.stringify({ name, columns }) },
    ),
  getTableSchema: (db: string, table: string) =>
    request<ApiResponse<TableSchema>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`,
    ),
  alterTable: (db: string, table: string, changes: Record<string, unknown>) =>
    request<ApiResponse<{ altered: boolean }>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`,
      { method: "PATCH", body: JSON.stringify(changes) },
    ),
  deleteTable: (db: string, table: string) =>
    request<ApiResponse<{ deleted: boolean }>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}`,
      { method: "DELETE" },
    ),

  // Records
  listRecords: (db: string, table: string, params?: RecordQueryParams) => {
    const qs = new URLSearchParams()
    if (params?.fields) params.fields.forEach((f) => qs.append("fields", f))
    if (params?.filter) qs.set("filter", params.filter)
    if (params?.search) qs.set("search", params.search)
    if (params?.sort) qs.set("sort", params.sort)
    if (params?.limit) qs.set("limit", String(params.limit))
    if (params?.offset) qs.set("offset", String(params.offset))
    const q = qs.toString()
    return request<ApiResponse<Record<string, unknown>[]>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/records${q ? `?${q}` : ""}`,
    )
  },
  getRecord: (db: string, table: string, id: string | number) =>
    request<ApiResponse<Record<string, unknown>>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/records/${id}`,
    ),
  createRecord: (db: string, table: string, data: Record<string, unknown>) =>
    request<ApiResponse<Record<string, unknown>>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/records`,
      { method: "POST", body: JSON.stringify(data) },
    ),
  updateRecord: (db: string, table: string, id: string | number, data: Record<string, unknown>) =>
    request<ApiResponse<Record<string, unknown>>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/records/${id}`,
      { method: "PATCH", body: JSON.stringify(data) },
    ),
  deleteRecord: (db: string, table: string, id: string | number) =>
    request<ApiResponse<{ deleted: boolean }>>(
      `/api/databases/${encodeURIComponent(db)}/tables/${encodeURIComponent(table)}/records/${id}`,
      { method: "DELETE" },
    ),

  // Query
  executeQuery: (db: string, sql: string, params?: unknown[]) =>
    request<QueryResult>(`/api/databases/${encodeURIComponent(db)}/query`, {
      method: "POST",
      body: JSON.stringify({ sql, params }),
    }),

  // Activity
  listActivity: (limit = 20, offset = 0) =>
    request<ApiResponse<ActivityEntry[]>>(`/api/activity?limit=${limit}&offset=${offset}`),

  // Settings
  getSettings: () => request<ApiResponse<GlobalSettings>>("/api/settings"),
  updateSettings: (settings: Partial<GlobalSettings>) =>
    request<ApiResponse<GlobalSettings>>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(settings),
    }),

  // Analytics
  getAnalyticsOverview: (range = "24h") => request<ApiResponse<AnalyticsOverview>>(`/api/analytics/overview?range=${range}`),
  getDatabaseAnalytics: (name: string, range = "24h") =>
    request<ApiResponse<DatabaseAnalytics>>(`/api/analytics/${encodeURIComponent(name)}/overview?range=${range}`),
  getAllDatabaseAnalytics: (range = "24h") =>
    request<ApiResponse<DatabaseAnalytics[]>>(`/api/analytics/databases?range=${range}`),
  getQueryLog: (name: string, range = "24h", limit = 20, offset = 0) =>
    request<ApiResponse<QueryLogEntry[]>>(`/api/analytics/${encodeURIComponent(name)}/queries?range=${range}&limit=${limit}&offset=${offset}`),
  getStorageHistory: (name: string) =>
    request<ApiResponse<StorageSnapshot[]>>(`/api/analytics/${encodeURIComponent(name)}/size`),
  getTopQueries: (range = "24h") => request<ApiResponse<TopQuery[]>>(`/api/analytics/top-queries?range=${range}`),
  getVolume: (range = "24h", tz?: string) => {
    let path = `/api/analytics/volume?range=${range}`;
    if (tz) path += `&tz=${encodeURIComponent(tz)}`;
    return request<ApiResponse<{ slots: string[]; counts: number[]; errors: number[]; max: number; rows_read?: number[]; rows_written?: number[]; max_read?: number; max_written?: number }>>(path);
  },
  getErrors: (limit = 20, range = "24h") => request<ApiResponse<QueryLogEntry[]>>(`/api/analytics/errors?range=${range}&limit=${limit}`),

  // Export
  exportDatabase: async (name: string) => {
    const baseUrl = getBaseUrl()
    const token = getToken()
    const res = await fetch(`${baseUrl}/api/databases/${encodeURIComponent(name)}/export`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new ApiClientError(res.status, "EXPORT_FAILED", "Export failed")
    return res.blob()
  },

  // Import
  importDatabase: async (file: File, name?: string, group?: string) => {
    const baseUrl = getBaseUrl()
    const token = getToken()
    const form = new FormData()
    form.append("file", file)
    if (name) form.append("name", name)
    if (group) form.append("group", group)
    const res = await fetch(`${baseUrl}/api/databases/import`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) {
      let message = "Import failed"
      try {
        const body = await res.json()
        if (body?.error?.message) message = body.error.message
      } catch {}
      throw new ApiClientError(res.status, "IMPORT_FAILED", message)
    }
    responseCache.clear();
    return res.json() as Promise<ApiResponse<{ name: string }>>
  },
}
