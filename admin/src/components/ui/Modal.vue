<template>
  <div
    class="modal-overlay"
    :class="{ show: show }"
    @click="closeOnBackdrop && $emit('close')"
  >
    <div class="modal">
      <div class="px-5 py-4 border-b border-border-default flex items-center justify-between">
        <div class="text-sm font-medium text-text-primary">
          <slot name="title" />
        </div>
        <button
          class="text-text-muted hover:text-text-primary transition-colors"
          @click="$emit('close')"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="p-5 space-y-4">
        <slot name="body" />
      </div>
      <div class="px-5 py-4 border-t border-border-default flex items-center justify-end gap-2">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    show: boolean
    closeOnBackdrop?: boolean
  }>(),
  {
    closeOnBackdrop: true,
  }
)

defineEmits<{ close: [] }>()
</script>
