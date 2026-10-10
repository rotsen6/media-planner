import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkflow } from "../src/lib/assistant/workflow";
import {
  createOllamaModel,
  ModelError,
  validateExtraction,
  type LanguageModel,
} from "../src/lib/assistant/ollama";
import { blankBrief as blank, financeBrief as complete, syntheticData } from "./fixtures";

const game =
  "im making a mobile video game and looking to setup an ad campaign";
/** A model answer: changed fields as {value, quote}, issues, and the message's intent. */
const extraction = (patch = {}, issues: object[] = [], intent = "brief") => ({
  intent,
  patch,
  issues,
});
const none = extraction();
const fake = (output: unknown = none): LanguageModel => ({
  extract: vi.fn(async (message) => validateExtraction(output, message)),
  answer: vi.fn(async () => "A grounded explanation."),
});
const workflow = (model: LanguageModel) =>
  createWorkflow({ model, loadData: async () => syntheticData() });
const request = (brief: object, message: string, pending: string[] = []) =>
  ({ brief, message, pending });
/** One chat turn through a fake model that answers `output`. */
const chat = (
  output: unknown,
  brief: object,
  message: string,
  pending: string[] = [],
) => workflow(fake(output))(request(brief, message, pending));
const modelResponse = (content: unknown) => Response.json({
  message: { content: typeof content === "string" ? content : JSON.stringify(content) },
});
/** Unplanned calls succeed, making an extra retry observable in count and result assertions. */
const replies = (...responses: (Response | Error)[]) => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => modelResponse(none));
  for (const response of responses) {
    if (response instanceof Error) fetcher.mockRejectedValueOnce(response);
    else fetcher.mockResolvedValueOnce(response);
  }
  return fetcher;
};
const requestBody = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);
const ollama = (content: unknown) => createOllamaModel({
  fetcher: async () => modelResponse(content),
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("workflow", () => {
  it("clarifies, ends the invocation, and carries corrections across independent turns", async () => {
    const first = await chat(
      extraction({
        geo: { value: "US", quote: "US" },
        budget: { value: 1000, quote: "$1,000" },
      }),
      {},
      "US, $1,000",
    );
    expect(first.status).toBe("clarification");
    expect(first.missing).toEqual(["vertical", "kpi"]);
    const second = await chat(
      extraction({
        vertical: { value: "Finance", quote: "Finance" },
        kpi: { value: "ctr", quote: "CTR" },
      }),
      first.brief,
      "Finance, optimize CTR",
    );
    expect(second.recommendation?.recommended?.id).toBe("B");
    const third = await chat(
      extraction({ impressionGoal: { value: 80000, quote: "80,000" } }),
      second.brief,
      "Actually, at least 80,000 impressions",
    );
    expect(third.recommendation?.recommended?.id).toBe("A");
  });
  it("isolates concurrent briefs and starts fresh invocations without server memory", async () => {
    const run = workflow(fake());
    const [first, second] = await Promise.all([
      run(request(complete, "Keep this brief")),
      run(request({ ...complete, impressionGoal: 80000 }, "Keep this brief")),
    ]);
    expect(first.recommendation?.recommended?.id).toBe("B");
    expect(second.recommendation?.recommended?.id).toBe("A");
    expect((await run(request({}, "Hello"))).missing).toHaveLength(4);
  });
  it.each([
    [false, complete], [false, { ...complete, kpi: null }], [true, complete],
  ])("clears an unknown optional name without requesting it (null patch: %s)", async (nullPatch, brief) => {
    const quote = "client name is unknown";
    const result = await chat(
      nullPatch
        ? extraction({ clientName: { value: null, quote: "unknown" } })
        : extraction({}, [{ field: "clientName", reason: "ambiguous", quote }]),
      { ...brief, clientName: "Orbit" },
      quote,
      ["clientName"],
    );
    expect(result).toMatchObject({
      status: brief.kpi ? "ready" : "clarification",
      brief: { clientName: null },
      pending: [],
      missing: brief.kpi ? [] : ["kpi"],
    });
    expect(result.explanation.join(" ")).not.toContain("name");
  });
  it.each([
    ["impressionGoal", "lots of impressions", "ambiguous"],
    ["impressionGoal", "the impression goal is not decided", "ambiguous"],
    ["geo", "geography is TBD", "ambiguous"],
    ["budget", "budget is TBD", "ambiguous"],
    ["vertical", "they have not provided their vertical", "unsupported"],
    ["geo", "Canada", "unsupported", "Change geography to Canada"],
  ] as const)(
    "keeps %s unresolved for '%s' until corrected",
    async (field, quote, reason, message?: string) => {
      for (const previous of [
        null,
        field === "impressionGoal" ? 80000 : complete[field],
      ]) {
        const first = await chat(
          extraction({ [field]: { value: null, quote } }, [
            { field, reason, quote },
          ]),
          { ...complete, [field]: previous },
          message ?? quote,
        );
        expect(first).toMatchObject({
          status: "clarification",
          brief: { [field]: null },
          pending: [field],
          recommendation: null,
        });
        if (quote === "Canada") expect(first.explanation[0]).toMatch(/Canada.*supported geography/);
        else {
          expect(first.explanation[0]).toContain("?");
          expect(first.explanation[0]).not.toContain("supported");
        }
        const waiting = await chat(none, first.brief, "Okay", first.pending);
        expect(waiting).toMatchObject({
          status: "clarification",
          pending: [field],
          recommendation: null,
        });
        const value = field === "impressionGoal" ? null : complete[field];
        const correction =
          value === null ? "Remove the impression goal" : String(value);
        const resolved = await chat(
          extraction({ [field]: { value, quote: correction } }),
          waiting.brief,
          correction,
          waiting.pending,
        );
        expect(resolved).toMatchObject({
          status: "ready",
          pending: [],
          brief: { [field]: value },
        });
      }
    },
  );
  it("says what it understood and asks once for what is still missing", async () => {
    const result = await chat(
      extraction({
        vertical: { value: "Entertainment", quote: "mobile video game" },
      }),
      blank,
      game,
    );
    expect(result).toMatchObject({
      status: "clarification",
      pending: [],
      missing: ["kpi", "geo", "budget"],
    });
    expect(result.explanation[0]).toContain("Entertainment");
    expect(result.explanation[0].match(/\?/g)).toHaveLength(1);
  });
  it.each([
    { intent: "question", brief: complete, status: "ready" },
    { intent: "other", brief: blank, status: "clarification" },
  ])("answers $intent using verified evidence and recent history", async ({ intent, brief, status }) => {
    const model = fake(extraction({}, [], intent));
    const loadData = vi.fn(async () => syntheticData());
    const history = [{ role: "assistant", text: "Earlier discussion about Alpha." }];
    const result = await createWorkflow({ model, loadData })({ brief, message: "What about that option?", history });
    expect(result).toMatchObject({ status, brief });
    expect(loadData).toHaveBeenCalledTimes(intent === "question" ? 1 : 0);
    expect(result.explanation[0]).toBe("A grounded explanation.");
    expect(model.extract).toHaveBeenCalledOnce();
    expect(model.answer).toHaveBeenCalledExactlyOnceWith("What about that option?", expect.objectContaining({ brief, status }), history, expect.any(AbortSignal));
    const evidence = vi.mocked(model.answer).mock.calls[0][1];
    if (intent === "question") {
      expect(result.recommendation?.recommended?.id).toBe("B");
      expect(evidence.recommendation).toMatchObject({
        recommended: { id: "B", ctr: 0.03 },
        evaluatedProducts: expect.arrayContaining([expect.objectContaining({ name: "Alpha", confidence: 0.7, assessment: expect.stringContaining("2% vs 3%") })]),
      });
    } else expect(evidence.missing).toEqual(["vertical", "kpi", "geo", "budget"]);
  });
  it.each(["unavailable", "invalid_output", "timeout"] as const)(
    "preserves the calculated plan when answering fails: %s", async (code) => {
      const model = fake(extraction({}, [], "question"));
      vi.mocked(model.answer).mockRejectedValue(new ModelError(code));
      const result = await workflow(model)(request(complete, "Why?"));
      expect(result).toMatchObject({ status: "ready", brief: complete, modelStatus: "unavailable", errorCode: code, recommendation: { recommended: { id: "B" } } });
      expect(result.explanation[0]).toMatch(/couldn't generate a tailored reply.*Beta.*3%/);
      expect(model.answer).toHaveBeenCalledOnce();
    },
  );
  it("ignores an invented advertiser-name issue in a product question", async () => {
    const message = "Why not Social Amplifier, with 91% inventory confidence?";
    const brief = { ...complete, clientName: "Stellar Bank" };
    const model = fake(extraction({}, [
      { field: "clientName", reason: "ambiguous", quote: message },
    ], "question"));
    const result = await workflow(model)(request(brief, message));
    expect(result.brief).toEqual(brief);
    expect(model.answer).toHaveBeenCalledOnce();
  });
  it("keeps the verified plan when the overall deadline expires during answering", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const model = fake(extraction({}, [], "question"));
    vi.mocked(model.answer).mockImplementation(async (_message, _evidence, _history, signal) => {
      deadline.abort();
      signal!.throwIfAborted();
      return "unreachable";
    });
    const result = await workflow(model)(request(complete, "Why?"));
    expect(result).toMatchObject({ status: "ready", errorCode: "timeout", recommendation: { recommended: { id: "B" } } });
    expect(result.explanation[0]).toContain("couldn't generate a tailored reply");
  });
  it("treats a question that sets a field as a brief change", async () => {
    const model = fake(extraction({ budget: { value: 2000, quote: "2000" } }, [], "question"));
    const result = await workflow(model)(request(complete, "What if the budget were 2000?"));
    expect(result).toMatchObject({ status: "ready", brief: { budget: 2000 } });
    expect(model.answer).not.toHaveBeenCalled();
  });
  it("preserves the existing KPI when extraction changes only the budget", async () => {
    const result = await chat(
      extraction({ budget: { value: 2000, quote: "2000" } }),
      { ...complete, kpi: "inViewRate" },
      "Make the budget 2000; do not optimize for clicks",
    );
    expect(result).toMatchObject({
      status: "ready",
      brief: { budget: 2000, kpi: "inViewRate" },
    });
  });
  it.each([
    ["A new mobile app", "A new mobile app", "Orbit"],
    ["A Finance brand", "A Finance brand", "Orbit"],
    ["A Finance brand", "Finance brand", "Orbit"],
    ["A new\nmobile app", "A new\nmobile app", "Orbit"],
    ["Our company", "Our company", "Orbit"],
    ['Use "Our Company" as the advertiser name.', "Our Company", "Our Company"],
    ["Description: A new mobile app", "A new mobile app", "Orbit"],
    ["The General", "The General", "The General"],
    ['The app is called "A New Mobile App".', "A New Mobile App", "A New Mobile App"],
    ["Client: A Company", "A Company", "A Company"],
    ["Advertiser: A Company", "A Company", "A Company"],
    ["The client's name is A Company", "A Company", "A Company"],
    ["The advertiser’s name is A Company", "A Company", "A Company"],
    ['The client is "A New Brand". A New Brand wants clicks.', "A New Brand", "A New Brand"],
  ])("distinguishes client names from descriptions: %s", async (message, name, expected) => {
    const result = await chat(
      extraction({ clientName: { value: name, quote: name } }),
      { ...complete, clientName: "Orbit" },
      message,
    );
    expect(result.brief.clientName).toBe(expected);
  });
  it("keeps a field when a null quotes no removal", async () => {
    const result = await chat(
      extraction({
        budget: { value: 2000, quote: "$2,000" },
        impressionGoal: { value: null, quote: "$2,000" },
      }),
      { ...complete, impressionGoal: 80000 },
      "Make it $2,000",
    );
    expect(result.brief).toMatchObject({ budget: 2000, impressionGoal: 80000 });
  });
  it.each([
    [false, "undecided"], [true, "Budget and geography are undecided"],
  ] as const)("clarifies fields sharing a quote (null patches: %s)", async (nullPatch, quote) => {
    const result = await chat(
      extraction(
        nullPatch ? { budget: { value: null, quote }, geo: { value: null, quote } } : {},
        ["budget", "geo"].map((field) => ({ field, reason: "ambiguous", quote })),
      ),
      complete,
      "Budget and geography are undecided",
    );
    expect(result).toMatchObject({
      status: "clarification",
      brief: { budget: null, geo: null },
      pending: ["budget", "geo"],
      recommendation: null,
    });
    const corrected = await chat(
      extraction({ budget: { value: 2000, quote: "$2,000" } }),
      result.brief, "Use $2,000", result.pending,
    );
    expect(corrected).toMatchObject({
      status: "clarification",
      brief: { budget: 2000, geo: null },
      pending: ["geo"],
      recommendation: null,
    });
  });
  it.each([
    [
      "invented quote",
      extraction({ budget: { value: 5000, quote: "$5,000" } }),
    ],
    ["empty output", {}],
    ["intent treated as a campaign field", extraction({}, [{ field: "intent", reason: "ambiguous", quote: "CTR" }], "question")],
    ["derived value", extraction({ ctr: { value: 1, quote: "CTR" } })],
    ["invalid KPI without an issue", extraction({ kpi: { value: "roas", quote: "CTR" } })],
    ["invented patch quote alongside an issue", extraction({ kpi: { value: "roas", quote: "ROAS" } }, [{ field: "kpi", reason: "unsupported", quote: "CTR" }])],
    ["unknown patch field alongside an issue", extraction({ extra: { value: 1, quote: "CTR" } }, [{ field: "kpi", reason: "unsupported", quote: "CTR" }])],
    ["extra patch key alongside an issue", extraction({ kpi: { value: "roas", quote: "CTR", extra: true } }, [{ field: "kpi", reason: "unsupported", quote: "CTR" }])],
    ["extra output key alongside an issue", { ...extraction({}, [{ field: "kpi", reason: "unsupported", quote: "CTR" }]), extra: true }],
  ])("rejects %s without changing the brief", async (_, output) => {
    const result = await chat(output, complete, "Set CTR to 100%");
    expect(result).toMatchObject({
      status: "error",
      errorCode: "invalid_output",
      brief: complete,
      recommendation: null,
    });
  });
  it("clarifies a grounded unsupported KPI even when its patch repeats the unsupported value", async () => {
    const quote = "return on ad spend";
    const result = await chat(
      extraction({ kpi: { value: "roas", quote } }, [{ field: "kpi", reason: "unsupported", quote }]),
      complete,
      "Make return on ad spend our primary KPI.",
    );
    expect(result).toMatchObject({
      status: "clarification", brief: { ...complete, kpi: null },
      pending: ["kpi"], recommendation: null, modelStatus: "used",
    });
    expect(result.explanation[0]).toContain("supported");
  });
  it("rejects client-supplied rankings and extra input keys", async () => {
    await expect(
      workflow(fake())({
        ...request(complete, "Hello"),
        recommendation: { ctr: 1 },
      }),
    ).rejects.toThrow();
  });
  it.each([
    ["unavailable", "unavailable"],
    ["invalid_output", "unavailable"],
    ["unavailable", "invalid_output"],
  ])("shares two extraction calls across %s then %s and preserves the brief", async (first, second) => {
    const fetcher = replies(...[first, second].map((failure) => failure === "unavailable"
      ? new Response(null, { status: 503 }) : modelResponse({})));
    const result = await workflow(createOllamaModel({ fetcher }))(
      request(complete, "Change budget to $2000"),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "error",
      errorCode: second,
      brief: complete,
      recommendation: null,
    });
  });
  it("allows malformed-output recovery to finish within the shared turn deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const fetcher = vi.fn(async () => {
      const first = fetcher.mock.calls.length === 1;
      await new Promise((resolve) => setTimeout(resolve, first ? 40_000 : 10_000));
      return modelResponse(first ? {} : none);
    });
    const result = workflow(createOllamaModel({ fetcher }))(request(complete, "Keep this brief"));
    await vi.advanceTimersByTimeAsync(50_000);
    expect(await result).toMatchObject({ status: "ready", brief: complete });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("Ollama HTTP adapter", () => {
  it("keeps quotes for known fields and an unresolved field in the same response", async () => {
    const output = extraction(
      {
        vertical: { value: "Finance", quote: "Finance" },
        geo: { value: "EMEA", quote: "EMEA" },
        budget: { value: 25000, quote: "$25,000" },
      },
      [{ field: "kpi", reason: "ambiguous", quote: "KPI undecided" }],
    );
    const result = await workflow(ollama(output))(request({}, "Finance, EMEA, $25,000. KPI undecided."));
    expect(result).toMatchObject({
      status: "clarification",
      modelStatus: "used",
      missing: ["kpi"],
      brief: { vertical: "Finance", geo: "EMEA", budget: 25000 },
    });
  });
  it("requests JSON and returns the structured content", async () => {
    const fetcher = replies(modelResponse(none));
    const brief = { ...blank, vertical: "Finance" as const };
    expect(
      await createOllamaModel({ fetcher }).extract("Hello", brief),
    ).toEqual(none);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = requestBody(fetcher.mock.calls[0]);
    expect(body).toMatchObject({
      stream: false,
      options: { temperature: 0 },
      format: "json",
      keep_alive: -1,
    });
    // The model sees only known values; nulls invited invented issues.
    expect(JSON.parse(body.messages[1].content).currentBrief).toEqual({
      vertical: "Finance",
    });
  });
  it.each([true, false])("retries invalid extraction once and validates the retry (valid: %s)", async (valid) => {
    const invalid = { issues: [{ field: "intent", reason: "ambiguous", quote: "Why?" }], intent: "question" };
    const recovered = extraction({}, [], "question");
    const fetcher = replies(modelResponse(invalid), modelResponse(valid ? recovered : invalid));
    const result = createOllamaModel({ fetcher }).extract("Why?", complete);
    if (valid) await expect(result).resolves.toEqual(recovered);
    else await expect(result).rejects.toMatchObject({ code: "invalid_output" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [before, after] = fetcher.mock.calls.map(requestBody);
    expect(after.messages[1]).toEqual(before.messages[1]);
    expect(after.messages[0]).not.toEqual(before.messages[0]);
  });
  it.each([429, 503, "network"])("retries transient extraction failure %s with the same prompt", async (failure) => {
    const first = typeof failure === "number"
      ? new Response(null, { status: failure }) : new TypeError("Connection refused");
    const fetcher = replies(first);
    await expect(createOllamaModel({ fetcher }).extract("Hello", {})).resolves.toEqual(none);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1]!.body).toEqual(fetcher.mock.calls[0][1]!.body);
  });
  it("uses the same transport for bounded plain-text answers without JSON mode", async () => {
    const evidence = await workflow(fake())(request(complete, "Keep this brief"));
    const fetcher = replies(modelResponse(" A grounded answer. "));
    const history = [{ role: "user" as const, text: "What about Alpha?" }];
    expect(await createOllamaModel({ fetcher }).answer("Why?", evidence, history)).toBe("A grounded answer.");
    const body = requestBody(fetcher.mock.calls[0]);
    expect(body.format).toBeUndefined();
    expect(body.messages[1]).toEqual({ role: "user", content: "What about Alpha?" });
    expect(JSON.parse(body.messages[2].content)).toEqual({ evidence, latestMessage: "Why?" });
    for (const content of [" ", "x".repeat(4001)])
      await expect(ollama(content).answer("Why?", evidence, [])).rejects.toMatchObject({ code: "invalid_output" });
  });
  it.each([
    ["malformed JSON", "bad JSON", 200, "invalid_output", 2],
    ["wrong envelope", JSON.stringify({ message: {} }), 200, "invalid_output", 2],
    ["oversized output", "x".repeat(65_000), 200, "invalid_output", 2],
    ["unavailable model", null, 404, "unavailable", 1],
  ] as const)("rejects %s", async (_name, body, status, code, attempts) => {
    const fetcher = replies(...Array.from({ length: attempts }, () => new Response(body, { status })));
    await expect(createOllamaModel({ fetcher }).extract("Hello", {})).rejects.toMatchObject({
      code, retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(attempts);
  });
  it.each([1, 2].flatMap((attempt) =>
    ["timeout", "cancellation"].map((source) => ({ attempt, source })),
  ))("stops HTTP without another retry on $source during extraction attempt $attempt", async ({ attempt, source }) => {
    let calls = 0;
    const model = createOllamaModel({
      timeoutMs: source === "timeout" ? 10 : 1000,
      fetcher: async (_url, options) => {
        if (++calls < attempt) return modelResponse({});
        return new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        });
      },
    });
    const signal = source === "cancellation" ? AbortSignal.timeout(10) : undefined;
    await expect(model.extract("Hello", {}, signal)).rejects.toMatchObject({
      code: "timeout",
    });
    expect(calls).toBe(attempt);
  });
  it("does not start HTTP for an already cancelled extraction", async () => {
    const fetcher = vi.fn();
    await expect(createOllamaModel({ fetcher }).extract("Hello", {}, AbortSignal.abort())).rejects.toMatchObject({ code: "timeout" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
