<script setup lang="ts">
import { computed, ref } from 'vue';
import { perDay, usageSummary, byRole, byModel, clearUsage } from '@/stores/usage';

type Metric = 'cost' | 'tokens';
const metric = ref<Metric>('cost');

// All reactive off the usage records + the model prices, so everything recomputes
// live as scans land and as you change a model or its price in Presets.
const summary = computed(() => usageSummary());
const roles = computed(() => byRole());
const models = computed(() => byModel());

// Cumulative spend over time. A running total fills the width smoothly at any number
// of days and is never dominated by one big day, unlike per-day or per-problem bars.
const VW = 1000;
const VH = 240;
const series = computed(() => {
  const ds = perDay(100000); // effectively all days
  let cum = 0;
  return ds.map((d) => {
    const add = metric.value === 'cost' ? d.costUSD : d.input + d.output;
    cum += add;
    return { day: d.day, cum, dayVal: add };
  });
});
const maxCum = computed(() => Math.max(1e-9, ...series.value.map((p) => p.cum)));
const pts = computed(() => {
  const s = series.value;
  const n = s.length;
  return s.map((p, i) => ({
    x: n <= 1 ? VW : (i / (n - 1)) * VW,
    y: VH - (p.cum / maxCum.value) * VH,
  }));
});
const linePath = computed(() =>
  pts.value.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
);
const areaPath = computed(() => {
  const ps = pts.value;
  if (ps.length < 2) return '';
  const first = ps[0].x.toFixed(1);
  const last = ps[ps.length - 1].x.toFixed(1);
  return `M${first},${VH} ${linePath.value.slice(1)} L${last},${VH} Z`;
});

function usd(n: number): string {
  return '$' + (n >= 1 ? n.toFixed(2) : n.toFixed(3));
}
function tok(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function share(costUSD: number): number {
  return summary.value.estCostUSD > 0 ? (costUSD / summary.value.estCostUSD) * 100 : 0;
}
function dayLabel(dayNum: number): string {
  const d = new Date(dayNum * 86_400_000);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const firstLabel = computed(() => (series.value.length ? dayLabel(series.value[0].day) : ''));
const totalLabel = computed(() =>
  metric.value === 'cost' ? usd(summary.value.estCostUSD) : tok(summary.value.tokensTotal),
);
</script>

<template>
  <section class="scroll">
    <div class="page-head">
      <h2>Usage</h2>
      <span class="muted mono" style="font-size: 0.72rem">estimated, priced per model</span>
      <span class="spacer" />
      <button class="ghost danger" @click="clearUsage">Clear log</button>
    </div>

    <template v-if="summary.scans > 0">
      <div class="stat-grid">
        <div class="card stat">
          <div class="k">Est. cost</div>
          <div class="v">{{ usd(summary.estCostUSD) }}</div>
          <div class="sub">{{ usd(summary.costPerPageUSD) }} / problem</div>
        </div>
        <div class="card stat">
          <div class="k">Tokens</div>
          <div class="v">{{ tok(summary.tokensTotal) }}</div>
          <div class="sub">{{ tok(summary.totals.input) }} in · {{ tok(summary.totals.output) }} out</div>
        </div>
        <div class="card stat">
          <div class="k">Scans</div>
          <div class="v">{{ summary.scans }}</div>
          <div class="sub">{{ summary.pages }} problems</div>
        </div>
        <div class="card stat">
          <div class="k">Lesson cards</div>
          <div class="v">{{ usd(summary.lessons.costUSD) }}</div>
          <div class="sub">{{ summary.lessons.count }} written</div>
        </div>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom: 0.6rem">
          <strong style="font-size: 0.85rem">Where it goes</strong>
          <span class="spacer" />
          <span class="muted mono" style="font-size: 0.68rem">by purpose, then by model</span>
        </div>
        <div class="userows">
          <div v-for="r in roles" :key="r.role" class="userow">
            <span class="ulabel">{{ r.label }}</span>
            <span class="ucount muted mono">{{ r.count }}×</span>
            <span class="utrack"><span class="ufill" :style="{ width: share(r.costUSD) + '%' }" /></span>
            <span class="ucost mono">{{ usd(r.costUSD) }}</span>
          </div>
        </div>
        <div
          class="userows"
          style="margin-top: 0.8rem; border-top: 1px solid var(--border); padding-top: 0.7rem"
        >
          <div v-for="m in models" :key="m.model" class="userow">
            <span class="ulabel">{{ m.label }}</span>
            <span class="ucount muted mono">{{ m.count }}×</span>
            <span class="utrack"><span class="ufill model" :style="{ width: share(m.costUSD) + '%' }" /></span>
            <span class="ucost mono">{{ usd(m.costUSD) }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="row" style="margin-bottom: 0.5rem">
          <strong style="font-size: 0.85rem">{{ metric === 'cost' ? 'Spend' : 'Tokens' }} over time</strong>
          <span class="muted mono" style="font-size: 0.72rem; margin-left: 0.5rem">{{ totalLabel }} total</span>
          <span class="spacer" />
          <div class="tabs">
            <button class="tab" :class="{ active: metric === 'cost' }" @click="metric = 'cost'">Cost</button>
            <button class="tab" :class="{ active: metric === 'tokens' }" @click="metric = 'tokens'">Tokens</button>
          </div>
        </div>
        <template v-if="pts.length >= 2">
          <svg class="trend" :viewBox="`0 0 ${VW} ${VH}`" preserveAspectRatio="none" aria-hidden="true">
            <path :d="areaPath" class="t-area" />
            <path :d="linePath" class="t-line" />
          </svg>
          <div class="t-axis mono">
            <span>{{ firstLabel }}</span>
            <span class="spacer" />
            <span>today</span>
          </div>
        </template>
        <p v-else class="muted" style="font-size: 0.72rem; margin-top: 0.4rem">
          The trend appears after a second day of use. Today's total is in the cards above.
        </p>
      </div>

      <p class="muted" style="font-size: 0.72rem; margin-top: 0.8rem">
        The line is your running total, so it only ever climbs and stays readable however long you use
        it. Lifetime figures are in the cards above. Prices come from the model rates in Presets, so
        changing a model re-prices history instantly. Solve and confirm also carry the skill tagging
        that feeds Progress, so it rides those rows rather than adding its own; lesson cards are the one
        separate call, on Sonnet, written once per mistake you fix.
      </p>
    </template>

    <div v-else class="empty">
      No scans recorded yet. Connect the pen and write on the Pad. Usage shows up here live.
    </div>
  </section>
</template>

<style scoped>
.userows {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.userow {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.76rem;
}

.userow .ulabel {
  flex: 0 0 6.5rem;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.userow .ucount {
  flex: 0 0 2.6rem;
  font-size: 0.7rem;
  text-align: right;
}

.userow .utrack {
  flex: 1;
  height: 0.55rem;
  background: var(--panel-2);
  border-radius: 3px;
  overflow: hidden;
}

.userow .ufill {
  display: block;
  height: 100%;
  background: var(--chart-out);
}

.userow .ufill.model {
  background: var(--chart-in);
}

.userow .ucost {
  flex: 0 0 3.6rem;
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.trend {
  width: 100%;
  height: 150px;
  display: block;
}

.t-area {
  fill: var(--chart-out);
  opacity: 0.14;
}

.t-line {
  fill: none;
  stroke: var(--chart-out);
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.t-axis {
  display: flex;
  font-size: 0.66rem;
  color: var(--muted);
  margin-top: 0.35rem;
}
</style>
