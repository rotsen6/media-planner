import {
  END,
  START,
  StateGraph,
  StateSchema,
  type GraphNode,
} from "@langchain/langgraph";
import {
  briefSchema,
  completeBriefSchema,
  mergeBrief,
  missingFields,
  type Brief,
  type BriefField,
} from "./brief";
import type { Dataset } from "./data";
import {
  answerEvidence,
  explainClarification,
  explainRecommendation,
} from "./evidence";
import {
  extractionSchema,
  ModelError,
  modelErrors,
  type LanguageModel,
} from "./model";
import { recommend, type Recommendation } from "./recommend";
import {
  pendingFieldsSchema,
  turnRequestSchema,
  turnResponseSchema,
  type TurnRequest,
  type TurnResponse,
  type TurnStage,
} from "./contract";

const State = new StateSchema({
  request: turnRequestSchema,
  brief: briefSchema,
  pending: pendingFieldsSchema.default([]),
  extraction: extractionSchema.nullable().default(null),
  response: turnResponseSchema.nullable().default(null),
});
type Node = GraphNode<typeof State>;
type Turn = { request: TurnRequest; brief: Brief; pending: BriefField[] };

/** Every answer carries the canonical brief, its open questions, and model status. */
const turn = (
  { request, brief, pending }: Turn,
  status: TurnResponse["status"],
  explanation: string[],
  recommendation: Recommendation | null = null,
): TurnResponse => ({
  status,
  brief,
  missing: missingFields(brief),
  pending,
  recommendation,
  explanation,
  modelStatus: request.mode === "chat" ? "used" : "not_used",
});

/** Compile once per server module instance. All campaign state is invocation-local. */
export function createWorkflow({
  model,
  loadData,
}: {
  model: LanguageModel;
  loadData: () => Promise<Dataset>;
}) {
  const extract: Node = async ({ request, brief }, config) => {
    if (request.mode !== "chat") return {};
    const extraction = await model.extract(request.message, brief, config.signal);
    // Field changes take precedence over a question or small-talk classification.
    if (Object.keys(extraction.patch).length || extraction.issues.length)
      extraction.intent = "brief";
    return { extraction };
  };
  const merge: Node = ({ brief, pending, extraction }) => {
    if (extraction && extraction.intent !== "brief") return {};
    const patch: Record<string, unknown> = {};
    const open = new Set(pending);
    for (const [field, change] of Object.entries(extraction?.patch ?? {})) {
      patch[field] = change?.value;
      open.delete(field as BriefField);
    }
    // A newly unsupported or invalid request must invalidate any previous value.
    for (const { field } of extraction?.issues ?? []) {
      patch[field] = null;
      open.add(field);
    }
    return { brief: mergeBrief(brief, patch), pending: [...open] };
  };
  const respond: Node = async (state) => {
    const { extraction, pending } = state;
    const brief = completeBriefSchema.safeParse(state.brief);
    const result =
      brief.success && !pending.length
        ? recommend(brief.data, await loadData())
        : null;
    const text = result
      ? explainRecommendation(result)
      : [explainClarification({
          brief: state.brief,
          changed: Object.keys(extraction?.patch ?? {}) as BriefField[],
          issues: extraction?.issues,
          pending,
          missing: missingFields(state.brief),
        })];
    return {
      response: turn(state, result?.status ?? "clarification", text, result),
    };
  };
  const graph = new StateGraph(State)
    .addNode("extract", extract)
    .addNode("merge", merge)
    .addNode("respond", respond)
    .addConditionalEdges(
      START,
      (s) => (s.request.mode === "chat" ? "extract" : "merge"),
      ["extract", "merge"],
    )
    .addEdge("extract", "merge")
    .addEdge("merge", "respond")
    .addEdge("respond", END)
    .compile();

  return async (
    input: unknown,
    signal?: AbortSignal,
    onProgress?: (stage: TurnStage) => void,
  ): Promise<TurnResponse> => {
    const request = turnRequestSchema.parse(input);
    const pending = request.mode === "chat" ? request.pending : [];
    const deadline = AbortSignal.timeout(85_000);
    const operation = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      onProgress?.(request.mode === "chat" ? "extract" : "validate");
      const updates = await graph.stream(
        { request, brief: request.brief, pending },
        {
          recursionLimit: 12,
          signal: operation,
          streamMode: "updates",
        },
      );
      let response: TurnResponse | null = null;
      let shouldAnswer = false;
      for await (const update of updates) {
        if ("extract" in update) {
          onProgress?.("validate");
          shouldAnswer = ["question", "other"].includes(update.extract?.extraction?.intent ?? "");
        }
        if ("merge" in update) onProgress?.("respond");
        if ("respond" in update) response = update.respond?.response ?? null;
      }
      const verified = turnResponseSchema.parse(response);
      if (request.mode !== "chat" || !shouldAnswer) return verified;
      // Answer after calculation, so a generation timeout cannot discard the verified plan.
      try {
        operation.throwIfAborted();
        const text = await model.answer(request.message, answerEvidence(verified), request.history, operation);
        operation.throwIfAborted();
        return { ...verified, explanation: [text, ...verified.explanation.slice(1)] };
      } catch (error) {
        if (signal?.aborted) throw error;
        return {
          ...verified,
          modelStatus: "unavailable",
          errorCode: error instanceof ModelError ? error.code : operation.aborted ? "timeout" : "internal",
          explanation: [`I couldn't generate a tailored reply. ${verified.explanation[0]}`, ...verified.explanation.slice(1)],
        };
      }
    } catch (error) {
      const code =
        error instanceof ModelError
          ? error.code
          : deadline.aborted
            ? "timeout"
            : "internal";
      const explanation =
        code === "internal"
          ? "The recommendation could not be completed. Check the dataset and try again."
          : `${modelErrors[code]} Your previous brief is preserved; the new message was not applied. You can edit the brief and calculate without a model.`;
      return {
        ...turn({ request, brief: request.brief, pending }, "error", [
          explanation,
        ]),
        modelStatus: "unavailable",
        errorCode: code,
      };
    }
  };
}
