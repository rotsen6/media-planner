import { z } from "zod";
import { briefFieldSchema, briefSchema } from "./brief";
import { recommendationSchema } from "./recommend";

export const pendingFieldsSchema = z
  .array(briefFieldSchema)
  .max(briefFieldSchema.options.length);

export const turnRequestSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("chat"),
      brief: briefSchema,
      message: z.string().trim().min(1).max(4000),
      pending: pendingFieldsSchema.default([]),
    })
    .strict(),
  z.object({ mode: z.literal("brief"), brief: briefSchema }).strict(),
]);
export const turnResponseSchema = z.object({
  status: z.enum(["ready", "infeasible", "clarification", "error"]),
  brief: briefSchema,
  missing: z.array(z.string()),
  pending: pendingFieldsSchema,
  recommendation: recommendationSchema.nullable(),
  explanation: z.array(z.string()),
  modelStatus: z.enum([
    "used",
    "not_used",
    "explanation_fallback", // Read compatibility for existing saved chats.
    "unavailable",
  ]),
  errorCode: z
    .enum(["unavailable", "invalid_output", "timeout", "internal"])
    .optional(),
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type TurnResponse = z.infer<typeof turnResponseSchema>;
