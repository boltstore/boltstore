<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useConnection } from "../stores/client";

const { apiRequest } = useConnection();
const logs = ref<any[]>([]);
const loading = ref(true);
const limit = ref(20);

onMounted(async () => {
  try {
    logs.value = (await apiRequest("GET", "/api/activity")) ?? [];
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
});

function actionLabel(action: string) {
  return action.replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-gray-100">Activity Log</h1>
      <span class="text-xs text-gray-600">{{ logs.length }} entries</span>
    </div>

    <div v-if="loading" class="text-center py-20 text-gray-500 text-sm">Loading...</div>

    <div v-else-if="logs.length === 0" class="text-center py-20 text-gray-600 text-sm">No activity recorded yet.</div>

    <div v-else class="space-y-2">
      <div v-for="(log, i) in logs.slice(0, limit)" :key="log.id || i" class="flex items-center gap-4 px-4 py-3 rounded-lg bg-gray-900 border border-gray-800">
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

      <button v-if="logs.length > limit" @click="limit += 20" class="w-full text-xs text-accent-400 hover:text-accent-300 py-3 transition-colors">
        Show {{ Math.min(20, logs.length - limit) }} more
      </button>
    </div>
  </div>
</template>
