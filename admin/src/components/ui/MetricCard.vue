<template>
  <div class="metric-card">
    <div class="flex items-center justify-between mb-3">
      <div class="text-xs font-medium text-text-muted uppercase tracking-wider">
        <slot name="title" />
      </div>
      <div class="w-8 h-8 rounded-md bg-accent-600/10 flex items-center justify-center">
        <slot name="icon" />
      </div>
    </div>
    <div class="text-2xl font-bold text-text-primary">
      <slot name="value" />
    </div>
    <div class="text-xs text-text-muted mt-1">
      <slot name="subtext" />
    </div>
  </div>
</template>
