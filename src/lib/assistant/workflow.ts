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
} from "../planning/brief";
import type { Dataset } from "../planning/dataset";
import {
  answerEvidence,
  explainClarification,
  explainRecommendation,
} from "../planning/explanations";
import {
  extractionSchema,
  ModelError,
  modelErrors,
  type LanguageModel,
} from "./ollama";
import { recommend, type Recommendation } from "../planning/recommendation";
import {
  pendingFieldsSchema,
  turnRequestSchema,
  turnResponseSchema,
  type TurnResponse,
  type TurnStage,
} from "../chat/protocol";

const State = new StateSchema({
  request: turnRequestSchema,
  brief: briefSchema,
  pending: pendingFieldsSchema.default([]),
  extraction: extractionSchema.nullable().default(null),
  response: turnResponseSchema.nullable().default(null),
});
type Node = GraphNode<typeof State>;
type Turn = { brief: Brief; pending: BriefField[] };

/** Every answer carries the canonical brief, its open questions, and model status. */
const createTurnResponse = (
  { brief, pending }: Turn,
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
  modelStatus: "used",
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
    const extraction = await model.extract(request.message, brief, config.signal);
    // Field changes take precedence over a question or small-talk classification.
    if (Object.keys(extraction.patch).length || extraction.issues.length)
      extraction.intent = "brief";
    return { extraction };
  };
  const merge: Node = ({ brief, pending, extraction }) => {
    const patch: Record<string, unknown> = {};
    const unresolvedFields = new Set(pending);
    for (const [field, change] of Object.entries(extraction?.patch ?? {})) {
      patch[field] = change?.value;
      unresolvedFields.delete(field as BriefField);
    }
    // A newly unsupported or invalid request must invalidate any previous value.
    for (const { field } of extraction?.issues ?? []) {
      patch[field] = null;
      unresolvedFields.add(field);
    }
    // An unknown advertiser name clears metadata, but never blocks planning.
    unresolvedFields.delete("clientName");
    return { brief: mergeBrief(brief, patch), pending: [...unresolvedFields] };
  };
  const respond: Node = async (state) => {
    const { extraction, pending } = state;
    const brief = completeBriefSchema.safeParse(state.brief);
    if (brief.success && pending.length === 0) {
      const recommendation = recommend(brief.data, await loadData());
      return {
        response: createTurnResponse(
          state,
          recommendation.status,
          explainRecommendation(recommendation),
          recommendation,
        ),
      };
    }
    const clarification = explainClarification({
      brief: state.brief,
      changed: Object.keys(extraction?.patch ?? {}) as BriefField[],
      issues: extraction?.issues.filter(({ field }) => pending.includes(field)),
      pending,
      missing: missingFields(state.brief),
    });
    return {
      response: createTurnResponse(state, "clarification", [clarification]),
    };
  };
  const graph = new StateGraph(State)
    .addNode("extract", extract)
    .addNode("merge", merge)
    .addNode("respond", respond)
    .addEdge(START, "extract")
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
    const pending = request.pending;
    const deadline = AbortSignal.timeout(85_000);
    const operation = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      onProgress?.("extract");
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
          const intent = update.extract?.extraction?.intent;
          shouldAnswer = intent === "question" || intent === "other";
        }
        if ("merge" in update) onProgress?.("respond");
        if ("respond" in update) response = update.respond?.response ?? null;
      }
      const verified = turnResponseSchema.parse(response);
      if (!shouldAnswer) return verified;
      // Answer after calculation, so a generation timeout cannot discard the verified plan.
      try {
        operation.throwIfAborted();
        const text = await model.answer(request.message, answerEvidence(verified), request.history, operation);
        operation.throwIfAborted();
        return { ...verified, explanation: [text, ...verified.explanation.slice(1)] };
      } catch (error) {
        if (signal?.aborted) throw error;
        let code: keyof typeof modelErrors | "internal" = "internal";
        if (error instanceof ModelError) code = error.code;
        else if (operation.aborted) code = "timeout";
        return {
          ...verified,
          modelStatus: "unavailable",
          errorCode: code,
          explanation: [`I couldn't generate a tailored reply. ${verified.explanation[0]}`, ...verified.explanation.slice(1)],
        };
      }
    } catch (error) {
      let code: keyof typeof modelErrors | "internal" = "internal";
      if (error instanceof ModelError) code = error.code;
      else if (deadline.aborted) code = "timeout";
      const explanation =
        code === "internal"
          ? "The recommendation could not be completed. Check the dataset and try again."
          : `${modelErrors[code]} Your previous brief is preserved; the new message was not applied. Please try again.`;
      return {
        ...createTurnResponse({ brief: request.brief, pending }, "error", [explanation]),
        modelStatus: "unavailable",
        errorCode: code,
      };
    }
  };
}
