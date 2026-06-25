<template>
  <AppLayout title="Analytics">
    <div class="flex items-center gap-1.5 mb-6">
      <TabButton v-for="t in timeRanges" :key="t" :active="t === activeRange" @click="activeRange = t">{{ t }}</TabButton>
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
      <MetricCard>
        <template #title>Total Queries</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        </template>
        <template #value>{{ overview ? overview.queries.toLocaleString() : '...' }}</template>
        <template #subtext>{{ overview ? `${overview.errorCount} errors` : '' }}</template>
      </MetricCard>
      <MetricCard>
        <template #title>Writes</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </template>
        <template #value>{{ overview ? overview.writes.toLocaleString() : '...' }}</template>
        <template #subtext>inserts + updates + deletes</template>
      </MetricCard>
      <MetricCard>
        <template #title>Total Storage</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>
        </template>
        <template #value>{{ overview ? formatBytes(overview.totalStorageBytes) : '...' }}</template>
        <template #subtext>{{ overview ? `${overview.databases} databases` : '' }}</template>
      </MetricCard>
      <MetricCard>
        <template #title>Avg Latency</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        </template>
        <template #value>{{ overview ? `${overview.avgLatencyMs}ms` : '...' }}</template>
        <template #subtext>avg response time</template>
      </MetricCard>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Query Volume</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="chartValues" :max="chartMax" />
        </div>
      </div>

      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Error Rate</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="errorValues" :max="chartMax" error />
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Rows Read</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="rowsReadValues" :max="rowsReadMax" />
        </div>
      </div>
      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Rows Written</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="rowsWrittenValues" :max="rowsWrittenMax" />
        </div>
      </div>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden mb-6">
      <div class="px-5 py-4 border-b border-border-default">
        <div class="text-sm font-medium text-text-primary">Databases</div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Queries</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Writes</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Errors</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Avg Latency</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Storage</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="db in dbList" :key="db.name" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                  <span class="font-medium text-text-primary">{{ db.name }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.queries }}</td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.writes }}</td>
              <td class="px-5 py-3 text-right" :class="db.errorClass">{{ db.errors }}</td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.latency }}</td>
              <td class="px-5 py-3 text-right text-text-secondary">{{ db.storage }}</td>
            </tr>
            <tr v-if="dbList.length === 0">
              <td colspan="6" class="px-5 py-8 text-center text-sm text-text-muted">No databases yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden mb-6">
      <div class="px-5 py-4 border-b border-border-default">
        <div class="text-sm font-medium text-text-primary">Top Queries (All Databases)</div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm top-queries-table">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated whitespace-nowrap">Database</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Query</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Calls</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Avg Time</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Total Rows</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in topQueries" :key="q.database + q.sql_text" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3 text-text-secondary whitespace-nowrap">{{ q.database }}</td>
              <td class="px-5 py-3 query-cell"><span class="font-mono text-xs text-accent-400">{{ q.sql_text }}</span></td>
              <td class="text-right px-5 py-3 text-text-secondary whitespace-nowrap tabular-nums">{{ q.calls.toLocaleString() }}</td>
              <td class="text-right px-5 py-3 text-text-secondary whitespace-nowrap tabular-nums">{{ q.avg_ms.toFixed(1) }}ms</td>
              <td class="text-right px-5 py-3 text-text-secondary whitespace-nowrap tabular-nums">{{ q.total_rows.toLocaleString() }}</td>
            </tr>
            <tr v-if="topQueries.length === 0">
              <td colspan="5" class="px-5 py-8 text-center text-sm text-text-muted">No query data yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
      <div class="px-5 py-4 border-b border-border-default">
        <div class="text-sm font-medium text-text-primary">Errors</div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Table</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Error</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in errorLog" :key="e.id" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3 text-text-secondary">{{ e.database }}</td>
              <td class="px-5 py-3 text-text-secondary">{{ e.table_name || '—' }}</td>
              <td class="px-5 py-3 text-red-400 max-w-md truncate">{{ e.error_msg || e.operation }}</td>
              <td class="px-5 py-3 text-right text-[10px] text-text-muted whitespace-nowrap">{{ formatTime(e.timestamp) }}</td>
            </tr>
            <tr v-if="errorLog.length === 0">
              <td colspan="4" class="px-5 py-8 text-center text-sm text-text-muted">No errors.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import MetricCard from "../components/ui/MetricCard.vue"
import TabButton from "../components/ui/TabButton.vue"
import QueryChart from "../components/ui/QueryChart.vue"
import { api, type AnalyticsOverview, type TopQuery, type QueryLogEntry } from "../api/client"
import { formatBytes } from "../utils/time"

const timeRanges = ["24h", "7d", "30d"]
const activeRange = ref("24h")
const overview = ref<AnalyticsOverview | null>(null)
const chartLabels = ref<string[]>([])
const chartValues = ref<number[]>([])
const chartMax = ref(1)
const errorValues = ref<number[]>([])
const rowsReadValues = ref<number[]>([])
const rowsWrittenValues = ref<number[]>([])
const rowsReadMax = ref(1)
const rowsWrittenMax = ref(1)
const topQueries = ref<TopQuery[]>([])
const dbList = ref<{ name: string; queries: string; writes: string; errors: string; errorClass: string; latency: string; storage: string }[]>([])
const errorLog = ref<QueryLogEntry[]>([])

async function loadAll() {
  try {
    const res = await api.getAnalyticsOverview(activeRange.value)
    overview.value = res.data
  } catch (err) {
    console.error("Failed to load analytics overview", err)
  }
  try {
    const vol = await api.getVolume(activeRange.value)
    chartLabels.value = vol.data.slots
    chartValues.value = vol.data.counts
    chartMax.value = vol.data.max
    errorValues.value = vol.data.errors
    rowsReadValues.value = vol.data.rows_read ?? []
    rowsWrittenValues.value = vol.data.rows_written ?? []
    rowsReadMax.value = vol.data.max_read ?? 1
    rowsWrittenMax.value = vol.data.max_written ?? 1
  } catch (err) {
    console.error("Failed to load volume data", err)
  }
  try {
    const res = await api.getTopQueries(activeRange.value)
    topQueries.value = res.data
  } catch (err) {
    console.error("Failed to load top queries", err)
  }
  try {
    const analytics = await api.getAllDatabaseAnalytics(activeRange.value)
    dbList.value = analytics.data.map(a => {
      const errRate = a.queries > 0 ? ((a.errorCount / a.queries) * 100).toFixed(2) : "0"
      return {
        name: a.database,
        queries: a.queries.toLocaleString(),
        writes: a.writes.toLocaleString(),
        errors: `${errRate}%`,
        errorClass: a.errorCount === 0 ? "text-green-400" : a.errorCount < 10 ? "text-yellow-400" : "text-red-400",
        latency: `${a.avgLatencyMs}ms`,
        storage: formatBytes(a.storageBytes),
      }
    })
  } catch (err) {
    console.error("Failed to load database analytics", err)
  }
  try {
    const err = await api.getErrors(20)
    errorLog.value = err.data
  } catch (err) {
    console.error("Failed to load error log", err)
  }
}

onMounted(loadAll)
watch(activeRange, loadAll)

function formatTime(dateStr: string) {
  if (!dateStr) return "—"
  return new Date(dateStr + "Z").toLocaleString()
}

</script>


