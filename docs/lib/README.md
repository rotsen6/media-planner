# Media planner library

Overview: [request lifecycle](../lifecycle/README.md).

`src/lib` holds planning rules, model calls, and conversation state. TypeScript calculates and ranks plans. The LLM reads campaign details and explains the calculated results.

## Following a request

![Request flow from validation through LangGraph to the browser](assets/01-request-flow.svg)

1. **Send.** [use-conversations.ts](../../src/components/use-conversations.ts) sends the message, current brief, unresolved fields, and recent history. Manual entry sends an explicit brief.
2. **Validate.** The [chat route](../../src/app/api/chat/route.ts) checks the request and connects the workflow to the dataset, model, and cancellation signal.
3. **Extract — LLM, then code.** [model.ts](../../src/lib/model.ts) sends Ollama the latest message and current brief. It returns intent and field changes with source quotes; code checks the output. Field changes take priority over questions; manual entry skips extraction.
4. **Merge — code.** [workflow.ts](../../src/lib/workflow.ts) applies changes through [brief.ts](../../src/lib/brief.ts). Omitted fields stay unchanged; `null` clears them. Values flagged as unusable clear the old field and trigger a question.
5. **Calculate — code.** Missing or unresolved fields get a clarification. Otherwise, [recommend.ts](../../src/lib/recommend.ts) calculates and validates a plan; [evidence.ts](../../src/lib/evidence.ts) writes its summary.
6. **Answer — optional LLM.** Questions and small talk get a tailored reply using the current evidence and recent history. Brief changes and manual calculations skip this call.
7. **Return.** Generated text can replace the summary, never the plan. Failed answer generation keeps the calculated result with a fallback notice. Failed extraction preserves the previous brief.
8. **Display and save.** The browser reveals the reply, pauses before showing the plan, and saves the conversation. Request IDs prevent late responses from overwriting newer edits.

LangGraph runs **extract → merge → respond**. Answer generation runs afterward, so its failure cannot discard a calculated plan. The server stores no conversation state. See [API](../api/README.md) for request limits and streaming, and [UI](../ui/README.md) for display and storage.

## Modules

| File | Used by | Responsibility |
| --- | --- | --- |
| [brief.ts](../../src/lib/brief.ts) | Server and browser | Campaign fields, validation, and merge rules. |
| [contract.ts](../../src/lib/contract.ts) | Server and browser | Request, response, and progress schemas; bounded stream readers. |
| [data.ts](../../src/lib/data.ts) | Server | Read and validate CSVs, aggregate history, index and fingerprint the dataset. |
| [recommend.ts](../../src/lib/recommend.ts) | Server and browser | Pure calculation, ranking, allocation, and result schemas. Calculation runs on the server. |
| [evidence.ts](../../src/lib/evidence.ts) | Server and browser | Shared labels, clarification text, and reasons derived from ranking rules. |
| [model.ts](../../src/lib/model.ts) | Server | Ollama calls, output checks, and extraction retries. |
| [workflow.ts](../../src/lib/workflow.ts) | Server | Coordinate extraction, merging, calculation, and answers. |
| [conversations.ts](../../src/lib/conversations.ts) | Browser | Conversation state, form values, stale-result checks, and save/restore logic. |
| [turn-stream.ts](../../src/lib/turn-stream.ts) | Browser | Read progress and a validated final result, including JSON fallback. |
| [reveal-text.ts](../../src/lib/reveal-text.ts) | Browser | Animate text, handle cancellation, and pause before showing a plan. |

These boundaries separate I/O from calculation and state changes. `createWorkflow({ model, loadData })` accepts injected services so tests can run without Ollama or file access. The React hook owns browser effects.

The dataset is cached per server process; failed loads can retry. Restart after replacing loaded data.

### Optional configuration

[Setup](../../README.md#run) needs no environment variables. To override the defaults, set these in `.env.local` and restart:

| Variable | Default |
| --- | --- |
| `DATA_DIR` | `data/private` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `qwen2.5:14b` |

## Import graphs

Arrows point from a file to its direct dependency. Dashed arrows are type-only imports, removed at runtime. These show dependencies, not execution order.

![Workflow and model dependencies](assets/02-orchestration-imports.svg)

![Dependencies among the remaining library modules](assets/03-shared-imports.svg)

The library has no import cycles. `workflow` and `recommend` use only the `Dataset` type, keeping file I/O out of shared code. Main dependencies are Zod for validation, `csv-parse` for CSVs, and LangGraph for the workflow.

## Planning rules

The brief requires vertical, KPI, geography, and budget. Advertiser name and minimum impressions are optional. [brief.ts](../../src/lib/brief.ts) defines supported values.

- **History:** CTR and in-view rate divide summed clicks or viewable impressions by summed impressions for each product/vertical. Row percentages are never averaged.
- **Budget:** a single product delivers `min(budget / CPM × 1,000, available inventory)`. It spends up to the budget or inventory limit. Minimum impressions are an eligibility threshold, not a target that stops spending. Constraint checks use unrounded values.
- **Ranking:** eligible single products rank by historical KPI, then higher inventory confidence, then stable product ID. The app uses `inventory_risk` as confidence; it never scales inventory or represents delivery probability.
- **Pairs:** considered only when no single meets a supplied minimum. Each pair maximizes its impression-weighted KPI within budget and inventory limits. The calculator checks the feasible intersections of those constraints. Ties prefer greater spend, then stable ID.
- **Result:** one recommendation, up to two alternatives, and each product's eligibility and comparison reasons. [recommend.ts](../../src/lib/recommend.ts) owns the ranking policy; `evidence.ts` uses it to explain decisions.

History has no geography or dates; inventory has no time dimension. Historical performance is not guaranteed, and summed impressions are not unique audience reach.

Source quotes help check extraction but cannot prove the model understood a message. Generated explanations can also be wrong. Users can inspect the evidence and correct the brief.

## Cost and failure handling

For **P** products, with fixed vertical and geography lists:

| Work | Time | Space |
| --- | --- | --- |
| Load and index data | Linear in input, plus completeness checks | Linear in input |
| Rank single products | O(P log P) | O(P) |
| Evaluate and rank pairs | O(P² log P) | O(P²) |
| Prepare follow-up evidence | O(P) | O(P) |

Each pair checks at most 15 constraint intersections. History is aggregated once; requests use indexed lookups. Model generation dominates chat latency.

A turn has an 85-second deadline; each model call has 45 seconds. Extraction allows at most two calls: retry transient failures, or retry invalid output with the schema included. Both attempts use the same checks. Permanent HTTP errors, timeouts, and cancellation are not retried. Answers get one call, then fall back to the calculated summary.

## Tests

| Area | Tests |
| --- | --- |
| Input and supplied data | [data](../../tests/data.test.ts), [dataset](../../tests/dataset.test.ts) |
| Ranking and allocation | [recommend](../../tests/recommend.test.ts) |
| Model and workflow | [workflow](../../tests/workflow.test.ts), [live Ollama checks](../../tests/live.test.ts) |
| HTTP and streaming | [route](../../tests/route.test.ts), [turn-stream](../../tests/turn-stream.test.ts) |
| Saved state and display timing | [conversations](../../tests/conversations.test.ts), [reveal-text](../../tests/reveal-text.test.ts) |

Regular tests use supplied data, fixtures, and injected model/HTTP functions. Only live checks require Ollama. Run the [verification commands](../../README.md#verify) from the repository root.
