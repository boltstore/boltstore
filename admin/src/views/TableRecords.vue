<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const route = useRoute();
const router = useRouter();
const { apiRequest } = useConnection();

const dbName = computed(() => route.params.name as string);
const tableName = computed(() => route.params.table as string);

const records = ref<any[]>([]);
const columns = ref<any[]>([]);
const loading = ref(true);
const page = ref(1);
const perPage = ref(20);
const total = ref(0);
const sortField = ref("");
const sortDir = ref<"asc" | "desc">("asc");
const filterText = ref("");

const totalPages = computed(() => Math.ceil(total.value / perPage.value));

function changeLimit(newLimit: number) {
  perPage.value = newLimit;
  page.value = 1;
  fetchRecords();
}

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const [schema, data] = await Promise.all([
      apiRequest("GET", `/api/databases/${dbName.value}/tables/${tableName.value}`),
      fetchRecords(),
    ]);
    columns.value = schema?.columns ?? [];
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function fetchRecords() {
  const params = new URLSearchParams();
  params.set("limit", String(perPage.value));
  params.set("offset", String((page.value - 1) * perPage.value));
  if (sortField.value) params.set("sort", sortDir.value === "desc" ? `-${sortField.value}` : sortField.value);

  const res = await globalThis.fetch(
    `${(useConnection().state).baseUrl}/api/databases/${dbName.value}/tables/${tableName.value}/records?${params}`,
    { headers: { "Authorization": `Bearer ${(useConnection().state).token}` } }
  );
  const json = await res.json();
  records.value = json.data ?? [];
  total.value = json.meta?.total ?? 0;
}

async function sortBy(field: string) {
  if (sortField.value === field) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortField.value = field;
    sortDir.value = "asc";
  }
  page.value = 1;
  await fetchRecords();
}

async function deleteRecord(id: number) {
  if (!confirm("Delete this record?")) return;
  try {
    await apiRequest("DELETE", `/api/databases/${dbName.value}/tables/${tableName.value}/records/${id}`);
    await fetchRecords();
  } catch (e: any) {
    alert(e.message);
  }
}
</script>

<template>
  <div>
    <button @click="router.push(`/databases/${dbName}`)" class="text-xs text-gray-500 hover:text-gray-300 mb-4 flex items-center gap-1">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      {{ dbName }}
    </button>
    <h1 class="text-xl font-semibold text-gray-100 mb-6">{{ tableName }}</h1>

    <div v-if="loading" class="text-center py-16 text-gray-600 text-sm">Loading...</div>

    <template v-else>
      <!-- Table -->
      <div class="overflow-x-auto rounded-xl border border-gray-800">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-900">
              <th v-for="col in columns" :key="col.name" @click="sortBy(col.name)" class="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-300 select-none">
                <div class="flex items-center gap-1">
                  {{ col.name }}
                  <span v-if="sortField === col.name" class="text-accent-400">{{ sortDir === "asc" ? "↑" : "↓" }}</span>
                </div>
              </th>
              <th class="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-16">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800">
            <tr v-for="row in records" :key="row.id" class="hover:bg-gray-900/50 transition-colors">
              <td v-for="col in columns" :key="col.name" class="px-4 py-2.5 text-gray-300 text-sm font-mono max-w-[200px] truncate" :title="row[col.name] ?? ''">
                {{ row[col.name] ?? "—" }}
              </td>
              <td class="px-4 py-2.5 text-right">
                <button @click="deleteRecord(row.id)" class="text-xs text-red-400 hover:text-red-300">Delete</button>
              </td>
            </tr>
            <tr v-if="records.length === 0">
              <td :colspan="columns.length + 1" class="px-4 py-12 text-center text-gray-600 text-sm">No records</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="flex items-center justify-between mt-4 text-xs text-gray-500">
        <div class="flex items-center gap-3">
          <span>{{ total }} records total</span>
          <select v-model.number="perPage" @change="changeLimit(perPage)" class="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-gray-400 text-xs focus:outline-none focus:border-accent-500">
            <option :value="10">10 / page</option>
            <option :value="20">20 / page</option>
            <option :value="50">50 / page</option>
            <option :value="100">100 / page</option>
          </select>
        </div>
        <div v-if="totalPages > 1" class="flex gap-1">
          <button :disabled="page <= 1" @click="page--; fetchRecords()" class="px-3 py-1.5 rounded bg-gray-900 border border-gray-800 hover:bg-gray-800 disabled:opacity-40">Previous</button>
          <span class="px-3 py-1.5 text-gray-400">Page {{ page }} of {{ totalPages }}</span>
          <button :disabled="page >= totalPages" @click="page++; fetchRecords()" class="px-3 py-1.5 rounded bg-gray-900 border border-gray-800 hover:bg-gray-800 disabled:opacity-40">Next</button>
        </div>
      </div>
    </template>
  </div>
</template>
