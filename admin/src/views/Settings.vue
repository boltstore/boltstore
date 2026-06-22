<script setup lang="ts">
import { ref } from "vue";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import ToggleSwitch from "../components/ui/ToggleSwitch.vue";
import { useSidebar } from "../composables/useSidebar";

const { toggleSidebar } = useSidebar();

const activeTab = ref("general");

const settings = ref({
  projectName: "default",
  projectId: "proj_2f9a8b1c4e5d6f7g",
  timezone: "UTC",
  emailAlerts: true,
  usageWarnings: true,
  weeklyReports: false,
  twoFactor: false,
  sessionTimeout: true,
});

const apiKeys = [
  { name: "Production Key", value: "bsk_prod_...xxxx", status: "Active" },
  { name: "Development Key", value: "bsk_dev_...xxxx", status: "Active" },
];

const integrations = [
  { name: "GitHub", connected: true, username: "gremdev" },
  { name: "Discord", connected: false, username: "" },
];

const webhooks = [
  { name: "Database Events", url: "https://api.example.com/webhooks/db", status: "Active" },
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
        <span class="text-text-primary">Settings</span>
      </div>
      <div class="flex items-center gap-3"></div>
    </header>

    <div class="p-4 sm:p-6 max-w-3xl mx-auto">
      <!-- Tabs -->
      <div class="flex gap-1 mb-6 border-b border-border-default pb-1">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'general' }"
          @click="activeTab = 'general'"
        >General</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'security' }"
          @click="activeTab = 'security'"
        >Security</button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'integrations' }"
          @click="activeTab = 'integrations'"
        >Integrations</button>
      </div>

      <!-- General Settings -->
      <div v-show="activeTab === 'general'" class="space-y-6">
        <div class="bg-bolt-card border border-border-default rounded-lg p-5">
          <h3 class="text-sm font-medium text-text-primary mb-4">Project Info</h3>
          <div class="space-y-4">
            <div>
              <label class="form-group label">Project Name</label>
              <input v-model="settings.projectName" type="text" class="input-field" />
              <p class="form-group hint">This is the name displayed in the dashboard and API responses.</p>
            </div>
            <div>
              <label class="form-group label">Project ID</label>
              <input v-model="settings.projectId" type="text" class="input-field" readonly />
              <p class="form-group hint">Unique identifier for this project. Cannot be changed.</p>
            </div>
            <div>
              <label class="form-group label">Timezone</label>
              <select v-model="settings.timezone" class="input-field appearance-none" style="font-family: Inter;">
                <option>UTC</option>
                <option>America/New_York</option>
                <option>Europe/London</option>
                <option>Asia/Tokyo</option>
              </select>
            </div>
          </div>
        </div>

        <div class="bg-bolt-card border border-border-default rounded-lg p-5">
          <h3 class="text-sm font-medium text-text-primary mb-4">Notifications</h3>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm text-text-primary">Email Alerts</div>
                <div class="form-group hint">Receive email notifications for critical events</div>
              </div>
              <ToggleSwitch v-model="settings.emailAlerts" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm text-text-primary">Usage Warnings</div>
                <div class="form-group hint">Get notified when approaching storage limits</div>
              </div>
              <ToggleSwitch v-model="settings.usageWarnings" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm text-text-primary">Weekly Reports</div>
                <div class="form-group hint">Receive a summary of activity each week</div>
              </div>
              <ToggleSwitch v-model="settings.weeklyReports" />
            </div>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3">
          <button class="btn-secondary">Cancel</button>
          <button class="btn-primary">Save Changes</button>
        </div>
      </div>

      <!-- Security Settings -->
      <div v-show="activeTab === 'security'" class="space-y-6">
        <div class="bg-bolt-card border border-border-default rounded-lg p-5">
          <h3 class="text-sm font-medium text-text-primary mb-4">Authentication</h3>
          <div class="space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm text-text-primary">Two-Factor Authentication</div>
                <div class="form-group hint">Require 2FA for all admin access</div>
              </div>
              <ToggleSwitch v-model="settings.twoFactor" />
            </div>
            <div class="flex items-center justify-between">
              <div>
                <div class="text-sm text-text-primary">Session Timeout</div>
                <div class="form-group hint">Automatically sign out after 24 hours of inactivity</div>
              </div>
              <ToggleSwitch v-model="settings.sessionTimeout" />
            </div>
          </div>
        </div>

        <div class="bg-bolt-card border border-border-default rounded-lg p-5">
          <h3 class="text-sm font-medium text-text-primary mb-4">API Keys</h3>
          <div class="space-y-3">
            <div
              v-for="key in apiKeys"
              :key="key.name"
              class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-default rounded-md"
            >
              <div>
                <div class="text-xs font-medium text-text-primary">{{ key.name }}</div>
                <div class="text-xs text-text-muted font-mono mt-0.5">{{ key.value }}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge badge-green">{{ key.status }}</span>
                <button class="btn-secondary btn-sm">Revoke</button>
              </div>
            </div>
          </div>
          <div class="mt-3">
            <button class="btn-secondary btn-sm flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Generate New Key
            </button>
          </div>
        </div>

        <div class="bg-bolt-card border border-red-500/75 rounded-lg p-5">
          <h3 class="text-sm font-medium text-red-400 mb-4">Danger Zone</h3>
          <div class="space-y-4">
            <div class="flex items-center justify-between p-3 border border-red-500/20 rounded-md bg-red-500/5">
              <div>
                <div class="text-xs font-medium text-red-400">Delete Project</div>
                <div class="form-group hint">This will permanently delete all databases, data, and settings. This action cannot be undone.</div>
              </div>
              <button class="btn-danger btn-sm">Delete</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Integrations Settings -->
      <div v-show="activeTab === 'integrations'" class="space-y-6">
        <div class="bg-bolt-card border border-border-default rounded-lg p-5">
          <h3 class="text-sm font-medium text-text-primary mb-4">Connected Services</h3>
          <div class="space-y-3">
            <div
              v-for="integration in integrations"
              :key="integration.name"
              class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-default rounded-md"
            >
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 rounded-md bg-bolt-hover flex items-center justify-center">
                  <svg v-if="integration.name === 'GitHub'" class="w-4 h-4 text-text-primary" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                  </svg>
                  <svg v-else class="w-4 h-4 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z"/>
                  </svg>
                </div>
                <div>
                  <div class="text-xs font-medium text-text-primary">{{ integration.name }}</div>
                  <div class="text-xs text-text-muted">
                    {{ integration.connected ? `Connected as ${integration.username}` : "Not connected" }}
                  </div>
                </div>
              </div>
              <button :class="integration.connected ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'">
                {{ integration.connected ? "Disconnect" : "Connect" }}
              </button>
            </div>
          </div>
        </div>

        <div class="bg-bolt-card border border-border-default rounded-lg p-5">
          <h3 class="text-sm font-medium text-text-primary mb-4">Webhooks</h3>
          <div class="space-y-3">
            <div
              v-for="webhook in webhooks"
              :key="webhook.name"
              class="flex items-center justify-between p-3 bg-bolt-elevated border border-border-default rounded-md"
            >
              <div>
                <div class="text-xs font-medium text-text-primary">{{ webhook.name }}</div>
                <div class="text-xs text-text-muted font-mono mt-0.5">{{ webhook.url }}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="badge badge-green">{{ webhook.status }}</span>
                <button class="btn-secondary btn-sm">Edit</button>
              </div>
            </div>
          </div>
          <div class="mt-3">
            <button class="btn-secondary btn-sm flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
              </svg>
              Add Webhook
            </button>
          </div>
        </div>
      </div>
    </div>

    <GithubBadge />
  </AppLayout>
</template>
