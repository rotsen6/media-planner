# Kargo Media Planner

A Next.js media planner. Ollama interprets chat; TypeScript calculates and ranks plans; LangGraph connects the steps.

## Run

Use Node.js 24 and npm. The supplied data is included; no `.env` is needed.

Install [Ollama](https://ollama.com/download) and start its app, or leave `ollama serve` running in a separate terminal. It provides the local LLM HTTP API at `http://127.0.0.1:11434`. From the repository root:

```bash
ollama pull qwen2.5:14b  # Required for chat
npm install
npm run dev
```

Open **http://127.0.0.1:3000** and describe your campaign in chat. Refine details or ask about the plan in the same conversation.

## Verify

```bash
npm run check       # Typecheck, tests, production build
npm run test:live   # Requires Ollama
```

## Documentation

- [Request lifecycle](docs/lifecycle/README.md)
- [Library, planning rules, and diagrams](docs/lib/README.md)
- [API and streaming](docs/api/README.md)
- [UI and saved chats](docs/ui/README.md)
