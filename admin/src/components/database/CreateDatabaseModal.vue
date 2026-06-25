<template>
  <div
    class="fixed inset-0 z-50"
    :class="show ? 'flex items-center justify-center' : 'hidden'"
    style="background: rgba(0,0,0,0.6);"
    @click="onBackdropClick"
  >
    <div class="bg-bolt-card border border-border-default rounded-lg w-full max-w-sm mx-4 p-5 shadow-2xl" @click.stop>
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 rounded-full bg-accent-600/10 flex items-center justify-center shrink-0">
          <svg class="w-5 h-5 text-accent-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-medium text-text-primary">Create Database</h3>
          <p class="text-xs text-text-muted mt-0.5">Add a new database to your project.</p>
        </div>
      </div>
      <div class="mb-4">
        <label class="block text-xs font-medium text-text-secondary mb-1.5">Database Name</label>
        <input type="text" class="input-field" placeholder="e.g. my-database" v-model="name" @keydown.enter="handleSubmit">
      </div>
      <div class="mb-4">
        <label class="block text-xs font-medium text-text-secondary mb-1.5">Group</label>
        <select class="input-field" v-model="group">
          <option value="">default</option>
          <option value="production">production</option>
          <option value="staging">staging</option>
        </select>
      </div>
      <p v-if="createError" class="text-xs text-red-400 mb-3">{{ createError }}</p>
      <div class="flex items-center justify-end gap-2">
        <button class="btn-ghost btn-sm" @click="emit('close')">Cancel</button>
        <button class="btn-primary btn-sm" :disabled="creating" @click="handleSubmit">{{ creating ? 'Creating...' : 'Create' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue"
import { api } from "../../api/client"

const props = withDefaults(defineProps<{
  show: boolean
  initialGroup?: string
}>(), {
  initialGroup: "",
})

const emit = defineEmits<{
  (e: "close"): void
  (e: "created", name: string): void
}>()

const name = ref("")
const group = ref("")
const creating = ref(false)
const createError = ref("")

watch(() => props.show, (val) => {
  if (val) {
    name.value = ""
    group.value = props.initialGroup || ""
    createError.value = ""
  }
})

function onBackdropClick() {
  emit("close")
}

async function handleSubmit() {
  if (!name.value.trim()) return
  createError.value = ""
  creating.value = true
  try {
    await api.createDatabase(name.value.trim(), group.value || undefined)
    emit("created", name.value.trim())
    name.value = ""
    group.value = ""
  } catch (e: unknown) {
    createError.value = e instanceof Error ? e.message : "Failed to create database"
  } finally {
    creating.value = false
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.show) emit("close")
}

onMounted(() => window.addEventListener("keydown", onKeyDown, { capture: true }))
onUnmounted(() => window.removeEventListener("keydown", onKeyDown, { capture: true }))
</script>
