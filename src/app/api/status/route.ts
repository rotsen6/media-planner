import { loadDataset } from "@/lib/data";
import { ollamaConfig } from "@/lib/model";

/** Setup state for the UI: is the evidence loaded, and is the configured model installed? */
export async function GET() {
  const { baseUrl, model } = ollamaConfig;
  const [data, modelReady] = await Promise.all([
    loadDataset().then(
      (d) => ({
        ready: true,
        products: d.products.length,
        benchmarks: d.benchmarks.length,
        historyRows: d.historyRows,
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
      // Editing the structured brief still works without a model.
      .catch(() => false),
  ]);
  return Response.json(
    { data, modelReady, model },
    { headers: { "Cache-Control": "no-store" } },
  );
}
