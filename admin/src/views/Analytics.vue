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
        <template #value>{{ overview ? formatCompact(overview.queries) : '...' }}</template>
        <template #subtext>{{ overview ? `${formatCompact(overview.errorCount)} errors` : '' }}</template>
      </MetricCard>
      <MetricCard>
        <template #title>Writes</template>
        <template #icon>
          <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        </template>
        <template #value>{{ overview ? formatCompact(overview.writes) : '...' }}</template>
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
          <QueryChart :labels="chartLabels" :values="chartValues" :max="chartMax" unitLabel="queries" />
        </div>
      </div>

      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Error Rate</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="errorValues" :max="chartMax" error unitLabel="errors" />
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Rows Read</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="rowsReadValues" :max="rowsReadMax" unitLabel="rows read" />
        </div>
      </div>
      <div class="bg-bolt-card border border-border-default rounded-lg p-5">
        <div class="text-sm font-medium text-text-primary mb-4">Rows Written</div>
        <div class="h-48 rounded-md overflow-hidden border border-border-default bg-bolt-elevated/30 p-2">
          <QueryChart :labels="chartLabels" :values="rowsWrittenValues" :max="rowsWrittenMax" unitLabel="rows written" />
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
              <td class="text-right px-5 py-3 text-text-secondary whitespace-nowrap tabular-nums">{{ formatCompact(q.calls) }}</td>
              <td class="text-right px-5 py-3 text-text-secondary whitespace-nowrap tabular-nums">{{ q.avg_ms.toFixed(1) }}ms</td>
              <td class="text-right px-5 py-3 text-text-secondary whitespace-nowrap tabular-nums">{{ formatCompact(q.total_rows) }}</td>
            </tr>
            <tr v-if="topQueries.length === 0">
              <td colspan="5" class="px-5 py-8 text-center text-sm text-text-muted">No query data yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
      <div class="px-5 py-4 border-b border-border-default flex items-center justify-between">
        <div class="text-sm font-medium text-text-primary">Errors</div>
        <button v-if="errorLog.length > 5" class="text-xs text-accent-400 hover:text-accent-300 transition-colors" @click="showAllErrors = true">View All ({{ errorLog.length }})</button>
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
            <tr v-for="e in errorLog.slice(0, 5)" :key="e.id" class="hover:bg-bolt-hover transition-colors">
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

    <Modal :show="showAllErrors" @close="showAllErrors = false">
      <template #title>Error Log ({{ errorLog.length }})</template>
      <template #body>
        <div class="max-h-96 overflow-y-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border-default">
                <th class="text-left px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
                <th class="text-left px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Table</th>
                <th class="text-left px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Error</th>
                <th class="text-right px-3 py-2 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Time</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="e in errorLog" :key="e.id" class="hover:bg-bolt-hover transition-colors">
                <td class="px-3 py-2 text-text-secondary">{{ e.database }}</td>
                <td class="px-3 py-2 text-text-secondary">{{ e.table_name || '—' }}</td>
                <td class="px-3 py-2 text-red-400 max-w-md truncate">{{ e.error_msg || e.operation }}</td>
                <td class="px-3 py-2 text-right text-[10px] text-text-muted whitespace-nowrap">{{ formatTime(e.timestamp) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template #footer>
        <button class="btn-ghost btn-sm" @click="showAllErrors = false">Close</button>
      </template>
    </Modal>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import MetricCard from "../components/ui/MetricCard.vue"
import Modal from "../components/ui/Modal.vue"
import TabButton from "../components/ui/TabButton.vue"
import QueryChart from "../components/ui/QueryChart.vue"
import { api, clearResponseCache, type AnalyticsOverview, type TopQuery, type QueryLogEntry } from "../api/client"
import { formatBytes, formatCompact } from "../utils/time"
import { useRefresh } from "../composables/useRefresh"

const userTimezone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"
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
const showAllErrors = ref(false)

const { refreshCounter } = useRefresh()
watch(refreshCounter, () => {
  clearResponseCache()
  loadAll()
})

async function loadAll() {
  const results = await Promise.allSettled([
    api.getAnalyticsOverview(activeRange.value),
    api.getVolume(activeRange.value, userTimezone),
    api.getTopQueries(activeRange.value),
    api.getAllDatabaseAnalytics(activeRange.value),
    api.getErrors(20, activeRange.value),
  ])

  const [overviewRes, volumeRes, topQueriesRes, dbAnalyticsRes, errorsRes] = results

  if (overviewRes.status === "fulfilled") {
    overview.value = overviewRes.value.data
  } else {
    console.error("Failed to load analytics overview", (overviewRes.reason as Error).message || String(overviewRes.reason))
  }

  if (volumeRes.status === "fulfilled") {
    const vol = volumeRes.value
    chartLabels.value = vol.data.slots
    chartValues.value = vol.data.counts
    chartMax.value = vol.data.max
    errorValues.value = vol.data.errors
    rowsReadValues.value = vol.data.rows_read ?? []
    rowsWrittenValues.value = vol.data.rows_written ?? []
    rowsReadMax.value = vol.data.max_read ?? 1
    rowsWrittenMax.value = vol.data.max_written ?? 1
  } else {
    console.error("Failed to load volume data", (volumeRes.reason as Error).message || String(volumeRes.reason))
  }

  if (topQueriesRes.status === "fulfilled") {
    topQueries.value = topQueriesRes.value.data
  } else {
    console.error("Failed to load top queries", (topQueriesRes.reason as Error).message || String(topQueriesRes.reason))
  }

  if (dbAnalyticsRes.status === "fulfilled") {
    dbList.value = dbAnalyticsRes.value.data.map(a => {
      const errRate = a.queries > 0 ? ((a.errorCount / a.queries) * 100).toFixed(2) : "0"
      return {
        name: a.database,
        queries: formatCompact(a.queries),
        writes: formatCompact(a.writes),
        errors: `${errRate}%`,
        errorClass: a.errorCount === 0 ? "text-green-400" : a.errorCount < 10 ? "text-yellow-400" : "text-red-400",
        latency: `${a.avgLatencyMs}ms`,
        storage: formatBytes(a.storageBytes),
      }
    })
  } else {
    console.error("Failed to load database analytics", (dbAnalyticsRes.reason as Error).message || String(dbAnalyticsRes.reason))
  }

  if (errorsRes.status === "fulfilled") {
    errorLog.value = errorsRes.value.data
  } else {
    console.error("Failed to load error log", (errorsRes.reason as Error).message || String(errorsRes.reason))
  }
}

onMounted(loadAll)
watch(activeRange, loadAll)

function formatTime(dateStr: string) {
  if (!dateStr) return "—"
  return new Date(dateStr + "Z").toLocaleString()
}

</script>
