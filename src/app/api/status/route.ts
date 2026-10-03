import { loadDataset } from "@/lib/data";
import { ollamaConfig } from "@/lib/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  let data: {
    ready: boolean;
    products?: number;
    benchmarks?: number;
    historyRows?: number;
    version?: string;
  } = { ready: false };
  try {
    const source = await loadDataset();
    data = {
      ready: true,
      products: source.products.length,
      benchmarks: source.benchmarks.length,
      historyRows: source.historyRows,
      version: source.version,
    };
  } catch {
    /* A missing dataset is a setup state, not an empty catalog. */
  }
  const { model, baseUrl } = ollamaConfig;
  let modelReady = false;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (response.ok) {
      const body = await response.json();
      modelReady =
        Array.isArray(body.models) &&
        body.models.some(
          (m: { name?: unknown; model?: unknown }) =>
            m.name === model || m.model === model,
        );
    }
  } catch {
    /* Editing the structured brief still works without a model. */
  }
  return Response.json(
    { data, modelReady, model },
    { headers: { "Cache-Control": "no-store" } },
  );
}
