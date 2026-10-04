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
    return { extraction: validateExtraction(output, request.message) };
  };
  const merge: Node = ({ brief, pending, extraction }) => {
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
  const clarify: Node = (state) => {
    const text = explainClarification({
      brief: state.brief,
      changed: Object.keys(state.extraction?.patch ?? {}) as BriefField[],
      issues: state.extraction?.issues,
      pending: state.pending,
      missing: missingFields(state.brief),
    });
    return { response: turn(state, "clarification", [text]) };
  };
  const calculate: Node = async (state) => {
    const brief = completeBriefSchema.parse(state.brief);
    const result = recommend(brief, await loadData());
    return {
      response: turn(
        state,
        result.status,
        explainRecommendation(result),
        result,
      ),
    };
  };
  // Questions and small talk change nothing: reply from the current brief's evidence.
  const answer: Node = async (state) => {
    const brief = completeBriefSchema.safeParse(state.brief);
    const result =
      brief.success && !state.pending.length
        ? recommend(brief.data, await loadData())
        : null;
    const needs = explainClarification({
      brief: state.brief,
      pending: state.pending,
      missing: missingFields(state.brief),
    });
    const { request } = state;
    const message = request.mode === "chat" ? request.message : "";
    const text = explainAnswer(
      state.extraction?.intent,
      result,
      needs,
      message,
    );
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
    .addNode("clarify", clarify)
    .addNode("calculate", calculate)
    .addNode("answer", answer)
    .addConditionalEdges(
      START,
      (s) => (s.request.mode === "chat" ? "extract" : "merge"),
      ["extract", "merge"],
    )
    // Any field set or flagged makes this a brief turn, whatever intent was reported.
    .addConditionalEdges(
      "extract",
      ({ extraction: e }) =>
        !e ||
        e.intent === "brief" ||
        Object.keys(e.patch).length ||
        e.issues.length
          ? "merge"
          : "answer",
      ["merge", "answer"],
    )
    .addConditionalEdges(
      "merge",
      (s) =>
        missingFields(s.brief).length || s.pending.length
          ? "clarify"
          : "calculate",
      ["clarify", "calculate"],
    )
    .addEdge("clarify", END)
    .addEdge("calculate", END)
    .addEdge("answer", END)
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
