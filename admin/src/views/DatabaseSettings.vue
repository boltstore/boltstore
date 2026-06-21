<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const route = useRoute();
const router = useRouter();
const { apiRequest } = useConnection();

const dbName = computed(() => route.params.name as string);
const config = ref<any>({});
const loading = ref(true);
const saving = ref(false);
const saved = ref(false);
const newOrigin = ref("");

onMounted(async () => {
  try {
    const data = await apiRequest("GET", `/api/databases/${dbName.value}/config`);
    config.value = {
      cors_origins: [],
      rate_limit: 1000,
      max_body_size: 10485760,
      ...(data || {}),
    };
  } catch (e) { console.error(e); }
  finally { loading.value = false; }
});

async function save() {
  saving.value = true;
  try {
    await apiRequest("PATCH", `/api/databases/${dbName.value}/config`, config.value);
    saved.value = true;
    setTimeout(() => saved.value = false, 2000);
  } catch (e: any) { alert(e.message); }
  finally { saving.value = false; }
}

function addOrigin() {
  const v = newOrigin.value.trim();
  if (v && !config.value.cors_origins.includes(v)) {
    config.value.cors_origins.push(v);
  }
  newOrigin.value = "";
}

function removeOrigin(i: number) {
  config.value.cors_origins.splice(i, 1);
}

async function rotateDbKey() {
  try {
    const keys = await apiRequest("GET", `/api/databases/${dbName.value}/keys`);
    if (keys && keys.length > 0) {
      const k = await apiRequest("POST", `/api/databases/${dbName.value}/keys/${keys[0].id}/rotate`);
      alert(`New key: ${k.key}`);
    }
  } catch (e: any) { alert(e.message); }
}
</script>

<template>
  <div>
    <button @click="router.push(`/databases/${dbName}`)" class="text-xs text-gray-500 hover:text-gray-300 mb-4 flex items-center gap-1">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
      {{ dbName }}
    </button>
    <h2 class="text-sm font-medium text-gray-300 mb-6">Database Settings</h2>

    <div v-if="loading" class="text-center py-12 text-gray-600 text-sm">Loading...</div>

    <div v-else class="space-y-8 max-w-lg">
      <div>
        <label class="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">CORS Origins</label>
        <div class="flex flex-wrap gap-2 mb-2">
          <span v-for="(origin, i) in config.cors_origins" :key="i" class="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-gray-800 text-xs text-gray-300">
            {{ origin }}
            <button @click="removeOrigin(i)" class="text-gray-600 hover:text-red-400">&times;</button>
          </span>
        </div>
        <div class="flex gap-2">
          <input v-model="newOrigin" class="input flex-1" placeholder="https://example.com" @keydown.enter.prevent="addOrigin" />
          <button @click="addOrigin" class="btn-secondary text-xs">Add</button>
        </div>
      </div>

      <div>
        <label class="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">Rate Limit (requests/min)</label>
        <input v-model.number="config.rate_limit" type="number" class="input" placeholder="1000" />
      </div>

      <div>
        <label class="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">Max Body Size (bytes)</label>
        <input v-model.number="config.max_body_size" type="number" class="input" placeholder="10485760" />
      </div>

      <div class="flex items-center justify-between pt-4 border-t border-gray-800">
        <button @click="save" :disabled="saving" class="btn-primary">{{ saving ? "Saving..." : "Save Changes" }}</button>
        <span v-if="saved" class="text-xs text-emerald-400">Saved!</span>
      </div>
    </div>
  </div>
</template>

