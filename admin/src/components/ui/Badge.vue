<script setup lang="ts">
defineProps<{
  variant: "green" | "yellow" | "red";
  label: string;
}>();

const variantClasses = {
  green: "badge-green",
  yellow: "badge-yellow",
  red: "badge-red",
};
</script>

<template>
  <span :class="variantClasses[variant]">{{ label }}</span>
</template>
