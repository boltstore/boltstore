import { ref, readonly } from "vue";

const sidebarOpen = ref(false);

export function useSidebar() {
  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value;
  }

  function closeSidebar() {
    sidebarOpen.value = false;
  }

  return {
    sidebarOpen: readonly(sidebarOpen),
    toggleSidebar,
    closeSidebar,
  };
}
