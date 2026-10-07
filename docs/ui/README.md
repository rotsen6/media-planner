# UI and conversation state

The workspace separates chat history, the current conversation, and an editable brief/plan panel. **Enter details manually** calculates without a model.

| File | Responsibility |
| --- | --- |
| [workspace.tsx](../../src/components/workspace.tsx) | Navigation, conversation, and layout. |
| [plan-panel.tsx](../../src/components/plan-panel.tsx) | Brief editing, plan metrics, and alternatives. |
| [use-conversations.ts](../../src/components/use-conversations.ts) | Browser effects, requests, cancellation, and persistence. |
| [conversations.ts](../../src/lib/conversations.ts) | State transitions, revisions, restoration, and debounced saving. |

## Persistence

Each chat saves messages, draft, brief, pending questions, and result in `localStorage`. Saves wait 300 ms after changes and flush on chat navigation, page hiding, and unmount. New chat retains earlier conversations. Storage is local to the browser and origin, with no account sync or concurrent-tab merging; clearing browser data removes chats, and storage failures show a notice.

Editing invalidates the plan immediately. Request IDs prevent late responses from overwriting newer edits or another chat. Interrupted requests restore as drafts, and changed dataset fingerprints invalidate saved results.

## Response presentation

[turn-stream.ts](../../src/lib/turn-stream.ts) reads progress and the final result. [reveal-text.ts](../../src/lib/reveal-text.ts) then reveals the completed text character by character, with a one-second pause before resolving a recommendation and opening the plan panel. Cancellation stops the reveal. Reduced motion, hidden pages, or navigation away from the chat can bypass animation. This presentation follows the [API result stream](../api/README.md), rather than model token streaming.

Dark surfaces adapt the public [Kargo](https://www.kargo.com/) wordmark and colors, not an official dark-mode specification. IBM Plex Sans is bundled with its [OFL license](../../src/app/fonts/OFL.txt).
