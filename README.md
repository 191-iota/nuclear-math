# nuclear-learning

Real-time academic feedback loop: write on paper, get instant correction through your earpiece.

Modes: math, chemistry notation, circuit diagrams, language learning, handwriting improvement, and anything else that can be recognized from ink and checked by an LLM.

## How it works

Neo Smartpen M1+ streams (x, y, pressure, timestamp) coordinates over Bluetooth → app renders strokes on a canvas → debounce 500ms → export PNG → OCR (mode-dependent) → structured output → Claude API feedback → audio ping to earpiece if wrong.

## Architecture

```
┌──────────┐   BLE    ┌──────────┐  POST   ┌───────────────┐
│ Neo M1+  │ ──────── │  Mobile  │ ──────── │ OCR layer     │
│ (pen)    │  strokes │  App     │  PNG     │ (per mode)    │
└──────────┘          └────┬─────┘          └──────┬────────┘
                           │                       │
                           │ context + recognized  │
                           │         ┌─────────────┘
                           ▼         ▼
                      ┌──────────────────┐
                      │   Claude API     │
                      │ (feedback)       │
                      └────────┬─────────┘
                               │
                          correction
                               │
                               ▼
                      ┌──────────────────┐
                      │  BLE Earpiece    │
                      │  (audio ping)    │
                      └──────────────────┘
```

## Hardware (per user)

| Item | Price |
|---|---|
| Neo Smartpen M1+ | CHF 74–129 |
| D1 refills (3-pack) | CHF 5 |
| Ncode paper (print your own or buy notebook) | CHF 0–16 |
| Any BLE earbud | CHF 15–20 |

## APIs

- **OCR layer** — mode-dependent recognition. Mathpix for math/science notation, general handwriting OCR for text-heavy modes, or Claude vision directly for less structured inputs
- **Claude** — takes recognized output + problem context + mode, returns feedback and correction

## Stack (TBD)

- Mobile app: Kotlin (Android) or Swift (iOS)
- Neo Smartpen SDK: BLE coordinate streaming, available for Android/iOS/Web
- Ncode paper: print custom grid templates via Ncode SDK or buy N Professional Notebook (has blank pages)

## Dev setup

```
# TODO: scaffold after platform decision
```

## License

MIT
