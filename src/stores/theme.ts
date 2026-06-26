import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark';

const KEY = 'nl.theme.v1';

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY) as Theme | null;
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  const prefersDark =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

export const theme = ref<Theme>(initial());

function apply(t: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', t);
  }
}

apply(theme.value);

watch(theme, (t) => {
  apply(t);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
});

export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
}
