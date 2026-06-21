<script setup lang="ts">
import Sidebar from "./Sidebar.vue";
</script>

<template>
  <div class="flex h-screen">
    <Sidebar />
    <main class="flex-1 overflow-auto bg-gray-950">
      <div class="max-w-6xl mx-auto px-8 py-8">
        <slot />
      </div>
    </main>
  </div>
</template>
