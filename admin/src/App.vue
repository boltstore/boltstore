<script setup lang="ts">
import { useConnection } from "./stores/client";
import AppLayout from "./components/AppLayout.vue";

const { state } = useConnection();
</script>

<template>
  <div v-if="state.sessionLoading" class="min-h-screen bg-gray-950 flex items-center justify-center">
    <div class="text-center">
      <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-sm text-gray-500">Restoring session...</p>
    </div>
  </div>
  <div v-else-if="state.connected" class="min-h-screen bg-gray-950">
    <AppLayout>
      <router-view />
    </AppLayout>
  </div>
  <div v-else class="min-h-screen bg-gray-950">
    <router-view />
  </div>
</template>
