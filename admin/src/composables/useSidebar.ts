import { ref } from "vue"

// Module-level singleton — all components share one sidebar state (intentional)
const isOpen = ref(false)

export function useSidebar() {
  function toggle() {
    isOpen.value = !isOpen.value
  }
  function close() {
    isOpen.value = false
  }
  return { isOpen, toggle, close }
}
