<template>
  <AppLayout title="Settings" container-class="p-4 sm:p-6 max-w-3xl mx-auto">
    <div class="border-b border-border-default mb-6 flex items-center gap-1">
      <router-link
        v-for="tab in tabs"
        :key="tab.id"
        :to="`/settings/${tab.id}`"
        class="nav-tab"
        :class="{ active: activeTab === tab.id }"
      >
        {{ tab.label }}
      </router-link>
    </div>

    <div v-show="activeTab === 'general'" class="space-y-6">
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Project Info</h3>
        <div class="p-5 pt-4 space-y-4">
          <div>
            <label class="label">Project Name</label>
            <input type="text" class="input-field" value="default">
            <p class="description">This is the name displayed in the dashboard and API responses.</p>
          </div>
          <div>
            <label class="label">Project ID</label>
            <input type="text" class="input-field" value="proj_2f9a8b1c4e5d6f7g" readonly>
            <p class="description">Unique identifier for this project. Cannot be changed.</p>
          </div>
          <div>
            <label class="label">Timezone</label>
            <select class="input-field appearance-none" style="font-family:Inter">
              <option>UTC</option>
              <option>America/New_York</option>
              <option>Europe/London</option>
              <option>Asia/Tokyo</option>
            </select>
          </div>
        </div>
      </div>
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Notifications</h3>
        <div class="p-5 pt-4 space-y-4">
          <div v-for="n in notifications" :key="n.label" class="flex items-center justify-between">
            <div>
              <div class="text-sm text-text-primary">{{ n.label }}</div>
              <div class="description">{{ n.description }}</div>
            </div>
            <ToggleSwitch v-model="n.value" />
          </div>
        </div>
      </div>
      <div class="flex items-center justify-end gap-3">
        <button class="btn-secondary">Cancel</button>
        <button class="btn-primary">Save Changes</button>
      </div>
    </div>

    <div v-show="activeTab === 'security'" class="space-y-6">
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Authentication</h3>
        <div class="p-5 pt-4 space-y-4">
          <div v-for="a in auth" :key="a.label" class="flex items-center justify-between">
            <div>
              <div class="text-sm text-text-primary">{{ a.label }}</div>
              <div class="description">{{ a.description }}</div>
            </div>
            <ToggleSwitch v-model="a.value" />
          </div>
        </div>
      </div>
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">API Keys</h3>
        <div class="p-5 pt-4 space-y-3">
          <div v-for="k in apiKeys" :key="k.name" class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-subtle rounded-md">
            <div>
              <div class="text-xs font-medium text-text-primary">{{ k.name }}</div>
              <div class="text-xs text-text-muted font-mono mt-0.5">{{ k.key }}</div>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant="green">Active</Badge>
              <button class="btn-secondary btn-sm">Revoke</button>
            </div>
          </div>
        </div>
        <div class="px-5 pb-5">
          <button class="btn-secondary btn-sm flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Generate New Key
          </button>
        </div>
      </div>
      <div class="bg-bolt-card border border-red-500/75 rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-red-400 px-5 py-4 border-b border-red-500/50">Danger Zone</h3>
        <div class="p-5 pt-4 space-y-4">
          <div class="flex items-center justify-between p-3 border border-red-500/20 rounded-md bg-red-500/5">
            <div>
              <div class="text-xs font-medium text-red-400">Delete Project</div>
              <div class="description">This will permanently delete all databases, data, and settings. This action cannot be undone.</div>
            </div>
            <button class="btn-danger btn-sm" @click="showDeleteProjectModal = true">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'integrations'" class="space-y-6">
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Connected Services</h3>
        <div class="p-5 pt-4 space-y-3">
          <div class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-subtle rounded-md">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-md bg-bolt-hover flex items-center justify-center">
                <svg class="w-4 h-4 text-text-primary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              </div>
              <div>
                <div class="text-xs font-medium text-text-primary">GitHub</div>
                <div class="text-xs text-text-muted">Connected as gremdev</div>
              </div>
            </div>
            <button class="btn-secondary btn-sm">Disconnect</button>
          </div>
          <div class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-subtle rounded-md">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-md bg-bolt-hover flex items-center justify-center">
                <svg class="w-4 h-4 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/></svg>
              </div>
              <div>
                <div class="text-xs font-medium text-text-primary">Discord</div>
                <div class="text-xs text-text-muted">Not connected</div>
              </div>
            </div>
            <button class="btn-primary btn-sm">Connect</button>
          </div>
        </div>
      </div>
      <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
        <h3 class="text-sm font-medium text-text-primary px-5 py-4 border-b border-border-default">Webhooks</h3>
        <div class="p-5 pt-4 space-y-3">
          <div class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-subtle rounded-md">
            <div>
              <div class="text-xs font-medium text-text-primary">Database Events</div>
              <div class="text-xs text-text-muted font-mono mt-0.5">https://api.example.com/webhooks/db</div>
            </div>
            <div class="flex items-center gap-2">
              <Badge variant="green">Active</Badge>
              <button class="btn-secondary btn-sm">Edit</button>
            </div>
          </div>
        </div>
        <div class="px-5 pb-5">
          <button class="btn-secondary btn-sm flex items-center gap-1">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add Webhook
          </button>
        </div>
      </div>
    </div>
  </AppLayout>

  <div
    class="fixed inset-0 z-50"
    :class="showDeleteProjectModal ? 'flex items-center justify-center' : 'hidden'"
    style="background: rgba(0,0,0,0.6);"
    @click="showDeleteProjectModal = false"
  >
    <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
          <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-medium text-text-primary">Delete Project</h3>
          <p class="text-xs text-red-400 mt-0.5">This action is permanent. All data will be removed.</p>
        </div>
      </div>
      <div class="p-3 bg-bolt-elevated border border-border-default rounded-md mb-4 text-xs text-text-muted">
        Are you sure you want to delete this project? This will permanently delete all databases, data, and settings. This cannot be undone.
      </div>
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost btn-sm" @click="showDeleteProjectModal = false">Cancel</button>
        <button class="btn-primary btn-sm bg-red-600 hover:bg-red-500 border-red-500/50">Delete Project</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, onMounted, onUnmounted } from "vue"
import { useRoute } from "vue-router"
import AppLayout from "../components/layout/AppLayout.vue"
import ToggleSwitch from "../components/ui/ToggleSwitch.vue"
import Badge from "../components/ui/Badge.vue"

const route = useRoute()
const activeTab = computed(() => route.params.tab as string || "general")
const tabs = [
  { id: "general", label: "General" },
  { id: "security", label: "Security" },
  { id: "integrations", label: "Integrations" },
]

const notifications = reactive([
  { label: "Email Alerts", description: "Receive email notifications for critical events", value: true },
  { label: "Usage Warnings", description: "Get notified when approaching storage limits", value: true },
  { label: "Weekly Reports", description: "Receive a summary of activity each week", value: false },
])

const auth = reactive([
  { label: "Two-Factor Authentication", description: "Require 2FA for all admin access", value: false },
  { label: "Session Timeout", description: "Automatically sign out after 24 hours of inactivity", value: true },
])

const apiKeys = [
  { name: "Production Key", key: "bsk_prod_...xxxx" },
  { name: "Development Key", key: "bsk_dev_...xxxx" },
]

const showDeleteProjectModal = ref(false)

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && showDeleteProjectModal.value) showDeleteProjectModal.value = false
}

onMounted(() => window.addEventListener("keydown", onKeyDown, { capture: true }))
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
</script>
