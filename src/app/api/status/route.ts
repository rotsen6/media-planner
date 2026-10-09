import { loadDataset } from "@/lib/planning/dataset";
import { ollamaConfig } from "@/lib/assistant/ollama";

/** Setup state for the UI: is the evidence loaded, and is the model installed? */
export async function GET() {
  const { baseUrl, model } = ollamaConfig;
  const [data, modelReady] = await Promise.all([
    loadDataset().then(
      (d) => ({
        ready: true,
        version: d.version,
      }),
      // A missing dataset is a setup state, not an empty catalog.
      () => ({ ready: false }),
    ),
    fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : {}))
      .then(
        ({ models }: { models?: { name?: unknown; model?: unknown }[] }) =>
          Array.isArray(models) &&
          models.some((m) => m.name === model || m.model === model),
      )
      .catch(() => false),
  ]);
  return Response.json(
    { data, modelReady, model },
    { headers: { "Cache-Control": "no-store" } },
  );
}
