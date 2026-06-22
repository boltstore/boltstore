<template>
  <div class="min-h-screen bg-bolt-base flex flex-col items-center justify-center px-4">
    <div class="text-6xl font-bold text-red-400 mb-4">{{ code }}</div>
    <div class="text-lg font-medium text-text-primary mb-2">{{ title }}</div>
    <div class="text-sm text-text-muted mb-8 text-center">{{ message }}</div>
    <router-link to="/" class="btn-primary btn-sm">Go Home</router-link>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import { useRoute } from "vue-router"

const route = useRoute()
const code = computed(() => (route.params.code as string) || "500")
const title = computed(() => {
  if (code.value === "403") return "Forbidden"
  if (code.value === "500") return "Server error"
  return "Something went wrong"
})
const message = computed(() => {
  if (code.value === "403") return "You don't have permission to access this resource."
  if (code.value === "500") return "An unexpected error occurred. Please try again later."
  return "An unexpected error occurred."
})
</script>
