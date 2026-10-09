# Media planner library

TypeScript calculates and ranks plans; the LLM extracts campaign details and answers questions.

## Following a request

![Library workflow: extract, merge, calculate, and optionally answer](assets/01-request-flow.svg)

LangGraph runs **extract → merge → respond**. It clarifies missing or unresolved details before evaluating a plan. Questions add an LLM call grounded in the current brief and results; failures keep the code-generated summary.

See the [request lifecycle](../lifecycle/README.md), [API](../api/README.md), and [UI](../ui/README.md) for the surrounding flow.

## Modules

`planning` owns campaign rules, `assistant` coordinates model calls, and `chat` handles transport and browser state. Imports lists other library modules; `(type)` means type-only.

| File | Used by | Responsibility | Imports |
| --- | --- | --- | --- |
| [planning/brief.ts](../../src/lib/planning/brief.ts) | Server and browser | Campaign fields, validation, and updates. | — |
| [planning/dataset.ts](../../src/lib/planning/dataset.ts) | Server | Load CSVs, aggregate history, and index data. | `brief` |
| [planning/recommendation.ts](../../src/lib/planning/recommendation.ts) | Server and browser | Server-side ranking and allocation; shared result schemas. | `brief`, `dataset` (type) |
| [planning/explanations.ts](../../src/lib/planning/explanations.ts) | Server and browser | Summaries and reasons derived from planning rules. | `brief`, `recommendation`, `protocol` (type) |
| [assistant/workflow.ts](../../src/lib/assistant/workflow.ts) | Server | Connect extraction, calculation, and answers. | `brief`, `protocol`, `explanations`, `ollama`, `recommendation`, `dataset` (type) |
| [assistant/ollama.ts](../../src/lib/assistant/ollama.ts) | Server | Ollama calls and output checks. | `brief`, `protocol`, `recommendation` |
| [chat/protocol.ts](../../src/lib/chat/protocol.ts) | Server and browser | Request, response, and stream validation. | `brief`, `recommendation` |
| [chat/conversations.ts](../../src/lib/chat/conversations.ts) | Browser | Chat state, saving, and restoration. | `brief`, `protocol` |
| [chat/read-response.ts](../../src/lib/chat/read-response.ts) | Browser | Read progress and the final result. | `protocol` |
| [chat/reveal-text.ts](../../src/lib/chat/reveal-text.ts) | Browser | Animate replies and pause before showing plans. | — |

## Planning rules

- **Brief:** vertical, KPI, geography, and budget are required. Advertiser name and minimum impressions are optional.
- **Benchmarks:** for each product/vertical, divide total clicks or viewable impressions by total impressions.
- **Singles:** spend up to budget or inventory. Minimum impressions determine eligibility. Rank by historical KPI, confidence, then product ID.
- **Pairs:** considered only when no single meets a supplied minimum. Maximize the impression-weighted KPI; ties prefer greater spend, then ID. Budget can remain unused to preserve a higher KPI.
- **Confidence:** the assessment defines higher `inventory_risk` as more confidence, not a delivery probability. It only breaks ties between singles.
