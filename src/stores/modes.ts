import { ref, watch } from 'vue';
import type { Mode } from '@/types';
import defaultModes from '@config/modes.json';

/**
 * User-editable feedback presets. Seeded from config/modes.json; edits and custom
 * presets are persisted to localStorage. The Presets view mutates this directly;
 * MainView reads it reactively so prompt / debounce / effort changes apply live.
 */
// Bumped when the shipped modes change in a way a stale saved copy must not shadow (v13:
// every hint rung now names the VIOLATED CONSTRAINT — the learner reasons from
// constraints, and a located flaw without its broken rule reads as noise; slips carry
// the law governing the botched operation instead of a bare recheck cue, and the deeper
// rungs restate the constraint alongside the move / the solutions-lookup). A bump drops
// the old localStorage and re-seeds from
// config/modes.json on next load, so new behaviour actually reaches an existing browser.
const KEY = 'nl.modes.v13';

function seed(): Mode[] {
  return structuredClone(defaultModes) as unknown as Mode[];
}

function load(): Mode[] {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Mode[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
    // First load under this version. A bump must replace the SHIPPED presets, but the
    // user's own presets are not ours to delete: carry `custom-*` entries over from the
    // newest old key, then drop the stale keys so they stop accumulating forever.
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && /^nl\.modes\.v\d+$/.test(k) && k !== KEY) old.push(k);
    }
    if (old.length) {
      old.sort((a, b) => Number(b.slice(10)) - Number(a.slice(10)));
      const carried: Mode[] = [];
      try {
        const prev = JSON.parse(localStorage.getItem(old[0]) ?? '[]') as Mode[];
        if (Array.isArray(prev)) {
          for (const m of prev) {
            if (m && typeof m.id === 'string' && m.id.startsWith('custom-')) carried.push(m);
          }
        }
      } catch {
        /* unreadable old save: nothing to carry */
      }
      for (const k of old) localStorage.removeItem(k);
      if (carried.length) return [...seed(), ...carried];
    }
  } catch {
    /* fall back to defaults */
  }
  return seed();
}

export const modes = ref<Mode[]>(load());

watch(
  modes,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(modes.value));
    } catch {
      /* non-fatal */
    }
  },
  { deep: true },
);

// A new preset clones the SHIPPED math grader, so a variant starts from the tuned
// baseline (conventions, hint rules, self-correction protocol) instead of a bare stub.
export function addMode(): Mode {
  const base = seed()[0];
  const preset: Mode = {
    ...base,
    id: `custom-${Date.now()}`,
    label: 'Math variant',
  };
  modes.value.push(preset);
  return preset;
}

export function removeMode(id: string): void {
  if (modes.value.length <= 1) return; // keep at least one preset
  modes.value = modes.value.filter((m) => m.id !== id);
}

export function resetModes(): void {
  modes.value = seed();
}
