<template>
  <div
    class="drawer-overlay"
    :class="{ open: open }"
    @click="$emit('close')"
  ></div>
  <div class="drawer" :class="{ open: open }">
    <div class="drawer-header">
      <div class="flex items-center gap-2">
        <slot name="header" />
      </div>
      <button
        class="btn-ghost btn-sm"
        @click="$emit('close')"
      >
        Cancel
      </button>
    </div>
    <div class="drawer-body">
      <slot name="body" />
    </div>
    <div class="p-4 border-t border-border-subtle shrink-0">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, onMounted, onUnmounted } from "vue"

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) emit("close")
}

watch(() => props.open, (open) => {
  if (open) {
    window.addEventListener("keydown", onKeyDown, { capture: true })
  } else {
    window.removeEventListener("keydown", onKeyDown, { capture: true })
  }
})

onUnmounted(() => {
  window.removeEventListener("keydown", onKeyDown, { capture: true })
})
</script>
