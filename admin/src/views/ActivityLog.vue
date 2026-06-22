<script setup lang="ts">
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import { useSidebar } from "../composables/useSidebar";

const { toggleSidebar } = useSidebar();

const activityLogs = [
  { timestamp: "2024-01-15 14:32:01", action: "Database Created", database: "callcenterninja", details: "Created by admin" },
  { timestamp: "2024-01-15 14:28:45", action: "Query Executed", database: "app-production", details: "SELECT * FROM users" },
  { timestamp: "2024-01-15 14:15:22", action: "Database Deleted", database: "test-db", details: "Deleted by admin" },
  { timestamp: "2024-01-15 13:58:10", action: "Query Executed", database: "callcenterninja", details: "UPDATE crawler_sources SET status = 'active'" },
  { timestamp: "2024-01-15 13:45:33", action: "Database Created", database: "analytics-staging", details: "Created by admin" },
  { timestamp: "2024-01-15 13:22:18", action: "Query Executed", database: "app-production", details: "INSERT INTO jobs (title, url) VALUES (...)" },
  { timestamp: "2024-01-15 12:56:44", action: "Settings Updated", database: "-", details: "Timezone changed to UTC" },
  { timestamp: "2024-01-15 12:34:09", action: "Query Executed", database: "callcenterninja", details: "DELETE FROM jobs WHERE status = 'expired'" },
  { timestamp: "2024-01-15 12:11:27", action: "Database Created", database: "app-production", details: "Created by admin" },
  { timestamp: "2024-01-15 11:48:55", action: "Query Executed", database: "analytics-staging", details: "SELECT COUNT(*) FROM events" },
];
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
          <option>Query Executed</option>
          <option>Settings Updated</option>
        </select>
        <input type="text" class="input-field text-xs py-2 px-3" placeholder="Filter by database..." />
      </div>

      <!-- Activity Table -->
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <div class="overflow-x-auto">
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
                :key="log.timestamp"
                class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
              >
                <td class="px-5 py-3 text-text-secondary font-mono text-xs">{{ log.timestamp }}</td>
                <td class="px-5 py-3">
                  <span
                    class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border"
                    :class="{
                      'bg-green-500/10 text-green-400 border-green-500/20': log.action === 'Database Created',
                      'bg-red-500/10 text-red-400 border-red-500/20': log.action === 'Database Deleted',
                      'bg-accent-600/10 text-accent-400 border-accent-600/20': log.action === 'Query Executed',
                      'bg-yellow-500/10 text-yellow-400 border-yellow-500/20': log.action === 'Settings Updated',
                    }"
                  >
                    {{ log.action }}
                  </span>
                </td>
                <td class="px-5 py-3 text-text-secondary">{{ log.database }}</td>
                <td class="px-5 py-3 text-text-muted text-xs">{{ log.details }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <GithubBadge />
  </AppLayout>
</template>
