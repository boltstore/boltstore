import { ref } from "vue"

// Module-level singleton — all components share one refresh counter
const refreshCounter = ref(0)

export function useRefresh() {
  function triggerRefresh() {
    refreshCounter.value++
  }
  return { refreshCounter, triggerRefresh }
}
