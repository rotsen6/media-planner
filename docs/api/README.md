# API

Next.js route handlers construct the workflow and share the cached dataset and model configuration.

| Endpoint | Purpose | Source |
| --- | --- | --- |
| `POST /api/chat` | Accept a chat turn or structured brief; return clarification, a plan, or an error. | [chat/route.ts](../../src/app/api/chat/route.ts) |
| `GET /api/status` | Report dataset readiness, counts/version, and whether the configured model is installed. | [status/route.ts](../../src/app/api/status/route.ts) |

Request and response schemas live in [contract.ts](../../src/lib/contract.ts). Chat requests carry the latest message, canonical brief, unresolved fields, and up to six prior messages of 1,000 characters each. Brief-editor requests carry the explicit brief and skip model extraction. Follow-up answering uses history; extraction uses only the latest message and brief.

The chat route validates origin, JSON content type, the 64,000-byte body limit, and the request schema before starting work. Invalid requests return JSON errors. Valid requests return JSON by default; `Accept: application/x-ndjson` selects progress events followed by one final result. A final `status: error` maps to HTTP 503 in JSON mode; streaming clients receive that status in the final event. Request or stream cancellation aborts model work.

The stream carries progress and a completed response, not Ollama tokens. See the [library walkthrough](../lib/README.md#following-a-request) for processing stages and the [UI guide](../ui/README.md) for text presentation.
