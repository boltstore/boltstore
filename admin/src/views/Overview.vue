<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useConnection } from "../stores/client";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import MetricCard from "../components/ui/MetricCard.vue";
import TabButton from "../components/ui/TabButton.vue";
import ChartBar from "../components/ui/ChartBar.vue";
import { useSidebar } from "../composables/useSidebar";

const { apiRequest } = useConnection();
const { toggleSidebar } = useSidebar();

const timeRange = ref("24h");
const loading = ref(true);

const health = ref({ status: "ok", version: "", databases: 0, uptime: 0 });
const databases = ref<{ name: string; created_at: string }[]>([]);

const chartBars = [
  40, 65, 45, 80, 55, 70, 60, 90, 75, 50,
  85, 65, 70, 55, 80, 60, 45, 75, 50, 85,
  95, 70, 55, 80,
];

const groupColors = ["bg-red-400", "bg-blue-400", "bg-yellow-400", "bg-green-400", "bg-purple-400"];

onMounted(async () => {
  try {
    const [h, dbs] = await Promise.all([
      apiRequest<{ status: string; version: string; databases: number; uptime: number }>("GET", "/api/health"),
      apiRequest<{ data: { name: string; created_at: string }[]; meta?: { total: number } }>("GET", "/api/databases"),
    ]);
    health.value = h;
    if (dbs.data) databases.value = dbs.data;
  } catch {
    // Keep defaults
  }
  loading.value = false;
});
</script>

<template>
  <AppLayout>
    <!-- Top bar -->
    <header class="h-14 border-b border-border-default flex items-center justify-between px-4 sm:px-6 bg-bolt-base/80 backdrop-blur-sm sticky top-0 z-30">
      <div class="flex items-center gap-2 text-sm">
        <button class="md:hidden p-1 text-text-muted hover:text-text-primary transition-colors" @click="toggleSidebar">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <span class="text-text-primary">Overview</span>
      </div>
      <div class="flex items-center gap-3"></div>
    </header>

    <div v-if="loading" class="flex items-center justify-center py-24">
      <div class="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
    </div>

    <div v-else class="p-4 sm:p-6 max-w-6xl mx-auto">
      <!-- Metrics -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          title="Active Databases"
          :value="String(health.databases || databases.length)"
          icon="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
          subtext="v{{ health.version || '-' }} &middot; {{ health.uptime ? Math.floor(health.uptime / 3600) + 'h uptime' : '' }}"
        />
        <MetricCard
          title="Storage Used"
          value="14.79 MB"
          icon="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
          subtext="of 10 GB"
        />
        <MetricCard
          title="Queries (24h)"
          value="528,001,446"
          icon="M13 10V3L4 14h7v7l9-11h-7z"
          :change="{ value: '+12.5% from yesterday', positive: true }"
        />
        <MetricCard
          title="Avg Latency"
          value="12ms"
          icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          subtext="p95: 34ms &middot; p99: 56ms"
        />
      </div>

      <!-- Query Volume Chart -->
      <div class="bg-bolt-card border border-border-default rounded-lg p-5 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="text-sm font-medium text-text-primary">Query Volume</div>
            <div class="text-xs text-text-muted mt-0.5">Requests per minute over time</div>
          </div>
          <TabButton v-model="timeRange" :options="['1h', '24h', '7d', '30d']" />
        </div>
        <div class="h-48 flex items-end gap-px rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 px-2 pt-4">
          <ChartBar :bars="chartBars" />
        </div>
        <div class="flex items-center justify-between mt-2 text-[10px] text-text-muted">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:59</span>
        </div>
      </div>

      <!-- Recent Databases -->
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <div class="text-sm font-medium text-text-primary">Recent Databases</div>
          <a href="/dashboard/databases" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View all &rarr;</a>
        </div>
        <div v-if="databases.length === 0" class="text-center py-12 text-sm text-text-muted">
          No databases yet. Create one from the Databases page.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border-default">
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Name</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Created</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Status</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(db, i) in databases"
                :key="db.name"
                class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
              >
                <td class="px-5 py-3">
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full" :class="groupColors[i % groupColors.length]"></div>
                    <span class="font-medium text-text-primary">{{ db.name }}</span>
                  </div>
                </td>
                <td class="px-5 py-3 text-text-secondary text-xs">{{ db.created_at }}</td>
                <td class="px-5 py-3">
                  <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
                </td>
                <td class="px-5 py-3 text-right">
                  <a :href="`/dashboard/databases/${db.name}`" class="text-text-muted hover:text-text-primary transition-colors">
                    <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <GithubBadge />
  </AppLayout>
</template>
