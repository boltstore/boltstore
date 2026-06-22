<script setup lang="ts">
import { useConnection } from "./stores/client";

const { state } = useConnection();
</script>

<template>
  <div v-if="state.sessionLoading" class="min-h-screen bg-bolt-base flex items-center justify-center">
    <div class="text-center">
      <div class="w-8 h-8 border-2 border-accent-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
      <p class="text-sm text-text-muted">Restoring session...</p>
    </div>
  </div>
  <div v-else class="min-h-screen bg-bolt-base">
    <router-view />
  </div>
</template>
