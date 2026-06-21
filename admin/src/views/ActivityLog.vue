<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useConnection } from "../stores/client";

const { apiRequest } = useConnection();
const logs = ref<any[]>([]);
const loading = ref(true);
const page = ref(1);
const perPage = ref(20);
const total = ref(0);

const totalPages = computed(() => Math.ceil(total.value / perPage.value));

onMounted(fetchLogs);

async function fetchLogs() {
  loading.value = true;
  try {
    const res = await apiRequest<any>("GET", `/api/activity?limit=${perPage.value}&offset=${(page.value - 1) * perPage.value}`);
    logs.value = res?.data ?? res ?? [];
    total.value = res?.meta?.total ?? 0;
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

function actionLabel(action: string) {
  return action.replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-gray-100">Activity Log</h1>
      <span class="text-xs text-gray-600">{{ total }} entries</span>
    </div>

    <div v-if="loading" class="text-center py-20 text-gray-500 text-sm">Loading...</div>

    <div v-else-if="logs.length === 0" class="text-center py-20 text-gray-600 text-sm">No activity recorded yet.</div>

    <div v-else class="space-y-2">
      <div v-for="log in logs" :key="log.id" class="flex items-center gap-4 px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
        <div class="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-gray-200">{{ actionLabel(log.action) }}</p>
          <div class="flex gap-3 mt-0.5">
            <span v-if="log.database_name" class="text-xs text-gray-600">{{ log.database_name }}</span>
            <span v-if="log.ip" class="text-xs text-gray-700 font-mono">{{ log.ip }}</span>
          </div>
        </div>
        <div class="text-xs text-gray-600 flex-shrink-0 text-right whitespace-nowrap">{{ log.created_at ? new Date(log.created_at).toLocaleString() : '' }}</div>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pt-2">
        <button :disabled="page <= 1" @click="page--; fetchLogs()" class="px-3 py-1.5 rounded bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">Previous</button>
        <span class="text-xs text-gray-600">Page {{ page }} of {{ totalPages }}</span>
        <button :disabled="page >= totalPages" @click="page++; fetchLogs()" class="px-3 py-1.5 rounded bg-gray-900 border border-gray-800 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">Next</button>
      </div>
    </div>
  </div>
</template>
