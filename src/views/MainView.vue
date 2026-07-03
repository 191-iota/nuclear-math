<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { modes } from '@/stores/modes';
import { usePen, type PenDot } from '@/composables/usePen';
import { useCanvas } from '@/composables/useCanvas';
import { useFeedback } from '@/composables/useFeedback';
import MathText from '@/components/MathText.vue';
import { settings } from '@/stores/settings';
import { recommendPractice } from '@/stores/skills';
import type { Mode } from '@/types';

const DOT_MOVE = 1;
const DOT_UP = 2;
const DOT_HOVER = 3;

const selectedModeId = ref(modes.value[0]?.id ?? '');
const activeMode = computed<Mode>(
  () => modes.value.find((m) => m.id === selectedModeId.value) ?? modes.value[0],
);

// If the selected preset is deleted/renamed in the Presets view, fall back.
watch(
  modes,
  () => {
    if (!modes.value.some((m) => m.id === selectedModeId.value)) {
      selectedModeId.value = modes.value[0]?.id ?? '';
    }
  },
  { deep: true },
);

const canvasRef = ref<HTMLCanvasElement | null>(null);
const canvas = useCanvas(canvasRef);
const feedback = useFeedback();

const lastFeedback = ref('');
const status = ref('');
const requesting = ref(false);

// Auto-clear after a correct answer: once a problem is marked CORRECT, a short
// countdown clears the pad for the next problem unless you keep it (or write more).
const autoClearLeft = ref(0); // seconds remaining; 0 = inactive
let autoClearTimer: number | undefined;
// What to practise next, refreshed at the solved moment — the one point where the
// learner actually decides what to write next, so the estimator's recommendation
// is worth a line right there instead of only living in the Progress tab.
const nextDrill = ref('');

function cancelAutoClear() {
  if (autoClearTimer) {
    window.clearInterval(autoClearTimer);
    autoClearTimer = undefined;
  }
  autoClearLeft.value = 0;
}

function startAutoClear() {
  const secs = settings.scan.autoClearSec ?? 0;
  if (secs <= 0 || autoClearLeft.value > 0) return; // disabled, or already counting
  const rec = recommendPractice();
  nextDrill.value = rec.drill ? rec.drill.label : '';
  autoClearLeft.value = secs;
  autoClearTimer = window.setInterval(() => {
    autoClearLeft.value -= 1;
    if (autoClearLeft.value <= 0) {
      cancelAutoClear();
      startFreshPage(); // same as pressing Clear
    }
  }, 1000);
}

// Orchestration state for sequential, coherent scans.
let dirty = false; // new strokes since the last completed scan
let pendingAgain = false; // strokes arrived while a scan was in flight
let debounceTimer: number | undefined;
let generation = 0; // bumped on clear / mode change to discard stale in-flight scans
// Change-gating: how many strokes existed at the last scan, plus an idle-flush
// timer so a small final increment is still checked once the pen goes idle.
let strokesAtLastScan = 0;
let flushTimer: number | undefined;
let flushing = false;
// One automatic re-scan after a failed request, so a transient network blip at the
// final mark doesn't leave the finished answer silently ungraded until more ink lands.
let retriedAfterError = false;
// Correction grace: the FIRST sighting of a new correction on a page still mid-work is
// held silently — on screen but not spoken — so a slip the learner is about to catch
// themselves is never read to them. It is delivered once it survives the next scan
// (they wrote on and it still stands) or once the pen has sat idle for
// correctionGraceMs (they are stuck, and now the hint helps instead of interrupting).
// CORRECT, anything on a final-marked page, and grace 0 skip the hold entirely.
let heldVerdict: string | null = null;
let holdTimer: number | undefined;
let lastInkAt = 0;

// Physical-page identity from the pen's ncode dots. Flipping to a new paper page is a
// new problem: without this the new page's ink lands ON TOP of the old page's on the
// canvas and the model is sent the superimposed mess. Confirmed over several ink dots
// so one glitched pageInfo can never wipe a page the learner is still working on.
let pageKey: string | null = null;
let pendingPage: { key: string; count: number } | null = null;
const PAGE_FLIP_DOTS = 8;

function detectPageFlip(dot: PenDot): void {
  const pi = (dot as { pageInfo?: { section: number; owner: number; book: number; page: number } })
    .pageInfo;
  // Only real ink dots vote: hover streams while the pen floats over a NEIGHBOURING
  // page, and pen-down sentinels carry placeholder data.
  if (!pi || (dot.dotType !== DOT_MOVE && dot.dotType !== DOT_UP) || dot.x < 0 || dot.y < 0) return;
  const key = `${pi.section}/${pi.owner}/${pi.book}/${pi.page}`;
  if (pageKey === null || key === pageKey) {
    pageKey = key;
    pendingPage = null;
    return;
  }
  if (pendingPage?.key === key) pendingPage.count += 1;
  else pendingPage = { key, count: 1 };
  if (pendingPage.count >= PAGE_FLIP_DOTS) {
    pageKey = key;
    pendingPage = null;
    startFreshPage(); // the first few dots of the new page are a fraction of one stroke
  }
}

function onDot(dot: PenDot) {
  detectPageFlip(dot);
  canvas.addDot(dot);
  if (dot.dotType === DOT_HOVER) return;
  // Writing again means you want to keep this page, call off any pending clear.
  if (autoClearLeft.value > 0) cancelAutoClear();
  dirty = true;
  retriedAfterError = false; // new ink is its own retry
  lastInkAt = Date.now();
  // New ink makes a held correction stale (the page changed under it): stop its timer,
  // but keep the sentence as the second-sighting key so the next scan can decide.
  if (holdTimer) {
    window.clearTimeout(holdTimer);
    holdTimer = undefined;
  }
  // Active writing resumed, cancel any pending idle flush.
  flushing = false;
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  scheduleFeedback();
}

const pen = usePen({ onDot });

function scheduleFeedback() {
  if (debounceTimer) window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(runFeedback, activeMode.value.debounceMs);
}

// After the debounce fires with too little new ink, wait out the REST of the idle
// window and then scan anyway, so a finished answer is never skipped just because the
// last addition was small. idleFlushMs is measured from the last stroke: the debounce
// already consumed debounceMs of idle before this is scheduled, so only the residual
// is waited here — a final mark (two underline strokes) reaches its verdict about
// idleFlushMs after the pen lifts, not debounce + flush stacked in series.
function scheduleFlush() {
  if (flushTimer) window.clearTimeout(flushTimer);
  const residual = Math.max(500, settings.scan.idleFlushMs - activeMode.value.debounceMs);
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    flushing = true;
    runFeedback();
  }, residual);
}

function clearHold() {
  if (holdTimer) {
    window.clearTimeout(holdTimer);
    holdTimer = undefined;
  }
  heldVerdict = null;
}

// Matches useFeedback's audio-dedup identity, so "same sentence" means the same thing
// on both sides of the hold.
function sameVerdict(a: string, b: string): boolean {
  const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  return norm(a) === norm(b);
}

// Arm (or re-arm) the grace timer for the current hold. The grace runs from the last
// stroke, and the debounce plus the request already consumed part of it, so only the
// residual is waited. Every scan CONCLUSION that leaves a hold pending with no newer
// ink must land here (or replace/resolve the hold), or the held correction has no
// liveness: a timer-less hold is only ever delivered by the next scan.
function armHoldTimer(): void {
  if (heldVerdict === null) return;
  if (holdTimer) window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    holdTimer = undefined;
    // A fresher page state is already on its way to a verdict; defer to its conclusion.
    if (dirty || requesting.value) return;
    const held = heldVerdict;
    heldVerdict = null;
    if (held) feedback.deliver(held, activeMode.value);
  }, Math.max(1000, settings.scan.correctionGraceMs - (Date.now() - lastInkAt)));
}

// Delivery policy in front of feedback.deliver. A graded OK resolves any held
// correction — the learner fixed the slip before ever hearing about it, which is the
// outcome the hold exists for. An UNGRADED OK (unusable model reply) says nothing
// about the page, so it must not rescind the hold as if the slip were fixed; and since
// it ends the scan chain without a throw (no automatic retry), the hold gets its grace
// timer back — silence-until-new-ink would strand a stuck learner.
function deliverVerdict(text: string, final: boolean, ungraded: boolean): void {
  if (feedback.isQuiet(text)) {
    if (!ungraded) clearHold();
    else if (!dirty) armHoldTimer();
    return;
  }
  const graceMs = settings.scan.correctionGraceMs;
  if (feedback.isCorrect(text) || final || graceMs <= 0 || feedback.alreadyDelivered(text)) {
    clearHold();
    feedback.deliver(text, activeMode.value);
    return;
  }
  if (heldVerdict !== null && sameVerdict(heldVerdict, text)) {
    // Second sighting: the error survived a whole further write-and-pause cycle
    // without the learner catching it, so a teacher would interject now.
    clearHold();
    feedback.deliver(text, activeMode.value);
    return;
  }
  // First sighting of a new correction mid-work: hold it.
  heldVerdict = text;
  if (holdTimer) {
    window.clearTimeout(holdTimer);
    holdTimer = undefined;
  }
  // Ink that landed while this scan was in flight postdates the image this verdict was
  // computed from — the ink could not cancel a timer that did not exist yet, and it may
  // BE the fix for this very sentence. The queued rescan is the authority: hold without
  // a timer and let its verdict decide (a graded OK clears, a repeat is the second
  // sighting). Arming here would race the rescan and could speak a correction for a
  // slip already struck through.
  if (dirty) return;
  armHoldTimer();
}

async function runFeedback() {
  if (!canvas.hasContent() || !dirty) return;
  if (requesting.value) {
    pendingAgain = true; // serialise: re-run after the current scan finishes
    return;
  }
  // Gate on how much new ink arrived since the last scan. Below the threshold we
  // wait for more (batching mid-writing scans), unless this is an idle flush. A
  // finished answer is substantial ink, so it always trips the threshold; and the
  // flush covers the case where the learner stops after a small final tweak.
  const newStrokes = canvas.strokeCount() - strokesAtLastScan;
  if (newStrokes <= 0) return;
  if (newStrokes < settings.scan.minNewStrokes && !flushing) {
    scheduleFlush();
    return;
  }
  flushing = false;
  if (flushTimer) {
    window.clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  requesting.value = true;
  dirty = false;
  const strokesBeforeScan = strokesAtLastScan;
  strokesAtLastScan = canvas.strokeCount();
  const gen = generation;
  status.value = 'Checking…';
  try {
    const img = canvas.exportImage();
    // A scan whose trigger was under the stroke gate arrived via the idle flush: a few
    // strokes then stillness, the shape of a final mark. The model gets told, so it
    // checks beneath the results before staying quiet.
    const smallBatch = newStrokes < settings.scan.minNewStrokes;
    const { verdict: text, final, ungraded } = await feedback.getFeedback(
      img,
      activeMode.value,
      smallBatch,
    );
    if (gen !== generation) {
      status.value = ''; // a reset happened mid-flight, drop this result
      return;
    }
    retriedAfterError = false;
    if (import.meta.env.DEV) {
      console.debug('[nuclear-math] verdict:', JSON.stringify(text), final ? '(final page)' : '');
    }
    feedback.recordVerdict(text);
    deliverVerdict(text, final, ungraded === true);
    if (feedback.isQuiet(text)) {
      // Distinguish "no solution cached yet" (the solve isn't producing one) from a real "looks
      // fine so far" — otherwise both read identically and a failing solve looks like a pass.
      lastFeedback.value = feedback.hasSolution()
        ? 'Looks good so far…'
        : 'Working out the solution…';
    } else {
      // Always reflect the CURRENT scan's verdict on screen — a glance is opt-in, so even a
      // held correction shows here while the audio waits out its grace — and never let a
      // resolved or changed error linger as stale text carried over from an earlier scan.
      lastFeedback.value = feedback.describe(text, activeMode.value);
    }
    status.value = '';
    // Correct → offer to auto-advance to the next problem; any other verdict (a fresh error
    // after a correct one) calls off a pending clear. CORRECT only fires once every visible
    // part carries a marked final result (FINAL MARK rule), so it is a completion worth clearing.
    // Never start the countdown when new ink already arrived mid-flight: those strokes are
    // the next problem (or more work), and the timer would wipe them at zero.
    if (feedback.isCorrect(text) && !dirty && !pendingAgain) startAutoClear();
    else if (!feedback.isQuiet(text)) cancelAutoClear();
  } catch (err: any) {
    if (gen !== generation) {
      status.value = '';
      return;
    }
    status.value = err?.message ?? 'Error contacting OpenAI.';
    // Re-arm ONE automatic retry for the ink this scan failed to grade; repeated
    // failures then wait for new ink rather than polling a dead API forever.
    if (!retriedAfterError) {
      retriedAfterError = true;
      dirty = true;
      strokesAtLastScan = strokesBeforeScan;
      scheduleFeedback();
    } else if (!dirty) {
      // The retry is spent and nothing further is queued: a timer-less hold would sit
      // silent forever while the learner waits stuck. Give it its grace timer back.
      armHoldTimer();
    }
  } finally {
    requesting.value = false;
    // Drain queued work if any arrived. This must NOT be gated on the finishing
    // request's generation: a reset (Clear / mode switch) bumps `generation` and
    // queues new-generation work, and the rescheduled run re-reads `generation`
    // and re-checks the canvas, so it always targets the current page/mode.
    if (pendingAgain || dirty) {
      pendingAgain = false;
      scheduleFeedback();
    }
  }
}

async function connect() {
  try {
    status.value = 'Scanning for pen…';
    await pen.scanPen();
    status.value = '';
  } catch (err: any) {
    status.value = err?.message ?? 'Could not connect to the pen.';
  }
}

function resetGating() {
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = undefined;
  flushing = false;
  strokesAtLastScan = 0;
}

function startFreshPage() {
  cancelAutoClear();
  clearHold(); // a correction held for the old page must never speak onto the new one
  generation += 1; // invalidate any in-flight scan
  if (debounceTimer) window.clearTimeout(debounceTimer);
  dirty = false;
  pendingAgain = false;
  resetGating();
  canvas.clear();
  feedback.resetSession();
  lastFeedback.value = '';
  status.value = '';
}

// Switching mode is also a fresh start for feedback context (keep the drawing).
watch(selectedModeId, () => {
  cancelAutoClear();
  clearHold();
  generation += 1;
  resetGating(); // re-evaluate the existing drawing under the new mode
  feedback.resetSession();
  lastFeedback.value = '';
  status.value = '';
  if (canvas.hasContent()) {
    dirty = true;
    scheduleFeedback();
  }
});

let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  canvas.resize();
  if (canvasRef.value && 'ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(() => canvas.resize());
    resizeObserver.observe(canvasRef.value);
  } else {
    window.addEventListener('resize', canvas.resize);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  window.removeEventListener('resize', canvas.resize);
  if (debounceTimer) window.clearTimeout(debounceTimer);
  if (flushTimer) window.clearTimeout(flushTimer);
  if (holdTimer) window.clearTimeout(holdTimer);
  cancelAutoClear();
});

const connectionLabel = computed(() => {
  if (pen.state.scanning) return 'Scanning…';
  if (pen.state.connected) {
    return pen.state.battery != null ? `Pen connected · ${pen.state.battery}%` : 'Pen connected';
  }
  return 'Pen disconnected';
});
</script>

<template>
  <div class="app">
    <header class="bar">
      <button :disabled="pen.state.scanning || pen.state.connected" @click="connect">
        {{ pen.state.connected ? 'Connected' : 'Connect pen' }}
      </button>
      <select v-if="modes.length > 1" v-model="selectedModeId" aria-label="Grader preset">
        <option v-for="m in modes" :key="m.id" :value="m.id">{{ m.label }}</option>
      </select>
      <button title="Wipe the pad and start a new problem" @click="startFreshPage">Clear</button>
      <span class="spacer" />
      <span class="conn" :class="{ on: pen.state.connected }">{{ connectionLabel }}</span>
    </header>

    <main class="stage">
      <canvas ref="canvasRef" class="pad" />
      <div v-if="autoClearLeft > 0" class="autoclear" role="status">
        <span class="ac-dot" />
        <span class="ac-msg">
          Solved. Clearing for the next problem in {{ autoClearLeft }}s
          <template v-if="nextDrill"> · next, drill: {{ nextDrill }}</template>
        </span>
        <button class="ghost" @click="cancelAutoClear">Keep</button>
      </div>
    </main>

    <footer class="status">
      <span class="mode">{{ activeMode.label }}</span>
      <span class="sep">·</span>
      <!-- Verdicts are mandated to be plain speakable prose, but a model that slips in
           LaTeX anyway should render it, not show raw markup; plain text passes through
           MathText unchanged. -->
      <span class="msg"><MathText :text="status || lastFeedback || 'Write on the pad. Feedback appears here.'" /></span>
    </footer>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.8rem;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.spacer {
  flex: 1;
}

.conn {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.3rem 0.6rem;
}

.conn.on {
  color: var(--ink);
  border-color: var(--ink);
}

.stage {
  flex: 1;
  padding: 0.8rem;
  min-height: 0;
  position: relative;
}

.autoclear {
  position: absolute;
  left: 50%;
  bottom: 1.4rem;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 0.6rem 0.5rem 0.85rem;
  background: var(--panel);
  border: 1px solid var(--gold);
  border-radius: var(--radius);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  font-size: 0.8rem;
  color: var(--ink);
}

.autoclear .ac-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--good);
  flex: none;
}

.autoclear .ac-msg {
  font-variant-numeric: tabular-nums;
}

.pad {
  width: 100%;
  height: 100%;
  display: block;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  touch-action: none;
}

.status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.9rem;
  border-top: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.8rem;
}

.status .mode {
  font-family: var(--mono);
  color: var(--muted);
}

.status .sep {
  color: var(--border);
}

.status .msg {
  color: var(--ink);
}
</style>
