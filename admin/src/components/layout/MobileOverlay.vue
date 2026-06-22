<script setup lang="ts">
defineProps<{ show: boolean }>();
defineEmits<{ (e: "click"): void }>();
</script>

<template>
  <div
    class="sidebar-overlay"
    :class="{ show }"
    @click="$emit('click')"
  />
</template>
