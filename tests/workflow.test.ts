import { describe, expect, it, vi } from "vitest";
import { createWorkflow } from "../src/lib/workflow";
import {
  createOllamaModel,
  ModelError,
  type LanguageModel,
} from "../src/lib/model";
import { syntheticData } from "./fixtures";

const complete = {
  vertical: "Finance",
  geo: "US",
  kpi: "ctr",
  budget: 1000,
} as const;
// A new chat sends every field, all null.
const blank = {
  clientName: null,
  vertical: null,
  kpi: null,
  geo: null,
  budget: null,
  impressionGoal: null,
};
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
  extract: vi.fn(async () => output),
});
const workflow = (model: LanguageModel) =>
  createWorkflow({ model, loadData: async () => syntheticData() });
/** One chat turn through a fake model that answers `output`. */
const chat = (
  output: unknown,
  brief: object,
  message: string,
  pending: string[] = [],
) => workflow(fake(output))({ mode: "chat", brief, message, pending });
const ollama = (content: string, init?: ResponseInit) =>
  createOllamaModel({
    fetcher: async () =>
      new Response(JSON.stringify({ message: { content } }), init),
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
  it("uses no model for explicit brief edits", async () => {
    const model = fake();
    const result = await workflow(model)({
      mode: "brief",
      brief: { ...complete, impressionGoal: 80000 },
    });
    expect(result.status).toBe("ready");
    expect(model.extract).not.toHaveBeenCalled();
    expect(result.explanation[0]).toMatch(/Beta.*budget.*50,000.*80,000/);
  });
  it("isolates concurrent briefs and starts fresh invocations without server memory", async () => {
    const run = workflow(fake());
    const [first, second] = await Promise.all([
      run({ mode: "brief", brief: complete }),
      run({ mode: "brief", brief: { ...complete, impressionGoal: 80000 } }),
    ]);
    expect(first.recommendation?.recommended?.id).toBe("B");
    expect(second.recommendation?.recommended?.id).toBe("A");
    expect((await run({ mode: "brief", brief: {} })).missing).toHaveLength(4);
  });
  it.each([
    ["impressionGoal", "lots of impressions", "ambiguous"],
    ["impressionGoal", "the impression goal is not decided", "ambiguous"],
    ["geo", "geography is TBD", "ambiguous"],
    ["budget", "budget is TBD", "ambiguous"],
    ["vertical", "they have not provided their vertical", "unsupported"],
  ] as const)(
    "keeps %s unresolved for '%s' until corrected",
    async (field, quote, reason) => {
      for (const previous of [
        null,
        field === "impressionGoal" ? 80000 : complete[field],
      ]) {
        const first = await chat(
          extraction({ [field]: { value: null, quote } }, [
            { field, reason, quote },
          ]),
          { ...complete, [field]: previous },
          quote,
        );
        expect(first).toMatchObject({
          status: "clarification",
          brief: { [field]: null },
          pending: [field],
          recommendation: null,
        });
        expect(first.explanation[0]).toContain("?");
        expect(first.explanation[0]).not.toContain("supported");
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
  it("clears a previously valid field on an unsupported correction", async () => {
    const result = await chat(
      extraction({ geo: { value: null, quote: "Canada" } }, [
        { field: "geo", reason: "unsupported", quote: "Canada" },
      ]),
      complete,
      "Change geography to Canada",
    );
    expect(result.status).toBe("clarification");
    expect(result.brief.geo).toBeNull();
    expect(result.recommendation).toBeNull();
    expect(result.explanation[0]).toMatch(/Canada.*supported geography/);
  });
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
    { goal: undefined, winner: "B", reason: /Alpha.*Gamma.*lower/ },
    { goal: 80000, winner: "A", reason: /Beta.*budget.*50,000.*80,000/ },
  ])(
    "explains $winner and its alternatives without changing the brief",
    async ({ goal, winner, reason }) => {
      const brief = { ...complete, impressionGoal: goal };
      const result = await chat(
        extraction({}, [], "question"),
        brief,
        "Why that product?",
      );
      expect(result).toMatchObject({
        status: "ready",
        brief,
        recommendation: { recommended: { id: winner } },
      });
      expect(result.explanation[0]).toMatch(reason);
    },
  );
  it.each([
    {
      message: "hi there",
      brief: blank,
      status: "clarification",
      reply: /Hi!.*vertical.*\?/,
    },
    { message: "thanks!", brief: complete, status: "ready", reply: /welcome/i },
  ])(
    "answers '$message' without changing the brief",
    async ({ message, brief, status, reply }) => {
      const result = await chat(extraction({}, [], "other"), brief, message);
      expect(result).toMatchObject({ status, brief });
      expect(result.explanation[0]).toMatch(reply);
    },
  );
  it("treats a question that sets a field as a brief change", async () => {
    const result = await chat(
      extraction({ budget: { value: 2000, quote: "2000" } }, [], "question"),
      complete,
      "What if the budget were 2000?",
    );
    expect(result).toMatchObject({ status: "ready", brief: { budget: 2000 } });
  });
  it("does not turn a negated KPI mention into a selection", async () => {
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
  it("drops issues that reuse one quote for two fields", async () => {
    const quote = "looking to setup an ad campaign";
    const result = await chat(
      extraction({}, [
        { field: "kpi", reason: "unsupported", quote },
        { field: "geo", reason: "unsupported", quote },
      ]),
      blank,
      game,
    );
    expect(result).toMatchObject({
      status: "clarification",
      pending: [],
      missing: ["vertical", "kpi", "geo", "budget"],
    });
    expect(result.explanation.join(" ")).not.toContain("supported");
  });
  it.each([
    [
      "invented quote",
      extraction({ budget: { value: 5000, quote: "$5,000" } }),
    ],
    ["empty output", {}],
    ["derived value", extraction({ ctr: { value: 1, quote: "CTR" } })],
  ])("rejects %s without changing the brief", async (_, output) => {
    const result = await chat(output, complete, "Set CTR to 100%");
    expect(result).toMatchObject({
      status: "error",
      errorCode: "invalid_output",
      brief: complete,
      recommendation: null,
    });
  });
  it("rejects client-supplied rankings and extra input keys", async () => {
    await expect(
      workflow(fake())({
        mode: "brief",
        brief: complete,
        recommendation: { ctr: 1 },
      }),
    ).rejects.toThrow();
  });
  it("retries transient extraction twice, preserves state on failure, and does not loop", async () => {
    const model = fake();
    vi.mocked(model.extract).mockRejectedValue(
      new ModelError("unavailable", true),
    );
    const result = await workflow(model)({
      mode: "chat",
      brief: complete,
      message: "Change budget to $2000",
    });
    expect(model.extract).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "error",
      errorCode: "unavailable",
      brief: complete,
      recommendation: null,
    });
  });
  it("returns verified prose with one extraction call and one evidence load", async () => {
    const model = fake();
    const loadData = vi.fn(async () => syntheticData());
    const run = createWorkflow({ model, loadData });
    const result = await run({
      mode: "chat",
      brief: complete,
      message: "Guarantee 100% CTR",
    });
    expect(result).toMatchObject({ status: "ready", modelStatus: "used" });
    expect(result.explanation[0]).toContain("3% historical click-through rate");
    expect(result.explanation.join(" ")).not.toContain("100%");
    expect(result.explanation.join(" ")).toContain("not guaranteed outcomes");
    expect(result.recommendation?.recommended?.ctr).toBe(0.03);
    expect(model.extract).toHaveBeenCalledTimes(1);
    expect(loadData).toHaveBeenCalledTimes(1);
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
    const result = await workflow(ollama(JSON.stringify(output)))({
      mode: "chat",
      brief: {},
      message: "Finance, EMEA, $25,000. KPI undecided.",
    });
    expect(result).toMatchObject({
      status: "clarification",
      modelStatus: "used",
      missing: ["kpi"],
      brief: { vertical: "Finance", geo: "EMEA", budget: 25000 },
    });
  });
  it("requests JSON and returns the structured content", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ message: { content: JSON.stringify(none) } }),
        ),
    );
    const brief = { ...blank, vertical: "Finance" as const };
    expect(
      await createOllamaModel({ fetcher }).extract("Hello", brief),
    ).toEqual(none);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
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
  it("rejects malformed JSON, wrong envelopes, oversized output, and unavailable models", async () => {
    for (const body of [
      "bad JSON",
      JSON.stringify({ message: {} }),
      "x".repeat(65_000),
    ]) {
      const model = createOllamaModel({
        fetcher: async () => new Response(body),
      });
      await expect(model.extract("Hello", {})).rejects.toMatchObject({
        code: "invalid_output",
      });
    }
    await expect(
      ollama("", { status: 404 }).extract("Hello", {}),
    ).rejects.toMatchObject({
      code: "unavailable",
      retryable: false,
    });
  });
  it("propagates cancellation to HTTP", async () => {
    const model = createOllamaModel({
      timeoutMs: 10,
      fetcher: async (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    });
    await expect(model.extract("Hello", {})).rejects.toMatchObject({
      code: "timeout",
    });
  });
});
