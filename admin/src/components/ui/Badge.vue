<template>
  <span
    :class="[
      'badge',
      variant === 'green' ? 'badge-green' : '',
      variant === 'yellow' ? 'badge-yellow' : '',
      variant === 'red' ? 'badge-red' : '',
    ]"
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: "green" | "yellow" | "red"
  }>(),
  {
    variant: "green",
  }
)
</script>
