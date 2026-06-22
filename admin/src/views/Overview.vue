<template>
  <AppLayout title="Overview">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <MetricCard>
        <template #title>Active Databases</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        </template>
        <template #value>3</template>
        <template #subtext>2 groups</template>
      </MetricCard>
      <MetricCard>
        <template #title>Storage Used</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
        </template>
        <template #value>14.79 MB</template>
        <template #subtext>of 10 GB</template>
      </MetricCard>
      <MetricCard>
        <template #title>Queries (24h)</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </template>
        <template #value>528,001,446</template>
        <template #subtext>
          <span class="text-xs text-green-400 mt-1 flex items-center gap-1">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>
            +12.5% from yesterday
          </span>
        </template>
      </MetricCard>
      <MetricCard>
        <template #title>Avg Latency</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </template>
        <template #value>12ms</template>
        <template #subtext>p95: 34ms · p99: 56ms</template>
      </MetricCard>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg p-5 mb-6">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="text-sm font-medium text-text-primary">Query Volume</div>
          <div class="text-xs text-text-muted mt-0.5">Requests per minute over time</div>
        </div>
        <div class="flex items-center gap-1.5">
          <TabButton v-for="t in timeRanges" :key="t" :active="t === activeRange" @click="activeRange = t">{{ t }}</TabButton>
        </div>
      </div>
      <div class="h-48 flex items-end gap-px rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 px-2 pt-4">
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

    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border-default">
        <div class="text-sm font-medium text-text-primary">Recent Databases</div>
        <router-link to="/databases" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View all →</router-link>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Name</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Rows Read</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Rows Written</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Storage</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Group</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Status</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated"></th>
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
              <td class="px-5 py-3 text-text-secondary">{{ db.rowsRead }}</td>
              <td class="px-5 py-3 text-text-secondary">{{ db.rowsWritten }}</td>
              <td class="px-5 py-3 text-text-secondary">{{ db.storage }}</td>
              <td class="px-5 py-3">
                <span class="inline-flex items-center gap-1 text-xs text-text-secondary">
                  <span class="w-2 h-2 rounded-sm" :class="db.groupColor"></span>
                  {{ db.group }}
                </span>
              </td>
              <td class="px-5 py-3">
                <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
              </td>
              <td class="px-5 py-3 text-right">
                <router-link :to="'/databases/' + db.name" class="text-text-muted hover:text-text-primary transition-colors">
                  <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </router-link>
              </td>
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
import MetricCard from "../components/ui/MetricCard.vue"
import TabButton from "../components/ui/TabButton.vue"
import ChartBar from "../components/ui/ChartBar.vue"

const timeRanges = ["1h", "24h", "7d", "30d"]
const activeRange = ref("24h")

const chartHeights = [40, 65, 45, 80, 55, 70, 60, 90, 75, 50, 85, 65, 70, 55, 80, 60, 45, 75, 50, 85, 95, 70, 55, 80]

const databases = [
  { name: "callcenterninja", rowsRead: "528,001,446", rowsWritten: "9,851", storage: "14.79 MB", group: "default", groupColor: "bg-red-400" },
  { name: "app-production", rowsRead: "2,145,302", rowsWritten: "4,221", storage: "3.12 MB", group: "production", groupColor: "bg-blue-400" },
  { name: "analytics-staging", rowsRead: "45,892", rowsWritten: "1,034", storage: "856 KB", group: "staging", groupColor: "bg-yellow-400" },
]
</script>
