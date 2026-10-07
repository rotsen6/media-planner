import {
  readChunks,
  readText,
  turnEventSchema,
  turnResponseSchema,
  type TurnResponse,
  type TurnStage,
} from "./contract";

const MAX_RESPONSE_BYTES = 262_144;
const UNREADABLE = "The server sent an unreadable response. Please try again.";
const parseJSON = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** Progress is transient; only a complete, validated result can replace the plan. */
export async function readTurnResponse(
  response: Response,
  onProgress: (stage: TurnStage) => void,
): Promise<TurnResponse> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const body = parseJSON(await readText(response.body, MAX_RESPONSE_BYTES));
    const result = turnResponseSchema.safeParse(body);
    if (result.success) return result.data;
    throw new Error(
      body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
        ? body.error
        : UNREADABLE,
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let size = 0;
  let result: TurnResponse | undefined;
  for await (const chunk of readChunks(response.body)) {
    size += chunk.byteLength;
    if (size > MAX_RESPONSE_BYTES) throw new Error(UNREADABLE);
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const event = turnEventSchema.safeParse(parseJSON(line));
      if (!event.success || result) throw new Error(UNREADABLE);
      if (event.data.type === "progress") onProgress(event.data.stage);
      else result = event.data.response;
    }
  }
  if ((buffer + decoder.decode()).trim()) throw new Error(UNREADABLE);
  if (!result)
    throw new Error("The response ended before completion. Please try again.");
  return result;
}
