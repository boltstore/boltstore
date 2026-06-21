<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const route = useRoute();
const router = useRouter();
const { disconnect, state } = useConnection();
const collapsed = ref(false);

function isActive(path: string) {
  return route.path.startsWith(path);
}

function handleDisconnect() {
  disconnect();
  router.push("/login");
}
</script>

<template>
  <aside :class="[
    'relative flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200',
    collapsed ? 'w-16' : 'w-60'
  ]">
    <!-- Logo -->
    <div class="flex items-center h-14 px-4 border-b border-gray-800 gap-3">
      <div class="w-7 h-7 rounded-lg bg-accent-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">B</div>
      <span v-if="!collapsed" class="font-semibold text-sm tracking-tight text-gray-100 flex-1">Boltstore</span>
    </div>

    <!-- Collapse toggle — on the right edge -->
    <button @click="collapsed = !collapsed" :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
      class="absolute top-[14px] -right-3 z-10 w-6 h-6 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-all shadow-md">
      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path v-if="!collapsed" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
        <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
      </svg>
    </button>

    <!-- Nav -->
    <nav class="flex-1 p-3 space-y-1">
      <router-link to="/overview" :class="['nav-item', isActive('/overview') ? 'active' : '']" :title="collapsed ? 'Overview' : ''">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
        <span v-if="!collapsed">Overview</span>
      </router-link>

      <router-link to="/databases" :class="['nav-item', isActive('/databases') ? 'active' : '']" :title="collapsed ? 'Databases' : ''">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/></svg>
        <span v-if="!collapsed">Databases</span>
      </router-link>

      <router-link to="/activity" :class="['nav-item', isActive('/activity') ? 'active' : '']" :title="collapsed ? 'Activity' : ''">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span v-if="!collapsed">Activity</span>
      </router-link>
    </nav>

    <!-- Bottom -->
    <div class="p-3 border-t border-gray-800">
      <button @click="handleDisconnect" class="nav-item w-full text-gray-500 hover:text-red-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
        <span v-if="!collapsed">Logout</span>
      </button>
    </div>
  </aside>
</template>

