import { KC_DEFS } from '@/kc';
import { kcView } from '@/stores/skills';

/**
 * Rank system: one ladder of six ranks anchored to the real academic progression.
 *
 * The anchor is free data the app already has: every knowledge component carries a
 * curriculum level (1 trivial … 3 BM/HF median … 5 Passerelle/ETH stretch), and the
 * estimator keeps a decay-aware mastery per component. A component is SECURED when its
 * shown mastery holds >= 70% on at least two observations (n >= 2 — one fewer than the
 * UI's provisional cutoff, deliberately: mastery is already confidence-shrunk under thin
 * evidence, so holding 70% at n = 2 is real signal). Untouched
 * components are unsecured — the anchor is absolute, not relative to what happens to
 * have been practised. Because mastery decays as skills go stale, ranks can decay too:
 * a rank is held, not owned.
 *
 * Ranks gate on stage bands, so the title always has a plain-language anchor
 * ("BM/HF core: 61% secured") rather than an abstract score.
 */

export const SECURE_PCT = 70;
export const SECURE_MIN_N = 2;

// Stage bands over curriculum levels.
export interface StageBand {
  key: string;
  label: string;
  levels: number[];
}
export const BANDS: StageBand[] = [
  { key: 'hs', label: 'Foundations (Sek/HS)', levels: [1, 2] },
  { key: 'bm', label: 'BM/HF core', levels: [3] },
  { key: 'pas', label: 'Passerelle band', levels: [4] },
  { key: 'eth', label: 'ETH stretch', levels: [5] },
];

// One requirement: at least `pct` percent of the band's components secured.
interface Gate {
  band: string;
  pct: number;
}

export interface RankDef {
  n: number; // 1..6
  title: string;
  anchor: string; // what holding this rank means, in academic terms
  gates: Gate[]; // all must hold (rank 1 has none)
}

export const RANKS: RankDef[] = [
  { n: 1, title: 'Apprentice', anchor: 'first skills tracked', gates: [] },
  { n: 2, title: 'Artisan', anchor: 'school foundations solid', gates: [{ band: 'hs', pct: 60 }] },
  {
    n: 3,
    title: 'Operator',
    anchor: 'BM/HF core in hand',
    gates: [
      { band: 'hs', pct: 70 },
      { band: 'bm', pct: 40 },
    ],
  },
  {
    n: 4,
    title: 'Vanguard',
    anchor: 'Passerelle band opening',
    gates: [
      { band: 'bm', pct: 70 },
      { band: 'pas', pct: 30 },
    ],
  },
  {
    n: 5,
    title: 'Master',
    anchor: 'Passerelle secured, ETH stretch underway',
    gates: [
      { band: 'bm', pct: 85 },
      { band: 'pas', pct: 60 },
      { band: 'eth', pct: 25 },
    ],
  },
  {
    n: 6,
    title: 'Grandmaster',
    anchor: 'ETH-ready across the map',
    gates: [
      { band: 'pas', pct: 80 },
      { band: 'eth', pct: 60 },
    ],
  },
];

export interface BandStat {
  key: string;
  label: string;
  secured: number;
  total: number;
  pct: number; // 0..100, secured share of the whole band
}

export interface RankView {
  rank: RankDef;
  next: RankDef | null;
  bands: BandStat[];
  // Progress toward the next rank: the least-satisfied gate, 0..100.
  nextProgress: number;
  // Plain-language line for the least-satisfied gate ("secure 9 more BM/HF skills").
  nextStep: string;
}

function bandStats(now: number): BandStat[] {
  const secured = new Set(
    kcView(now)
      .filter((v) => v.masteryPct >= SECURE_PCT && v.n >= SECURE_MIN_N)
      .map((v) => v.id),
  );
  return BANDS.map((b) => {
    const members = KC_DEFS.filter((d) => b.levels.includes(d.level));
    const sec = members.filter((d) => secured.has(d.id)).length;
    return {
      key: b.key,
      label: b.label,
      secured: sec,
      total: members.length,
      pct: members.length ? Math.round((100 * sec) / members.length) : 0,
    };
  });
}

// Compare on the exact fraction, not the display-rounded pct, so the "secure N more"
// arithmetic in nextStep can never disagree with the gate itself.
function gateHolds(g: Gate, bands: BandStat[]): boolean {
  const b = bands.find((x) => x.key === g.band);
  return !!b && 100 * b.secured >= g.pct * b.total;
}

export function rankView(now = Date.now()): RankView {
  const bands = bandStats(now);
  let held = RANKS[0];
  for (const r of RANKS) {
    if (r.gates.every((g) => gateHolds(g, bands))) held = r;
    else break; // ranks are strictly ordered; the first failed rank ends the climb
  }
  const next = RANKS.find((r) => r.n === held.n + 1) ?? null;

  let nextProgress = 100;
  let nextStep = '';
  if (next) {
    let worst = 1;
    let worstGate: Gate | null = null;
    for (const g of next.gates) {
      const b = bands.find((x) => x.key === g.band);
      const frac = b ? Math.min(1, b.pct / g.pct) : 0;
      if (frac < worst || worstGate === null) {
        worst = frac;
        worstGate = g;
      }
    }
    nextProgress = Math.round(100 * worst);
    if (worstGate) {
      const b = bands.find((x) => x.key === worstGate!.band)!;
      const need = Math.max(0, Math.ceil((worstGate.pct / 100) * b.total) - b.secured);
      nextStep =
        need > 0
          ? `secure ${need} more ${b.label} skill${need === 1 ? '' : 's'}`
          : 'hold your secured skills against decay';
    }
  }
  return { rank: held, next, bands, nextProgress, nextStep };
}
