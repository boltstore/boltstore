<template>
  <div
    class="sidebar-overlay"
    :class="{ show: isOpen }"
    @click="close"
  ></div>
</template>

<script setup lang="ts">
import { useSidebar } from "../../composables/useSidebar"

const { isOpen, close } = useSidebar()
</script>
