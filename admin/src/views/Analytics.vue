<template>
  <AppLayout title="Analytics">
    <div class="bg-bolt-card border border-border-default rounded-lg p-5 mb-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="text-sm font-medium text-text-primary">Query Volume</div>
          <div class="text-xs text-text-muted mt-0.5">Total requests per interval</div>
        </div>
        <div class="flex items-center gap-1.5">
          <TabButton v-for="t in timeRanges" :key="t" :active="t === activeRange" @click="activeRange = t">{{ t }}</TabButton>
        </div>
      </div>
      <div class="h-56 flex items-end gap-px rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 px-2 pt-4">
        <ChartBar v-for="h in chartHeights" :key="h" :percent="h" />
      </div>
      <div class="flex items-center justify-between mt-2 text-[10px] text-text-muted">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>

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
        <ChartBar v-for="h in errorHeights" :key="h" :percent="h" error />
      </div>
      <div class="flex items-center justify-between mt-2 text-[10px] text-text-muted">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>23:59</span>
      </div>
    </div>

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
            <tr v-for="db in databases" :key="db.name" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                  <span class="font-medium text-text-primary">{{ db.name }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.queries }}</td>
              <td class="px-5 py-3 text-right" :class="db.errorClass">{{ db.errors }}</td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.latency }}</td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.storage }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import TabButton from "../components/ui/TabButton.vue"
import ChartBar from "../components/ui/ChartBar.vue"

const timeRanges = ["1h", "24h", "7d", "30d"]
const activeRange = ref("24h")

const chartHeights = [40, 65, 45, 80, 55, 70, 60, 90, 75, 50, 85, 65, 70, 55, 80, 60, 45, 75, 50, 85, 95, 70, 55, 80]
const errorHeights = [5, 3, 8, 2, 4, 12, 6, 3, 7, 2, 5, 9, 4, 6, 3, 8, 5, 4, 6, 3, 7, 4, 5, 6]

const databases = [
  { name: "callcenterninja", queries: "528,001,446", errors: "0.02%", errorClass: "text-green-400", latency: "12ms", storage: "14.79 MB" },
  { name: "app-production", queries: "2,145,302", errors: "0.05%", errorClass: "text-green-400", latency: "18ms", storage: "3.12 MB" },
  { name: "analytics-staging", queries: "45,892", errors: "0.12%", errorClass: "text-yellow-400", latency: "24ms", storage: "856 KB" },
]
</script>
