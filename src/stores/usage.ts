import { reactive } from 'vue';
import { settings } from '@/stores/settings';

/**
 * Reactive token-usage log. Every scan records its API `usage` here; the Usage
 * dashboard reads it live. Records are grouped by "page" (one Clear-to-Clear
 * session) and persisted to localStorage so the dashboard survives reloads.
 *
 * Console access:  __nlUsage.summary() · __nlUsage.records() · __nlUsage.clear()
 */
export interface UsageRecord {
  page: number;
  ts: number;
  mode: string;
  effort: string;
  cached: boolean; // cheap verify-against-cached-solution scan?
  input: number;
  output: number; // includes thinking tokens
  cacheRead: number;
  cacheCreate: number;
}

const KEY = 'nl.usage.v1';
const MAX_RECORDS = 2000;

interface Persisted {
  page: number;
  records: UsageRecord[];
}

function load(): Persisted {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Persisted;
      if (Array.isArray(parsed.records)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { page: 1, records: [] };
}

export const usage = reactive(load());

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(usage));
  } catch {
    /* non-fatal */
  }
}

export function newPage(): void {
  usage.page += 1;
}

export function recordUsage(entry: Omit<UsageRecord, 'page' | 'ts'>): void {
  usage.records.push({ page: usage.page, ts: Date.now(), ...entry });
  if (usage.records.length > MAX_RECORDS) {
    usage.records.splice(0, usage.records.length - MAX_RECORDS);
  }
  persist();
}

export function clearUsage(): void {
  usage.records.splice(0, usage.records.length);
  usage.page = 1;
  persist();
}

export interface PageStat {
  page: number;
  scans: number;
  solves: number;
  verifies: number;
  input: number;
  output: number;
  inputCostUSD: number;
  outputCostUSD: number;
  costUSD: number;
}

export function perPage(): PageStat[] {
  const inRate = settings.api.priceInputPerMTok;
  const outRate = settings.api.priceOutputPerMTok;
  const byPage = new Map<number, PageStat>();
  for (const r of usage.records) {
    let s = byPage.get(r.page);
    if (!s) {
      s = {
        page: r.page,
        scans: 0,
        solves: 0,
        verifies: 0,
        input: 0,
        output: 0,
        inputCostUSD: 0,
        outputCostUSD: 0,
        costUSD: 0,
      };
      byPage.set(r.page, s);
    }
    s.scans += 1;
    if (r.cached) s.verifies += 1;
    else s.solves += 1;
    s.input += r.input;
    s.output += r.output;
  }
  const stats = [...byPage.values()].sort((a, b) => a.page - b.page);
  for (const s of stats) {
    s.inputCostUSD = (s.input * inRate) / 1e6;
    s.outputCostUSD = (s.output * outRate) / 1e6;
    s.costUSD = s.inputCostUSD + s.outputCostUSD;
  }
  return stats;
}

export function usageSummary() {
  const inRate = settings.api.priceInputPerMTok;
  const outRate = settings.api.priceOutputPerMTok;
  const totals = usage.records.reduce(
    (a, r) => ({
      input: a.input + r.input,
      output: a.output + r.output,
      solves: a.solves + (r.cached ? 0 : 1),
      verifies: a.verifies + (r.cached ? 1 : 0),
    }),
    { input: 0, output: 0, solves: 0, verifies: 0 },
  );
  const scans = usage.records.length;
  const pages = new Set(usage.records.map((r) => r.page)).size || 1;
  const costUSD = (totals.input * inRate + totals.output * outRate) / 1e6;
  return {
    scans,
    pages,
    totals,
    tokensTotal: totals.input + totals.output,
    tokensPerScan: scans ? Math.round((totals.input + totals.output) / scans) : 0,
    estCostUSD: +costUSD.toFixed(4),
    costPerPageUSD: +(costUSD / pages).toFixed(4),
  };
}

if (typeof window !== 'undefined') {
  (window as unknown as { __nlUsage: unknown }).__nlUsage = {
    records: () => usage.records.slice(),
    summary: usageSummary,
    perPage,
    clear: clearUsage,
  };
}
