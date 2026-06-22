<script setup lang="ts">
const props = defineProps<{
  options: string[];
  modelValue: string;
}>();

const emit = defineEmits<{ (e: "update:modelValue", value: string): void }>();

function select(option: string) {
  emit("update:modelValue", option);
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <button
      v-for="option in options"
      :key="option"
      class="tab-btn"
      :class="{ active: modelValue === option }"
      @click="select(option)"
    >
      {{ option }}
    </button>
  </div>
</template>
