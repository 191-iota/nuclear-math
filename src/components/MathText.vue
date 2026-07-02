<script setup lang="ts">
import { computed } from 'vue';
import { renderMath } from '@/math';

// Renders prose mixed with LaTeX ($...$ / \(...\) inline, $$...$$ / \[...\] display,
// plus bare undelimited TeX fragments the model slipped in). The HTML is built by
// renderMath, which escapes everything outside the math.
const props = defineProps<{ text?: string }>();
const html = computed(() => renderMath(props.text ?? ''));
</script>

<template>
  <span class="mathtext" v-html="html" />
</template>

<style scoped>
.mathtext {
  white-space: pre-wrap;
  word-break: break-word;
}

.mathtext :deep(.katex) {
  font-size: 1.04em;
  /* A long inline formula scrolls in its own box instead of overflowing the card. */
  display: inline-block;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  vertical-align: middle;
}

/* Let long display formulas scroll instead of overflowing the card. */
.mathtext :deep(.katex-display) {
  margin: 0.4rem 0;
  overflow-x: auto;
  overflow-y: hidden;
}
</style>
