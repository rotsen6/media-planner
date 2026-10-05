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
  explainAnswer,
  explainClarification,
  explainRecommendation,
} from "./evidence";
import {
  extractionSchema,
  ModelError,
  modelErrors,
  ollamaConfig,
  validateExtraction,
  type LanguageModel,
} from "./model";
import { recommend, type Recommendation } from "./recommend";
import {
  pendingFieldsSchema,
  turnRequestSchema,
  turnResponseSchema,
  type TurnRequest,
  type TurnResponse,
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

/** Every answer carries the canonical brief, its open questions, and whether the model ran. */
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
    const output = await model.extract(request.message, brief, config.signal);
    const extraction = validateExtraction(output, request.message);
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
    const { request, extraction, pending } = state;
    const brief = completeBriefSchema.safeParse(state.brief);
    const result =
      brief.success && !pending.length
        ? recommend(brief.data, await loadData())
        : null;
    const needs = result
      ? ""
      : explainClarification({
          brief: state.brief,
          changed: Object.keys(extraction?.patch ?? {}) as BriefField[],
          issues: extraction?.issues,
          pending,
          missing: missingFields(state.brief),
        });
    const text =
      extraction && extraction.intent !== "brief"
        ? explainAnswer(
            extraction.intent,
            result,
            needs,
            request.mode === "chat" ? request.message : "",
          )
        : result
          ? explainRecommendation(result)
          : [needs];
    return {
      response: turn(state, result?.status ?? "clarification", text, result),
    };
  };
  const graph = new StateGraph(State)
    .addNode("extract", extract, {
      timeout: ollamaConfig.timeoutMs + 2_000,
      retryPolicy: {
        maxAttempts: 2,
        initialInterval: 250,
        jitter: false,
        logWarning: false,
        retryOn: (error: unknown) =>
          error instanceof ModelError && error.retryable,
      },
    })
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
  ): Promise<TurnResponse> => {
    const request = turnRequestSchema.parse(input);
    const pending = request.mode === "chat" ? request.pending : [];
    const deadline = AbortSignal.timeout(85_000);
    try {
      const state = await graph.invoke(
        { request, brief: request.brief, pending },
        {
          recursionLimit: 12,
          signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        },
      );
      return turnResponseSchema.parse(state.response);
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
