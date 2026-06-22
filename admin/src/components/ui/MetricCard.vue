<script setup lang="ts">
defineProps<{
  title: string;
  value: string;
  icon: string;
  subtext?: string;
  change?: {
    value: string;
    positive: boolean;
  };
}>();
</script>

<template>
  <div class="metric-card">
    <div class="flex items-center justify-between mb-3">
      <div class="text-xs font-medium text-text-muted uppercase tracking-wider">{{ title }}</div>
      <div class="w-8 h-8 rounded-md bg-accent-600/10 flex items-center justify-center">
        <svg class="w-4 h-4 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="icon"/>
        </svg>
      </div>
    </div>
    <div class="text-2xl font-bold text-text-primary">{{ value }}</div>
    <div v-if="change" class="text-xs mt-1 flex items-center gap-1" :class="change.positive ? 'text-green-400' : 'text-red-400'">
      <svg v-if="change.positive" class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>
      </svg>
      <svg v-else class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6"/>
      </svg>
      {{ change.value }}
    </div>
    <div v-else-if="subtext" class="text-xs text-text-muted mt-1">{{ subtext }}</div>
  </div>
</template>
