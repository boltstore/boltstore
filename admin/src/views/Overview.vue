<template>
  <AppLayout title="Overview">
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      <MetricCard>
        <template #title>Active Databases</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        </template>
        <template #value>{{ analytics ? analytics.databases : '...' }}</template>
        <template #subtext>v{{ health?.version || '...' }}</template>
      </MetricCard>
      <MetricCard>
        <template #title>Storage Used</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
        </template>
        <template #value>{{ analytics ? formatBytes(analytics.totalStorageBytes) : '...' }}</template>
        <template #subtext>{{ analytics ? `${analytics.databases} databases` : '' }}</template>
      </MetricCard>
      <MetricCard>
        <template #title>Queries (24h)</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </template>
        <template #value>{{ analytics ? analytics.queries.toLocaleString() : '...' }}</template>
        <template #subtext>{{ analytics ? `${analytics.errorCount} errors` : '' }}</template>
      </MetricCard>
      <MetricCard>
        <template #title>Avg Latency</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </template>
        <template #value>{{ analytics ? `${analytics.avgLatencyMs}ms` : '...' }}</template>
        <template #subtext>avg response time</template>
      </MetricCard>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg p-5 mb-6">
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3">
          <div>
            <div class="text-sm font-medium text-text-primary">Query Volume</div>
            <div class="text-xs text-text-muted mt-0.5">Requests per minute over time</div>
          </div>
          <div class="flex items-center gap-1.5">
            <TabButton v-for="t in timeRanges" :key="t" :active="t === activeRange" @click="activeRange = t">{{ t }}</TabButton>
          </div>
        </div>
        <router-link to="/analytics" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View analytics →</router-link>
      </div>
      <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
        <QueryChart :labels="chartLabels" :values="chartValues" :max="chartMax" />
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <div class="text-sm font-medium text-text-primary">Databases</div>
          <router-link to="/databases" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View all →</router-link>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border-default">
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Name</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Group</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Status</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Created</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="db in databases" :key="db.name" class="hover:bg-bolt-hover transition-colors">
                <td class="px-5 py-3 w-full">
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                    <span class="font-medium text-text-primary">{{ db.name }}</span>
                  </div>
                </td>
                <td class="px-5 py-3 whitespace-nowrap">
                  <span class="inline-flex items-center gap-1 text-xs text-text-secondary">
                    <span class="w-2 h-2 rounded-sm" :class="groupColor(db.group)"></span>
                    {{ db.group || 'default' }}
                  </span>
                </td>
                <td class="px-5 py-3 whitespace-nowrap">
                  <Badge v-if="db.readonly" variant="yellow">Read-only</Badge>
                  <Badge v-else variant="green">Active</Badge>
                </td>
                <td class="px-5 py-3 text-text-secondary text-xs whitespace-nowrap">{{ formatDate(db.createdAt) }}</td>
                <td class="px-5 py-3 text-right">
                  <router-link :to="'/databases/' + db.name" class="text-text-muted hover:text-text-primary transition-colors">
                    <svg class="w-4 h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  </router-link>
                </td>
              </tr>
              <tr v-if="databases.length === 0">
                <td colspan="5" class="px-5 py-8 text-center text-sm text-text-muted">No databases yet. Create one to get started.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <div class="text-sm font-medium text-text-primary">Recent Activity</div>
          <router-link to="/activities" class="text-xs text-accent-400 hover:text-accent-300 transition-colors">View all →</router-link>
        </div>
        <div>
          <div v-for="entry in activities" :key="entry.id" class="px-5 py-3 flex items-start gap-3">
            <span class="w-6 h-6 rounded-full bg-accent-600/10 flex items-center justify-center shrink-0 mt-0.5">
              <svg class="w-3 h-3 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-xs text-text-primary">{{ formatAction(entry.action) }}</div>
              <div class="text-[10px] text-text-muted mt-0.5">
                {{ entry.database_name || entry.target || '' }}
                <span v-if="entry.ip" class="ml-1 font-mono">{{ entry.ip }}</span>
              </div>
            </div>
            <div class="text-[10px] text-text-muted shrink-0">{{ formatTime(entry.created_at) }}</div>
          </div>
          <div v-if="activities.length === 0" class="px-5 py-8 text-center text-sm text-text-muted">No recent activity.</div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import MetricCard from "../components/ui/MetricCard.vue"
import Badge from "../components/ui/Badge.vue"
import TabButton from "../components/ui/TabButton.vue"
import QueryChart from "../components/ui/QueryChart.vue"
import { api, type HealthResponse, type DatabaseInfo, type ActivityEntry, type AnalyticsOverview } from "../api/client"

const timeRanges = ["24h", "7d", "30d"]
const activeRange = ref("24h")
const chartLabels = ref<string[]>([])
const chartValues = ref<number[]>([])
const chartMax = ref(1)

const health = ref<HealthResponse | null>(null)
const databases = ref<DatabaseInfo[]>([])
const activities = ref<ActivityEntry[]>([])
const analytics = ref<AnalyticsOverview | null>(null)

async function loadAll() {
  try {
    health.value = await api.health()
  } catch {}
  try {
    const res = await api.listDatabases()
    databases.value = res.data
  } catch {}
  try {
    const res = await api.listActivity(5)
    activities.value = res.data
  } catch {}
  try {
    const res = await api.getAnalyticsOverview(activeRange.value)
    analytics.value = res.data
  } catch {}
  try {
    const vol = await api.getVolume(activeRange.value)
    chartLabels.value = vol.data.slots
    chartValues.value = vol.data.counts
    chartMax.value = vol.data.max
  } catch {}
}

onMounted(loadAll)

watch(activeRange, loadAll)

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function formatDate(dateStr: string) {
  if (!dateStr) return ""
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z")
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function groupColor(group?: string) {
  if (group === "production") return "bg-blue-400"
  if (group === "staging") return "bg-yellow-400"
  return "bg-gray-400"
}

function formatTime(dateStr: string) {
  if (!dateStr) return ""
  const d = new Date(dateStr + "Z")
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatAction(action: string) {
  return action.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}
</script>
