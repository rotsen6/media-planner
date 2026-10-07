# Local setup

Use Node.js 24 and npm. The supplied CSVs and example briefs are included in `data/private/`; no data import or `.env` file is needed. Run commands from the repository root.

## Ollama

On macOS, install and start [Ollama with Homebrew](https://formulae.brew.sh/formula/ollama):

```bash
brew install ollama
brew services start ollama
ollama pull qwen2.5:14b
```

Other platforms can use [Ollama's installer](https://ollama.com/download), start `ollama serve`, and run `ollama pull qwen2.5:14b` in another terminal. The default model downloads about 9 GB. The app keeps it loaded between turns with `keep_alive: -1`; stop the macOS service with `brew services stop ollama` when finished.

## Configuration and checks

Optional `.env.local` settings:

| Variable | Default |
| --- | --- |
| `DATA_DIR` | `data/private` |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `qwen2.5:14b` |

After [starting the app](../../README.md#run), `curl http://127.0.0.1:3000/api/status` should report `data.ready: true` and `modelReady: true`. Manual brief entry works without Ollama. Restart after replacing data or changing configuration. Production mode uses `npm run build` followed by `npm start`. A hosted app needs a reachable model endpoint; no paid API or database is required.

`npm run check` runs typechecking, regular tests, and a production build. `npm run test:live` needs Ollama but no running app; it covers the supplied briefs, clarification, intent routing, confidence follow-ups, and unsupported-geography correction. See [benchmarks](../benchmarks/README.md) for measurement commands.
