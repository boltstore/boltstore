<template>
  <button
    class="tab-btn"
    :class="{ active: active }"
    @click="$emit('click')"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{ active?: boolean }>()
defineEmits<{ click: [] }>()
</script>
