<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const { apiRequest } = useConnection();
const router = useRouter();

const databases = ref<any[]>([]);
const loading = ref(true);
const showCreate = ref(false);
const showImport = ref(false);
const newName = ref("");
const importFile = ref<File | null>(null);
const importName = ref("");
const importing = ref(false);
const exporting = ref<string | null>(null);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    databases.value = (await apiRequest("GET", "/api/databases")) ?? [];
  } catch (e: any) {
    alert(e.message);
  } finally {
    loading.value = false;
  }
}

async function createDb() {
  try {
    await apiRequest("POST", "/api/databases", { name: newName.value });
    showCreate.value = false;
    newName.value = "";
    await load();
  } catch (e: any) {
    alert(e.message);
  }
}

async function deleteDb(name: string) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    await apiRequest("DELETE", `/api/databases/${name}`);
    await load();
  } catch (e: any) {
    alert(e.message);
  }
}

async function importDb() {
  if (!importFile.value || importing.value) return;
  importing.value = true;
  try {
    const form = new FormData();
    form.append("file", importFile.value);
    if (importName.value) form.append("name", importName.value);
    const { state } = useConnection();
    const res = await globalThis.fetch(`${state.baseUrl}/api/databases/import`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${state.token}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = "Import failed";
      try { msg = JSON.parse(text)?.error?.message || msg; } catch {}
      throw new Error(msg);
    }
    showImport.value = false;
    importFile.value = null;
    importName.value = "";
    await load();
  } catch (e: any) {
    alert(e.message);
  } finally {
    importing.value = false;
  }
}

async function exportDb(name: string) {
  if (exporting.value) return;
  exporting.value = name;
  try {
    const { state } = useConnection();
    const res = await globalThis.fetch(`${state.baseUrl}/api/databases/${name}/export`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${state.token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      let msg = "Export failed";
      try { msg = JSON.parse(text)?.error?.message || msg; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.db`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    alert(e.message);
  } finally {
    exporting.value = null;
  }
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-2xl font-semibold text-gray-100">Databases</h1>
      <div class="flex gap-3">
        <button @click="showImport = true" :disabled="importing" class="btn-secondary">{{ importing ? "Importing..." : "Import" }}</button>
        <button @click="showCreate = true" class="btn-primary">+ Create</button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-20 text-gray-500 text-sm">Loading...</div>

    <div v-else-if="databases.length === 0" class="text-center py-20">
      <div class="w-16 h-16 rounded-2xl bg-gray-900 flex items-center justify-center mx-auto mb-4 border border-gray-800">
        <svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
      </div>
      <p class="text-sm text-gray-500 mb-1">No databases</p>
      <p class="text-xs text-gray-600 mb-4">Create your first database to get started</p>
      <button @click="showCreate = true" class="btn-primary">Create Database</button>
    </div>

    <div v-else class="db-grid">
      <div v-for="db in databases" :key="db.name" class="db-card">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gray-800 flex items-center justify-center">
              <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4"/></svg>
            </div>
            <div>
              <p class="text-sm font-medium text-gray-200">{{ db.name }}</p>
              <p class="text-xs text-gray-600">{{ db.createdAt ? new Date(db.createdAt).toLocaleDateString() : '' }}</p>
            </div>
          </div>
          <div class="flex gap-1">
            <button @click.stop="exportDb(db.name)" :disabled="exporting !== null" title="Export" class="icon-btn">
              <svg v-if="exporting === db.name" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
            </button>
            <button @click.stop="deleteDb(db.name)" title="Delete" class="icon-btn text-red-400 hover:text-red-300"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>
          </div>
        </div>
        <button @click="router.push(`/databases/${db.name}`)" class="w-full mt-2 text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors">Manage</button>
      </div>
    </div>

    <!-- Create Modal -->
    <div v-if="showCreate" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showCreate = false">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-sm">
        <h3 class="text-sm font-medium text-gray-200 mb-4">Create Database</h3>
        <input v-model="newName" @keyup.enter="createDb" class="input mb-4" placeholder="my-database" autofocus />
        <div class="flex gap-3 justify-end">
          <button @click="showCreate = false" class="btn-secondary">Cancel</button>
          <button @click="createDb" class="btn-primary">Create</button>
        </div>
      </div>
    </div>

    <!-- Import Modal -->
    <div v-if="showImport" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" @click.self="showImport = false">
      <div class="bg-gray-900 border border-gray-800 rounded-xl p-6 w-full max-w-sm">
        <h3 class="text-sm font-medium text-gray-200 mb-4">Import Database</h3>
        <input type="file" accept=".db,.sqlite,.sqlite3" @change="(e: any) => importFile = e.target.files?.[0] || null" class="text-sm text-gray-400 mb-1 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-gray-800 file:text-gray-300 hover:file:bg-gray-700" />
        <p class="text-xs text-gray-600 mb-3">Accepted: .db, .sqlite, .sqlite3</p>
        <input v-model="importName" class="input mb-4" placeholder="Database name (optional)" />
        <div class="flex gap-3 justify-end">
          <button @click="showImport = false" class="btn-secondary">Cancel</button>
          <button @click="importDb" :disabled="importing" class="btn-primary">{{ importing ? "Importing..." : "Import" }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

