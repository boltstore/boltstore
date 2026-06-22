<script setup lang="ts">
import { ref } from "vue";
import Sidebar from "./Sidebar.vue";
import MobileOverlay from "./MobileOverlay.vue";

const sidebarOpen = ref(false);

function toggleSidebar() {
  sidebarOpen.value = !sidebarOpen.value;
}

function closeSidebar() {
  sidebarOpen.value = false;
}
</script>

<template>
  <div class="min-h-screen bg-bolt-base text-text-primary">
    <!-- Sidebar -->
    <Sidebar
      :class="{ 'sidebar-open': sidebarOpen }"
      @create-database="$emit('createDatabase')"
    />

    <!-- Mobile overlay -->
    <MobileOverlay :show="sidebarOpen" @click="closeSidebar" />

    <!-- Main Content -->
    <div class="main-content">
      <slot />
    </div>
  </div>
</template>
