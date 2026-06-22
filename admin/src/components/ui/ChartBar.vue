<template>
  <div
    :class="[error ? 'chart-bar-error' : 'chart-bar']"
    :style="{ height: percent + '%' }"
  ></div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    percent: number
    error?: boolean
  }>(),
  {
    error: false,
  }
)
</script>
