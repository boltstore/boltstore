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

    <CreateDatabaseModal :show="showCreateModal" @close="showCreateModal = false" @created="onDatabaseCreated" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue"
import { useRouter } from "vue-router"
import { useSidebar } from "../../composables/useSidebar"
import { hasSession } from "../../api/client"
import Sidebar from "./Sidebar.vue"
import MobileOverlay from "./MobileOverlay.vue"
import GithubBadge from "../ui/GithubBadge.vue"
import CreateDatabaseModal from "../database/CreateDatabaseModal.vue"

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
const router = useRouter()
const showCreateModal = ref(false)

function handleCreateDatabase() {
  showCreateModal.value = true
}

function onDatabaseCreated(name: string) {
  showCreateModal.value = false
  router.push(`/databases/${name}`)
}

onMounted(() => {
  if (!hasSession()) router.push("/login")
})
</script>
