<script setup lang="ts">
defineProps<{ show: boolean }>();
defineEmits<{ (e: "close"): void }>();
</script>

<template>
  <div class="drawer-overlay" :class="{ open: show }" @click="$emit('close')">
    <div class="drawer" :class="{ open: show }" @click.stop="">
      <div class="drawer-header">
        <slot name="header" />
        <button class="text-text-muted hover:text-text-primary transition-colors" @click="$emit('close')">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="drawer-body">
        <slot />
      </div>
    </div>
  </div>
</template>
