<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const route = useRoute();
const router = useRouter();
const { apiRequest } = useConnection();

const dbName = computed(() => route.params.name as string);
const tables = ref<string[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const newTable = ref({ name: "", columns: [{ name: "", type: "text" as const }] });

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const info = await apiRequest("GET", `/api/databases/${dbName.value}`);
    tables.value = info?.tables ?? [];
  } catch (e) {
    console.error(e);
  } finally {
    loading.value = false;
  }
}

async function createTable() {
  try {
    await apiRequest("POST", `/api/databases/${dbName.value}/tables`, {
      name: newTable.value.name,
      columns: newTable.value.columns.filter((c: any) => c.name),
    });
    showCreate.value = false;
    newTable.value = { name: "", columns: [{ name: "", type: "text" as const }] };
    await load();
  } catch (e: any) {
    alert(e.message);
  }
}

function addColumn() {
  newTable.value.columns.push({ name: "", type: "text" as const });
}

async function deleteTable(name: string) {
  if (!confirm(`Delete table "${name}"?`)) return;
  try {
    await apiRequest("DELETE", `/api/databases/${dbName.value}/tables/${name}`);
    await load();
  } catch (e: any) {
    alert(e.message);
  }
}
</script>

<template>
  <div>
    <button @click="router.push('/databases')" class="text-xs text-gray-500 hover:text-gray-300 mb-4 flex items-center gap-1">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      Databases
    </button>
    <div class="flex items-center justify-between mb-2">
      <h1 class="text-2xl font-semibold text-gray-100">{{ dbName }}</h1>
      <div class="flex gap-2">
        <button @click="router.push(`/databases/${dbName}/sql`)" class="btn-tab">SQL Console</button>
        <button @click="router.push(`/databases/${dbName}/settings`)" class="btn-tab">Settings</button>
      </div>
    </div>

    <div v-if="!route.path.endsWith('/sql') && !route.path.endsWith('/settings')">
      <p v-if="tables.length > 0" class="text-xs text-gray-600 mb-6">{{ tables.length }} table(s)</p>

      <div v-if="loading" class="text-center py-16 text-gray-500 text-sm">Loading...</div>

      <div v-else class="space-y-1">
        <div v-for="t in tables" :key="t" class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-900 hover:bg-gray-800 border border-gray-800 transition-colors cursor-pointer" @click="router.push(`/databases/${dbName}/tables/${t}`)">
          <span class="text-sm text-gray-200">{{ t }}</span>
          <div class="flex gap-3">
            <button @click.stop="router.push(`/databases/${dbName}/tables/${t}`)" class="text-xs text-accent-400 hover:text-accent-300">Browse</button>
            <button @click.stop="deleteTable(t)" class="text-xs text-red-400 hover:text-red-300">Delete</button>
          </div>
        </div>
        <div v-if="tables.length === 0 && !loading" class="text-center py-16">
          <p class="text-sm text-gray-600 mb-4">No tables yet</p>
          <button @click="showCreate = true" class="btn-primary">Create Table</button>
        </div>
      </div>
    </div>

    <!-- Nested route for SQL/Settings -->
    <router-view :dbName="dbName" />

    <!-- Create modal -->
    <div v-if="showCreate" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showCreate = false">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-md">
        <h3 class="text-sm font-medium text-gray-200 mb-4">Create Table</h3>
        <input v-model="newTable.name" class="input mb-4" placeholder="Table name" />
        <div v-for="(col, i) in newTable.columns" :key="i" class="flex gap-2 mb-2">
          <input v-model="col.name" class="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-accent-500" placeholder="Column name" />
          <select v-model="col.type" class="w-28 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-accent-500">
            <option value="text">text</option>
            <option value="integer">integer</option>
            <option value="real">real</option>
            <option value="boolean">boolean</option>
          </select>
        </div>
        <button @click="addColumn" class="text-xs text-accent-400 mb-4">+ Add column</button>
        <div class="flex gap-3 justify-end">
          <button @click="showCreate = false" class="btn-sm-secondary">Cancel</button>
          <button @click="createTable" class="btn-sm-primary">Create</button>
        </div>
      </div>
    </div>
  </div>
</template>

