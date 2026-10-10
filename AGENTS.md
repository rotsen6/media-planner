<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Repository guidance

- Keep calculations and product selection in deterministic planning code; use the LLM for brief extraction and answers grounded in calculated evidence.
- Before reviewing or changing planning or extraction, read the [library guide](docs/lib/README.md). Check its planning rules, especially the assessment's meaning of `inventory_risk`, before proposing policy changes.
- For changes spanning systems or affecting clarification and failure handling, read the [request lifecycle](docs/lifecycle/README.md).
- For request validation or streaming, read the [API guide](docs/api/README.md); for browser state or presentation, read the [UI guide](docs/ui/README.md).
- Reuse existing schemas and planning helpers. Refactors should preserve observable behavior and meaningful regression coverage.

## Verification and review

- For application changes, run the standard checks in [README](README.md#verify). Prompt, extraction, or model integration changes also need its live-model checks with Ollama. Verify visible UI changes in the browser.
- Report which checks passed and which were skipped; mocked tests alone do not establish live-model behavior.
- Review findings should identify a triggering scenario, user impact, and code location. Distinguish defects from proposed policy changes.
