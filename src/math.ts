import katex from 'katex';

/**
 * Render a string that mixes prose with LaTeX math into safe HTML.
 *
 * Math is delimited `$...$` / `\(...\)` (inline) or `$$...$$` / `\[...\]` (display);
 * everything outside the delimiters is plain text — except that a bare TeX fragment
 * the model slipped in without any delimiter ("2^{2n}", "\frac{a}{b}") is detected
 * and rendered too (see promote), instead of showing up literally on screen. Only
 * KaTeX-produced markup is ever injected as HTML, the surrounding prose is escaped,
 * so a verdict or correction coming back from the model cannot smuggle markup into
 * the page. A malformed formula falls back to its literal source rather than throwing.
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function renderTex(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html' });
  } catch {
    const d = display ? '$$' : '$';
    return escapeHtml(d + tex + d);
  }
}

// ---- bare-TeX promotion: undelimited fragments the model forgot to wrap ----
//
// Promotion must be TIGHT: unlike the speech pipeline (which turns math into words and
// can afford to touch a whole run), rendering a prose word through KaTeX would set it
// in math italics. So only whitespace-delimited tokens that are unmistakably TeX act
// as anchors, and a span grows from an anchor only across operator glue and operand
// tokens, never across a prose word. Sentence punctuation clinging to a token ends the
// span there and stays outside the math.

// Unmistakably TeX, never prose: a \command, or a ^/_ script attached to something.
const STRONG_TEX = /\\[a-zA-Z]+|[\^_](\{|[0-9A-Za-z(])/;

// The whole token is made of math-charset characters (no umlauts, no `$`).
const MATH_CHARSET = /^[0-9A-Za-z(){}[\]^_+\-*/=<>.,:;|!'\\]+$/;

// A prose word, possibly with clinging punctuation ("Vereinfache:", "gilt,").
const PROSE_WORD = /^[A-Za-z]{2,}[.,;:!?]*$/;

// Pure operator glue between operands ("=", "+", "<=").
const CONNECTOR = /^[+\-*/=<>]+$/;

type TokenKind = 'strong' | 'operand' | 'connector' | 'prose';

// Trailing sentence punctuation is not part of a formula ("... gilt 2^{2n}, weil").
function splitTrail(token: string): [string, string] {
  const m = /[.,;:!?]+$/.exec(token);
  return m ? [token.slice(0, m.index), m[0]] : [token, ''];
}

function classify(token: string): TokenKind {
  const [core] = splitTrail(token);
  if (!core || !MATH_CHARSET.test(core) || PROSE_WORD.test(token)) return 'prose';
  if (STRONG_TEX.test(core)) return 'strong';
  if (CONNECTOR.test(core)) return 'connector';
  if (/[0-9A-Za-z\\]/.test(core)) return 'operand';
  return 'prose';
}

// Escape a plain segment, rendering any bare-TeX spans found inside it.
function promote(text: string): string {
  if (!STRONG_TEX.test(text)) return escapeHtml(text);
  // split(/(\s+)/) alternates token / separator; tokens sit at even indices.
  const parts = text.split(/(\s+)/);
  const kinds = parts.map((p, idx) => (idx % 2 === 0 && p ? classify(p) : null));
  // Two-pass: mark which tokens join a span around each strong anchor, then emit.
  const inSpan = new Array<boolean>(parts.length).fill(false);
  for (let a = 0; a < parts.length; a += 2) {
    if (kinds[a] !== 'strong') continue;
    let lo = a;
    let hi = a;
    // Left: absorb operands/connectors, but a token whose own punctuation separates it
    // from us ("x=2, ...") stays out.
    while (lo - 2 >= 0 && (kinds[lo - 2] === 'operand' || kinds[lo - 2] === 'connector' || kinds[lo - 2] === 'strong')) {
      if (splitTrail(parts[lo - 2])[1]) break;
      lo -= 2;
    }
    // Right: absorb likewise; a token carrying trailing punctuation joins but ends the span.
    while (splitTrail(parts[hi])[1] === '' && hi + 2 < parts.length
      && (kinds[hi + 2] === 'operand' || kinds[hi + 2] === 'connector' || kinds[hi + 2] === 'strong')) {
      hi += 2;
    }
    // Bare connectors at the edges are prose glue ("und - x^2"), not part of the math.
    while (lo < a && kinds[lo] === 'connector') lo += 2;
    while (hi > a && kinds[hi] === 'connector') hi -= 2;
    for (let k = lo; k <= hi; k += 1) inSpan[k] = true;
  }
  let out = '';
  let i = 0;
  while (i < parts.length) {
    if (!inSpan[i]) {
      out += escapeHtml(parts[i]);
      i += 1;
      continue;
    }
    // Collect the contiguous span (tokens and their separators).
    const cores: string[] = [];
    let trail = '';
    while (i < parts.length && inSpan[i]) {
      if (i % 2 === 0) {
        const [core, t] = splitTrail(parts[i]);
        cores.push(core);
        trail = t; // only the last token's punctuation survives the span
      }
      i += 1;
    }
    out += renderTex(cores.join(' '), false) + escapeHtml(trail);
  }
  return out;
}

export function renderMath(input: string): string {
  if (!input) return '';
  let out = '';
  let plain = '';
  const flush = () => {
    if (plain) {
      out += promote(plain);
      plain = '';
    }
  };
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];
    // A backslash-escaped dollar is a literal $, never a delimiter.
    if (ch === '\\' && next === '$') {
      plain += '$';
      i += 2;
      continue;
    }
    // \( ... \) and \[ ... \], the delimiters GPT models default to.
    if (ch === '\\' && (next === '(' || next === '[')) {
      const display = next === '[';
      const closer = display ? ']' : ')';
      let j = i + 2;
      let close = -1;
      while (j < n) {
        if (input[j] === '\\') {
          if (input[j + 1] === closer) {
            close = j;
            break;
          }
          j += 2;
          continue;
        }
        j += 1;
      }
      // No closing delimiter: leave the rest as plain text rather than eating it.
      if (close === -1) {
        plain += input.slice(i);
        break;
      }
      flush();
      out += renderTex(input.slice(i + 2, close), display);
      i = close + 2;
      continue;
    }
    if (ch === '$') {
      const display = next === '$';
      const delim = display ? '$$' : '$';
      const start = i + delim.length;
      // An opening $ followed by whitespace (or nothing) is prose, not a delimiter:
      // without this, one stray $ pairs with the next unrelated $ and renders the
      // prose between them as garbled math.
      if (!display && (start >= n || /\s/.test(input[start]))) {
        plain += '$';
        i += 1;
        continue;
      }
      let j = start;
      let close = -1;
      while (j < n) {
        if (input[j] === '\\') {
          j += 2;
          continue;
        }
        if (display ? input[j] === '$' && input[j + 1] === '$' : input[j] === '$') {
          close = j;
          break;
        }
        j += 1;
      }
      // No closing delimiter: treat the rest as plain text rather than eating it.
      if (close === -1) {
        plain += input.slice(i);
        break;
      }
      flush();
      out += renderTex(input.slice(start, close), display);
      i = close + delim.length;
      continue;
    }
    // Plain run up to the next potential delimiter.
    let k = i;
    while (k < n && input[k] !== '$' && !(input[k] === '\\' && k + 1 < n && '$(['.includes(input[k + 1]))) {
      k += 1;
    }
    if (k === i) k = i + 1; // lone trailing backslash: consume it, never stall
    plain += input.slice(i, k);
    i = k;
  }
  flush();
  return out;
}
