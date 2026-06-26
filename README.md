# nuclear-learning

Real-time feedback for handwritten work. You write on paper with a Neo Smartpen, the strokes stream into the browser over Bluetooth, and a moment after you pause the page is sent to Claude, which reads it and tells you — spoken aloud or with a chime — whether it found a mistake. The point is a tight write-check-correct loop: you fix the error yourself from a one-line hint instead of being shown the answer.

## How it works

The pen streams (x, y, pressure) points over Web Bluetooth. The app draws them onto a canvas, fitting the pen's page coordinates to the drawing area as it goes. When you stop writing for a beat (a per-mode debounce), the canvas is exported to a PNG and sent to the Claude API as a vision message under the active mode's system prompt. Claude replies with a short verdict, which is spoken through the Web Speech API and/or marked with a chime.

```
   pen ──Bluetooth──▶ canvas ──debounce──▶ PNG ──▶ Claude (vision) ──▶ verdict ──▶ speech / chime
```

There is no separate OCR step — Claude reads the ink directly.

## Modes

A mode is a system prompt plus a few settings. Four ship by default: math, chemistry notation, German, and freeform note-reading. Each decides how the work is judged and how the result reaches you.

To add a mode, edit `config/modes.json` and add an object — no code changes. Each entry has:

- `id` — short slug, used internally
- `label` — what shows in the dropdown
- `systemPrompt` — the full instruction sent to Claude
- `feedbackStyle` — `"spoken"`, `"chime"`, or `"both"`
- `debounceMs` — how long to wait after the last stroke before checking

```json
{
  "id": "physics",
  "label": "Physics",
  "feedbackStyle": "both",
  "debounceMs": 600,
  "systemPrompt": "You are checking handwritten physics working. If correct reply CORRECT, otherwise name the first error in one short sentence."
}
```

Global settings — stroke colour, pressure, voice language and rate, chime files, model, and token budget — live in `config/settings.json`.

## Staying coherent across a page

A page is checked many times as you write, so the app keeps the scans consistent instead of treating each one as a fresh shot:

- The same correction is never replayed. A verdict is only spoken or chimed when it differs from the last one delivered, so while you are still fixing "Step 3: check your sign" it stays on screen but stops talking.
- Each request carries the verdicts already given on the page as context, so Claude stays consistent with itself — it does not re-flag a line it already confirmed, and it keeps reporting the same first unresolved error until you fix it, then moves on to what follows.
- Requests are sent one at a time and in order, so verdicts never arrive out of sequence.

When you start a new problem, press Clear. That wipes the pad and resets the page context, so feedback on the next question starts clean and a late reply from the previous one cannot leak into it. Switching mode resets the context the same way but keeps your drawing.

## Running it

You need Node and a Chromium-based browser (Chrome or Edge) — Web Bluetooth is not available in Safari or Firefox.

```
npm install
cp .env.example .env   # then put your Anthropic API key in .env
npm run dev
```

Open the printed localhost URL, click Connect pen, pick a mode, and start writing. Pairing only works over `localhost` or `https`.

The key is read from `VITE_ANTHROPIC_API_KEY` and used directly from the browser, so it is visible to anyone who can open the page. Keep this local and use a key you can rotate.

## Chimes

If `public/correct.mp3` and `public/error.mp3` exist they are played; otherwise the app synthesises a short tone (a rising pair for correct, a low buzz for an error). Drop your own files into `public/` to override them.

## Hardware

| Item | Price |
|---|---|
| Neo Smartpen (M1 / M1+ or compatible) | CHF 74–129 |
| D1 refills (3-pack) | CHF 5 |
| Ncode paper (print your own or buy a notebook) | CHF 0–16 |
| Any BLE earbud (optional, for spoken feedback in your ear) | CHF 15–20 |

## Notes

The pen SDK (`web_pen_sdk`) is a webpack bundle that pulls in Firebase, jQuery and JSZip, and references the Node `global` along with Neo's ncode page-definition files, even though this app uses none of that. `vite.config.ts` and a small polyfill already handle it, so a clean `npm install` is all that is needed; the audit warnings on install come from those old transitive dependencies, not from this code.

The default model is `claude-sonnet-4-6`, chosen for low latency. Change `api.model` in `config/settings.json` to `claude-opus-4-8` for more careful checking at higher cost and latency. The token budget is deliberately small so the model answers in one line; if you ever see truncated reasoning instead of a verdict, raise `maxTokens` in the same file.

## License

MIT
