<script setup lang="ts">
defineProps<{
  bars: number[];
  variant?: "default" | "error";
}>();

const barClass = (variant: "default" | "error" = "default") =>
  variant === "error" ? "chart-bar-error" : "chart-bar";
</script>

<template>
  <div class="h-full flex items-end gap-px">
    <div
      v-for="(height, i) in bars"
      :key="i"
      :class="barClass(variant)"
      :style="{ height: height + '%' }"
    />
  </div>
</template>
