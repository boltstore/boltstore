<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const { apiRequest } = useConnection();
const router = useRouter();
const { state } = useConnection();

const health = ref<any>({});
const databases = ref<any[] | null>(null);
const activity = ref<any[]>([]);
const loadError = ref("");

onMounted(async () => {
  const timeoutId = setTimeout(() => {
    if (databases.value === null) {
      loadError.value = "Server unreachable. Is the backend running?";
    }
  }, 8000);
  try {
    const [healthData, dbs, act] = await Promise.all([
      apiRequest("GET", "/api/health"),
      apiRequest("GET", "/api/databases"),
      apiRequest<any>("GET", "/api/activity?limit=5"),
    ]);
    health.value = healthData;
    databases.value = dbs ?? [];
    activity.value = act?.data ?? act ?? [];
  } catch (e: any) {
    loadError.value = e.message || "Failed to load data";
  } finally {
    clearTimeout(timeoutId);
    if (!loadError.value && databases.value === null) {
      databases.value = [];
    }
  }
});

function retry() {
  loadError.value = "";
  health.value = {};
  databases.value = null;
  activity.value = [];
  const timeoutId = setTimeout(() => {
    if (databases.value === null) {
      loadError.value = "Server unreachable. Is the backend running?";
    }
  }, 8000);
  Promise.all([
    apiRequest("GET", "/api/health"),
    apiRequest("GET", "/api/databases"),
    apiRequest<any>("GET", "/api/activity?limit=5"),
  ]).then(([healthData, dbs, act]) => {
    health.value = healthData;
    databases.value = dbs ?? [];
    activity.value = act?.data ?? act ?? [];
  }).catch((e: any) => {
    loadError.value = e.message || "Failed to load data";
  }).finally(() => {
    clearTimeout(timeoutId);
    if (!loadError.value && databases.value === null) {
      databases.value = [];
    }
  });
}

function actionLabel(action: string) {
  return action.replace(/\./g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-semibold text-gray-100 mb-8">Overview</h1>

    <div v-if="loadError && databases === null" class="mb-8 px-4 py-3 rounded-xl bg-red-950/50 border border-red-900/50 text-sm text-red-400 flex items-center gap-3">
      <span class="flex-1">{{ loadError }}</span>
      <button @click="retry" class="text-xs text-red-300 hover:text-red-200 underline">Retry</button>
    </div>

    <!-- Metrics -- always visible -->
    <div class="grid grid-cols-4 gap-4 mb-10">
      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-accent-500/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"/></svg>
          </div>
          <div>
            <p class="text-2xl font-semibold text-gray-100">{{ databases === null ? '—' : databases.length }}</p>
            <p class="text-xs text-gray-500">Databases</p>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 13l4 4L19 7"/></svg>
          </div>
          <div>
            <p class="text-2xl font-semibold text-gray-100">{{ health.status || "--" }}</p>
            <p class="text-xs text-gray-500">Server Status</p>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <div>
            <p class="text-2xl font-semibold text-gray-100">{{ health.version || "--" }}</p>
            <p class="text-xs text-gray-500">Version</p>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
          </div>
          <div>
            <p class="text-2xl font-semibold text-gray-100">{{ state.adminName || "--" }}</p>
            <p class="text-xs text-gray-500">Admin</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Databases quick list -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-medium text-gray-300">Databases</h2>
      <button @click="router.push('/databases')" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View all</button>
    </div>

    <div v-if="databases === null && !loadError" class="space-y-2">
      <div v-for="i in 3" :key="i" class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-900 border border-gray-800 animate-pulse">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gray-800" />
          <div>
            <div class="h-4 w-32 bg-gray-800 rounded" />
            <div class="h-3 w-20 bg-gray-800 rounded mt-1" />
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="databases?.length === 0" class="text-center py-8">
      <p class="text-sm text-gray-500 mb-2">No databases yet</p>
      <button @click="router.push('/databases')" class="text-sm text-accent-400 hover:text-accent-300">Create your first database</button>
    </div>

    <div v-else-if="databases && databases.length > 0" class="space-y-2 mb-10">
      <div v-for="db in databases" :key="db.name" @click="router.push(`/databases/${db.name}`)" class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 transition-colors cursor-pointer">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center">
            <svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4"/></svg>
          </div>
          <div>
            <p class="text-sm font-medium text-gray-200">{{ db.name }}</p>
            <p class="text-xs text-gray-600">{{ db.createdAt ? new Date(db.createdAt).toLocaleDateString() : '' }}</p>
          </div>
        </div>
        <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7"/></svg>
      </div>
    </div>

    <!-- Recent activity -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-sm font-medium text-gray-300">Recent Activity</h2>
      <button @click="router.push('/activity')" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View all</button>
    </div>

    <div v-if="activity.length === 0" class="text-center py-8 text-xs text-gray-600">No recent activity</div>

    <div v-else class="space-y-1">
      <div v-for="log in activity" :key="log.id" class="flex items-center gap-3 px-4 py-2 rounded-lg bg-gray-900 border border-gray-800">
        <div class="w-1.5 h-1.5 rounded-full bg-accent-500 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <p class="text-xs text-gray-300">{{ actionLabel(log.action) }}</p>
          <p v-if="log.database_name" class="text-xs text-gray-600">{{ log.database_name }}</p>
        </div>
        <span class="text-xs text-gray-700 flex-shrink-0">{{ log.created_at ? new Date(log.created_at).toLocaleString() : '' }}</span>
      </div>
    </div>
  </div>
</template>

