import { z } from "zod";
import { briefFieldSchema, briefSchema } from "./brief";
import { recommendationSchema } from "./recommend";

export const pendingFieldsSchema = z
  .array(briefFieldSchema)
  .max(briefFieldSchema.options.length);

export const turnRequestSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("chat"),
    brief: briefSchema,
    message: z.string().trim().min(1).max(4000),
    pending: pendingFieldsSchema.default([]),
  }),
  z.strictObject({ mode: z.literal("brief"), brief: briefSchema }),
]);
export const turnResponseSchema = z.object({
  status: z.enum(["ready", "infeasible", "clarification", "error"]),
  brief: briefSchema,
  missing: z.array(z.string()),
  pending: pendingFieldsSchema,
  recommendation: recommendationSchema.nullable(),
  explanation: z.array(z.string()),
  modelStatus: z.enum(["used", "not_used", "unavailable"]),
  errorCode: z
    .enum(["unavailable", "invalid_output", "timeout", "internal"])
    .optional(),
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type TurnResponse = z.infer<typeof turnResponseSchema>;

/** Read a body as UTF-8 text; throws a RangeError (and cancels the stream) past `limit` bytes. */
export async function readText(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for await (const chunk of body ?? []) {
    size += chunk.byteLength;
    if (size > limit) throw new RangeError(`Body exceeds ${limit} bytes`);
    text += decoder.decode(chunk, { stream: true });
  }
  return text + decoder.decode();
}
