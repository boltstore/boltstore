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
        <span class="text-xs text-text-muted hidden sm:inline">{{ dbAnalytics ? `${formatBytes(dbAnalytics.storageBytes)} · ${dbAnalytics.queries.toLocaleString()} queries (24h)` : '' }}</span>
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
        SQLite · {{ dbAnalytics ? `${dbAnalytics.avgLatencyMs}ms avg` : '' }}
      </div>
    </div>

    <div v-show="activeTab === 'data'" class="flex flex-col md:flex-row gap-4">
      <div class="w-56 shrink-0">
        <p v-if="tableFeedback" class="text-[10px] text-green-400 mb-2">{{ tableFeedback }}</p>
        <div class="flex items-center gap-2 mb-3">
          <input type="text" class="input-field text-xs py-2" placeholder="Search tables..." style="font-family:Inter" v-model="tableSearch">
          <button class="btn-primary btn-sm shrink-0 text-xs flex items-center gap-1" @click="showAddTableDrawer = true">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add
          </button>
        </div>
        <div class="space-y-0.5">
          <div v-if="filteredTables.length === 0 && !loadingTables" class="px-2 py-3 text-xs text-text-muted">No tables found.</div>
          <div
            v-for="t in filteredTables"
            :key="t.name"
            class="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors group"
            :class="t.name === selectedTable ? 'text-text-primary bg-bolt-hover' : 'text-text-secondary hover:bg-bolt-hover'"
            @click="selectTable(t.name)"
          >
            <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            {{ t.name }}
            <span class="ml-auto text-[10px] text-text-muted">{{ t.count || '' }}</span>
            <div class="hidden group-hover:flex items-center gap-0.5 ml-1 shrink-0">
              <button class="w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-accent-400 hover:bg-bolt-hover" title="Rename" @click.stop="startRename(t)">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              </button>
              <button class="w-4 h-4 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-red-500/10" title="Delete" @click.stop="startDeleteTable(t)">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <p v-if="dataError" class="text-xs text-red-400 mb-2">{{ dataError }}</p>
        <DataTable
          :key="selectedTable"
          :columns="tableColumns"
          :rows="dataRows"
          :total="totalRecords"
          :offset="recordOffset"
          :limit="recordLimit"
          :timing="recordTiming"
          @delete-selected="handleDelete"
          @update:rows="handleUpdateRows"
          @refresh="loadRecords"
          @page-change="goToPage"
          @sort-change="onSortChange"
          @filter-change="onFilterChange"
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
          <button class="btn-primary btn-sm flex items-center gap-1 ml-auto" :disabled="sqlRunning" @click="runQuery">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            {{ sqlRunning ? 'Running...' : 'Run' }}
          </button>
        </div>
        <textarea
          class="input-field w-full h-40 resize-none font-mono text-sm leading-relaxed"
          spellcheck="false"
          v-model="sqlQuery"
          @keydown.ctrl.enter="runQuery"
          @keydown.meta.enter="runQuery"
        ></textarea>
      </div>
      <div v-if="sqlError" class="bg-bolt-card border border-red-500/20 rounded-lg p-4">
        <div class="text-xs text-red-400 font-mono whitespace-pre-wrap">{{ sqlError }}</div>
      </div>
      <div v-if="sqlResult !== null" class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="px-4 py-2 border-b border-border-default bg-bolt-elevated">
          <span class="text-xs text-text-muted">{{ sqlResultText }}</span>
        </div>
        <div class="overflow-x-auto">
          <table class="data-table" v-if="sqlColumns.length > 0">
            <thead>
              <tr>
                <th v-for="col in sqlColumns" :key="col">{{ col }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in sqlResult" :key="i">
                <td v-for="col in sqlColumns" :key="col">
                  <span class="font-mono text-xs">{{ row[col] === null ? 'null' : row[col] }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="px-4 py-8 text-center text-xs text-text-muted">Query executed successfully. No rows returned.</div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'schema'" class="space-y-4">
      <div
        v-for="t in loadedSchemas"
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
            <tr v-if="topQueries.length === 0">
              <td colspan="5" class="px-5 py-8 text-center text-sm text-text-muted">No query data yet. Run some queries to see analytics.</td>
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
            <div class="flex items-center gap-2">
              <input type="text" class="input-field" v-model="editableName">
              <button v-if="editableName !== dbName" class="btn-primary btn-sm shrink-0" :disabled="renaming" @click="saveName">{{ renaming ? 'Saving...' : 'Save' }}</button>
            </div>
            <p v-if="nameSaved" class="text-[10px] text-green-400 mt-1">Name updated</p>
          </div>
          <div>
            <label class="label">Group</label>
            <select class="input-field appearance-none" style="font-family:Inter" :value="dbConfig.group || ''" @change="saveGroup(($event.target as HTMLSelectElement).value)">
              <option value="">default</option>
              <option value="production">production</option>
              <option value="staging">staging</option>
            </select>
            <p v-if="groupSaved" class="text-[10px] text-green-400 mt-1">Group updated</p>
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
        </div>
        <p v-if="addRecordError" class="text-xs text-red-400 mt-2">{{ addRecordError }}</p>
      </template>
      <template #footer>
        <button class="btn-primary w-full" @click="saveRecord">Save Record</button>
      </template>
    </Drawer>

    <Drawer :open="showAddTableDrawer" @close="showAddTableDrawer = false">
      <template #header>
        <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        <span class="text-sm font-medium text-text-primary">Add Table</span>
      </template>
      <template #body>
        <div class="form-group">
          <label>Table Name</label>
          <input type="text" class="input-field" placeholder="table_name" v-model="newTableName">
        </div>
        <p class="text-[10px] text-text-muted mt-3 mb-2">Columns</p>
        <div class="space-y-2">
          <div v-for="(col, i) in newTableColumns" :key="i" class="bg-bolt-elevated border border-border-subtle rounded-md overflow-hidden">
            <div class="p-2 pb-1">
              <div class="flex items-center gap-1.5 mb-1.5">
                <input type="text" class="input-field text-xs py-1.5 flex-1 min-w-0" placeholder="Column name" v-model="col.name">
                <select class="input-field text-xs py-1.5 shrink-0 appearance-none" style="font-family:Inter;width:78px" v-model="col.type">
                  <option>text</option>
                  <option>integer</option>
                  <option>real</option>
                  <option>blob</option>
                  <option>numeric</option>
                  <option>boolean</option>
                  <option>date</option>
                  <option>datetime</option>
                </select>
                <button v-if="newTableColumns.length > 1" class="w-5 h-5 flex items-center justify-center text-text-muted hover:text-red-400 shrink-0" @click="newTableColumns.splice(i, 1)">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
              <div class="flex items-center gap-2 text-[10px] flex-wrap">
                <label class="flex items-center gap-1 text-text-muted cursor-pointer">
                  <input type="checkbox" class="w-3 h-3 accent-accent-600" v-model="col.primary_key"> PK
                </label>
                <label v-if="col.primary_key" class="flex items-center gap-1 cursor-pointer" :class="col.type === 'integer' ? 'text-text-muted' : 'text-text-muted/40'">
                  <input type="checkbox" class="w-3 h-3 accent-accent-600" :disabled="col.type !== 'integer'" v-model="col.auto_increment"> AI
                  <span v-if="col.type !== 'integer'" class="text-[9px]">(int)</span>
                </label>
                <span class="text-border-subtle">|</span>
                <label class="flex items-center gap-1 text-text-muted cursor-pointer">
                  <input type="checkbox" class="w-3 h-3 accent-accent-600" :checked="!col.nullable" @change="col.nullable = !col.nullable"> Not null
                </label>
                <label class="flex items-center gap-1 text-text-muted cursor-pointer">
                  <input type="checkbox" class="w-3 h-3 accent-accent-600" v-model="col.unique"> Unique
                </label>
                <button class="text-text-muted hover:text-accent-400 ml-auto" @click="col._showFk = !col._showFk" :class="col._showFk ? 'text-accent-400' : ''">FK</button>
                <button v-if="!col.primary_key" class="text-text-muted hover:text-accent-400" @click="col._showDefault = !col._showDefault">default</button>
              </div>
            </div>
            <div v-if="col._showFk" class="px-2 pb-2 flex items-center gap-1.5 border-t border-border-subtle pt-2">
              <span class="text-[10px] text-text-muted shrink-0">FK →</span>
              <input type="text" class="input-field text-xs py-1.5 flex-1" placeholder="table" v-model="col.fk_table">
              <span class="text-text-muted text-[10px]">.</span>
              <input type="text" class="input-field text-xs py-1.5" placeholder="column" style="width:100px" v-model="col.fk_column">
            </div>
            <div v-if="col._showDefault && !col.primary_key" class="px-2 pb-2 border-t border-border-subtle pt-2">
              <input type="text" class="input-field text-xs py-1.5" placeholder="Default value" v-model="col.default">
            </div>
          </div>
        </div>
          <button class="btn-ghost btn-sm text-xs mt-2" @click="newTableColumns.push({ name: '', type: 'text', primary_key: false, auto_increment: false, nullable: false, default: '', unique: false, fk_table: '', fk_column: '', _showFk: false, _showDefault: false })">+ Add column</button>
        <p v-if="addTableError" class="text-xs text-red-400 mt-3">{{ addTableError }}</p>
      </template>
      <template #footer>
        <button class="btn-primary w-full" :disabled="addingTable" @click="createTable">{{ addingTable ? 'Creating...' : 'Create Table' }}</button>
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
          v-model="schemaDdl"
        ></textarea>
        <p v-if="schemaError" class="text-xs text-red-400 mt-2">{{ schemaError }}</p>
        <p v-if="schemaSuccess" class="text-xs text-green-400 mt-2">{{ schemaSuccess }}</p>
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
          <button class="btn-primary w-full text-xs" :disabled="schemaApplying" @click="applySchema">{{ schemaApplying ? 'Applying...' : 'Apply Changes' }}</button>
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
          <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500 border-red-500/50" @click="confirmDeleteRecords">Delete</button>
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
    <div
      class="fixed inset-0 z-50"
      :class="showRenameTableModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showRenameTableModal = false"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <h3 class="text-sm font-medium text-text-primary mb-4">Rename Table</h3>
        <div class="mb-4">
          <input type="text" class="input-field" v-model="renameTableName" placeholder="New table name" @keyup.enter="confirmRename">
          <p v-if="renameError" class="text-xs text-red-400 mt-1">{{ renameError }}</p>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showRenameTableModal = false">Cancel</button>
          <button class="btn-primary btn-sm" :disabled="renamingTable" @click="confirmRename">{{ renamingTable ? 'Renaming...' : 'Rename' }}</button>
        </div>
      </div>
    </div>

    <div
      class="fixed inset-0 z-50"
      :class="showDeleteTableModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showDeleteTableModal = false"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text-primary">Delete Table</h3>
            <p class="text-xs text-red-400 mt-0.5">This action is permanent. All data will be removed.</p>
          </div>
        </div>
        <div class="p-3 bg-bolt-elevated border border-border-default rounded-md mb-4 text-xs text-text-muted">
          Are you sure you want to delete <strong class="text-text-primary">{{ deletingTable?.name }}</strong>?
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showDeleteTableModal = false">Cancel</button>
          <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500 border-red-500/50" @click="confirmDeleteTable">Delete</button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, h, computed, watch, onMounted, onUnmounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import AppLayout from "../components/layout/AppLayout.vue"
import DataTable, { type ColumnDef } from "../components/ui/DataTable.vue"
import Drawer from "../components/ui/Drawer.vue"
import { api, type ApiKeyInfo, type DatabaseAnalytics } from "../api/client"

const route = useRoute()
const router = useRouter()
const dbName = computed(() => route.params.name as string)
const activeTab = computed(() => route.params.tab as string || "data")
const selectedTable = ref(route.params.table as string || "")
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
const groupSaved = ref(false)
const nameSaved = ref(false)
const renaming = ref(false)
const editableName = ref("")
const deletingRows = ref<number[]>([])
const dbAnalytics = ref<DatabaseAnalytics | null>(null)
const showRenameTableModal = ref(false)
const showDeleteTableModal = ref(false)
const renameTableName = ref("")
const renamingTable = ref(false)
const renameError = ref("")
const renameTargetTable = ref<{ name: string } | null>(null)
const deletingTable = ref<{ name: string } | null>(null)
const showAddTableDrawer = ref(false)
const newTableName = ref("")
const newTableColumns = ref([{ name: "", type: "text", primary_key: false, auto_increment: false, nullable: false, default: "", unique: false, fk_table: "", fk_column: "", _showFk: false, _showDefault: false }])
const addingTable = ref(false)
const addTableError = ref("")
const addRecordError = ref("")
const tableFeedback = ref("")

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape") return
  if (showDeleteModal.value) showDeleteModal.value = false
  if (showGenerateKeyModal.value) showGenerateKeyModal.value = false
  if (showNewKeyModal.value) showNewKeyModal.value = false
  if (showDeleteKeyModal.value) showDeleteKeyModal.value = false
  if (showDeleteDatabaseModal.value) showDeleteDatabaseModal.value = false
  if (showRenameTableModal.value) showRenameTableModal.value = false
  if (showDeleteTableModal.value) showDeleteTableModal.value = false
  if (showAddTableDrawer.value) showAddTableDrawer.value = false
}

onMounted(() => window.addEventListener("keydown", onKeyDown, { capture: true }))
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))

watch(selectedTable, (table) => {
  recordOffset.value = 0
  recordSort.value = ""
  recordFilter.value = ""
  if (table) loadRecords()
})

watch(() => route.params.table, (table) => {
  if (table && selectedTable.value !== table) {
    tableColumns.value = []
    dataRows.value = []
    selectedTable.value = table as string
  }
})

watch(dbName, (name) => {
  editableName.value = name
  selectedTable.value = ""
  tables.value = []
  tableColumns.value = []
  dataRows.value = []
  loadConfig()
  loadKeys()
  loadTables()
  loadAnalytics()
})

async function loadTables() {
  loadingTables.value = true
  dataError.value = ""
  try {
    const res = await api.listTables(dbName.value)
    tables.value = res.data.map(name => ({ name, count: 0 }))
    if (tables.value.length > 0 && !selectedTable.value) {
      selectTable(tables.value[0].name)
    } else if (selectedTable.value) {
      loadRecords()
    }
  } catch (e: unknown) {
    dataError.value = e instanceof Error ? e.message : "Failed to load tables"
  } finally {
    loadingTables.value = false
  }
}

function selectTable(name: string) {
  if (selectedTable.value === name) return
  tableColumns.value = []
  dataRows.value = []
  selectedTable.value = name
  router.push(`/databases/${dbName.value}/${activeTab.value}/${name}`)
}

async function loadRecords() {
  if (!selectedTable.value) return
  loadingRecords.value = true
  dataError.value = ""
  const start = performance.now()
  try {
    const res = await api.listRecords(dbName.value, selectedTable.value, {
      limit: recordLimit,
      offset: recordOffset.value,
      sort: recordSort.value || undefined,
      filter: recordFilter.value || undefined,
    })
    dataRows.value = res.data
    totalRecords.value = res.meta?.total ?? 0
    if (res.data.length > 0 && tableColumns.value.length === 0) {
      const keys = Object.keys(res.data[0]).filter(k => k !== "rowid")
      tableColumns.value = keys.map(key => ({
        key,
        label: key,
        type: typeof res.data[0][key] === "number" ? "integer" : "text",
      }))
    }
    if (tableColumns.value.length === 0) {
      try {
        const schema = await api.getTableSchema(dbName.value, selectedTable.value)
        tableColumns.value = schema.data.columns.map(c => ({
          key: c.name,
          label: c.name,
          type: c.type.toLowerCase().startsWith("int") || c.type.toLowerCase().startsWith("real") ? "integer" : "text",
        }))
      } catch {}
    }
    recordTiming.value = Math.round(performance.now() - start)
  } catch (e: unknown) {
    dataError.value = e instanceof Error ? e.message : "Failed to load records"
  } finally {
    loadingRecords.value = false
  }
}

function goToPage(offset: number) {
  recordOffset.value = offset
  loadRecords()
}

function onSortChange(column: string | null, asc: boolean) {
  recordSort.value = column ? `${asc ? "+" : "-"}${column}` : ""
  recordOffset.value = 0
  loadRecords()
}

function onFilterChange(filters: { column: string; operator: string; value: string }[]) {
  const active = filters.filter(f => f.value)
  if (active.length === 0) {
    recordFilter.value = ""
  } else {
    const obj: Record<string, Record<string, string>> = {}
    for (const f of active) {
      const op = f.operator === "contains" ? "$like" : f.operator === "equals" ? "$eq" : f.operator === "starts with" ? "$like" : "$eq"
      const val = f.operator === "contains" ? `%${f.value}%` : f.operator === "starts with" ? `${f.value}%` : f.value
      obj[f.column] = { [op]: val }
    }
    recordFilter.value = JSON.stringify(obj)
  }
  recordOffset.value = 0
  loadRecords()
}

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

const tables = ref<{ name: string; count: number }[]>([])
const tableSearch = ref("")
const filteredTables = computed(() => {
  if (!tableSearch.value) return tables.value
  const q = tableSearch.value.toLowerCase()
  return tables.value.filter(t => t.name.toLowerCase().includes(q))
})
const tableColumns = ref<ColumnDef[]>([])
const dataRows = ref<Record<string, unknown>[]>([])
const loadingTables = ref(false)
const loadingRecords = ref(false)
const totalRecords = ref(0)
const recordOffset = ref(0)
const recordLimit = 50
const recordSort = ref("")
const recordFilter = ref("")
const recordTiming = ref(0)
const dataError = ref("")

const sqlQuery = ref("SELECT * FROM ")
const sqlResult = ref<Record<string, unknown>[] | null>(null)
const sqlColumns = ref<string[]>([])
const sqlError = ref("")
const sqlRunning = ref(false)
const sqlResultText = ref("")

async function runQuery() {
  if (!sqlQuery.value.trim()) return
  sqlRunning.value = true
  sqlError.value = ""
  sqlResult.value = null
  const start = performance.now()
  try {
    const res = await api.executeQuery(dbName.value, sqlQuery.value)
    if (res.data) {
      sqlResult.value = res.data
      sqlColumns.value = res.data.length > 0 ? Object.keys(res.data[0]) : []
      const ms = Math.round(performance.now() - start)
      sqlResultText.value = `${res.data.length} row${res.data.length !== 1 ? 's' : ''} · ${ms}ms`
    } else {
      sqlResult.value = []
      sqlColumns.value = []
      const ms = Math.round(performance.now() - start)
      sqlResultText.value = `${res.meta?.changes ?? 0} row(s) affected · ${ms}ms`
    }
  } catch (e: unknown) {
    sqlError.value = e instanceof Error ? e.message : "Query failed"
  } finally {
    sqlRunning.value = false
  }
}

const loadedSchemas = ref<{ name: string; rows: string; columns: { name: string; type: string; nullable: boolean; default: string | null; constraint: string | null; pk: boolean }[] }[]>([])

async function loadSchemas() {
  try {
    const tableList = await api.listTables(dbName.value)
    const schemas = []
    for (const name of tableList.data) {
      try {
        const schema = await api.getTableSchema(dbName.value, name)
        const columns = schema.data.columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: !c.notnull,
          default: c.dflt_value,
          constraint: c.pk ? "PRIMARY KEY" : null,
          pk: !!c.pk,
        }))
        schemas.push({ name, rows: "—", columns })
      } catch {
        schemas.push({ name, rows: "—", columns: [] })
      }
    }
    loadedSchemas.value = schemas
  } catch {}
}

watch(activeTab, (tab) => {
  if (tab === "schema") loadSchemas()
}, { immediate: true })

const topQueries = computed(() => {
  if (!dbAnalytics.value?.topTables) return []
  return dbAnalytics.value.topTables.map(t => ({
    query: t.table_name,
    calls: t.calls.toLocaleString(),
    avgTime: `${t.avg_ms.toFixed(1)}ms`,
    totalTime: `${(t.calls * t.avg_ms / 1000).toFixed(1)}s`,
    rows: t.calls.toLocaleString(),
  }))
})

const addFields = ref<{ key: string; label: string; placeholder: string; value: string }[]>([])

watch(tableColumns, (cols) => {
  addFields.value = cols
    .filter(c => c.key !== "rowid")
    .map(c => ({ key: c.key, label: c.label, placeholder: `Enter ${c.label}`, value: "" }))
  addRecordError.value = ""
}, { immediate: true })

watch(showAddDrawer, (open) => {
  if (open) addRecordError.value = ""
})

const schemaDdl = ref("")
const schemaError = ref("")
const schemaSuccess = ref("")
const schemaApplying = ref(false)

async function applySchema() {
  if (!schemaDdl.value.trim()) return
  schemaApplying.value = true
  schemaError.value = ""
  schemaSuccess.value = ""
  try {
    await api.executeQuery(dbName.value, schemaDdl.value)
    schemaSuccess.value = "Schema updated successfully"
    showSchemaDrawer.value = false
    loadSchemas()
  } catch (e: unknown) {
    schemaError.value = e instanceof Error ? e.message : "Failed to apply schema changes"
  } finally {
    schemaApplying.value = false
  }
}

onMounted(() => {
  loadConfig()
  loadKeys()
  loadTables()
  loadAnalytics()
})

async function loadConfig() {
  try {
    const res = await api.getConfig(dbName.value)
    dbConfig.value = res.data
  } catch {}
}

async function loadAnalytics() {
  try {
    const res = await api.getDatabaseAnalytics(dbName.value)
    dbAnalytics.value = res.data
  } catch {}
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

async function saveGroup(group: string) {
  dbConfig.value.group = group || undefined
  try {
    await api.updateConfig(dbName.value, { group: group || null })
    groupSaved.value = true
    setTimeout(() => groupSaved.value = false, 2000)
  } catch {}
}

async function saveName() {
  const newName = editableName.value.trim()
  if (!newName || newName === dbName.value) return
  renaming.value = true
  try {
    await api.renameDatabase(dbName.value, newName)
    nameSaved.value = true
    setTimeout(() => nameSaved.value = false, 2000)
    router.replace(`/databases/${newName}/${activeTab.value}/settings`)
  } catch {}
  renaming.value = false
}

async function saveReadonly() {
  try {
    await api.updateConfig(dbName.value, { readonly: dbConfig.value.readonly || false })
  } catch {}
}

async function exportDatabase() {
  try {
    const blob = await api.exportDatabase(dbName.value)
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${dbName.value}.db`
    a.click()
    URL.revokeObjectURL(url)
  } catch {}
}

async function loadKeys() {
  try {
    const res = await api.listKeys(dbName.value)
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
  deletingRows.value = rows
  showDeleteModal.value = true
}

async function confirmDeleteRecords() {
  try {
    for (const row of deletingRows.value) {
      await api.deleteRecord(dbName.value, selectedTable.value, row)
    }
    showDeleteModal.value = false
    deletingRows.value = []
    await loadRecords()
  } catch {}
}

async function handleUpdateRows(rows: Record<string, unknown>[]) {
  const oldRows = dataRows.value
  dataRows.value = rows
  for (let i = 0; i < rows.length; i++) {
    if (i >= oldRows.length) break
    const newRow = rows[i]
    const oldRow = oldRows[i]
    const rowId = oldRow.rowid ?? oldRow.id
    if (rowId == null) continue
    const changes: Record<string, unknown> = {}
    for (const key of Object.keys(newRow)) {
      if (newRow[key] !== oldRow[key] && key !== "rowid" && key !== "id") changes[key] = newRow[key]
    }
    if (Object.keys(changes).length > 0) {
      try {
        await api.updateRecord(dbName.value, selectedTable.value, rowId as number, changes)
      } catch {}
    }
  }
}

async function saveRecord() {
  const record: Record<string, unknown> = {}
  for (const field of addFields.value) {
    if (field.value) record[field.key] = field.value
  }
  addRecordError.value = ""
  try {
    await api.createRecord(dbName.value, selectedTable.value, record)
    showAddDrawer.value = false
    addFields.value.forEach(f => f.value = "")
    await loadRecords()
  } catch (e: unknown) {
    addRecordError.value = e instanceof Error ? e.message : "Failed to save record"
  }
}

function openSchemaEditor(name: string) {
  schemaError.value = ""
  schemaSuccess.value = ""
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
    const res = await api.createKey(dbName.value, newKeyLabel.value.trim())
    newKeyValue.value = res.data.key
    showGenerateKeyModal.value = false
    showNewKeyModal.value = true
    await loadKeys()
  } catch {}
}

async function revokeKey() {
  if (!deletingKey.value) return
  try {
    await api.revokeKey(dbName.value, deletingKey.value.id)
    showDeleteKeyModal.value = false
    deletingKey.value = null
    await loadKeys()
  } catch {}
}

function copyUrl() {
  navigator.clipboard.writeText(`${window.location.origin}/api/databases/${dbName.value}`)
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
    await api.deleteDatabase(dbName.value)
    router.push("/databases")
  } catch {}
}

function startRename(t: { name: string }) {
  renameTargetTable.value = t
  renameTableName.value = t.name
  renameError.value = ""
  showRenameTableModal.value = true
}

async function confirmRename() {
  const newName = renameTableName.value.trim()
  if (!newName || newName === renameTargetTable.value?.name) return
  renamingTable.value = true
  renameError.value = ""
  try {
    await api.alterTable(dbName.value, renameTargetTable.value!.name, { name: newName })
    showRenameTableModal.value = false
    tableFeedback.value = `Table renamed to "${newName}"`
    setTimeout(() => tableFeedback.value = "", 3000)
    if (selectedTable.value === renameTargetTable.value?.name) {
      selectedTable.value = newName
    }
    await loadTables()
  } catch (e: unknown) {
    renameError.value = e instanceof Error ? e.message : "Failed to rename table"
  }
  renamingTable.value = false
}

function startDeleteTable(t: { name: string }) {
  deletingTable.value = t
  showDeleteTableModal.value = true
}

async function confirmDeleteTable() {
  if (!deletingTable.value) return
  try {
    await api.deleteTable(dbName.value, deletingTable.value.name)
    showDeleteTableModal.value = false
    tableFeedback.value = `Table "${deletingTable.value.name}" deleted`
    setTimeout(() => tableFeedback.value = "", 3000)
    if (selectedTable.value === deletingTable.value.name) {
      selectedTable.value = ""
    }
    await loadTables()
  } catch {}
}

async function createTable() {
  const name = newTableName.value.trim()
  const columns = newTableColumns.value.filter(c => c.name.trim())
  if (!name) { addTableError.value = "Table name is required."; return }
  if (columns.length === 0) { addTableError.value = "At least one column is required."; return }
  addingTable.value = true
  addTableError.value = ""
  try {
    await api.createTable(dbName.value, name, columns.map(c => ({
      name: c.name.trim(),
      type: c.type,
      primary_key: c.primary_key || undefined,
      auto_increment: c.auto_increment || undefined,
      nullable: c.nullable ? undefined : false,
      default: c.default?.trim() || undefined,
      unique: c.unique || undefined,
      references: (c.fk_table?.trim() && c.fk_column?.trim()) ? { table: c.fk_table.trim(), column: c.fk_column.trim() } : undefined,
    })))
    showAddTableDrawer.value = false
    newTableName.value = ""
    newTableColumns.value = [{ name: "", type: "text", primary_key: false, auto_increment: false, nullable: false, default: "", unique: false, fk_table: "", fk_column: "", _showFk: false, _showDefault: false }]
    tableFeedback.value = `Table "${name}" created`
    setTimeout(() => tableFeedback.value = "", 3000)
    await loadTables()
  } catch (e: unknown) {
    addTableError.value = e instanceof Error ? e.message : "Failed to create table"
  }
  addingTable.value = false
}
</script>
