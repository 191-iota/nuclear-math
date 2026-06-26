<script setup lang="ts">
import { modes, addMode, removeMode, resetModes } from '@/stores/modes';
import { settings, resetSettings } from '@/stores/settings';

const MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', in: 5, out: 25 },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', in: 5, out: 25 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', in: 3, out: 15 },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', in: 1, out: 5 },
];
const EFFORTS = ['low', 'medium', 'high', 'max'];
const STYLES = ['spoken', 'chime', 'both'];

// When the model changes, drop in its list prices so the Usage chart stays honest.
function onModelChange(): void {
  const m = MODELS.find((x) => x.id === settings.api.model);
  if (m) {
    settings.api.priceInputPerMTok = m.in;
    settings.api.priceOutputPerMTok = m.out;
  }
}
</script>

<template>
  <section class="scroll">
    <div class="page-head">
      <h2>Presets &amp; engine</h2>
    </div>

    <!-- ENGINE SETTINGS -->
    <div class="card" style="margin-bottom: 1rem">
      <div class="row" style="margin-bottom: 0.8rem">
        <strong style="font-size: 0.85rem">Engine</strong>
        <span class="spacer" />
        <button class="ghost" @click="resetSettings">Reset engine</button>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Model</label>
          <select v-model="settings.api.model" @change="onModelChange">
            <option v-for="m in MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
          </select>
        </div>
        <div class="field">
          <label>Solve effort (first pass)</label>
          <select v-model="settings.api.solveEffort">
            <option v-for="e in EFFORTS" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>
        <div class="field">
          <label>Verify effort (cached check)</label>
          <select v-model="settings.api.checkEffort">
            <option v-for="e in EFFORTS" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>
        <div class="field">
          <label>Max tokens</label>
          <input v-model.number="settings.api.maxTokens" type="number" min="256" step="256" />
        </div>
      </div>

      <div class="field-row" style="margin-top: 0.7rem">
        <div class="field">
          <label>Image long edge (px)</label>
          <input v-model.number="settings.export.maxEdgePx" type="number" min="256" step="64" />
        </div>
        <div class="field">
          <label>JPEG quality — {{ settings.export.jpegQuality }}</label>
          <input
            v-model.number="settings.export.jpegQuality"
            type="range"
            min="0.4"
            max="1"
            step="0.05"
          />
        </div>
        <div class="field">
          <label>Crop padding (px)</label>
          <input v-model.number="settings.export.paddingPx" type="number" min="0" step="4" />
        </div>
      </div>

      <div class="field-row" style="margin-top: 0.7rem">
        <div class="field">
          <label>Input price ($ / 1M tok)</label>
          <input v-model.number="settings.api.priceInputPerMTok" type="number" min="0" step="0.5" />
        </div>
        <div class="field">
          <label>Output price ($ / 1M tok)</label>
          <input v-model.number="settings.api.priceOutputPerMTok" type="number" min="0" step="0.5" />
        </div>
      </div>

      <p class="muted" style="font-size: 0.72rem; margin-top: 0.7rem">
        Solve effort runs once when a problem is first solved; verify effort runs on every later
        scan against the cached solution. Smaller image edge &amp; lower quality cut tokens;
        prices only affect the cost estimate.
      </p>
    </div>

    <!-- PRESETS -->
    <div class="row" style="margin-bottom: 0.7rem">
      <strong style="font-size: 0.85rem">Feedback presets</strong>
      <span class="spacer" />
      <button class="ghost" @click="resetModes">Reset presets</button>
      <button class="primary" @click="addMode">+ Add preset</button>
    </div>

    <div v-for="mode in modes" :key="mode.id" class="card preset">
      <div class="preset-head">
        <input v-model="mode.label" type="text" style="flex: 1; font-weight: 600" />
        <span class="muted mono" style="font-size: 0.68rem">{{ mode.id }}</span>
        <button class="ghost danger" :disabled="modes.length <= 1" @click="removeMode(mode.id)">
          Delete
        </button>
      </div>

      <div class="field-row">
        <div class="field">
          <label>Feedback style</label>
          <select v-model="mode.feedbackStyle">
            <option v-for="s in STYLES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>
        <div class="field">
          <label>Debounce (ms)</label>
          <input v-model.number="mode.debounceMs" type="number" min="300" step="100" />
        </div>
        <div class="field" style="justify-content: flex-end; gap: 0.5rem">
          <label class="toggle">
            <input v-model="mode.errorChecking" type="checkbox" />
            Grade errors
          </label>
          <label class="toggle">
            <input v-model="mode.cacheSolution" type="checkbox" />
            Cache solution (solve once, then verify)
          </label>
        </div>
      </div>

      <div class="field" style="margin-top: 0.7rem">
        <label>System prompt</label>
        <textarea v-model="mode.systemPrompt" rows="6" />
      </div>
    </div>
  </section>
</template>
