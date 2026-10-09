import { z } from "zod";
import { briefFieldSchema, briefSchema } from "./brief";
import { recommendationSchema } from "./recommend";

export const pendingFieldsSchema = z
  .array(briefFieldSchema)
  .max(briefFieldSchema.options.length);

export const CHAT_HISTORY_LIMIT = 6;
export const CHAT_HISTORY_TEXT_LIMIT = 1000;
const chatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(CHAT_HISTORY_TEXT_LIMIT),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const turnRequestSchema = z.strictObject({
  brief: briefSchema,
  message: z.string().trim().min(1).max(4000),
  pending: pendingFieldsSchema.default([]),
  history: z.array(chatMessageSchema).max(CHAT_HISTORY_LIMIT).default([]),
});
export const turnResponseSchema = z.object({
  status: z.enum(["ready", "infeasible", "clarification", "error"]),
  brief: briefSchema,
  missing: z.array(z.string()),
  pending: pendingFieldsSchema,
  recommendation: recommendationSchema.nullable(),
  explanation: z.array(z.string()),
  modelStatus: z.enum(["used", "not_used", "unavailable"]), // Read earlier saved plans.
  errorCode: z
    .enum(["unavailable", "invalid_output", "timeout", "internal"])
    .optional(),
});
export type TurnResponse = z.infer<typeof turnResponseSchema>;

export const turnStageSchema = z.enum(["extract", "validate", "respond"]);
export type TurnStage = z.infer<typeof turnStageSchema>;
export const TURN_STAGE_LABELS: Record<TurnStage, string> = {
  extract: "Reading your brief…",
  validate: "Checking campaign details…",
  respond: "Preparing your response…",
};
export const turnEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), stage: turnStageSchema }),
  z.object({ type: z.literal("result"), response: turnResponseSchema }),
]);
export type TurnEvent = z.infer<typeof turnEventSchema>;

/** Use getReader for browsers without ReadableStream's async iterator. */
export async function* readChunks(body: ReadableStream<Uint8Array> | null) {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Read a body as UTF-8 text; throws a RangeError (and cancels the stream) past `limit` bytes. */
export async function readText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of readChunks(body)) {
    size += chunk.byteLength;
    if (size > limit) throw new RangeError(`Body exceeds ${limit} bytes`);
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
