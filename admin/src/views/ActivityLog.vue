<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useConnection } from "../stores/client";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import { useSidebar } from "../composables/useSidebar";

const { apiRequest } = useConnection();
const { toggleSidebar } = useSidebar();

interface ActivityEntry {
  id: string;
  created_at: string;
  action: string;
  database_name: string | null;
  target: string | null;
  details: string | null;
  admin_id: string | null;
}

const activityLogs = ref<ActivityEntry[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await apiRequest<{ data: ActivityEntry[]; meta: { total: number } }>("GET", "/api/activity");
    activityLogs.value = res.data ?? [];
  } catch {
    // Keep empty
  }
  loading.value = false;
});

function formatAction(action: string): string {
  const map: Record<string, string> = {
    "database.create": "Database Created",
    "database.delete": "Database Deleted",
    "database.rename": "Database Renamed",
    "database.config.update": "Config Updated",
    "database.export": "Database Exported",
    "database.import": "Database Imported",
    "api_key.create": "API Key Created",
    "api_key.revoke": "API Key Revoked",
    "api_key.rotate": "API Key Rotated",
    "admin.login": "Admin Login",
    "admin.logout": "Admin Logout",
    "admin.create": "Admin Created",
  };
  return map[action] ?? action;
}

function actionClass(action: string): string {
  if (action.startsWith("database.create") || action.startsWith("admin.create")) return "bg-green-500/10 text-green-400 border-green-500/20";
  if (action.startsWith("database.delete")) return "bg-red-500/10 text-red-400 border-red-500/20";
  if (action.startsWith("admin.login") || action.startsWith("api_key")) return "bg-accent-600/10 text-accent-400 border-accent-600/20";
  return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
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
        <span class="text-text-primary">Activity Log</span>
      </div>
      <div class="flex items-center gap-3"></div>
    </header>

    <div class="p-4 sm:p-6 max-w-6xl mx-auto">
      <!-- Filters -->
      <div class="flex items-center gap-3 mb-4">
        <select class="input-field appearance-none text-xs py-2 px-3 w-auto">
          <option>All Actions</option>
          <option>Database Created</option>
          <option>Database Deleted</option>
          <option>API Key Created</option>
          <option>Admin Login</option>
        </select>
        <input type="text" class="input-field text-xs py-2 px-3" placeholder="Filter by database..." />
      </div>

      <!-- Activity Table -->
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div v-if="loading" class="flex items-center justify-center py-12">
          <div class="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin"></div>
        </div>
        <div v-else-if="activityLogs.length === 0" class="text-center py-12 text-sm text-text-muted">
          No activity logged yet.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border-default">
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Timestamp</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Action</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
                <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Details</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="log in activityLogs"
                :key="log.id"
                class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
              >
                <td class="px-5 py-3 text-text-secondary font-mono text-xs">{{ log.created_at }}</td>
                <td class="px-5 py-3">
                  <span
                    class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border"
                    :class="actionClass(log.action)"
                  >
                    {{ formatAction(log.action) }}
                  </span>
                </td>
                <td class="px-5 py-3 text-text-secondary">{{ log.database_name || "-" }}</td>
                <td class="px-5 py-3 text-text-muted text-xs">{{ log.details || "-" }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <GithubBadge />
  </AppLayout>
</template>
