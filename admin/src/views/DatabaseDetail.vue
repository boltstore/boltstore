<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";
import SqlConsole from "./SqlConsole.vue";
import DatabaseSettings from "./DatabaseSettings.vue";

const route = useRoute();
const router = useRouter();
const { apiRequest } = useConnection();

const dbName = computed(() => route.params.name as string);

const tables = ref<string[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const creating = ref(false);
const deleting = ref<string | null>(null);
const newTable = ref({ name: "", columns: [{ name: "", type: "text" as const }] });

const selectedTable = ref("");
const records = ref<any[]>([]);
const columns = ref<any[]>([]);
const recordsLoading = ref(false);
const page = ref(1);
const perPage = ref(20);
const total = ref(0);
const sortField = ref("");
const sortDir = ref<"asc" | "desc">("asc");
const deletingRecord = ref<number | null>(null);
const view = ref<"tables" | "sql" | "settings">("tables");

const totalPages = computed(() => Math.ceil(total.value / perPage.value));

onMounted(load);

watch(() => dbName.value, () => { selectedTable.value = ""; view.value = "tables"; load(); });

async function load() {
  loading.value = true;
  try {
    const info = await apiRequest("GET", `/api/databases/${dbName.value}`);
    tables.value = info?.tables ?? [];
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function selectTable(name: string) {
  selectedTable.value = name;
  page.value = 1;
  sortField.value = "";
  sortDir.value = "asc";
  view.value = "tables";
  await loadRecords();
}

async function loadRecords() {
  if (!selectedTable.value) return;
  recordsLoading.value = true;
  try {
    const schema = await apiRequest("GET", `/api/databases/${dbName.value}/tables/${selectedTable.value}`);
    columns.value = schema?.columns ?? [];
    await fetchRecords();
  } catch (e) {
    console.error(e);
  } finally {
    recordsLoading.value = false;
  }
}

async function fetchRecords() {
  const params = new URLSearchParams();
  params.set("limit", String(perPage.value));
  params.set("offset", String((page.value - 1) * perPage.value));
  if (sortField.value) params.set("sort", sortDir.value === "desc" ? `-${sortField.value}` : sortField.value);

  const res = await globalThis.fetch(
    `${(useConnection().state).baseUrl}/api/databases/${dbName.value}/tables/${selectedTable.value}/records?${params}`,
    { headers: { "Authorization": `Bearer ${(useConnection().state).token}` } }
  );
  const json = await res.json();
  records.value = json.data ?? [];
  total.value = json.meta?.total ?? 0;
}

function changeLimit(newLimit: number) {
  perPage.value = newLimit;
  page.value = 1;
  fetchRecords();
}

function sortBy(field: string) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortField.value = field;
    sortDir.value = "asc";
  }
  page.value = 1;
  fetchRecords();
}

async function deleteRecord(id: number) {
  if (deletingRecord.value !== null) return;
  if (!confirm("Delete this record?")) return;
  deletingRecord.value = id;
  try {
    await apiRequest("DELETE", `/api/databases/${dbName.value}/tables/${selectedTable.value}/records/${id}`);
    await fetchRecords();
  } catch (e: any) {
    alert(e.message);
  } finally {
    deletingRecord.value = null;
  }
}

async function createTable() {
  if (creating.value) return;
  creating.value = true;
  try {
    await apiRequest("POST", `/api/databases/${dbName.value}/tables`, {
      name: newTable.value.name,
      columns: newTable.value.columns.filter((c: any) => c.name),
    });
    showCreate.value = false;
    newTable.value = { name: "", columns: [{ name: "", type: "text" as const }] };
    await load();
  } catch (e: any) {
    alert(e.message);
  } finally {
    creating.value = false;
  }
}

function addColumn() {
  newTable.value.columns.push({ name: "", type: "text" as const });
}

async function deleteTable(name: string) {
  if (deleting.value) return;
  deleting.value = name;
  try {
    await apiRequest("DELETE", `/api/databases/${dbName.value}/tables/${name}`);
    if (selectedTable.value === name) selectedTable.value = "";
    await load();
  } catch (e: any) {
    alert(e.message);
  } finally {
    deleting.value = null;
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="flex items-center gap-3 mb-4 flex-shrink-0">
      <button @click="router.push('/databases')" class="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
        Databases
      </button>
      <span class="text-gray-700">/</span>
      <h1 class="text-lg font-semibold text-gray-100">{{ dbName }}</h1>
    </div>

    <div class="flex flex-1 gap-4 min-h-0">
      <!-- Left panel: tables list -->
      <div class="flex-none w-1/5 flex flex-col bg-gray-900 rounded-xl border border-gray-800 min-h-0">
        <div class="flex items-center justify-between px-3 py-2.5 border-b border-gray-800 flex-shrink-0">
          <span class="text-xs font-medium text-gray-500 uppercase tracking-wider">Tables</span>
          <button @click="showCreate = true" class="text-xs text-accent-400 hover:text-accent-300" title="Create table">+ New</button>
        </div>
        <div class="flex-1 overflow-y-auto p-2 space-y-0.5">
          <div v-if="loading" class="text-center py-8 text-xs text-gray-600">Loading...</div>
          <template v-else-if="tables.length === 0">
            <div class="text-center py-8">
              <p class="text-xs text-gray-600 mb-2">No tables yet</p>
              <button @click="showCreate = true" class="text-xs text-accent-400 hover:text-accent-300">Create one</button>
            </div>
          </template>
          <template v-else>
            <div v-for="t in tables" :key="t" @click="selectTable(t)"
              :class="[
                'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center justify-between group cursor-pointer',
                selectedTable === t ? 'bg-accent-500/10 text-accent-300' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              ]">
              <span class="truncate min-w-0">{{ t }}</span>
              <button @click.stop="deleteTable(t)" :disabled="deleting !== null"
                class="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 text-xs disabled:opacity-40 flex-shrink-0 ml-2">
                {{ deleting === t ? "..." : "×" }}
              </button>
            </div>
          </template>
        </div>
        <div class="border-t border-gray-800 p-2 space-y-1 flex-shrink-0">
          <button @click="view = 'sql'" :class="['nav-item w-full', view === 'sql' ? 'text-accent-400' : '']">SQL Console</button>
          <hr class="border-gray-800">
          <button @click="view = 'settings'" :class="['nav-item w-full', view === 'settings' ? 'text-accent-400' : '']">Settings</button>
        </div>
      </div>

      <!-- Right panel -->
      <div class="flex-1 flex flex-col min-h-0">
        <!-- Table browser -->
        <template v-if="view === 'tables'">
          <div v-if="!selectedTable" class="flex-1 flex items-center justify-center">
            <p class="text-sm text-gray-600">Select a table to browse its data</p>
          </div>

          <template v-else>
            <div class="flex items-center justify-between mb-3 flex-shrink-0">
              <div class="flex items-center gap-3">
                <h2 class="text-sm font-medium text-gray-200">{{ selectedTable }}</h2>
                <span class="text-xs text-gray-600">{{ total }} rows</span>
                <select v-model.number="perPage" @change="changeLimit(perPage)" class="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-gray-400 text-xs focus:outline-none focus:border-accent-500">
                  <option :value="10">10</option>
                  <option :value="20">20</option>
                  <option :value="50">50</option>
                  <option :value="100">100</option>
                </select>
              </div>
              <div class="flex items-center gap-1">
                <button :disabled="page <= 1" @click="page--; fetchRecords()" class="px-2 py-1 rounded bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">Prev</button>
                <span class="text-xs text-gray-500 w-16 text-center">{{ page }} / {{ totalPages }}</span>
                <button :disabled="page >= totalPages" @click="page++; fetchRecords()" class="px-2 py-1 rounded bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">Next</button>
              </div>
            </div>

            <div v-if="recordsLoading" class="flex-1 flex items-center justify-center">
              <p class="text-xs text-gray-600">Loading...</p>
            </div>

            <template v-else>
              <div class="flex-1 min-h-0 overflow-auto">
                <table class="min-w-full text-sm">
                  <thead class="sticky top-0 z-10 bg-gray-900">
                    <tr class="border-b border-gray-800">
                      <th v-for="col in columns" :key="col.name" @click="sortBy(col.name)"
                        class="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-300 select-none whitespace-nowrap border-r border-gray-800 last:border-r-0" style="min-width: 100px;">
                        <div class="flex items-center gap-1">
                          {{ col.name }}
                          <span v-if="sortField === col.name" class="text-accent-400">{{ sortDir === "asc" ? "↑" : "↓" }}</span>
                        </div>
                      </th>
                      <th class="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-14">Act.</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-gray-800">
                    <tr v-for="row in records" :key="row.id" class="hover:bg-gray-900/20 transition-colors">
                      <td v-for="col in columns" :key="col.name" class="px-3 py-2 text-gray-300 text-xs font-mono max-w-[300px] truncate whitespace-nowrap border-r border-gray-800 last:border-r-0" style="min-width: 100px;" :title="row[col.name] ?? ''">
                        {{ row[col.name] ?? "—" }}
                      </td>
                      <td class="px-3 py-2 text-right">
                        <button @click="deleteRecord(row.id)" :disabled="deletingRecord !== null" class="text-xs text-red-400 hover:text-red-300 disabled:opacity-40">
                          {{ deletingRecord === row.id ? "..." : "Del" }}
                        </button>
                      </td>
                    </tr>
                    <tr v-if="records.length === 0">
                      <td :colspan="columns.length + 1" class="px-4 py-12 text-center text-gray-600 text-sm">No records</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </template>
          </template>
        </template>

        <!-- SQL Console -->
        <SqlConsole v-else-if="view === 'sql'" />

        <!-- Settings -->
        <DatabaseSettings v-else-if="view === 'settings'" />
      </div>
    </div>

    <!-- Create table modal -->
    <div v-if="showCreate" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showCreate = false">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md">
        <h3 class="text-sm font-medium text-gray-200 mb-4">Create Table</h3>
        <input v-model="newTable.name" class="input mb-4" placeholder="Table name" />
        <div v-for="(col, i) in newTable.columns" :key="i" class="flex gap-2 mb-2">
          <input v-model="col.name" class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-500" placeholder="Column name" />
          <select v-model="col.type" class="w-28 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-accent-500">
            <option value="text">text</option>
            <option value="integer">integer</option>
            <option value="real">real</option>
            <option value="boolean">boolean</option>
          </select>
        </div>
        <button @click="addColumn" class="text-xs text-accent-400 mb-4">+ Add column</button>
        <div class="flex gap-3 justify-end">
          <button @click="showCreate = false" :disabled="creating" class="btn-sm-secondary">Cancel</button>
          <button @click="createTable" :disabled="creating" class="btn-sm-primary">{{ creating ? "Creating..." : "Create" }}</button>
        </div>
      </div>
    </div>
  </div>
</template>