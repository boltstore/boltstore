<template>
  <AppLayout container-class="p-4 sm:p-6 max-w-6xl mx-auto">
    <template #header-left>
      <div class="flex items-center gap-2 text-sm">
        <router-link to="/databases" class="text-text-muted hover:text-text-primary transition-colors">Databases</router-link>
        <span class="text-text-muted">/</span>
        <span class="text-text-primary">{{ dbName }}</span>
        <span v-if="dbConfig.readonly" class="inline-flex items-center px-2 py-0.5 text-[10px] font-medium rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">Read-only</span>
        <span v-else class="badge-green">Active</span>
      </div>
    </template>
    <template #header-right>
      <div class="flex items-center gap-2">
        <button class="btn-ghost btn-sm flex items-center gap-1 hidden sm:inline-flex" @click="exportDatabase">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
          Download
        </button>
        <span class="text-xs text-text-muted hidden sm:inline">14.79 MB · 528M rows read · 9.8K rows written</span>
      </div>
    </template>

    <div class="border-b border-border-default mb-6 flex items-center justify-between">
      <div>
        <router-link
          v-for="tab in tabs"
          :key="tab.id"
          :to="`/databases/${dbName}/${tab.id}`"
          class="nav-tab"
          :class="{ active: activeTab === tab.id }"
        >
          <component :is="tab.icon" class="w-3.5 h-3.5" />
          {{ tab.label }}
        </router-link>
      </div>
      <div class="flex items-center gap-2 text-[10px] text-text-muted pb-1">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        SQLite 3.42.0 · 17ms
      </div>
    </div>

    <div v-show="activeTab === 'data'" class="flex flex-col md:flex-row gap-4">
      <div class="w-56 shrink-0">
        <div class="flex items-center gap-2 mb-3">
          <input type="text" class="input-field text-xs py-2" placeholder="Search tables..." style="font-family:Inter">
        </div>
        <div class="space-y-0.5">
          <div
            v-for="t in tables"
            :key="t.name"
            class="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors"
            :class="t.name === selectedTable ? 'text-text-primary bg-bolt-hover' : 'text-text-secondary hover:bg-bolt-hover'"
            @click="selectedTable = t.name"
          >
            <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            {{ t.name }}
            <span class="ml-auto text-[10px] text-text-muted">{{ t.count }}</span>
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <DataTable
          :columns="tableColumns"
          :rows="dataRows"
          @delete-selected="handleDelete"
          @update:rows="dataRows = $event"
        >
          <template #toolbar-extra>
            <button class="btn-primary btn-sm flex items-center gap-1" @click="showAddDrawer = true">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              Add Record
            </button>
          </template>
          <template #table-footer-right>
          </template>
        </DataTable>
      </div>
    </div>

    <div v-show="activeTab === 'sql'" class="space-y-4">
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden mb-4">
        <div class="px-4 py-2 border-b border-border-default flex items-center gap-2">
          <span class="text-xs font-medium text-text-primary">SQL Console</span>
          <button class="btn-primary btn-sm flex items-center gap-1 ml-auto">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            Run
          </button>
        </div>
        <textarea
          class="input-field w-full h-40 resize-none font-mono text-sm leading-relaxed"
          spellcheck="false"
          :value="defaultSql"
        ></textarea>
      </div>
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="px-4 py-2 border-b border-border-default bg-bolt-elevated">
          <span class="text-xs text-text-muted">Result (2 rows) · 17ms</span>
        </div>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th v-for="col in tableColumns" :key="col.key">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in sqlResult" :key="i">
                <td v-for="col in tableColumns" :key="col.key">
                  <span class="font-mono text-xs">{{ row[col.key] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'schema'" class="space-y-4">
      <div
        v-for="t in schemaTables"
        :key="t.name"
        class="bg-bolt-card border border-border-default rounded-lg overflow-hidden"
      >
        <div class="px-4 py-3 border-b border-border-default flex items-center justify-between">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span class="text-sm font-medium text-text-primary">{{ t.name }}</span>
            <span class="text-xs text-text-muted">{{ t.rows }} rows</span>
          </div>
          <button class="btn-ghost btn-sm text-xs flex items-center gap-1" @click="openSchemaEditor(t.name)">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            Edit Schema
          </button>
        </div>
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Default</th>
                <th>Constraints</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="col in t.columns" :key="col.name">
                <td>
                  <span class="font-mono text-xs" :class="{ 'text-accent-400': col.pk }">{{ col.name }}</span>
                </td>
                <td class="text-text-secondary">{{ col.type }}</td>
                <td>{{ col.nullable ? 'YES' : 'NO' }}</td>
                <td>
                  <span v-if="col.default !== null">{{ col.default }}</span>
                  <span v-else class="text-text-muted italic">null</span>
                </td>
                <td>
                  <span v-if="col.constraint" class="badge-green">{{ col.constraint }}</span>
                  <span v-else class="text-text-muted italic">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'queries'" class="bg-bolt-card border border-border-default rounded-lg overflow-hidden mb-4">
      <div class="px-4 py-2 border-b border-border-default bg-bolt-elevated/50 flex items-center gap-2">
        <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        <span class="text-xs font-medium text-text-primary">Top Queries (last 24h)</span>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Query</th>
              <th class="text-right">Calls</th>
              <th class="text-right">Avg Time</th>
              <th class="text-right">Total Time</th>
              <th class="text-right">Rows</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="q in topQueries" :key="q.query">
              <td><span class="font-mono text-xs text-accent-400">{{ q.query }}</span></td>
              <td class="text-right text-text-secondary">{{ q.calls }}</td>
              <td class="text-right text-text-secondary">{{ q.avgTime }}</td>
              <td class="text-right text-text-secondary">{{ q.totalTime }}</td>
              <td class="text-right text-text-secondary">{{ q.rows }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-show="activeTab === 'settings'" class="max-w-2xl mx-auto space-y-6">
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Database Settings</h3>
        <div class="p-5 pt-4 space-y-4">
          <div>
            <label class="label">Database Name</label>
            <input type="text" class="input-field" :value="dbName" readonly>
          </div>
          <div>
            <label class="label">Group</label>
            <select class="input-field appearance-none" style="font-family:Inter" v-model="dbConfig.group" @change="saveGroup">
              <option value="">default</option>
              <option value="production">production</option>
              <option value="staging">staging</option>
            </select>
          </div>
          <div class="flex items-start gap-2">
            <input type="checkbox" id="readonly" class="mt-0.5 w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600" v-model="dbConfig.readonly" @change="saveReadonly">
            <div>
              <label for="readonly" class="text-xs text-text-secondary">Read-only mode</label>
              <p class="description">Prevent any write operations on this database</p>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Connection</h3>
        <div class="p-5 pt-4 space-y-4">
          <div>
            <label class="label">Database URL</label>
          <div class="flex items-center justify-between gap-2">
              <input type="text" class="input-field" :value="`https://api.boltstore.local/v1/dbs/${dbName}`" readonly>
              <button class="btn-secondary btn-sm flex items-center gap-1 shrink-0" @click="copyUrl">
                <svg v-if="!urlCopied" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                <svg v-else class="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                {{ urlCopied ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>

          <div>
            <button class="btn-secondary btn-sm flex items-center gap-1" @click="exportDatabase">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/></svg>
              Download Database
            </button>
          </div>

          <div>
            <label class="label">API Keys</label>
            <div class="space-y-2">
              <div
                v-for="k in apiKeys"
                :key="k.name"
                class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-subtle rounded-md"
              >
                <div class="flex items-center gap-3">
                  <div class="text-xs font-medium text-text-primary">{{ k.name }}</div>
                  <div class="text-xs text-text-muted">Last used: {{ k.lastUsed }}</div>
                </div>
                <button class="text-xs text-red-400 hover:text-red-300 transition-colors" @click="confirmDeleteKey(k)">Delete</button>
              </div>
            </div>
            <div class="mt-3">
              <button class="btn-secondary btn-sm flex items-center gap-1" @click="showGenerateKeyModal = true">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                Generate New Key
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-bolt-card border border-red-500/75 rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-red-400 px-5 py-4 border-b border-red-500/50">Danger Zone</h3>
        <div class="p-5 pt-4 space-y-4">
          <div class="flex items-center justify-between p-3 border border-red-500/20 rounded-md bg-red-500/5">
            <div>
              <div class="text-xs font-medium text-red-400">Delete Database</div>
              <div class="description">This action cannot be undone. All data will be permanently removed.</div>
            </div>
            <button class="text-xs font-medium text-red-400 border border-red-500/30 rounded-md px-3 py-1.5 hover:bg-red-500/10 transition-colors" @click="showDeleteDatabaseModal = true">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <Drawer :open="showAddDrawer" @close="showAddDrawer = false">
      <template #header>
        <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        <span class="text-sm font-medium text-text-primary">Add Record</span>
      </template>
      <template #body>
        <div v-for="field in addFields" :key="field.key" class="form-group">
          <label>{{ field.label }}</label>
          <input
            type="text"
            class="input-field"
            :placeholder="field.placeholder"
            v-model="field.value"
          >
          <p v-if="field.hint" class="hint">{{ field.hint }}</p>
        </div>
      </template>
      <template #footer>
        <button class="btn-primary w-full">Save Record</button>
      </template>
    </Drawer>

    <Drawer :open="showSchemaDrawer" @close="showSchemaDrawer = false">
      <template #header>
        <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        <span class="text-sm font-medium text-text-primary">Edit Schema</span>
      </template>
      <template #body>
        <div class="p-3 bg-red-500/5 border border-red-500/20 rounded-md mb-4 flex items-start gap-2">
          <svg class="w-4 h-4 text-red-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
          <div class="text-xs text-red-400"><strong>Warning:</strong> Editing schema may break existing queries or application code. This operation cannot be undone.</div>
        </div>
        <textarea
          class="input-field w-full h-60 resize-none font-mono text-xs leading-relaxed"
          spellcheck="false"
          :value="schemaDdl"
        ></textarea>
        <div class="mt-4">
          <label class="label">Preview changes</label>
          <div class="p-3 bg-bolt-elevated border border-border-default rounded-md text-xs text-text-muted font-mono">
            No changes to preview
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex gap-2">
          <button class="btn-ghost w-full text-xs" @click="showSchemaDrawer = false">Cancel</button>
          <button class="btn-primary w-full text-xs">Apply Changes</button>
        </div>
      </template>
    </Drawer>

    <div
      class="fixed inset-0 z-50"
      :class="showDeleteModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text-primary">Delete records</h3>
            <p class="text-xs text-text-muted mt-0.5">Are you sure? This action cannot be undone.</p>
          </div>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showDeleteModal = false">Cancel</button>
          <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500 border-red-500/50" @click="showDeleteModal = false">Delete</button>
        </div>
      </div>
    </div>

    <div
      class="fixed inset-0 z-50"
      :class="showGenerateKeyModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showGenerateKeyModal = false"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-sm font-medium text-text-primary">Generate API Key</h3>
          <button class="text-text-muted hover:text-text-primary" @click="showGenerateKeyModal = false">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="p-3 bg-bolt-elevated border border-border-default rounded-md mb-4">
          <p class="text-xs text-text-muted">This will generate a new API key for the database. Existing keys will remain active.</p>
        </div>
        <div class="mb-4">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Key Identifier</label>
          <input type="text" class="input-field" placeholder="e.g. production-worker-1" v-model="newKeyLabel">
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showGenerateKeyModal = false">Cancel</button>
          <button class="btn-primary btn-sm" @click="generateKey">Generate Key</button>
        </div>
      </div>
    </div>

    <div
      class="fixed inset-0 z-50"
      :class="showNewKeyModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-accent-600/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
          </div>
          <div>
            <div class="text-sm font-medium text-text-primary">API Key Generated</div>
            <div class="text-xs text-red-400 mt-0.5">Copy this now — it will only be shown once.</div>
          </div>
        </div>
        <div class="p-3 bg-bolt-elevated border border-border-default rounded-md mb-4">
          <div class="text-xs text-text-muted mb-1">API Key</div>
          <div class="flex items-center gap-2">
            <code class="text-xs font-mono text-accent-400 break-all">{{ newKeyValue }}</code>
            <button class="btn-secondary btn-sm flex items-center gap-1 ml-auto shrink-0" @click="copyKey">
              <svg v-if="!copied" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
              <svg v-else class="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
        <div class="flex items-center justify-end">
          <button class="btn-primary btn-sm" @click="showNewKeyModal = false">Done</button>
        </div>
      </div>
    </div>

    <div
      class="fixed inset-0 z-50"
      :class="showDeleteKeyModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text-primary">Delete API Key</h3>
            <p class="text-xs text-red-400 mt-0.5">This action is permanent. Any services using this key will stop working.</p>
          </div>
        </div>
        <div class="p-3 bg-bolt-elevated border border-border-default rounded-md mb-4 text-xs font-mono text-accent-400">{{ deletingKey?.name }}</div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showDeleteKeyModal = false">Cancel</button>
          <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500" @click="revokeKey">Delete Key</button>
        </div>
      </div>
    </div>

    <div
      class="fixed inset-0 z-50"
      :class="showDeleteDatabaseModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showDeleteDatabaseModal = false"
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
          Are you sure you want to delete <strong class="text-text-primary">{{ dbName }}</strong>? This cannot be undone.
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showDeleteDatabaseModal = false">Cancel</button>
          <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500 border-red-500/50" @click="deleteDatabase">Delete Database</button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, h, computed, onMounted, onUnmounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import AppLayout from "../components/layout/AppLayout.vue"
import DataTable, { type ColumnDef } from "../components/ui/DataTable.vue"
import Drawer from "../components/ui/Drawer.vue"
import { api, type ApiKeyInfo } from "../api/client"

const route = useRoute()
const router = useRouter()
const dbName = route.params.name as string
const activeTab = computed(() => route.params.tab as string || "data")
const selectedTable = ref("crawler_sources")
const showAddDrawer = ref(false)
const showSchemaDrawer = ref(false)
const showDeleteModal = ref(false)
const showGenerateKeyModal = ref(false)
const showNewKeyModal = ref(false)
const showDeleteKeyModal = ref(false)
const showDeleteDatabaseModal = ref(false)
const deletingKey = ref<{ id: string; name: string } | null>(null)
const copied = ref(false)
const urlCopied = ref(false)
const newKeyLabel = ref("")
const newKeyValue = ref("")
const dbConfig = ref<Record<string, unknown>>({})
const apiKeys = ref<{ id: string; name: string; key: string; lastUsed: string }[]>([])

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape") return
  if (showDeleteModal.value) showDeleteModal.value = false
  if (showGenerateKeyModal.value) showGenerateKeyModal.value = false
  if (showNewKeyModal.value) showNewKeyModal.value = false
  if (showDeleteKeyModal.value) showDeleteKeyModal.value = false
  if (showDeleteDatabaseModal.value) showDeleteDatabaseModal.value = false
}

onMounted(() => window.addEventListener("keydown", onKeyDown, { capture: true }))
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))

function icon(path: string) {
  return () => h('svg', { class: 'w-3.5 h-3.5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
    h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: path })
  ])
}

const tabs = [
  { id: "data", label: "Data", icon: icon("M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z") },
  { id: "sql", label: "SQL Console", icon: icon("M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z") },
  { id: "schema", label: "Schema", icon: icon("M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4") },
  { id: "queries", label: "Top Queries", icon: icon("M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z") },
  { id: "settings", label: "Settings", icon: icon("M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z") },
]

const tables = [
  { name: "crawler_sources", count: "40" },
  { name: "jobs", count: "1,248" },
  { name: "users", count: "89" },
]

const tableColumns: ColumnDef[] = [
  { key: "id", label: "id", type: "integer" },
  { key: "name", label: "name", type: "text" },
  { key: "url", label: "url", type: "text" },
  { key: "job_selector", label: "job_selector", type: "text" },
  { key: "title_selector", label: "title_selector", type: "text" },
  { key: "link_selector", label: "link_selector", type: "text" },
]

const rawData: Record<string, unknown>[] = [
  { id: 1, name: "TDCX", url: "https://www.tdcx.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 2, name: "Concentrix", url: "https://jobs.concentrix.com", job_selector: "script#jobsData", title_selector: null, link_selector: null },
  { id: 3, name: "Teleperformance", url: "https://www.tp.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 4, name: "Sutherland", url: "https://www.jobs.sutherland.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 5, name: "Foundever", url: "https://jobs.foundever.com", job_selector: "tr.data-row", title_selector: "a.jobTitle-link", link_selector: "a.jobTitle-link" },
  { id: 6, name: "TaskUs", url: "https://jobs.taskus.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 7, name: "Accenture", url: "https://www.accenture.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 8, name: "Alorica", url: "https://jobs.alorica.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 9, name: "Webhelp", url: "https://jobs.webhelp.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 10, name: "Genpact", url: "https://www.genpact.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 11, name: "IBM Services", url: "https://www.ibm.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 12, name: "WNS Global", url: "https://www.wns.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 13, name: "Firstsource", url: "https://www.firstsource.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 14, name: "Hinduja Global", url: "https://www.hgs.cx/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 15, name: "Transcom", url: "https://www.transcom.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 16, name: "VXI Global", url: "https://www.vxiglobal.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 17, name: "24-7 Intouch", url: "https://www.24-7intouch.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 18, name: "Qualfon", url: "https://www.qualfon.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 19, name: "Startek", url: "https://www.startek.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 20, name: "Sitel Group", url: "https://www.sitel.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 21, name: "Arvato", url: "https://www.arvato.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 22, name: "EXL Service", url: "https://www.exlservice.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 23, name: "Infosys BPM", url: "https://www.infosys.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 24, name: "Wipro BPO", url: "https://careers.wipro.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 25, name: "Tech Mahindra", url: "https://www.techmahindra.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 26, name: "Cognizant", url: "https://www.cognizant.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 27, name: "Capita", url: "https://www.capita.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 28, name: "CGI Group", url: "https://www.cgi.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 29, name: "Atento", url: "https://www.atento.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 30, name: "Comdata", url: "https://www.comdata.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 31, name: "Minacs", url: "https://www.minacs.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 32, name: "Iberia Inf", url: "https://www.iberia.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 33, name: "Stream Global", url: "https://www.stream.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 34, name: "Amdocs", url: "https://www.amdocs.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 35, name: "Epam Systems", url: "https://www.epam.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 36, name: "Majorel", url: "https://www.majorel.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 37, name: "Salesforce", url: "https://www.salesforce.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 38, name: "SAP", url: "https://www.sap.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 39, name: "Oracle", url: "https://www.oracle.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 40, name: "Microsoft", url: "https://www.microsoft.com/careers", job_selector: null, title_selector: null, link_selector: null },
]

const dataRows = ref(rawData)

const defaultSql = "SELECT * FROM crawler_sources WHERE job_selector IS NOT NULL;"

const sqlResult = [
  { id: 2, name: "Concentrix", url: "https://jobs.concentrix.com", job_selector: "script#jobsData", title_selector: null, link_selector: null },
  { id: 5, name: "Foundever", url: "https://jobs.foundever.com", job_selector: "tr.data-row", title_selector: "a.jobTitle-link", link_selector: "a.jobTitle-link" },
]

const schemaTables = [
  {
    name: "crawler_sources",
    rows: 40,
    columns: [
      { name: "id", type: "INTEGER", nullable: false, default: null, constraint: "PRIMARY KEY", pk: true },
      { name: "name", type: "TEXT", nullable: false, default: null, constraint: "UNIQUE", pk: false },
      { name: "url", type: "TEXT", nullable: false, default: null, constraint: null, pk: false },
      { name: "job_selector", type: "TEXT", nullable: true, default: null, constraint: null, pk: false },
      { name: "title_selector", type: "TEXT", nullable: true, default: null, constraint: null, pk: false },
      { name: "link_selector", type: "TEXT", nullable: true, default: null, constraint: null, pk: false },
    ],
  },
  {
    name: "jobs",
    rows: 1248,
    columns: [
      { name: "id", type: "INTEGER", nullable: false, default: null, constraint: "PRIMARY KEY", pk: true },
      { name: "title", type: "TEXT", nullable: false, default: null, constraint: null, pk: false },
      { name: "url", type: "TEXT", nullable: false, default: null, constraint: null, pk: false },
      { name: "company_id", type: "INTEGER", nullable: true, default: null, constraint: "FOREIGN KEY", pk: false },
      { name: "status", type: "TEXT", nullable: false, default: "'new'", constraint: null, pk: false },
      { name: "created_at", type: "DATETIME", nullable: false, default: "CURRENT_TIMESTAMP", constraint: null, pk: false },
    ],
  },
  {
    name: "users",
    rows: 89,
    columns: [
      { name: "id", type: "INTEGER", nullable: false, default: null, constraint: "PRIMARY KEY", pk: true },
      { name: "email", type: "TEXT", nullable: false, default: null, constraint: "UNIQUE", pk: false },
      { name: "role", type: "TEXT", nullable: false, default: "'viewer'", constraint: null, pk: false },
      { name: "created_at", type: "DATETIME", nullable: false, default: "CURRENT_TIMESTAMP", constraint: null, pk: false },
    ],
  },
]

const topQueries = [
  { query: "SELECT * FROM jobs WHERE company_id = ?", calls: "12,450", avgTime: "2.3ms", totalTime: "28.6s", rows: "3,112" },
  { query: "INSERT INTO jobs (title, url, company_id) VALUES (?, ?, ?)", calls: "3,891", avgTime: "5.1ms", totalTime: "19.8s", rows: "3,891" },
  { query: "UPDATE jobs SET status = ? WHERE id = ?", calls: "2,104", avgTime: "3.8ms", totalTime: "8.0s", rows: "2,104" },
  { query: "SELECT COUNT(*) FROM crawler_sources WHERE name = ?", calls: "1,876", avgTime: "1.1ms", totalTime: "2.1s", rows: "1,876" },
  { query: "DELETE FROM jobs WHERE created_at < datetime('now', '-30 days')", calls: "12", avgTime: "45.2ms", totalTime: "542.4ms", rows: "8,421" },
]

const addFields = ref([
  { key: "name", label: "Name", placeholder: "Enter name", value: "", hint: "" },
  { key: "url", label: "URL", placeholder: "https://", value: "", hint: "" },
  { key: "job_selector", label: "Job Selector", placeholder: "e.g., tr.job-row", value: "", hint: "CSS selector for job listing container" },
  { key: "title_selector", label: "Title Selector", placeholder: "e.g., h2.job-title a", value: "", hint: "CSS selector for job title element" },
  { key: "link_selector", label: "Link Selector", placeholder: "e.g., a.job-link", value: "", hint: "CSS selector for job detail link" },
])

const schemaDdl = ref("-- Edit schema for crawler_sources\nALTER TABLE crawler_sources ADD COLUMN new_field TEXT;")

onMounted(() => {
  loadConfig()
  loadKeys()
})

async function loadConfig() {
  try {
    const res = await api.getConfig(dbName)
    dbConfig.value = res.data
  } catch {}
}

async function saveGroup() {
  try {
    await api.updateConfig(dbName, { group: dbConfig.value.group || null })
  } catch {}
}

async function saveReadonly() {
  try {
    await api.updateConfig(dbName, { readonly: dbConfig.value.readonly || false })
  } catch {}
}

async function exportDatabase() {
  try {
    const blob = await api.exportDatabase(dbName)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${dbName}.db`
    a.click()
    URL.revokeObjectURL(url)
  } catch {}
}

async function loadKeys() {
  try {
    const res = await api.listKeys(dbName)
    apiKeys.value = res.data.map((k: ApiKeyInfo) => ({
      id: k.id,
      name: k.label,
      key: k.id.slice(0, 8) + "...",
      lastUsed: k.last_used_at ? formatTimeAgo(k.last_used_at) : "never",
    }))
  } catch {}
}

function formatTimeAgo(dateStr: string) {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z")
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

function handleDelete(rows: number[]) {
  showDeleteModal.value = true
}

function openSchemaEditor(name: string) {
  schemaDdl.value = `-- Edit schema for ${name}\nALTER TABLE ${name} ADD COLUMN new_field TEXT;`
  showSchemaDrawer.value = true
}

function confirmDeleteKey(k: { id: string; name: string }) {
  deletingKey.value = k
  showDeleteKeyModal.value = true
}

async function generateKey() {
  if (!newKeyLabel.value.trim()) return
  try {
    const res = await api.createKey(dbName, newKeyLabel.value.trim())
    newKeyValue.value = res.data.key
    showGenerateKeyModal.value = false
    showNewKeyModal.value = true
    await loadKeys()
  } catch {}
}

async function revokeKey() {
  if (!deletingKey.value) return
  try {
    await api.revokeKey(dbName, deletingKey.value.id)
    showDeleteKeyModal.value = false
    deletingKey.value = null
    await loadKeys()
  } catch {}
}

function copyUrl() {
  navigator.clipboard.writeText(`${window.location.origin}/api/databases/${dbName}`)
  urlCopied.value = true
  setTimeout(() => urlCopied.value = false, 2000)
}

function copyKey() {
  navigator.clipboard.writeText(newKeyValue.value)
  copied.value = true
  setTimeout(() => copied.value = false, 2000)
}

async function deleteDatabase() {
  try {
    await api.deleteDatabase(dbName)
    router.push("/databases")
  } catch {}
}
</script>
