<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import Drawer from "../components/ui/Drawer.vue";
import { useSidebar } from "../composables/useSidebar";

const route = useRoute();
const router = useRouter();
const { apiRequest } = useConnection();
const { toggleSidebar } = useSidebar();

const dbName = ref("");
const activeTab = ref("data");
const showAddRecordDrawer = ref(false);
const selectedTable = ref("");
const loading = ref(true);
const error = ref("");

const tables = ref<{ name: string }[]>([]);
const columns = ref<{ name: string; type: string }[]>([]);
const rows = ref<Record<string, unknown>[]>([]);
const totalRows = ref(0);
const limit = ref(50);
const offset = ref(0);

const topQueries = [
  { query: "SELECT * FROM crawler_sources WHERE status = 'active'", count: 12453 },
  { query: "INSERT INTO jobs (title, url, company) VALUES (?, ?, ?)", count: 8921 },
  { query: "UPDATE crawler_sources SET last_crawled = ? WHERE id = ?", count: 6543 },
  { query: "DELETE FROM jobs WHERE posted_at < ?", count: 2341 },
  { query: "SELECT COUNT(*) FROM jobs WHERE status = 'open'", count: 1876 },
];

const schemaInfo = ref<{ table: string; columns: { name: string; type: string }[] }[]>([]);

const sqlQuery = ref("");
const sqlResult = ref<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null);
const sqlError = ref("");
const sqlLoading = ref(false);

const config = ref<Record<string, unknown>>({});
const configSaving = ref(false);
const configDanger = ref("");

const newRecord = ref<Record<string, string>>({});

const tabs = [
  { id: "data", label: "Data", icon: "M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { id: "sql", label: "SQL Console", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "schema", label: "Schema", icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" },
  { id: "queries", label: "Top Queries", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

onMounted(async () => {
  dbName.value = route.params.name as string;
  await loadDb();
});

watch(() => route.params.name, async (name) => {
  if (name) {
    dbName.value = name as string;
    await loadDb();
  }
});

async function loadDb() {
  loading.value = true;
  error.value = "";
  try {
    const [dbsRes, tablesRes] = await Promise.all([
      apiRequest<{ data: { name: string; created_at: string; config?: string } }>("GET", `/api/databases/${dbName.value}`),
      apiRequest<{ data: { name: string }[] }>("GET", `/api/databases/${dbName.value}/tables`),
    ]);
    tables.value = tablesRes.data ?? [];
    if (dbsRes.data?.config) {
      try { config.value = JSON.parse(dbsRes.data.config); } catch { config.value = {}; }
    }
    if (tables.value.length > 0 && !selectedTable.value) {
      selectedTable.value = tables.value[0].name;
    }
    if (selectedTable.value) await loadRecords();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Failed to load database";
  }
  loading.value = false;
}

async function loadRecords() {
  if (!selectedTable.value) return;
  try {
    const [columnsRes, recordsRes] = await Promise.all([
      apiRequest<{ data: { name: string; type: string }[] }>("GET", `/api/databases/${dbName.value}/tables/${selectedTable.value}`),
      apiRequest<{ data: Record<string, unknown>[]; meta?: { total?: number } }>("GET", `/api/databases/${dbName.value}/tables/${selectedTable.value}/records?limit=${limit.value}&offset=${offset.value}`),
    ]);
    columns.value = columnsRes.data ?? [];
    rows.value = recordsRes.data ?? [];
    totalRows.value = (recordsRes as any)?.meta?.total ?? rows.value.length;
  } catch {
    columns.value = [];
    rows.value = [];
    totalRows.value = 0;
  }
}

async function loadSchema() {
  try {
    const res = await apiRequest<{ data: { name: string }[] }>("GET", `/api/databases/${dbName.value}/tables`);
    const tablesList = res.data ?? [];
    const schemas = await Promise.all(
      tablesList.map(async (t) => {
        try {
          const colRes = await apiRequest<{ data: { name: string; type: string }[] }>("GET", `/api/databases/${dbName.value}/tables/${t.name}`);
          return { table: t.name, columns: colRes.data ?? [] };
        } catch {
          return { table: t.name, columns: [] };
        }
      })
    );
    schemaInfo.value = schemas;
  } catch {
    schemaInfo.value = [];
  }
}

function selectTable(name: string) {
  if (name === selectedTable.value) return;
  selectedTable.value = name;
  offset.value = 0;
  loadRecords();
}

async function runSql() {
  if (!sqlQuery.value.trim()) return;
  sqlLoading.value = true;
  sqlError.value = "";
  sqlResult.value = null;
  try {
    const res = await apiRequest<{ data?: Record<string, unknown>[]; meta?: { changes?: number } }>("POST", `/api/databases/${dbName.value}/query`, {
      sql: sqlQuery.value.trim(),
    });
    if (res.data) {
      const cols = res.data.length > 0 ? Object.keys(res.data[0]) : [];
      sqlResult.value = { columns: cols, rows: res.data };
    } else if ((res as any)?.meta?.changes !== undefined) {
      sqlResult.value = { columns: ["affected_rows"], rows: [{ affected_rows: (res as any).meta.changes }] };
    }
  } catch (e) {
    sqlError.value = e instanceof Error ? e.message : "Query failed";
  }
  sqlLoading.value = false;
}

async function addRecord() {
  if (!selectedTable.value) return;
  try {
    await apiRequest("POST", `/api/databases/${dbName.value}/tables/${selectedTable.value}/records`, newRecord.value);
    showAddRecordDrawer.value = false;
    newRecord.value = {};
    await loadRecords();
  } catch (e) {
    // Could surface error
  }
}

async function deleteDatabase() {
  if (!confirm("Delete this database? This cannot be undone.")) return;
  try {
    await apiRequest("DELETE", `/api/databases/${dbName.value}`);
    router.push("/databases");
  } catch (e) {
    configDanger.value = e instanceof Error ? e.message : "Failed to delete";
  }
}
</script>

<template>
  <AppLayout>
    <header class="h-14 border-b border-border-default flex items-center justify-between px-4 sm:px-6 bg-bolt-base/80 backdrop-blur-sm sticky top-0 z-30">
      <div class="flex items-center gap-2 text-sm">
        <button class="md:hidden p-1 text-text-muted hover:text-text-primary transition-colors" @click="toggleSidebar">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <a href="/dashboard/databases" class="text-text-muted hover:text-text-primary transition-colors">Databases</a>
        <span class="text-text-muted">/</span>
        <span class="text-text-primary">{{ dbName }}</span>
        <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-muted hidden sm:inline">{{ tables.length }} tables</span>
      </div>
    </header>

    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
    </div>

    <div v-else-if="error" class="p-4 sm:p-6 max-w-6xl mx-auto">
      <div class="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">{{ error }}</div>
    </div>

    <div v-else class="p-4 sm:p-6 max-w-6xl mx-auto">
      <!-- Tabs -->
      <div class="border-b border-border-default mb-6 flex items-center justify-between">
        <div>
          <a
            v-for="tab in tabs"
            :key="tab.id"
            href="#"
            class="nav-tab"
            :class="{ active: activeTab === tab.id }"
            @click.prevent="activeTab = tab.id"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="tab.icon"/>
            </svg>
            {{ tab.label }}
          </a>
        </div>
        <div class="flex items-center gap-2 text-[10px] text-text-muted pb-1">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
          </svg>
          SQLite 3.42.0
        </div>
      </div>

      <!-- Data Panel -->
      <div v-show="activeTab === 'data'" class="flex flex-col md:flex-row gap-4">
        <!-- Table List -->
        <div class="w-56 shrink-0">
          <div class="flex items-center gap-2 mb-3">
            <input type="text" class="input-field text-xs py-2" placeholder="Search tables..." style="font-family:Inter" />
          </div>
          <div class="space-y-0.5">
            <div
              v-for="table in tables"
              :key="table.name"
              class="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors"
              :class="table.name === selectedTable ? 'text-text-primary bg-bolt-hover' : 'text-text-secondary hover:bg-bolt-hover'"
              @click="selectTable(table.name)"
            >
              <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
              {{ table.name }}
            </div>
          </div>
        </div>

        <!-- Data Viewer -->
        <div class="flex-1 min-w-0">
          <div v-if="!selectedTable" class="text-center py-12 text-sm text-text-muted">
            Select a table to view data.
          </div>
          <template v-else>
            <!-- Toolbar -->
            <div class="flex items-center gap-2 mb-3 flex-wrap">
              <div class="flex-1"></div>
              <div class="flex items-center gap-1">
                <button class="btn-ghost btn-sm flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z"/>
                  </svg>
                  Filters
                </button>
                <button class="btn-ghost btn-sm flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                  </svg>
                  Sort
                </button>
                <button class="btn-ghost btn-sm flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
                  </svg>
                  Columns
                </button>
                <button class="btn-primary btn-sm flex items-center gap-1" @click="showAddRecordDrawer = true">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                  </svg>
                  Add Record
                </button>
              </div>
            </div>

            <!-- Data Table -->
            <div class="border border-border-default rounded-lg overflow-hidden bg-bolt-card mb-4">
              <div v-if="columns.length === 0" class="text-center py-8 text-sm text-text-muted">
                No columns found for this table.
              </div>
              <div v-else class="overflow-x-auto table-scrollable">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th class="w-8">
                        <input type="checkbox" class="w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600" />
                      </th>
                      <th
                        v-for="col in columns"
                        :key="col.name"
                        class="sortable"
                      >
                        {{ col.name }}
                        <span class="schema-col">{{ col.type }}</span>
                        <svg class="sort-icon w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                        </svg>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(row, ri) in rows" :key="ri">
                      <td>
                        <input type="checkbox" class="row-check w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600" />
                      </td>
                      <td v-for="col in columns" :key="col.name" class="font-mono text-xs">
                        <span v-if="row[col.name] === null || row[col.name] === undefined" class="text-text-muted italic">null</span>
                        <span v-else>{{ String(row[col.name]) }}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div class="flex items-center justify-between px-4 py-2 border-t border-border-default bg-bolt-elevated/50">
                <div class="flex items-center gap-2 text-xs text-text-muted">
                  {{ offset + 1 }} &ndash; {{ Math.min(offset + limit, totalRows) }} of {{ totalRows }}
                </div>
                <div class="flex items-center gap-2">
                  <button class="btn-ghost btn-sm flex items-center gap-1" @click="offset = Math.max(0, offset - limit); loadRecords()" :disabled="offset === 0">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                  </button>
                  <button class="btn-secondary btn-sm" :class="{ 'opacity-50 cursor-not-allowed': offset === 0 }" :disabled="offset === 0" @click="offset = Math.max(0, offset - limit); loadRecords()">Previous</button>
                  <button class="btn-secondary btn-sm" :class="{ 'opacity-50 cursor-not-allowed': offset + limit >= totalRows }" :disabled="offset + limit >= totalRows" @click="offset += limit; loadRecords()">Next</button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- SQL Console Panel -->
      <div v-show="activeTab === 'sql'" class="space-y-4">
        <div class="bg-bolt-card border border-border-default rounded-lg p-4">
          <textarea
            v-model="sqlQuery"
            class="w-full h-32 bg-bolt-elevated border border-border-default rounded-lg p-3 text-sm text-text-primary font-mono resize-none focus:outline-none focus:border-accent-600"
            placeholder="-- Enter your SQL query here"
          ></textarea>
          <div class="flex items-center justify-between mt-3">
            <p v-if="sqlError" class="text-xs text-red-400">{{ sqlError }}</p>
            <button class="btn-primary flex items-center gap-1.5 ml-auto" @click="runSql" :disabled="sqlLoading">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              {{ sqlLoading ? "Running..." : "Run Query" }}
            </button>
          </div>
        </div>
        <div class="bg-bolt-card border border-border-default rounded-lg p-4">
          <div class="text-sm text-text-muted mb-2">Results</div>
          <div v-if="!sqlResult && !sqlLoading" class="text-xs text-text-muted">Run a query to see results here.</div>
          <div v-else-if="sqlLoading" class="text-xs text-text-muted">Executing...</div>
          <div v-else class="overflow-x-auto">
            <table class="data-table w-full">
              <thead>
                <tr>
                  <th v-for="col in sqlResult.columns" :key="col">{{ col }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, ri) in sqlResult.rows" :key="ri">
                  <td v-for="col in sqlResult.columns" :key="col" class="font-mono text-xs">
                    <span v-if="row[col] === null || row[col] === undefined" class="text-text-muted italic">null</span>
                    <span v-else>{{ String(row[col]) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="sqlResult.rows.length === 0" class="text-xs text-text-muted py-2">Query executed successfully — no rows returned.</div>
          </div>
        </div>
      </div>

      <!-- Schema Panel -->
      <div v-show="activeTab === 'schema'" class="space-y-4">
        <div class="flex items-center justify-end mb-2">
          <button class="btn-ghost btn-sm" @click="loadSchema">Refresh</button>
        </div>
        <div
          v-for="schema in schemaInfo"
          :key="schema.table"
          class="bg-bolt-card border border-border-default rounded-lg p-4"
        >
          <div class="flex items-center gap-2 mb-3">
            <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            <span class="text-sm font-medium text-text-primary">{{ schema.table }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="col in schema.columns" :key="col.name">
                  <td class="text-text-primary">{{ col.name }}</td>
                  <td><span class="schema-col">{{ col.type }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div v-if="schemaInfo.length === 0" class="text-center py-8 text-sm text-text-muted">
          No tables found. Click Refresh to load schema.
        </div>
      </div>

      <!-- Top Queries Panel -->
      <div v-show="activeTab === 'queries'" class="space-y-4">
        <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
          <div class="px-5 py-4 border-b border-border-default">
            <div class="text-sm font-medium text-text-primary">Top Queries</div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border-default">
                  <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Query</th>
                  <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Executions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="q in topQueries"
                  :key="q.query"
                  class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
                >
                  <td class="px-5 py-3 text-text-secondary font-mono text-xs">{{ q.query }}</td>
                  <td class="px-5 py-3 text-right text-text-secondary">{{ q.count.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Settings Panel -->
      <div v-show="activeTab === 'settings'" class="max-w-2xl">
        <div class="bg-bolt-card border border-border-default rounded-lg p-5 space-y-4">
          <div>
            <label class="form-group label">Database Name</label>
            <input type="text" class="input-field" :value="dbName" readonly />
          </div>
          <div>
            <label class="form-group label">Group</label>
            <select class="input-field appearance-none" style="font-family:Inter">
              <option>default</option>
              <option>production</option>
              <option>staging</option>
            </select>
          </div>
          <div>
            <label class="form-group label">Region</label>
            <select class="input-field appearance-none" style="font-family:Inter">
              <option>Auto (closest)</option>
              <option>US East (N. Virginia)</option>
              <option>EU West (Ireland)</option>
              <option>Asia Pacific (Tokyo)</option>
            </select>
          </div>
        </div>

        <div class="bg-bolt-card border border-red-500/75 rounded-lg p-5 mt-6">
          <h3 class="text-sm font-medium text-red-400 mb-4">Danger Zone</h3>
          <div class="flex items-center justify-between p-3 border border-red-500/20 rounded-md bg-red-500/5">
            <div>
              <div class="text-xs font-medium text-red-400">Delete Database</div>
              <div class="form-group hint">This will permanently delete all tables and data. This action cannot be undone.</div>
            </div>
            <button class="btn-danger btn-sm" @click="deleteDatabase">Delete</button>
          </div>
          <p v-if="configDanger" class="text-xs text-red-400 mt-2">{{ configDanger }}</p>
        </div>
      </div>
    </div>

    <!-- Add Record Drawer -->
    <Drawer :show="showAddRecordDrawer" @close="showAddRecordDrawer = false">
      <template #header>
        <div class="text-sm font-medium text-text-primary">Add Record to {{ selectedTable }}</div>
      </template>
      <div class="space-y-4">
        <div v-for="col in columns" :key="col.key" class="form-group">
          <label>{{ col.label || col.name }}</label>
          <input type="text" class="input-field" v-model="newRecord[col.name]" :placeholder="col.type" />
        </div>
        <div class="flex items-center justify-end gap-3 pt-4 border-t border-border-default">
          <button class="btn-secondary" @click="showAddRecordDrawer = false">Cancel</button>
          <button class="btn-primary" @click="addRecord">Save</button>
        </div>
      </div>
    </Drawer>

    <GithubBadge />
  </AppLayout>
</template>
