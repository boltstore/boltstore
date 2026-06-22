<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import TabButton from "../components/ui/TabButton.vue";
import ChartBar from "../components/ui/ChartBar.vue";
import { useSidebar } from "../composables/useSidebar";

const router = useRouter();
const { toggleSidebar } = useSidebar();

const timeRange = ref("24h");

const queryVolumeBars = [
  40, 65, 45, 80, 55, 70, 60, 90, 75, 50,
  85, 65, 70, 55, 80, 60, 45, 75, 50, 85,
  95, 70, 55, 80,
];

const errorRateBars = [
  5, 3, 8, 2, 4, 12, 6, 3, 7, 2,
  5, 9, 4, 6, 3, 8, 5, 4, 6, 3,
  7, 4, 5, 6,
];

const topDatabases = [
  {
    name: "callcenterninja",
    queries: "528,001,446",
    errors: "0.02%",
    errorColor: "text-green-400",
    latency: "12ms",
    storage: "14.79 MB",
  },
  {
    name: "app-production",
    queries: "2,145,302",
    errors: "0.05%",
    errorColor: "text-green-400",
    latency: "18ms",
    storage: "3.12 MB",
  },
  {
    name: "analytics-staging",
    queries: "45,892",
    errors: "0.12%",
    errorColor: "text-yellow-400",
    latency: "24ms",
    storage: "856 KB",
  },
];
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
        <span class="text-text-primary">Analytics</span>
      </div>
      <div class="flex items-center gap-3"></div>
    </header>

    <div class="p-4 sm:p-6 max-w-6xl mx-auto">
      <!-- Query Volume Chart -->
      <div class="bg-bolt-card border border-border-default rounded-lg p-5 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="text-sm font-medium text-text-primary">Query Volume</div>
            <div class="text-xs text-text-muted mt-0.5">Total requests per interval</div>
          </div>
          <TabButton v-model="timeRange" :options="['1h', '24h', '7d', '30d']" />
        </div>
        <div class="h-56 flex items-end gap-px rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 px-2 pt-4">
          <ChartBar :bars="queryVolumeBars" />
        </div>
        <div class="flex items-center justify-between mt-2 text-[10px] text-text-muted">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:59</span>
        </div>
      </div>

      <!-- Error Rate Chart -->
      <div class="bg-bolt-card border border-border-default rounded-lg p-5 mb-6">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="text-sm font-medium text-text-primary">Error Rate</div>
            <div class="text-xs text-text-muted mt-0.5">5xx and 4xx responses over time</div>
          </div>
          <div class="flex items-center gap-1.5">
            <span class="inline-flex items-center gap-1 text-xs text-text-muted">
              <span class="w-2 h-2 rounded-full bg-red-400"></span> 5xx
              <span class="w-2 h-2 rounded-full bg-yellow-400 ml-2"></span> 4xx
            </span>
          </div>
        </div>
        <div class="h-40 flex items-end gap-px rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 px-2 pt-4">
          <ChartBar :bars="errorRateBars" variant="error" />
        </div>
        <div class="flex items-center justify-between mt-2 text-[10px] text-text-muted">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:59</span>
        </div>
      </div>

      <!-- Top Databases Table -->
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="px-5 py-4 border-b border-border-default">
          <div class="text-sm font-medium text-text-primary">Top Databases by Queries</div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border-default">
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Queries (24h)</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Errors</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Avg Latency</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Storage</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="db in topDatabases"
                :key="db.name"
                class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
              >
                <td class="px-5 py-3">
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                    <span class="font-medium text-text-primary">{{ db.name }}</span>
                  </div>
                </td>
                <td class="px-5 py-3 text-right text-text-secondary">{{ db.queries }}</td>
                <td class="px-5 py-3 text-right" :class="db.errorColor">{{ db.errors }}</td>
                <td class="px-5 py-3 text-right text-text-secondary">{{ db.latency }}</td>
                <td class="px-5 py-3 text-right text-text-secondary">{{ db.storage }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <GithubBadge />
  </AppLayout>
</template>
