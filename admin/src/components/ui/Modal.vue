<script setup lang="ts">
defineProps<{ show: boolean }>();
defineEmits<{ (e: "close"): void }>();

function onOverlayClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    emit("close");
  }
}
</script>

<template>
  <div class="modal-overlay" :class="{ show }" @click="onOverlayClick">
    <div class="modal">
      <slot />
    </div>
  </div>
</template>
