<template>
  <AppLayout title="Activities">
    <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
      <div class="flex items-center justify-between px-5 py-4 border-b border-border-default">
        <div class="text-sm font-medium text-text-primary">Recent Activities</div>
        <div class="flex items-center gap-2">
          <select class="input-field text-xs py-1.5" style="width: auto; font-family: Inter;" v-model="eventFilter">
            <option value="all">All Events</option>
            <option value="query">Queries</option>
            <option value="schema">Schema</option>
            <option value="auth">Authentication</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-border-default">
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Event</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Database</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">User</th>
              <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">IP Address</th>
              <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in filteredEvents" :key="event.id" class="hover:bg-bolt-hover transition-colors">
              <td class="px-5 py-3">
                <div class="flex items-center gap-2">
                  <span class="w-6 h-6 rounded-full flex items-center justify-center" :class="event.bgClass">
                    <svg class="w-3 h-3" :class="event.iconClass" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="event.iconPath"/></svg>
                  </span>
                  <div>
                    <div class="text-xs font-medium text-text-primary">{{ event.action }}</div>
                    <div class="text-[10px] text-text-muted">{{ event.detail }}</div>
                  </div>
                </div>
              </td>
              <td class="px-5 py-3 text-xs text-text-secondary">{{ event.database }}</td>
              <td class="px-5 py-3 text-xs text-text-secondary">{{ event.user }}</td>
              <td class="px-5 py-3 text-xs font-mono text-text-muted">{{ event.ip }}</td>
              <td class="px-5 py-3 text-right text-[10px] text-text-muted">{{ event.time }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { ref, computed } from "vue"
import AppLayout from "../components/layout/AppLayout.vue"

const eventFilter = ref("all")

interface ActivityEvent {
  id: number
  action: string
  detail: string
  database: string
  user: string
  ip: string
  time: string
  type: string
  bgClass: string
  iconClass: string
  iconPath: string
}

const events: ActivityEvent[] = [
  { id: 1, action: "Logged in", detail: "Admin login", database: "—", user: "Admin", ip: "192.168.1.1", time: "2 min ago", type: "auth", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" },
  { id: 2, action: "Executed query", detail: "SELECT * FROM users JOIN orders ON users.id = orders.user_id LIMIT 50", database: "callcenterninja", user: "Admin", ip: "192.168.1.1", time: "5 min ago", type: "query", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: 3, action: "Created database", detail: "Created new database 'staging-analytics-v2'", database: "staging-analytics-v2", user: "Admin", ip: "192.168.1.1", time: "12 min ago", type: "admin", bgClass: "bg-green-500/10", iconClass: "text-green-400", iconPath: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" },
  { id: 4, action: "Altered table", detail: "ALTER TABLE users ADD COLUMN phone VARCHAR(20)", database: "app-production", user: "Admin", ip: "10.0.0.45", time: "25 min ago", type: "schema", bgClass: "bg-yellow-500/10", iconClass: "text-yellow-400", iconPath: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
  { id: 5, action: "Executed query", detail: "INSERT INTO analytics_events (event, page, referrer) VALUES (?, ?, ?)", database: "callcenterninja", user: "API Key (prod)", ip: "worker-3.prod.internal", time: "1 hour ago", type: "query", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: 6, action: "Logged in", detail: "API key authentication", database: "—", user: "API Key (prod)", ip: "worker-3.prod.internal", time: "1 hour ago", type: "auth", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" },
  { id: 7, action: "Deleted table", detail: "DROP TABLE IF EXISTS temp_import_2024", database: "analytics-staging", user: "Admin", ip: "192.168.1.1", time: "2 hours ago", type: "schema", bgClass: "bg-red-500/10", iconClass: "text-red-400", iconPath: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
  { id: 8, action: "Executed query", detail: "SELECT COUNT(*), status FROM orders GROUP BY status", database: "app-production", user: "API Key (prod)", ip: "10.0.0.100", time: "3 hours ago", type: "query", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: 9, action: "Created index", detail: "CREATE INDEX idx_orders_user_id ON orders (user_id)", database: "callcenterninja", user: "Admin", ip: "192.168.1.1", time: "4 hours ago", type: "schema", bgClass: "bg-yellow-500/10", iconClass: "text-yellow-400", iconPath: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
  { id: 10, action: "Logged out", detail: "Admin session ended", database: "—", user: "Admin", ip: "192.168.1.1", time: "5 hours ago", type: "auth", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" },
  { id: 11, action: "Executed query", detail: "UPDATE products SET price = price * 1.1 WHERE category = 'electronics'", database: "app-production", user: "API Key (prod)", ip: "10.0.0.100", time: "6 hours ago", type: "query", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: 12, action: "Deleted database", detail: "Deleted database 'old-archive-2023'", database: "old-archive-2023", user: "Admin", ip: "192.168.1.1", time: "8 hours ago", type: "admin", bgClass: "bg-red-500/10", iconClass: "text-red-400", iconPath: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
  { id: 13, action: "Generated API key", detail: "Generated new API key 'production-worker-1'", database: "callcenterninja", user: "Admin", ip: "192.168.1.1", time: "10 hours ago", type: "admin", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" },
  { id: 14, action: "Revoked API key", detail: "Revoked API key 'dev-worker-2'", database: "analytics-staging", user: "Admin", ip: "10.0.0.45", time: "1 day ago", type: "admin", bgClass: "bg-red-500/10", iconClass: "text-red-400", iconPath: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" },
  { id: 15, action: "Generated API key", detail: "Generated new API key 'staging-reader'", database: "app-production", user: "Admin", ip: "192.168.1.1", time: "2 days ago", type: "admin", bgClass: "bg-accent-600/10", iconClass: "text-accent-400", iconPath: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" },
]

const filteredEvents = computed(() => {
  if (eventFilter.value === "all") return events
  return events.filter(e => e.type === eventFilter.value)
})
</script>
