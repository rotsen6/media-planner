# Request lifecycle

One user turn, from submission to reply and plan. The browser owns chat history; each server request starts fresh.

![A user turn crosses the UI, API, workflow, and Ollama, then returns for reply animation and plan display](assets/01-turn-lifecycle.svg)

Read the diagram top to bottom. Actor names in the standalone SVG link to the guides below.

## Explore each system

| System | Guide | Diagram |
| --- | --- | --- |
| Browser state and display | [UI](../ui/README.md) | [Response flow](../ui/assets/01-response-flow.svg) |
| Validation and transport | [API](../api/README.md) | [Request flow](../api/assets/01-request-flow.svg) |
| Extraction, calculation, and answers | [Library](../lib/README.md) | [Workflow](../lib/assets/01-request-flow.svg) · [Imports](../lib/README.md#import-graphs) |

## Other paths

| Event | What changes |
| --- | --- |
| Open or reload | Restore this browser's saved chats and check data/model readiness. Interrupted chat turns return as drafts. |
| Missing details | Ask a clarification. The user's answer starts another request carrying the brief and unresolved fields. |
| Manual brief | Skip Ollama; validate and calculate directly. |
| Stop or edit | Abort the request or reveal. Request IDs prevent late results from replacing edits. |
| Model failure | Failed extraction leaves the brief unchanged. Failed follow-up generation keeps the calculated plan and uses its summary. |

Conversation changes save throughout the turn; text animation is temporary. Reduced motion or hidden chats skip the reveal and pause. Refinements repeat the same path.
