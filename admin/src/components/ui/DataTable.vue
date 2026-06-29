<template>
  <div ref="rootEl" tabindex="-1" style="outline: none" @keydown.escape="closePanels">
    <div class="flex items-center gap-2 mb-3 flex-wrap">
      <div class="flex-1"></div>
      <div
        v-if="selectedRows.size > 0"
        class="flex items-center gap-1 mr-2"
      >
        <span class="text-xs text-text-muted">{{ selectedRows.size }} selected</span>
        <button
          class="btn-danger btn-sm flex items-center gap-1"
          @click="$emit('deleteSelected', Array.from(selectedRows))"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          Delete
        </button>
      </div>
      <div class="flex items-center gap-1">
        <div class="relative">
          <button
            class="btn-ghost btn-sm flex items-center gap-1"
            @click="showFilterBar = !showFilterBar"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z"/></svg>
            Filters
          </button>
        </div>
          <div ref="sortButtonRef" class="relative">
            <button
              class="btn-ghost btn-sm flex items-center gap-1"
              @click="toggleSortPanel"
            >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>
            Sort
          </button>
          <div ref="sortPanelRef" class="sort-panel" :class="{ show: showSortPanel }">
            <div class="sort-panel-header">
              <span class="text-xs font-medium text-text-primary">Sort by</span>
              <select
                class="input-field text-[10px]"
                style="width: 4.5rem; font-family: Inter; padding: 2px 4px;"
                v-model="sortDir"
              >
                <option value="asc">ASC</option>
                <option value="desc">DESC</option>
              </select>
            </div>
            <div class="sort-panel-body">
              <div
                v-for="(col, i) in visibleColumns"
                :key="col.key"
                class="sort-option"
                :class="{ active: sortColIndex === i }"
                @click="setSort(i)"
              >
                <span>{{ col.label }}</span>
                <span class="dir-icon text-xs">{{ sortColIndex === i ? (sortAsc ? '▲' : '▼') : '⇅' }}</span>
              </div>
            </div>
            <div class="px-3 py-1.5 border-t border-border-subtle flex items-center justify-between">
              <button
                class="text-xs text-text-muted hover:text-text-primary transition-colors"
                @click="clearSort()"
              >Clear</button>
            </div>
          </div>
        </div>
          <div ref="columnButtonRef" class="relative">
            <button
              class="btn-ghost btn-sm flex items-center gap-1"
              @click="toggleColumnPanel"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
              Columns
            </button>
            <div ref="columnPanelRef" class="column-panel" :class="{ show: showColumnPanel }">
            <div class="column-panel-header">
              <span class="text-xs font-medium text-text-primary">Manage columns</span>
              <button
                class="text-text-muted hover:text-text-primary transition-colors"
                @click="showColumnPanel = false"
              >
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div class="column-panel-body">
              <div
                v-for="col in columns"
                :key="col.key"
                class="column-item"
                :class="{ 'hidden-col': !col.visible }"
                @click="toggleColumn(col.key)"
              >
                <svg class="eye-icon w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                <span>{{ col.label }}</span>
              </div>
            </div>
          </div>
        </div>
        <slot name="toolbar-extra" />
      </div>
    </div>

    <div class="filter-bar" :class="{ show: showFilterBar }">
      <div class="flex items-center gap-2 w-full justify-between">
        <div class="flex items-center gap-2">
          <button class="btn-ghost btn-sm text-xs px-2 py-1" @click="addFilter">+ Add filter</button>
          <button class="btn-ghost btn-sm text-xs px-2 py-1" @click="clearFilters">Clear filters</button>
        </div>
        <button class="btn-primary btn-sm text-xs px-2 py-1" @click="applyFilters">Apply</button>
      </div>
      <div class="w-full h-px my-1" style="background-color: #333333;"></div>
      <div
        v-for="(f, i) in filters"
        :key="i"
        class="filter-row-inline"
      >
        <select class="input-field" style="width: 5.5rem" v-model="f.column">
          <option v-for="col in columns" :key="col.key" :value="col.key">{{ col.label }}</option>
        </select>
        <select class="input-field" style="width: 6rem" v-model="f.operator">
          <option>contains</option>
          <option>equals</option>
          <option>starts with</option>
          <option>ends with</option>
        </select>
        <input class="input-field" style="width: 8rem" v-model="f.value" placeholder="value">
        <button class="remove-btn" @click="filters.splice(i, 1)">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="border border-border-default rounded-lg overflow-hidden bg-bolt-card mb-4">
      <div class="overflow-x-auto table-scrollable">
        <table class="data-table">
          <thead>
            <tr>
              <th class="w-8">
                <input
                  type="checkbox"
                  class="w-3.5 h-3.5 rounded border-border-subtle bg-bolt-input accent-accent-600"
                  :checked="allSelected"
                  @change="toggleAll"
                >
              </th>
              <th
                v-for="(col, i) in visibleColumns"
                :key="col.key"
                class="sortable"
                :class="{ 'sort-asc': sortColIndex === i && sortAsc, 'sort-desc': sortColIndex === i && !sortAsc }"
                @click="setSort(i)"
              >
                {{ col.label }}
                <span class="schema-col">{{ col.type }}</span>
                <svg class="sort-icon w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, ri) in sortedRows"
              :key="ri"
              :class="{ 'row-modified': modifiedRows.has(ri) }"
            >
              <td>
                <input
                  type="checkbox"
                  class="row-check w-3.5 h-3.5 rounded border-border-subtle bg-bolt-input accent-accent-600"
                  :checked="selectedRows.has(ri)"
                  @change="toggleRow(ri)"
                >
              </td>
              <td
                v-for="col in visibleColumns"
                :key="col.key"
                @dblclick="startEdit(ri, col.key)"
              >
                <div v-if="editingCell?.row === ri && editingCell?.col === col.key">
                  <input
                    :ref="setEditInputRef"
                    class="cell-input"
                    v-model="editValue"
                    @keydown.enter="saveEdit(ri, col.key)"
                    @keydown.escape="cancelEdit"
                    @blur="saveEdit(ri, col.key)"
                    :style="{ fontFamily: col.key === 'id' ? 'JetBrains Mono, monospace' : 'Inter, system-ui, sans-serif' }"
                  >
                </div>
                <template v-else>
                  <span
                    v-if="row[col.key] === null || row[col.key] === undefined"
                    class="text-text-muted italic"
                  >null</span>
                  <span
                    v-else-if="col.key === 'id'"
                    class="font-mono text-xs"
                  >{{ row[col.key] }}</span>
                  <span v-else>{{ row[col.key] }}</span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between px-4 py-2 border-t border-border-default bg-bolt-elevated/50">
      <div class="flex items-center gap-2 text-xs text-text-muted">
         {{ visibleTotal > 0 ? offset + 1 : 0 }} – {{ Math.min(offset + limit, visibleTotal) }} of {{ visibleTotal }}
         <span v-if="timing > 0" class="ml-2 text-text-muted">· {{ timing }}ms</span>
        <button class="btn-ghost btn-sm p-1 flex items-center" @click="$emit('refresh')">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        </button>
      </div>
        <div class="flex items-center gap-1">
          <slot name="table-footer-right" />
          <button class="btn-ghost btn-sm" :class="{ 'opacity-50 cursor-not-allowed': offset <= 0 }" :disabled="offset <= 0" @click="$emit('page-change', Math.max(0, offset - limit))">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <button class="btn-ghost btn-sm" :class="{ 'opacity-50 cursor-not-allowed': offset + limit >= total }" :disabled="offset + limit >= total" @click="$emit('page-change', offset + limit)">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue"

export interface ColumnDef {
  key: string
  label: string
  type: string
  visible?: boolean
}

const props = withDefaults(
  defineProps<{
    columns: ColumnDef[]
    rows: Record<string, unknown>[]
    total?: number
    offset?: number
    limit?: number
    timing?: number
  }>(),
  {
    total: 0,
    offset: 0,
    limit: 50,
    timing: 0,
  }
)

const emit = defineEmits<{
  "deleteSelected": [rowIndices: number[]]
  "update:rows": [rows: Record<string, unknown>[]]
  "refresh": []
  "page-change": [offset: number]
  "sort-change": [column: string | null, asc: boolean]
  "filter-change": [filters: { column: string; operator: string; value: string }[]]
}>()

const showFilterBar = ref(false)
const showSortPanel = ref(false)
const showColumnPanel = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const sortPanelRef = ref<HTMLElement | null>(null)
const sortButtonRef = ref<HTMLElement | null>(null)
const columnPanelRef = ref<HTMLElement | null>(null)
const columnButtonRef = ref<HTMLElement | null>(null)

watch(showFilterBar, (show) => {
  if (show && filters.value.length === 0) addFilter()
})

function focusRoot() {
  nextTick(() => rootEl.value?.focus())
}

function toggleSortPanel() {
  showSortPanel.value = !showSortPanel.value
  if (showSortPanel.value) focusRoot()
}

function toggleColumnPanel() {
  showColumnPanel.value = !showColumnPanel.value
  if (showColumnPanel.value) focusRoot()
}

function closePanels() {
  showSortPanel.value = false
  showFilterBar.value = false
  showColumnPanel.value = false
}

function onClickOutside(event: MouseEvent) {
  const target = event.target as Node
  if (sortPanelRef.value && !sortPanelRef.value.contains(target) && sortButtonRef.value && !sortButtonRef.value.contains(target)) {
    showSortPanel.value = false
  }
  if (columnPanelRef.value && !columnPanelRef.value.contains(target) && columnButtonRef.value && !columnButtonRef.value.contains(target)) {
    showColumnPanel.value = false
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    closePanels()
  }
}

onMounted(() => {
  document.addEventListener("click", onClickOutside)
  window.addEventListener("keydown", onKeyDown, { capture: true })
})
onUnmounted(() => {
  document.removeEventListener("click", onClickOutside)
  window.removeEventListener("keydown", onKeyDown, { capture: true })
})
const sortColIndex = ref(-1)
const sortAsc = ref(true)
const sortDir = computed({
  get: () => sortAsc.value ? 'asc' : 'desc',
  set: (val) => { sortAsc.value = val === 'asc' }
})
const selectedRows = ref(new Set<number>())
const modifiedRows = ref(new Set<number>())
const editingCell = ref<{ row: number; col: string } | null>(null)
const editValue = ref("")
let editInputEl: HTMLInputElement | null = null
function setEditInputRef(el: unknown) {
  if (el instanceof HTMLInputElement) editInputEl = el
}

interface Filter {
  column: string
  operator: string
  value: string
}

const filters = ref<Filter[]>([])
const activeFilters = ref<Filter[]>([])

const columns = ref<ColumnDef[]>([])

watch(
  () => props.columns,
  (cols) => {
    columns.value = cols.map((c) => ({ ...c, visible: c.visible ?? true }))
  },
  { immediate: true }
)

const visibleColumns = computed(() => columns.value.filter((c) => c.visible))
const visibleTotal = computed(() => props.total || sortedRows.value.length)

const allSelected = computed(() => {
  return props.rows.length > 0 && selectedRows.value.size === props.rows.length
})

function toggleAll() {
  if (allSelected.value) {
    selectedRows.value.clear()
  } else {
    selectedRows.value = new Set(props.rows.map((_, i) => i))
  }
}

function toggleRow(i: number) {
  const s = new Set(selectedRows.value)
  if (s.has(i)) s.delete(i)
  else s.add(i)
  selectedRows.value = s
}

function toggleColumn(key: string) {
  const col = columns.value.find((c) => c.key === key)
  if (col) col.visible = !col.visible
}

function setSort(i: number) {
  if (sortColIndex.value === i) {
    sortAsc.value = !sortAsc.value
  } else {
    sortColIndex.value = i
    sortAsc.value = false
  }
  showSortPanel.value = false
  const col = visibleColumns.value[i]
  emit("sort-change", col?.key ?? null, sortAsc.value)
}

function clearSort() {
  sortColIndex.value = -1
  sortAsc.value = true
  emit("sort-change", null, true)
}

const sortedRows = computed(() => {
  let rows = [...props.rows]

  // Apply filters (client-side only, for preview before Apply)
  for (const f of activeFilters.value) {
    if (!f.value) continue
    const val = f.value.toLowerCase()
    rows = rows.filter(r => {
      const cell = String(r[f.column] ?? "").toLowerCase()
      switch (f.operator) {
        case "contains": return cell.includes(val)
        case "equals": return cell === val
        case "starts with": return cell.startsWith(val)
        case "ends with": return cell.endsWith(val)
        default: return cell.includes(val)
      }
    })
  }

  return rows
})

function applyFilters() {
  activeFilters.value = filters.value.map(f => ({ ...f }))
  emit("filter-change", filters.value)
}

function addFilter() {
  filters.value.push({ column: columns.value[0]?.key ?? "", operator: "contains", value: "" })
}

function clearFilters() {
  filters.value = []
  activeFilters.value = []
  emit("filter-change", [])
}

function startEdit(row: number, col: string) {
  if (col === "id") return
  editingCell.value = { row, col }
  editValue.value = String(props.rows[row]?.[col] ?? "")
  nextTick(() => {
    editInputEl?.focus()
  })
}

function saveEdit(row: number, col: string) {
  if (!editingCell.value) return
  const rows = [...props.rows]
  rows[row] = { ...rows[row], [col]: editValue.value }
  modifiedRows.value.add(row)
  emit("update:rows", rows)
  editingCell.value = null
}

function cancelEdit() {
  editingCell.value = null
}

watch(
  () => props.rows,
  () => {
    selectedRows.value.clear()
  }
)
</script>
