# Benchmarks

Historical measurements from October 5–7, 2026. One machine and one run per measurement unless noted; results will vary.

## Environment

- Apple M4 Pro, 48 GB memory, macOS (Darwin 25.6)
- Ollama 0.35.1, qwen2.5:14b: 9.0 GB on disk, 9.6 GB resident, 100% GPU
- Model settings: JSON format, temperature 0, `num_predict: 800`, `num_ctx: 8192`
- Node 24.18, Next.js 16.3.8, Vitest 5

## Model latency

Run `npm run bench:latency` with Ollama running. It measures each supplied brief using Ollama's prompt, generation, and load timings.

Warm-model results, October 6:

| Input | Measurement |
| --- | --- |
| Full brief | ~540 prompt tokens in 0.44–0.58 s; 80–110 output tokens in 6.7–10.1 s |
| Small talk | 17 output tokens in 1.7 s |
| Generation | ~12 tokens/s; ~93% of a turn |

After idle, two live-suite runs took 17.1–19.2 s for the first brief, versus 9.7 s warm. The adapter now uses `keep_alive: -1` to retain the model.

Experiments on October 6:

| Change | Result |
| --- | --- |
| Disable JSON mode | 12.5 vs 12.1 tokens/s |
| Reduce context to 2,048 | No generation speedup; 1.4 s reload |
| Positional `[value, quote]` output | 86 vs 110 tokens; validation failed for 5/8 briefs, or 1/8 with a worked example |
| qwen2.5:7b | ~25 tokens/s; 9/10 live checks failed |

## Response comparison

With the app running, record responses before and after a change:

```bash
node bench/golden.mjs /tmp/before.jsonl
# Apply the change, then:
node bench/golden.mjs /tmp/after.jsonl
node bench/compare.mjs /tmp/before.jsonl /tmp/after.jsonl
```

`APP_URL` defaults to `http://127.0.0.1:3000`. Each recording contains 1,260 brief combinations (5 verticals × 3 geographies × 2 KPIs × 6 budgets × 7 impression goals), 11 boundary requests, and one status response. Comparison ignores object key order and reports explanation changes separately.

The October 5–6 refactors produced no structural or explanation differences. Regenerate recordings locally.

## Browser payload

Production builds of minimal chat apps (textbox and server echo):

| | Next.js 16.3.8 | Gradio 6.29 | Streamlit 1.65 |
| --- | --- | --- | --- |
| First-load requests | 7 | 56 | 78 |
| Transferred | 135 KB | 414 KB | 2,333 KB* |
| Decoded JS, CSS, fonts | 449 KB | 902 KB | 2,310 KB |
| Largest file | 224 KB | 131 KB | 813 KB |
| Backend round trip | 24 ms | 47 ms | 56 ms |

*Streamlit's server did not gzip responses. These examples used `gr.ChatInterface` and `st.chat_input`.

The full Next.js app measured 12 requests, 442 KB transferred, 1,286 KB decoded (400 KB fonts), and 68 ms round trip. Installed dependencies: Streamlit 368 MB/35 packages; Gradio 259 MB/52 packages.

`node bench/payload.mjs http://127.0.0.1:<port>` measures HTML and linked scripts/styles, with raw and estimated gzip sizes. Browser network measurements used one uncached load, including fonts and dynamic requests.

## Test coverage at measurement time

76 regular tests and 10 live-model checks covered the supplied briefs, clarification, intent routing, and geography correction. Current commands are in the [README](../../README.md#verify); historical counts do not reflect later tests.
