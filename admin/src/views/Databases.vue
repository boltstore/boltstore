<template>
  <AppLayout title="Databases">
    <div class="flex items-center justify-between mb-4">
      <div class="text-xs text-text-muted">{{ databases.length }} database{{ databases.length !== 1 ? 's' : '' }}</div>
      <div class="flex items-center gap-2">
        <button class="btn-secondary btn-sm flex items-center gap-1" @click="showImport = true">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
          Import
        </button>
        <button class="btn-primary btn-sm flex items-center gap-1" @click="showCreate = true">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Create
        </button>
      </div>
    </div>

    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Name</th>
              <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Rows Read</th>
              <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Rows Written</th>
              <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Storage</th>
              <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Group</th>
              <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Status</th>
              <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Created</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="db in sortedDatabases" :key="db.name" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                  <span class="font-medium text-text-primary">{{ db.name }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-text-secondary text-center">{{ getDbAnalytics(db.name)?.rows_read ? formatCompact(getDbAnalytics(db.name)!.rows_read) : '—' }}</td>
              <td class="px-5 py-3 text-text-secondary text-center">{{ getDbAnalytics(db.name)?.writes ? formatCompact(getDbAnalytics(db.name)!.writes) : '—' }}</td>
              <td class="px-5 py-3 text-text-secondary text-center">{{ getDbAnalytics(db.name) ? formatBytes(getDbAnalytics(db.name)!.storageBytes) : '—' }}</td>
              <td class="px-5 py-3 text-center">
                <span class="inline-flex items-center gap-1 text-xs text-text-secondary">
                  <span class="w-2 h-2 rounded-sm" :class="groupColor(db.group)"></span>
                  {{ db.group || 'default' }}
                </span>
              </td>
              <td class="px-5 py-3 text-center">
                <Badge v-if="db.readonly" variant="yellow">Read-only</Badge>
                <Badge v-else variant="green">Active</Badge>
              </td>
              <td class="px-5 py-3 text-text-secondary text-center text-xs">{{ formatDate(db.createdAt) }}</td>
              <td class="px-5 py-3 text-right">
                <router-link :to="'/databases/' + db.name" class="btn-secondary btn-sm flex items-center gap-1 inline-flex">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  Manage
                </router-link>
              </td>
            </tr>
            <tr v-if="databases.length === 0">
              <td colspan="8" class="px-5 py-8 text-center text-sm text-text-muted">No databases yet. Create one to get started.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <CreateDatabaseModal :show="showCreate" @close="showCreate = false" @created="onDatabaseCreated" />

    <div
      class="fixed inset-0 z-50"
      :class="showImport ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showImport = false"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-accent-600/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text-primary">Import Database</h3>
            <p class="text-xs text-text-muted mt-0.5">Upload a .db or .sqlite file.</p>
          </div>
        </div>
        <div class="mb-4">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">File</label>
          <input type="file" ref="fileInput" accept=".db,.sqlite,.sqlite3" class="input-field text-xs py-2" @change="onFilePicked">
        </div>
        <div class="mb-4">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Database Name (optional)</label>
          <input type="text" class="input-field" placeholder="Defaults to filename" v-model="importName">
        </div>
        <div class="mb-4">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Group</label>
          <select class="input-field" v-model="importGroup">
            <option value="">default</option>
            <option value="production">production</option>
            <option value="staging">staging</option>
          </select>
        </div>
        <p v-if="importError" class="text-xs text-red-400 mb-3">{{ importError }}</p>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showImport = false">Cancel</button>
          <button class="btn-primary btn-sm" :disabled="importing || !importFile" @click="handleImport">{{ importing ? 'Importing...' : 'Import' }}</button>
        </div>
      </div>
    </div>

    <div
      class="fixed inset-0 z-50"
      :class="showDelete ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showDelete = false"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text-primary">Delete Database</h3>
            <p class="text-xs text-red-400 mt-0.5">This action is permanent. All data will be removed.</p>
          </div>
        </div>
        <div class="p-3 bg-bolt-elevated border border-border-default rounded-md mb-4 text-xs text-text-muted">
          Are you sure you want to delete <strong class="text-text-primary">{{ deletingName }}</strong>? This cannot be undone.
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showDelete = false">Cancel</button>
          <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500 border-red-500/50" :disabled="deleting" @click="deleteDatabase">{{ deleting ? 'Deleting...' : 'Delete' }}</button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import Badge from "../components/ui/Badge.vue"
import CreateDatabaseModal from "../components/database/CreateDatabaseModal.vue"
import { api, clearResponseCache, type DatabaseInfo, type DatabaseAnalytics } from "../api/client"
import { formatBytes, formatCompact } from "../utils/time"
import { useRefresh } from "../composables/useRefresh"

const databases = ref<DatabaseInfo[]>([])

const sortedDatabases = computed(() => {
  return [...databases.value].sort((a, b) => {
    const da = new Date(a.createdAt.endsWith("Z") ? a.createdAt : a.createdAt + "Z").getTime()
    const db = new Date(b.createdAt.endsWith("Z") ? b.createdAt : b.createdAt + "Z").getTime()
    return db - da
  })
})
const showCreate = ref(false)
const showDelete = ref(false)
const showImport = ref(false)
const deletingName = ref("")
const deleting = ref(false)
const importing = ref(false)
const importFile = ref<File | null>(null)
const importName = ref("")
const importGroup = ref("")
const importError = ref("")
const fileInput = ref<HTMLInputElement | null>(null)
const dbAnalytics = ref<Record<string, DatabaseAnalytics>>({})

const { refreshCounter } = useRefresh()
watch(refreshCounter, () => {
  clearResponseCache()
  load()
})

onMounted(load);

async function load() {
  try {
    const [dbs, analytics] = await Promise.all([
      api.listDatabases(),
      api.getAllDatabaseAnalytics(),
    ])
    databases.value = dbs.data
    for (const a of analytics.data) {
      dbAnalytics.value[a.database] = a
    }
  } catch (err) {
    console.error("Failed to load databases", (err as Error).message || String(err))
  }
}

function getDbAnalytics(name: string) {
  return dbAnalytics.value[name]
}

function groupColor(group?: string) {
  if (group === "production") return "bg-blue-400"
  if (group === "staging") return "bg-yellow-400"
  return "bg-gray-400"
}

function formatDate(dateStr: string) {
  if (!dateStr) return ""
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z")
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function onDatabaseCreated() {
  showCreate.value = false
  load()
}

function confirmDelete(name: string) {
  deletingName.value = name
  showDelete.value = true
}

async function deleteDatabase() {
  deleting.value = true
  try {
    await api.deleteDatabase(deletingName.value)
    showDelete.value = false
    await load()
  } catch {} finally {
    deleting.value = false
  }
}

async function exportDatabase(name: string) {
  try {
    const blob = await api.exportDatabase(name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${name}.db`
    a.click()
    URL.revokeObjectURL(url)
  } catch {}
}

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement
  importFile.value = input.files?.[0] || null
}

async function handleImport() {
  if (!importFile.value) return
  importError.value = ""
  importing.value = true
  try {
    await api.importDatabase(importFile.value, importName.value || undefined, importGroup.value || undefined)
    showImport.value = false
    importFile.value = null
    importName.value = ""
    await load()
  } catch (e: unknown) {
    importError.value = e instanceof Error ? e.message : "Import failed"
  } finally {
    importing.value = false
  }
}
</script>
