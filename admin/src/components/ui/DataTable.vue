<script setup lang="ts">
interface ColumnDef {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  sortable?: boolean;
  schemaType?: string;
}

const props = defineProps<{
  columns: ColumnDef[];
  rows: any[];
  selectable?: boolean;
  hoverable?: boolean;
}>();

const emit = defineEmits<{
  (e: "selectAll", selected: boolean): void;
  (e: "selectRow", index: number, selected: boolean): void;
  (e: "sort", key: string, direction: "asc" | "desc" | null): void;
}>();

const selectedRows = defineModel<Set<number>>("selectedRows", { default: () => new Set() });
const sortKey = defineModel<string>("sortKey", { default: "" });
const sortDirection = defineModel<"asc" | "desc" | null>("sortDirection", { default: null });

const allSelected = computed(() => {
  if (props.rows.length === 0) return false;
  return props.rows.every((_, i) => selectedRows.value.has(i));
});

function toggleSelectAll() {
  if (allSelected.value) {
    selectedRows.value = new Set();
    emit("selectAll", false);
  } else {
    const newSet = new Set<number>();
    for (let i = 0; i < props.rows.length; i++) {
      newSet.add(i);
    }
    selectedRows.value = newSet;
    emit("selectAll", true);
  }
}

function toggleRow(index: number) {
  const newSet = new Set(selectedRows.value);
  if (newSet.has(index)) {
    newSet.delete(index);
  } else {
    newSet.add(index);
  }
  selectedRows.value = newSet;
  emit("selectRow", index, newSet.has(index));
}

function handleSort(column: ColumnDef) {
  if (!column.sortable) return;
  if (sortKey.value === column.key) {
    if (sortDirection.value === "asc") {
      sortDirection.value = "desc";
    } else if (sortDirection.value === "desc") {
      sortDirection.value = null;
      sortKey.value = "";
    } else {
      sortDirection.value = "asc";
    }
  } else {
    sortKey.value = column.key;
    sortDirection.value = "asc";
  }
  emit("sort", sortKey.value, sortDirection.value);
}

function getSortClass(column: ColumnDef) {
  if (sortKey.value !== column.key) return "";
  return sortDirection.value === "asc" ? "sort-asc" : "sort-desc";
}
</script>

<template>
  <div class="border border-border-default rounded-lg overflow-hidden bg-bolt-card">
    <div class="overflow-x-auto table-scrollable">
      <table class="data-table">
        <thead>
          <tr>
            <th v-if="selectable" class="w-8">
              <input
                type="checkbox"
                class="w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600"
                :checked="allSelected"
                @change="toggleSelectAll"
              />
            </th>
            <th
              v-for="column in columns"
              :key="column.key"
              :class="[column.sortable ? 'sortable' : '', getSortClass(column)]"
              :style="{ textAlign: column.align || 'left' }"
              @click="handleSort(column)"
            >
              {{ column.label }}
              <span v-if="column.schemaType" class="schema-col">{{ column.schemaType }}</span>
              <svg
                v-if="column.sortable"
                class="sort-icon w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
              </svg>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIndex) in rows"
            :key="rowIndex"
            :class="{ 'hover:bg-bolt-hover transition-colors': hoverable, 'row-modified': row.__modified }"
          >
            <td v-if="selectable">
              <input
                type="checkbox"
                class="row-check w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600"
                :checked="selectedRows.has(rowIndex)"
                @change="toggleRow(rowIndex)"
              />
            </td>
            <td
              v-for="column in columns"
              :key="column.key"
              :style="{ textAlign: column.align || 'left' }"
            >
              <slot :name="`cell-${column.key}`" :row="row" :index="rowIndex">
                <span v-if="row[column.key] === null || row[column.key] === undefined">
                  <span class="text-text-muted italic">null</span>
                </span>
                <span v-else-if="typeof row[column.key] === 'boolean'">
                  {{ row[column.key] ? "Yes" : "No" }}
                </span>
                <span v-else>{{ row[column.key] }}</span>
              </slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script lang="ts">
import { computed } from "vue";
</script>
