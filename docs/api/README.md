# API

Overview: [request lifecycle](../lifecycle/README.md).

![API validation, workflow, response formats, and readiness checks](assets/01-request-flow.svg)

| Endpoint | Purpose | Source |
| --- | --- | --- |
| `POST /api/chat` | Turn a message into a clarification, plan, or error. | [chat/route.ts](../../src/app/api/chat/route.ts) |
| `GET /api/status` | Check data readiness, counts/version, and model availability. | [status/route.ts](../../src/app/api/status/route.ts) |

Requests follow [contract.ts](../../src/lib/contract.ts): the latest message, current brief, unresolved fields, and up to six prior messages of 1,000 characters each.

The chat route checks origin, JSON content type, the 64,000-byte body limit, and the schema. Invalid requests return JSON errors. Valid requests return JSON, or progress events followed by one result when sent with `Accept: application/x-ndjson`. Workflow errors return HTTP 503 in JSON mode or `status: error` in the final stream event. Cancelling the request or stream stops model work.

The stream contains completed text, not model tokens. See the [request walkthrough](../lib/README.md#following-a-request) and [UI presentation](../ui/README.md#response-presentation).
