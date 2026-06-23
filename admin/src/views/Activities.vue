<template>
  <AppLayout title="Activities">
    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border-default">
        <div class="text-sm font-medium text-text-primary">Activities</div>
        <div class="flex items-center gap-2">
          <select class="input-field text-xs py-1.5" style="width: auto; font-family: Inter; cursor: pointer !important;" v-model="eventFilter">
            <option value="all">All Events</option>
            <option value="database">Databases</option>
            <option value="api_key">API Keys</option>
            <option value="admin">Authentication</option>
          </select>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Event</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">IP Address</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in filteredEvents" :key="entry.id" class="hover:bg-bolt-hover transition-colors cursor-pointer" @click="selected = entry">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full flex items-center justify-center" :class="getIcon(entry.action).bgClass">
                    <svg class="w-3 h-3" :class="getIcon(entry.action).iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="getIcon(entry.action).path"/></svg>
                  </span>
                  <div>
                    <div class="text-xs font-medium text-text-primary">{{ formatAction(entry.action) }}</div>
                    <div class="text-[10px] text-text-muted">{{ formatDetail(entry) }}</div>
                  </div>
                </div>
              </td>
              <td class="px-5 py-3 text-xs text-text-secondary">{{ entry.database_name || '—' }}</td>
              <td class="px-5 py-3 text-xs font-mono text-text-muted">{{ entry.ip || '—' }}</td>
              <td class="px-5 py-3 text-right text-[10px] text-text-muted">{{ formatTime(entry.created_at) }}</td>
            </tr>
            <tr v-if="filteredEvents.length === 0">
              <td colspan="4" class="px-5 py-8 text-center text-sm text-text-muted">No activity yet.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="total > limit" class="flex items-center justify-between px-5 py-3 border-t border-border-default">
        <div class="text-[10px] text-text-muted">{{ total }} total</div>
        <div class="flex items-center gap-2">
          <button class="btn-ghost btn-sm text-xs" :disabled="offset === 0" @click="prevPage">Previous</button>
          <button class="btn-ghost btn-sm text-xs" :disabled="offset + limit >= total" @click="nextPage">Next</button>
        </div>
      </div>
    </div>

    <div
      v-if="selected"
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.6);"
      @click="selected = null"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-md mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-medium text-text-primary">Event Details</h3>
          <button class="btn-ghost btn-sm text-text-muted" @click="selected = null">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="space-y-2 text-xs">
          <div class="flex justify-between py-1.5 border-b border-border-subtle">
            <span class="text-text-muted">Event</span>
            <span class="text-text-primary font-medium">{{ formatAction(selected.action) }}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b border-border-subtle">
            <span class="text-text-muted">Database</span>
            <span class="text-text-primary">{{ selected.database_name || '—' }}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b border-border-subtle">
            <span class="text-text-muted">Admin</span>
            <span class="text-text-primary">{{ selected.admin_email || '—' }}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b border-border-subtle">
            <span class="text-text-muted">Target</span>
            <span class="text-text-primary">{{ selected.target || '—' }}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b border-border-subtle">
            <span class="text-text-muted">IP Address</span>
            <span class="text-text-primary font-mono">{{ selected.ip || '—' }}</span>
          </div>
          <div class="flex justify-between py-1.5 border-b border-border-subtle">
            <span class="text-text-muted">Time</span>
            <span class="text-text-primary">{{ formatLocalTime(selected.created_at) }}</span>
          </div>
          <div v-if="parsedDetails" class="pt-1">
            <div class="text-text-muted mb-1">Details</div>
            <pre class="bg-bolt-elevated border border-border-subtle rounded-md p-3 text-[11px] text-text-secondary font-mono whitespace-pre-wrap">{{ parsedDetails }}</pre>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import { api, type ActivityEntry } from "../api/client"

const eventFilter = ref("all")
const entries = ref<ActivityEntry[]>([])
const total = ref(0)
const limit = 20
const offset = ref(0)
const selected = ref<ActivityEntry | null>(null)

const parsedDetails = computed(() => {
  if (!selected.value?.details) return null
  try {
    return JSON.stringify(JSON.parse(selected.value.details), null, 2)
  } catch {
    return selected.value.details
  }
})

onMounted(() => {
  load()
  window.addEventListener("keydown", onKeyDown, { capture: true })
})
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && selected.value) selected.value = null
}

async function load() {
  try {
    const res = await api.listActivity(limit, offset.value)
    entries.value = res.data
    total.value = res.meta?.total ?? 0
  } catch {}
}

function nextPage() {
  offset.value += limit
  load()
}

function prevPage() {
  offset.value = Math.max(0, offset.value - limit)
  load()
}

const filteredEvents = computed(() => {
  if (eventFilter.value === "all") return entries.value
  return entries.value.filter(e => e.action.startsWith(eventFilter.value))
})

function formatAction(action: string) {
  return action.replace(/\./g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

function formatDetail(entry: ActivityEntry) {
  if (entry.target) return entry.target
  if (entry.details) {
    try {
      const d = JSON.parse(entry.details)
      if (d.admin) return d.admin
      if (d.from && d.to) return `${d.from} → ${d.to}`
    } catch {}
  }
  return ""
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

function formatLocalTime(dateStr: string) {
  if (!dateStr) return "—"
  return new Date(dateStr + "Z").toLocaleString()
}

interface IconDef {
  bgClass: string
  iconClass: string
  path: string
}

function getIcon(action: string): IconDef {
  if (action.startsWith("admin.")) {
    return { bgClass: "bg-accent-600/10", iconClass: "text-accent-400", path: "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" }
  }
  if (action.startsWith("database.")) {
    if (action.includes("delete")) {
      return { bgClass: "bg-red-500/10", iconClass: "text-red-400", path: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" }
    }
    if (action.includes("create")) {
      return { bgClass: "bg-green-500/10", iconClass: "text-green-400", path: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" }
    }
    return { bgClass: "bg-accent-600/10", iconClass: "text-accent-400", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" }
  }
  if (action.startsWith("api_key.")) {
    if (action.includes("revoke")) {
      return { bgClass: "bg-red-500/10", iconClass: "text-red-400", path: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" }
    }
    return { bgClass: "bg-accent-600/10", iconClass: "text-accent-400", path: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" }
  }
  return { bgClass: "bg-accent-600/10", iconClass: "text-accent-400", path: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" }
}
</script>
