<template>
  <aside class="sidebar border-r border-border-default" :class="{ 'sidebar-open': isOpen }">
    <div class="h-14 flex items-center px-4 border-b border-border-default shrink-0">
      <router-link to="/" class="flex items-center gap-2.5">
        <svg width="24" height="24" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="7" fill="#080c14"/>
          <g transform="translate(16, 15)">
            <rect x="-13" y="-5" width="26" height="2" rx="1" fill="#00d4ff" opacity="0.35"/>
            <rect x="-13" y="0" width="26" height="2" rx="1" fill="#00d4ff" opacity="0.25"/>
            <rect x="-13" y="5" width="26" height="2" rx="1" fill="#00d4ff" opacity="0.15"/>
            <path d="M-2 -10 L8 1 L2 1 L6 12 L-8 -1 L-2 -1 Z" fill="#00d4ff"/>
          </g>
        </svg>
        <span class="font-semibold tracking-tight">Boltstore</span>
      </router-link>
      <button class="md:hidden ml-auto p-1 text-text-muted hover:text-text-primary transition-colors" @click="close">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto py-3">
      <div class="px-3 mb-1">
        <button
          class="btn-primary w-full text-xs flex items-center justify-center gap-1.5 py-2"
          @click="emit('createDatabase')"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          Create Database
        </button>
      </div>
      <div class="px-3 mt-4 mb-1">
        <div class="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-2">Project</div>
      </div>
      <router-link to="/overview" class="sidebar-item" :class="{ active: $route.path === '/overview' }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>
        Overview
      </router-link>
      <router-link to="/databases" class="sidebar-item" :class="{ active: $route.path.startsWith('/databases') }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        Databases
      </router-link>
      <router-link to="/analytics" class="sidebar-item" :class="{ active: $route.path === '/analytics' }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"/></svg>
        Analytics
      </router-link>
      <router-link to="/activities" class="sidebar-item" :class="{ active: $route.path === '/activities' }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
        Activities
      </router-link>
      <router-link to="/databases" class="sidebar-item" :class="{ active: $route.path.startsWith('/databases') }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        Databases
      </router-link>
      <router-link to="/settings" class="sidebar-item" :class="{ active: $route.path.startsWith('/settings') }">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        Settings
      </router-link>
    </div>
    <div class="p-3 border-t border-border-default shrink-0">
      <button
        class="flex items-center justify-center gap-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-md px-3 py-2 transition-colors w-full"
        style="text-decoration: none"
        @click="handleLogout"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        Log out
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useRouter } from "vue-router"
import { useSidebar } from "../../composables/useSidebar"
import { api, clearSession } from "../../api/client"

const router = useRouter()
const emit = defineEmits<{ createDatabase: [] }>()
const { isOpen, close } = useSidebar()

async function handleLogout() {
  try {
    await api.logout()
  } catch {}
  clearSession()
  router.push("/login")
}
</script>
