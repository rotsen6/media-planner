import { describe, it } from "vitest";
import { createOllamaModel } from "../src/lib/model";
import { loadExampleBriefs } from "../src/lib/data";

// `npm run bench:latency` prints Ollama's own timing fields for each example brief.
describe.skipIf(!process.env.BENCH)("model latency", () => {
  it("measures prompt processing and generation per brief", async () => {
    const rows: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const res = await fetch(url, init);
      const text = await res.text();
      const t = JSON.parse(text);
      rows.push(
        `${t.prompt_eval_count} prompt tokens in ${Math.round(t.prompt_eval_duration / 1e6)} ms, ` +
          `${t.eval_count} output tokens in ${Math.round(t.eval_duration / 1e6)} ms ` +
          `(${(t.eval_count / (t.eval_duration / 1e9)).toFixed(1)} tok/s), load ${Math.round(t.load_duration / 1e6)} ms`,
      );
      return new Response(text, { status: res.status, headers: res.headers });
    };
    const model = createOllamaModel({ fetcher, timeoutMs: 120_000 });
    for (const brief of await loadExampleBriefs()) await model.extract(brief, {});
    console.log(rows.join("\n"));
  }, 600_000);
});
