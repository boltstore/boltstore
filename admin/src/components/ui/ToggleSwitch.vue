<script setup lang="ts">
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", value: boolean): void }>();

function toggle() {
  emit("update:modelValue", !props.modelValue);
}
</script>

<template>
  <label class="toggle">
    <input type="checkbox" :checked="modelValue" @change="toggle" />
    <span class="toggle-slider" />
  </label>
</template>
