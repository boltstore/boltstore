<script setup lang="ts">
import Sidebar from "./Sidebar.vue";
</script>

<template>
  <div class="flex h-screen">
    <Sidebar />
    <main class="flex-1 min-h-0 bg-gray-950">
      <div class="max-w-6xl mx-auto px-8 py-8 h-full flex flex-col min-h-0 overflow-y-auto overflow-x-hidden">
        <div class="flex-1 min-h-0">
          <slot />
        </div>
      </div>
    </main>
  </div>
</template>
