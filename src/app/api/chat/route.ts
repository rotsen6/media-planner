import { z } from "zod";
import { loadDataset } from "@/lib/data";
import { createOllamaModel } from "@/lib/model";
import { createWorkflow, turnRequestSchema } from "@/lib/workflow";

export const runtime = "nodejs";
export const maxDuration = 90;
// Only immutable server evidence is cached. A failed load can be retried after setup.
let dataset: ReturnType<typeof loadDataset> | undefined;
const workflow = createWorkflow({
  model: createOllamaModel(),
  loadData: () => {
    dataset ??= loadDataset().catch((error) => {
      dataset = undefined;
      throw error;
    });
    return dataset;
  },
});

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize request.url to localhost even when the browser used
  // 127.0.0.1. Compare the browser origin with the actual HTTP Host instead.
  if (origin) {
    try {
      if (new URL(origin).host !== request.headers.get("host"))
        return Response.json({ error: "Unsupported origin" }, { status: 403 });
    } catch {
      return Response.json({ error: "Unsupported origin" }, { status: 403 });
    }
  }
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json({ error: "Expected JSON" }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader)
    return Response.json({ error: "Missing request body" }, { status: 400 });
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) {
        await reader.cancel();
        return Response.json(
          { error: "Request is too large" },
          { status: 413 },
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const input = turnRequestSchema.parse(JSON.parse(text));
    const response = await workflow(input, request.signal);
    return Response.json(response, {
      status: response.status === "error" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError || error instanceof SyntaxError
            ? "Invalid request. Check the campaign fields."
            : "Unable to process the request.",
      },
      { status: 400 },
    );
  } finally {
    reader.releaseLock();
  }
}
