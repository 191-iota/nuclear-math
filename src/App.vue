<script setup lang="ts">
import { ref } from 'vue';
import MainView from '@/views/MainView.vue';
import UsageView from '@/views/UsageView.vue';
import PresetsView from '@/views/PresetsView.vue';
import { theme, toggleTheme } from '@/stores/theme';

type View = 'pad' | 'usage' | 'presets';
const view = ref<View>('pad');
const tabs: { id: View; label: string }[] = [
  { id: 'pad', label: 'Pad' },
  { id: 'usage', label: 'Usage' },
  { id: 'presets', label: 'Presets' },
];
</script>

<template>
  <div class="shell">
    <header class="topnav">
      <span class="brand">
        <svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">
            <ellipse cx="32" cy="32" rx="27" ry="10.5" />
            <ellipse cx="32" cy="32" rx="27" ry="10.5" transform="rotate(60 32 32)" />
            <ellipse cx="32" cy="32" rx="27" ry="10.5" transform="rotate(120 32 32)" />
          </g>
          <circle cx="32" cy="32" r="4.8" fill="var(--gold)" />
        </svg>
        nuclear<span class="brand-dim">·learning</span>
      </span>
      <nav class="tabs">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="tab"
          :class="{ active: view === t.id }"
          @click="view = t.id"
        >
          {{ t.label }}
        </button>
      </nav>
      <span class="spacer" />
      <button
        class="theme"
        :title="theme === 'dark' ? 'Switch to light' : 'Switch to dark'"
        @click="toggleTheme"
      >
        {{ theme === 'dark' ? '☾' : '☀' }}
      </button>
    </header>

    <main class="content">
      <!-- Kept mounted so the pen stays connected and the canvas persists. -->
      <MainView v-show="view === 'pad'" />
      <UsageView v-if="view === 'usage'" />
      <PresetsView v-if="view === 'presets'" />
    </main>
  </div>
</template>
