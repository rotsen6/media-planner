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
  fieldLabels,
  mergeBrief,
  missingFields,
  type Brief,
} from "./brief";
import type { Dataset } from "./data";
import { explainRecommendation } from "./evidence";
import {
  extractionSchema,
  ModelError,
  ollamaConfig,
  validateExtraction,
  type LanguageModel,
} from "./model";
import { recommend } from "./recommend";
import {
  pendingFieldsSchema,
  turnRequestSchema,
  turnResponseSchema,
  type TurnResponse,
} from "./workflow-types";
export { turnRequestSchema, turnResponseSchema } from "./workflow-types";
export type { TurnRequest, TurnResponse } from "./workflow-types";
const GraphState = new StateSchema({
  request: turnRequestSchema,
  brief: briefSchema,
  pending: pendingFieldsSchema.default([]),
  extraction: extractionSchema.nullable().default(null),
  response: turnResponseSchema.nullable().default(null),
});

/** Compile once per server module instance. All campaign state is invocation-local. */
export function createWorkflow(deps: {
  model: LanguageModel;
  loadData: () => Promise<Dataset>;
}) {
  const extract: GraphNode<typeof GraphState> = async (state, config) => {
    if (state.request.mode !== "chat") return {};
    const output = await deps.model.extract(
      state.request.message,
      state.brief,
      config.signal,
    );
    try {
      return { extraction: validateExtraction(output, state.request.message) };
    } catch {
      throw new ModelError("invalid_output");
    }
  };
  const merge: GraphNode<typeof GraphState> = (state) => {
    const patch: Brief = { ...state.extraction?.patch };
    // A newly unsupported/invalid request must invalidate any previous value.
    const pending = new Set(state.pending);
    for (const key of Object.keys(patch)) pending.delete(key as keyof Brief);
    for (const issue of state.extraction?.issues ?? []) {
      patch[issue.field] = null;
      pending.add(issue.field);
    }
    return {
      brief: mergeBrief(state.brief, patch),
      pending: [...pending],
    };
  };
  const clarify: GraphNode<typeof GraphState> = (state) => {
    const missing = missingFields(state.brief);
    const issues = state.extraction?.issues ?? [];
    return {
      response: {
        status: "clarification",
        brief: state.brief,
        missing,
        pending: state.pending,
        recommendation: null,
        explanation: [
          ...issues.map(
            (i) =>
              `The requested ${i.field} is ${i.reason}. Please provide a supported value or edit the campaign brief.`,
          ),
          ...(!issues.length && state.pending.length
            ? [
                `Please resolve the earlier question about ${state.pending.join(", ")}. Provide a value, explicitly remove an optional requirement, or edit the brief and recalculate.`,
              ]
            : []),
          ...(missing.length
            ? [
                `To recommend a plan, I need your ${missing.map((key) => fieldLabels[key]).join(", ")}.`,
              ]
            : []),
        ],
        modelStatus: state.request.mode === "chat" ? "used" : "not_used",
      },
    };
  };
  const calculate: GraphNode<typeof GraphState> = async (state) => {
    const result = recommend(
      completeBriefSchema.parse(state.brief),
      await deps.loadData(),
    );
    return {
      response: {
        status: result.status,
        brief: state.brief,
        missing: [],
        pending: [],
        recommendation: result,
        explanation: explainRecommendation(result),
        modelStatus: state.request.mode === "chat" ? "used" : "not_used",
      },
    };
  };
  const graph = new StateGraph(GraphState)
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
    .addConditionalEdges(
      START,
      (s) => (s.request.mode === "chat" ? "extract" : "merge"),
      ["extract", "merge"],
    )
    .addEdge("extract", "merge")
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
    .compile();

  return async (
    input: unknown,
    signal?: AbortSignal,
  ): Promise<TurnResponse> => {
    const request = turnRequestSchema.parse(input);
    try {
      const state = await graph.invoke(
        {
          request,
          brief: request.brief,
          pending: request.mode === "chat" ? request.pending : [],
        },
        {
          recursionLimit: 12,
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(85_000)])
            : AbortSignal.timeout(85_000),
        },
      );
      return turnResponseSchema.parse(state.response);
    } catch (error) {
      const code = error instanceof ModelError ? error.code : "internal";
      return {
        status: "error",
        brief: request.brief,
        missing: missingFields(request.brief),
        pending: request.mode === "chat" ? request.pending : [],
        recommendation: null,
        explanation: [
          code === "internal"
            ? "The recommendation could not be completed. Check the dataset and try again."
            : `${error instanceof Error ? error.message : "The model is unavailable."} Your previous brief is preserved; the new message was not applied. You can edit the brief and calculate without a model.`,
        ],
        modelStatus: "unavailable",
        errorCode: code,
      };
    }
  };
}
