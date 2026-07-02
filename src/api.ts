import OpenAI from 'openai';

/**
 * The single door to OpenAI. Every request in the app goes through createCompletion(),
 * which chains onto a global FIFO queue, so two requests can never be in flight at
 * once: the next starts only after the previous one settles. The scan loop was already
 * serialized in MainView, but the fire-and-forget lesson card and an on-demand drill
 * could still overlap a scan; owning the client here (no module holds its own) makes
 * overlap structurally impossible rather than per-caller discipline. Each request is
 * bounded by the client timeout per attempt (the client retries once, so a stalled
 * call delays the queue by at most ~2x the timeout).
 */
let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('Missing VITE_OPENAI_API_KEY. Copy .env.example to .env and add your key.');
    }
    // Reasoning models legitimately take 30-90s at medium/high effort, so the default
    // timeout is generous; callers pass a tighter per-request one where it fits (drill).
    client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true, timeout: 90000, maxRetries: 1 });
  }
  return client;
}

let tail: Promise<void> = Promise.resolve();
let queued = 0;
let inFlight = false;

export function createCompletion(params: any, opts?: { timeout?: number }): Promise<any> {
  queued += 1;
  const result = tail.then(async () => {
    queued -= 1;
    inFlight = true;
    try {
      return await getClient().chat.completions.create(params, opts);
    } finally {
      inFlight = false;
    }
  });
  // The chain must survive a failed request, or one error would jam the queue forever.
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// Strip control characters a model's broken JSON string escaping can smuggle past the
// strict schema: a live gpt-5.4 reply once mis-escaped the · in a problem label as
// backslash-u0000-b7, landing a literal NUL byte in the parsed string. Newlines and
// tabs stay — the solution checklist is line-structured.
export function cleanText(s: unknown): string {
  return typeof s === 'string' ? s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') : '';
}

// Console probe: __nlApi() shows whether a request is running and how many wait behind
// it — the live proof (alongside the network tab) that requests never overlap.
if (typeof window !== 'undefined') {
  (window as unknown as { __nlApi: unknown }).__nlApi = () => ({ inFlight, queued });
}
