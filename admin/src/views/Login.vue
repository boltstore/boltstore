<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useConnection } from "../stores/client";

const router = useRouter();
const { connect, apiRequest, state } = useConnection();

const isSetup = ref(false);
const loading = ref(true);
const error = ref("");

const username = ref("");
const password = ref("");

onMounted(async () => {
  // If already connected, redirect
  if (state.connected) {
    router.push("/overview");
    return;
  }
  try {
    const data = await apiRequest<{ hasAdmins: boolean }>("GET", "/api/admin/status");
    isSetup.value = !data.hasAdmins;
  } catch (e: any) {
    error.value = e.message || "Server unreachable";
  } finally {
    loading.value = false;
  }
});

async function submit() {
  error.value = "";
  if (!username.value || !password.value) {
    error.value = "Username and password are required.";
    return;
  }
  try {
    if (isSetup.value) {
      await apiRequest("POST", "/api/admin/setup", { username: username.value, password: password.value });
    }
    const data = await apiRequest<{ token: string }>("POST", "/api/admin/login", { username: username.value, password: password.value });
    await connect(data.token);
    router.push("/overview");
  } catch (e: any) {
    error.value = e.message || "Login failed";
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-950 flex items-center justify-center p-8">
    <div class="w-full max-w-sm">
      <div class="text-center mb-10">
        <div class="w-12 h-12 rounded-xl bg-accent-500 flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">B</div>
        <h1 class="text-xl font-semibold text-gray-100">Boltstore</h1>
        <p class="text-sm text-gray-500 mt-1">{{ isSetup ? "Create your first admin account" : "Sign in to your server" }}</p>
      </div>

      <div v-if="loading" class="text-center py-8 text-gray-500 text-sm">Connecting...</div>

      <form v-else @submit.prevent="submit" class="space-y-4">
        <div>
          <label class="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1">Username</label>
          <input v-model="username" type="text" class="input" :placeholder="isSetup ? 'Choose a username' : 'admin'" autocomplete="username" @keydown.enter="submit" />
        </div>
        <div>
          <label class="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-1">Password</label>
          <input v-model="password" type="password" class="input" :placeholder="isSetup ? 'At least 8 characters' : '••••••••'" autocomplete="current-password" @keydown.enter="submit" />
        </div>

        <p v-if="error" class="text-sm text-red-400 bg-red-950/50 rounded-lg px-3 py-2">{{ error }}</p>

        <div class="pt-2">
          <button type="submit" class="btn-primary w-full">
            {{ isSetup ? "Create Account & Sign In" : "Sign In" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
