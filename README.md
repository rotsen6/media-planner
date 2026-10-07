# Kargo Media Planner

A Next.js media-planning app with chat, an editable brief, and product recommendations. LangGraph coordinates the workflow; Ollama interprets language, and TypeScript owns calculations and ranking.

## Run

Use Node.js 24 and npm. The supplied data is included; no `.env` is needed.

For chat, install [Ollama](https://ollama.com/download) and start its app, or leave `ollama serve` running in a separate terminal. Then, from the repository root:

```bash
ollama pull qwen2.5:14b  # Required for chat
npm install
npm run dev
```

Open **http://127.0.0.1:3000** and describe your campaign in chat. The brief editor works without Ollama.

## Verify

```bash
npm run check       # Typecheck, tests, production build
npm run test:live   # Requires Ollama
```

## Documentation

- [Setup](docs/setup/README.md) — data, local model, configuration, and commands.
- [Library](docs/lib/README.md) — workflow, dependency graphs, and planning rules.
- [API](docs/api/README.md) — endpoints, validation, and streaming.
- [UI](docs/ui/README.md) — conversation state, persistence, and presentation.
- [Benchmarks](docs/benchmarks/README.md) — measurements and reproduction commands.
