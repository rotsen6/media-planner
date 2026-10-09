# UI and conversation state

Overview: [request lifecycle](../lifecycle/README.md).

Chat updates a read-only brief/plan panel; the sidebar holds saved conversations.

![UI request, reply animation, plan display, and browser storage](assets/01-response-flow.svg)

| File | Responsibility |
| --- | --- |
| [workspace.tsx](../../src/components/workspace.tsx) | Navigation, conversation, and layout. |
| [plan-panel.tsx](../../src/components/plan-panel.tsx) | Brief summary, plan metrics, and alternatives. |
| [use-conversations.ts](../../src/components/use-conversations.ts) | Browser effects, requests, cancellation, and persistence. |
| [chat/conversations.ts](../../src/lib/chat/conversations.ts) | Chat state, revisions, restoration, and saving. |

## Persistence

Chats use `localStorage`, scoped to this browser and origin; tabs do not sync. Changes save after 300 ms, or immediately on navigation, page hiding, or unmount. Clearing browser data removes chats; storage failures show a notice.

New requests clear the old plan; a different dataset version invalidates saved plans. Request IDs reject late responses. Interrupted requests restore as drafts.

## Response presentation

[chat/read-response.ts](../../src/lib/chat/read-response.ts) reads API progress and the final result. [chat/reveal-text.ts](../../src/lib/chat/reveal-text.ts) reveals the reply character by character, then waits one second before showing a plan. Stop cancels the reveal; reduced motion or hidden chats skip it and the pause.

The theme adapts [Kargo's](https://www.kargo.com/) branding; it is not an official design. IBM Plex Sans uses the [OFL license](../../src/app/fonts/OFL.txt).
