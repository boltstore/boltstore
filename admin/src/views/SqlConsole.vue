<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const route = useRoute();
const router = useRouter();
const { apiRequest } = useConnection();

const dbName = computed(() => route.params.name as string);
const sql = ref("SELECT * FROM ");
const result = ref<any[] | null>(null);
const error = ref("");
const loading = ref(false);
const history = ref<string[]>([]);

async function execute() {
  error.value = "";
  result.value = null;
  loading.value = true;
  try {
    const res = await apiRequest("POST", `/api/databases/${dbName.value}/query`, { sql: sql.value });
    result.value = res ?? [];
    history.value.unshift(sql.value);
    if (history.value.length > 50) history.value.pop();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function getColumns(): string[] {
  if (!result.value || result.value.length === 0) return [];
  return Object.keys(result.value[0]);
}
</script>

<template>
  <div>
    <button @click="router.push(`/databases/${dbName}`)" class="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white mb-4 flex items-center gap-1.5 transition-colors">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      Back to {{ dbName }}
    </button>
    <h2 class="text-sm font-medium text-gray-300 mb-4">SQL Console</h2>

    <div class="flex gap-2 mb-4">
      <textarea v-model="sql" rows="4" class="flex-1 px-4 py-3 bg-gray-900 border border-gray-800 rounded-xl text-sm font-mono text-gray-200 placeholder-gray-700 focus:outline-none focus:border-accent-500 resize-none" placeholder="SELECT * FROM users WHERE age > 18" @keydown.meta.enter="execute" @keydown.ctrl.enter="execute"></textarea>
    </div>

    <div class="flex items-center gap-3 mb-6">
      <button @click="execute" :disabled="loading" class="btn-primary">
        {{ loading ? "Running..." : "Execute" }}
        <span class="text-gray-400 ml-2 text-xs">⌘⏎</span>
      </button>
      <button @click="sql = ''; result = null; error = ''" class="btn-secondary">Clear</button>
    </div>

    <div v-if="error" class="mb-4 px-4 py-3 rounded-xl bg-red-950/50 border border-red-900/50 text-sm text-red-400 font-mono">{{ error }}</div>

    <div v-if="result" class="overflow-x-auto rounded-xl border border-gray-800">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-gray-900">
            <th v-for="col in getColumns()" :key="col" class="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{ col }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-800">
          <tr v-for="(row, i) in result" :key="i" class="hover:bg-gray-900/50">
            <td v-for="col in getColumns()" :key="col" class="px-4 py-2 text-gray-300 font-mono text-xs whitespace-nowrap">{{ typeof row[col] === 'object' ? JSON.stringify(row[col]) : (row[col] ?? '—') }}</td>
          </tr>
          <tr v-if="result.length === 0">
            <td :colspan="getColumns().length" class="px-4 py-8 text-center text-gray-600 text-sm">No results</td>
          </tr>
        </tbody>
      </table>
      <div class="px-4 py-2 bg-gray-900 border-t border-gray-800 text-xs text-gray-600">{{ result.length }} row(s)</div>
    </div>
  </div>
</template>

