<script setup lang="ts">
import { ref } from "vue";
import GithubBadge from "../components/ui/GithubBadge.vue";

const email = ref("");
const password = ref("");
</script>

<template>
  <div class="min-h-screen flex items-center justify-center relative overflow-hidden bg-bolt-base text-text-primary">
    <!-- Background grid -->
    <div class="bg-grid absolute inset-0 pointer-events-none"></div>
    <div class="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bolt-base/50 pointer-events-none"></div>

    <div class="relative z-10 w-full max-w-sm px-6">
      <div class="text-center mb-8">
        <div class="flex items-center justify-center gap-2.5 mb-6">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="7" fill="#080c14"/>
            <g transform="translate(16, 15)">
              <rect x="-13" y="-5" width="26" height="2" rx="1" fill="#00d4ff" opacity="0.35"/>
              <rect x="-13" y="0" width="26" height="2" rx="1" fill="#00d4ff" opacity="0.25"/>
              <rect x="-13" y="5" width="26" height="2" rx="1" fill="#00d4ff" opacity="0.15"/>
              <path d="M-2 -10 L8 1 L2 1 L6 12 L-8 -1 L-2 -1 Z" fill="#00d4ff"/>
            </g>
          </svg>
          <span class="font-bold text-xl tracking-tight">Boltstore</span>
        </div>
        <h1 class="text-xl font-semibold mb-2">Welcome back</h1>
        <p class="text-sm text-text-secondary">Sign in to your dashboard</p>
      </div>

      <form class="space-y-4" @submit.prevent="">
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Email</label>
          <input
            v-model="email"
            type="email"
            class="input-field"
            placeholder="you@example.com"
            required
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-text-secondary mb-1.5">Password</label>
          <input
            v-model="password"
            type="password"
            class="input-field"
            placeholder="Enter your password"
            required
          />
        </div>
        <button type="submit" class="btn-primary w-full py-2.5">
          Sign In
        </button>
      </form>
    </div>

    <GithubBadge />
  </div>
</template>
