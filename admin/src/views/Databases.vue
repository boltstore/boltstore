<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useConnection } from "../stores/client";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import Modal from "../components/ui/Modal.vue";
import { useSidebar } from "../composables/useSidebar";

const { apiRequest } = useConnection();
const { toggleSidebar } = useSidebar();

const router = useRouter();
const showCreateModal = ref(false);
const loading = ref(true);

interface DbEntry {
  name: string;
  created_at: string;
  path: string;
}

const databases = ref<DbEntry[]>([]);
const newDbName = ref("");
const createError = ref("");

onMounted(async () => {
  try {
    const res = await apiRequest<{ data: DbEntry[]; meta?: { total: number } }>("GET", "/api/databases");
    databases.value = res.data ?? [];
  } catch {
    // Keep empty
  }
  loading.value = false;
});

async function handleCreate() {
  if (!newDbName.value.trim()) return;
  createError.value = "";
  try {
    await apiRequest("POST", "/api/databases", { name: newDbName.value.trim() });
    const res = await apiRequest<{ data: DbEntry[] }>("GET", "/api/databases");
    databases.value = res.data ?? [];
    showCreateModal.value = false;
    newDbName.value = "";
  } catch (e) {
    createError.value = e instanceof Error ? e.message : "Failed to create database";
  }
}
</script>

<template>
  <AppLayout>
    <header class="h-14 border-b border-border-default flex items-center justify-between px-4 sm:px-6 bg-bolt-base/80 backdrop-blur-sm sticky top-0 z-30">
      <div class="flex items-center gap-2 text-sm">
        <button class="md:hidden p-1 text-text-muted hover:text-text-primary transition-colors" @click="toggleSidebar">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <span class="text-text-primary">Databases</span>
      </div>
      <div class="flex items-center gap-3"></div>
    </header>

    <div class="p-4 sm:p-6 max-w-6xl mx-auto">
      <!-- Database Table -->
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div v-if="loading" class="flex items-center justify-center py-12">
          <div class="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
        </div>
        <div v-else-if="databases.length === 0" class="text-center py-12 text-sm text-text-muted">
          No databases yet.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border-default">
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Name</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Created</th>
                <th class="text-center px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Status</th>
                <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="db in databases"
                :key="db.name"
                class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
              >
                <td class="px-5 py-3">
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                    <span class="font-medium text-text-primary">{{ db.name }}</span>
                  </div>
                </td>
                <td class="px-5 py-3 text-text-secondary text-xs">{{ db.created_at }}</td>
                <td class="px-5 py-3 text-center">
                  <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
                </td>
                <td class="px-5 py-3 text-right">
                  <button class="btn-secondary btn-sm flex items-center gap-1 inline-flex" @click="router.push(`/databases/${db.name}`)">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
                    </svg>
                    Manage
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between px-5 py-3 border-t border-border-default">
          <div class="text-xs text-text-muted">Showing {{ databases.length }} of {{ databases.length }} databases</div>
          <div class="flex items-center gap-2">
            <button class="btn-secondary btn-sm" @click="showCreateModal = true">+ New Database</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create Database Modal -->
    <Modal :show="showCreateModal" @close="showCreateModal = false">
      <div class="px-5 py-4 border-b border-border-default flex items-center justify-between">
        <div class="text-sm font-medium text-text-primary">Create Database</div>
        <button class="text-text-muted hover:text-text-primary transition-colors" @click="showCreateModal = false">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="p-5 space-y-4">
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Database Name</label>
          <input v-model="newDbName" type="text" class="input-field" placeholder="e.g., my-app-prod" @keyup.enter="handleCreate" />
          <p class="text-xs text-text-muted mt-1">Lowercase letters, numbers, hyphens, and underscores only.</p>
        </div>
        <p v-if="createError" class="text-xs text-red-400">{{ createError }}</p>
      </div>
      <div class="px-5 py-4 border-t border-border-default flex items-center justify-end gap-2">
        <button class="btn-secondary" @click="showCreateModal = false">Cancel</button>
        <button class="btn-primary" @click="handleCreate">Create Database</button>
      </div>
    </Modal>

    <GithubBadge />
  </AppLayout>
</template>
