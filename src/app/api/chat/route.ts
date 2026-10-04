import { z } from "zod";
import { readText } from "@/lib/contract";
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
    const input = JSON.parse(await readText(request.body, 16_384));
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
