# Benchmarks

Every number quoted in the presentation, with how it was measured. One machine, one run each unless stated. These are engineering measurements, not a statistical study.

## Setup

- Apple M4 Pro, 48 GB unified memory, macOS (Darwin 25.6)
- Ollama 0.35.1; qwen2.5:14b (9.0 GB on disk, 9.6 GB resident, 100% GPU); `format: "json"`, `temperature: 0`, `num_predict: 800`, `num_ctx: 8192`
- Node 24.18, Next.js 16.3.8, vitest 5
- Measured 2026-10-05 to 2026-10-07

## Model latency per turn

`npm run bench:latency` runs the real adapter against Ollama for each example brief and prints Ollama's timing fields (`prompt_eval_duration`, `eval_duration`, `load_duration`).

Warm model, 2026-10-06: a full brief is ~540 prompt tokens, processed in 0.44–0.58 s, and 80–110 output tokens at ~12 tokens/s, 6.7–10.1 s. Small talk is 17 output tokens, 1.7 s. Generation is about 93% of a turn.

Cold start: with Ollama's default five-minute `keep_alive`, the first brief after idle took 17.1–19.2 s in two live-suite runs, against 9.7 s warm. The adapter now sends `keep_alive: -1`.

Variants on one brief, 2026-10-06: JSON mode off, 12.5 vs 12.1 tokens/s (no change); `num_ctx` 2048, no decode change and a 1.4 s model reload; a positional `[value, quote]` output shape, 86 vs 110 tokens but rejected by validation on 5 of 8 example briefs (1 of 8 with a worked example in the prompt); qwen2.5:7b, ~25 tokens/s with 9 of 10 live checks failing.

## Recorded responses

`node bench/golden.mjs out.jsonl` posts 1,260 brief-mode requests (5 verticals × 3 geographies × 2 KPIs × 6 budgets × 7 impression goals) plus 12 boundary cases to a running app (`APP_URL`, default `http://127.0.0.1:3000`) and records each status and body. `node bench/compare.mjs before.jsonl after.jsonl` reports structural differences (key order ignored) separately from explanation-text changes.

Regenerate the corpus locally. It was run after each change to the calculator or the explanation text: 0 structural and 0 text differences across the refactors of 2026-10-05 and 2026-10-06.

## Front-end payload

Minimal chat apps in each framework, a textbox and a server echo, production builds: Next.js 16.3.8 (`next build && next start`), Gradio 6.29 (`gr.ChatInterface`), Streamlit 1.65 (`st.chat_input`). Byte sizes from `node bench/payload.mjs http://127.0.0.1:<port>`, which fetches the page and its scripts and stylesheets and reports raw and gzip bytes. Request counts and round-trip times from the browser's network panel with the cache disabled, one load each.

| | Next.js 16 | Gradio 6 | Streamlit 1.65 |
| --- | --- | --- | --- |
| Requests on first load | 7 | 56 | 78 |
| Transferred | 135 KB | 414 KB | 2,333 KB (not gzipped by its server) |
| Decoded JS, CSS and fonts | 449 KB | 902 KB | 2,310 KB |
| Largest file | 224 KB | 131 KB | 813 KB |
| Round trip, trivial backend | 24 ms | 47 ms | 56 ms |

This app: 12 requests, 442 KB transferred, 1,286 KB decoded (400 KB of it bundled fonts), 68 ms. Installs: Streamlit 368 MB in 35 packages, Gradio 259 MB in 52.

## Tests

At the measurement date, `npm test` ran 76 unit and integration tests with no model. `npm run test:live` ran 10 checks through the real model: the seven example briefs, a vague brief, intent routing, and an unsupported geography with its correction. The unit tests ran on every change; the recorded responses and the live checks ran on every change to the model path or the calculator. Run these commands from the repository root.
