<template>
  <div class="bg-bolt-base text-text-primary">
    <Sidebar @create-database="handleCreateDatabase" />
    <MobileOverlay />
    <main class="main-content">
      <header
        class="h-14 border-b border-border-default flex items-center justify-between px-4 sm:px-6 bg-bolt-base/80 backdrop-blur-sm sticky top-0 z-30"
      >
        <div class="flex items-center gap-2 text-sm">
          <button
            class="md:hidden p-1 text-text-muted hover:text-text-primary transition-colors"
            @click="toggleSidebar"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <slot name="header-left">
            <span class="text-text-primary">{{ title }}</span>
          </slot>
        </div>
        <div class="flex items-center gap-3">
          <slot name="header-right" />
        </div>
      </header>
      <div class="p-4 sm:p-6" :class="containerClass">
        <slot />
      </div>
    </main>
    <GithubBadge />

    <div
      class="fixed inset-0 z-50"
      :class="showCreateModal ? 'flex items-center justify-center' : 'hidden'"
      style="background: rgba(0,0,0,0.6);"
      @click="showCreateModal = false"
    >
      <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-full bg-accent-600/10 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          </div>
          <div>
            <h3 class="text-sm font-medium text-text-primary">Create Database</h3>
            <p class="text-xs text-text-muted mt-0.5">Add a new database to your project.</p>
          </div>
        </div>
        <div class="mb-4">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Database Name</label>
          <input type="text" class="input-field" placeholder="e.g. my-database" v-model="newDbName">
        </div>
        <div class="flex items-center justify-end gap-2">
          <button class="btn-ghost btn-sm" @click="showCreateModal = false">Cancel</button>
          <button class="btn-primary btn-sm" @click="createDatabase">Create</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue"
import { useSidebar } from "../../composables/useSidebar"
import Sidebar from "./Sidebar.vue"
import MobileOverlay from "./MobileOverlay.vue"
import GithubBadge from "../ui/GithubBadge.vue"

withDefaults(
  defineProps<{
    title?: string
    containerClass?: string
  }>(),
  {
    title: "",
    containerClass: "max-w-6xl mx-auto",
  }
)

const { toggle: toggleSidebar } = useSidebar()
const showCreateModal = ref(false)
const newDbName = ref("")

function handleCreateDatabase() {
  newDbName.value = ""
  showCreateModal.value = true
}

function createDatabase() {
  if (!newDbName.value.trim()) return
  showCreateModal.value = false
  newDbName.value = ""
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && showCreateModal.value) showCreateModal.value = false
}

onMounted(() => window.addEventListener("keydown", onKeyDown, { capture: true }))
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
</script>
