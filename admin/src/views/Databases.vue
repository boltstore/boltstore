<template>
  <AppLayout title="Databases">
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
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="db in databases" :key="db.name" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <div class="w-2 h-2 rounded-full bg-accent-400"></div>
                  <span class="font-medium text-text-primary">{{ db.name }}</span>
                </div>
              </td>
              <td class="px-5 py-3 text-text-secondary text-center">{{ db.rowsRead }}</td>
              <td class="px-5 py-3 text-text-secondary text-center">{{ db.rowsWritten }}</td>
              <td class="px-5 py-3 text-text-secondary text-center">{{ db.storage }}</td>
              <td class="px-5 py-3 text-center">
                <span class="inline-flex items-center gap-1 text-xs text-text-secondary">
                  <span class="w-2 h-2 rounded-sm" :class="db.groupColor"></span>
                  {{ db.group }}
                </span>
              </td>
              <td class="px-5 py-3 text-center">
                <Badge variant="green">Active</Badge>
              </td>
              <td class="px-5 py-3 text-right">
                <router-link :to="'/databases/' + db.name" class="btn-secondary btn-sm flex items-center gap-1 inline-flex">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  Manage
                </router-link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="flex items-center justify-between px-5 py-3 border-t border-border-default">
        <div class="text-xs text-text-muted">Showing 3 of 3 databases</div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary btn-sm opacity-50 cursor-not-allowed">Previous</button>
          <button class="btn-secondary btn-sm opacity-50 cursor-not-allowed">Next</button>
        </div>
      </div>
    </div>

    <div class="modal-overlay" :class="{ show: showCreate }" @click="showCreate = false">
      <div class="modal">
        <div class="px-5 py-4 border-b border-border-default flex items-center justify-between">
          <div class="text-sm font-medium text-text-primary">Create Database</div>
          <button class="text-text-muted hover:text-text-primary transition-colors" @click="showCreate = false">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="p-5 space-y-4">
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1.5">Database Name</label>
            <input type="text" class="input-field" placeholder="e.g., my-app-prod">
          </div>
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1.5">Group</label>
            <select class="input-field appearance-none">
              <option>default</option>
              <option>production</option>
              <option>staging</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1.5">Region</label>
            <select class="input-field appearance-none">
              <option>Auto (closest)</option>
              <option>US East (N. Virginia)</option>
              <option>EU West (Ireland)</option>
              <option>Asia Pacific (Tokyo)</option>
            </select>
          </div>
          <div class="flex items-start gap-2">
            <input type="checkbox" id="seed" class="mt-0.5 w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600">
            <label for="seed" class="text-xs text-text-secondary">Seed with sample data (useful for testing)</label>
          </div>
        </div>
        <div class="px-5 py-4 border-t border-border-default flex items-center justify-end gap-2">
          <button class="btn-secondary" @click="showCreate = false">Cancel</button>
          <button class="btn-primary" @click="showCreate = false">Create Database</button>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"
import Badge from "../components/ui/Badge.vue"

const showCreate = ref(false)

const databases = [
  { name: "callcenterninja", rowsRead: "528,001,446", rowsWritten: "9,851", storage: "14.79 MB", group: "default", groupColor: "bg-red-400" },
  { name: "app-production", rowsRead: "2,145,302", rowsWritten: "4,221", storage: "3.12 MB", group: "production", groupColor: "bg-blue-400" },
  { name: "analytics-staging", rowsRead: "45,892", rowsWritten: "1,034", storage: "856 KB", group: "staging", groupColor: "bg-yellow-400" },
]
</script>
