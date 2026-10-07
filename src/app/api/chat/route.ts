import { z } from "zod";
import { readText, turnRequestSchema, type TurnEvent } from "@/lib/contract";
import { loadDataset } from "@/lib/data";
import { createOllamaModel } from "@/lib/model";
import { createWorkflow } from "@/lib/workflow";

export const maxDuration = 90;
const workflow = createWorkflow({
  model: createOllamaModel(),
  loadData: loadDataset,
});
const reject = (error: string, status: number) =>
  Response.json({ error }, { status });

export async function POST(request: Request) {
  // Next may normalize request.url to localhost even when the browser used
  // 127.0.0.1. Compare the browser origin with the actual HTTP Host instead.
  const origin = request.headers.get("origin");
  if (
    origin &&
    !(
      URL.canParse(origin) &&
      new URL(origin).host === request.headers.get("host")
    )
  )
    return reject("Unsupported origin", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    return reject("Expected JSON", 415);
  try {
    const input = turnRequestSchema.parse(
      JSON.parse(await readText(request.body, 64_000)),
    );
    if (request.headers.get("accept")?.includes("application/x-ndjson")) {
      const cancelled = new AbortController();
      const signal = AbortSignal.any([request.signal, cancelled.signal]);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: TurnEvent) => {
            if (!signal.aborted)
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          try {
            const response = await workflow(input, signal, (stage) =>
              send({ type: "progress", stage }),
            );
            if (!cancelled.signal.aborted) {
              send({ type: "result", response });
              controller.close();
            }
          } catch (error) {
            if (!cancelled.signal.aborted) controller.error(error);
          }
        },
        cancel(reason) {
          cancelled.abort(reason);
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store, no-transform",
        },
      });
    }
    const response = await workflow(input, request.signal);
    return Response.json(response, {
      status: response.status === "error" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof RangeError) return reject("Request is too large", 413);
    return reject(
      error instanceof z.ZodError || error instanceof SyntaxError
        ? "Invalid request. Check the campaign fields."
        : "Unable to process the request.",
      400,
    );
  }
}
