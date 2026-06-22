<template>
  <label class="toggle">
    <input
      type="checkbox"
      :checked="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span class="toggle-slider"></span>
  </label>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
defineEmits<{ "update:modelValue": [value: boolean] }>()
</script>
