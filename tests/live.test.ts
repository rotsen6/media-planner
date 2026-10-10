import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/chat/route";
import type { TurnResponse } from "../src/lib/chat/protocol";
import { loadExampleBriefs } from "../src/lib/planning/dataset";
import { number, percent } from "../src/lib/planning/explanations";
import { blankBrief as blank, chatRequest } from "./fixtures";

// Opt-in (npm run test:live): the real local model, real data, and the real chat route.
const live = !!process.env.LIVE;
const briefs = live ? await loadExampleBriefs() : [];
const expected = ["P003", "P004", "P006", "P003", "P006", "vertical", "kpi"];
const clientNames = ["Acme Shoes", "Burger Bazaar", "CineVerse", "Stellar Bank", "Wanderlust Air", null, null];
async function chat(body: object): Promise<TurnResponse> {
  const json = JSON.stringify(body);
  const result = await (await POST(chatRequest(json))).json();
  expect(result.modelStatus).toBe("used");
  return result;
}

describe.skipIf(!live)("live model", { timeout: 180_000 }, () => {
  it.each(
    briefs.map((message, i) => ({ message, n: i + 1, want: expected[i] })),
  )("brief $n: $want", async ({ message, n, want }) => {
    const result = await chat({ brief: blank, message });
    expect(result.brief.clientName).toBe(clientNames[n - 1]);
    if (n <= 5)
      expect(result).toMatchObject({
        status: "ready",
        recommendation: { recommended: { id: want } },
      });
    else {
      expect(result).toMatchObject({
        status: "clarification",
        missing: [want],
      });
      // These example briefs say a detail is undecided: a question, not an invalid value.
      expect(result.explanation[0]).not.toContain("supported");
    }
  });
  it("maps a mobile game to Entertainment and asks only for what is missing", async () => {
    const message =
      "im making a mobile video game and looking to setup an ad campaign";
    const first = await chat({ brief: blank, message });
    expect(first).toMatchObject({
      status: "clarification",
      brief: { vertical: "Entertainment" },
      missing: ["kpi", "geo", "budget"],
      pending: [],
    });
    // The natural follow-up names the KPI plainly; it must complete the brief.
    const plan = await chat({
      brief: first.brief,
      message: "US, click-through rate, $40,000 budget",
    });
    expect(plan).toMatchObject({
      status: "ready",
      brief: { kpi: "ctr", geo: "US", budget: 40000 },
    });
  });
  it("routes questions, small talk, and what-if changes by intent", async () => {
    const brief = {
      ...blank,
      vertical: "Finance",
      geo: "US",
      kpi: "ctr",
      budget: 20000,
      impressionGoal: 800000,
    };
    const why = await chat({
      brief,
      message: "Why did you pick that product?",
    });
    expect(why).toMatchObject({ status: "ready", brief: { budget: 20000 } });
    expect(why.explanation[0]).toContain(why.recommendation!.recommended!.name);
    const thanks = await chat({ brief: blank, message: "thanks!" });
    expect(thanks.explanation[0]).toMatch(/thank|welcome|glad|happy|anytime/i);
    const whatIf = await chat({
      brief,
      message: "what if the budget were 30k?",
    });
    // A changed budget must not clear the impression goal.
    expect(whatIf).toMatchObject({
      status: "ready",
      brief: { budget: 30000, impressionGoal: 800000 },
    });
  });
  it.each([
    { name: "Finance", brief: { vertical: "Finance", geo: "EMEA", kpi: "ctr", budget: 25000, impressionGoal: null }, message: "Why not attention builder if higher inventory confidence?" },
    { name: "Retail", brief: { clientName: "Acme Shoes", vertical: "Retail", geo: "US", kpi: "ctr", budget: 30000, impressionGoal: null }, message: "why not Attention Builder, with 93% inventory confidence?" },
    { name: "Stellar Bank", brief: { clientName: "Stellar Bank", vertical: "Finance", geo: "US", kpi: "ctr", budget: 20000, impressionGoal: 800000 }, product: "Social Amplifier", message: "Why not Social Amplifier, with 91% inventory confidence?" },
  ])("answers a confidence comparison and resolves a follow-up reference from history: $name", async ({ brief, message, product = "Attention Builder" }) => {
    const first = await chat({ brief, message });
    expect(first.brief).toMatchObject(brief);
    const plan = first.recommendation!;
    const candidate = plan.evaluatedProducts.find((p) => p.name === product)!;
    for (const value of [candidate.ctr, plan.recommended!.ctr])
      expect(first.explanation[0]).toContain(percent(value));
    expect(first.explanation[0]).toMatch(/higher (?:inventory )?confidence/i);
    expect(first.explanation[0]).toMatch(/prioriti[sz]|primary|tie|equal/i);
    const second = await chat({
      brief: first.brief,
      history: [{ role: "user", text: message }, { role: "assistant", text: first.explanation[0].slice(0, 1000) }],
      message: "How many impressions can that alternative deliver for my budget? Give the exact count.",
    });
    expect(second.brief).toEqual(first.brief);
    expect(second.recommendation?.recommended?.id).toBe(plan.recommended?.id);
    expect(second.explanation[0]).toContain(candidate.name);
    expect(second.explanation[0]).toContain(number(candidate.deliverableImpressions));
  });
  it("clears an unsupported geography, then accepts the correction", async () => {
    const unresolved = await chat({
      brief: { vertical: "Finance", kpi: "ctr", geo: "EMEA", budget: 15000 },
      message: "Change geography to Canada.",
    });
    expect(unresolved).toMatchObject({
      status: "clarification",
      brief: { geo: null },
    });
    expect(unresolved.pending).toContain("geo");
    const corrected = await chat({
      brief: unresolved.brief,
      pending: unresolved.pending,
      message: "Use US instead.",
    });
    expect(corrected).toMatchObject({
      status: "ready",
      brief: { geo: "US" },
      pending: [],
    });
  });
  it.each([
    ["Change the advertiser vertical to Healthcare.", "vertical", null],
    ["What if geography were Canada?", "geo", null],
    ["The budget is negative $500.", "budget", null],
    ['Use "Our Company" as the advertiser name.', "clientName", "Our Company"],
  ] as const)("handles the requested field without changing the rest: %s", async (message, field, value) => {
    const brief = {
      clientName: "Acme Shoes", vertical: "Retail", geo: "US", kpi: "ctr",
      budget: 30000, impressionGoal: 700000,
    };
    const result = await chat({ brief, message });
    expect(result.brief).toEqual({ ...brief, [field]: value });
    expect(result.errorCode).toBeUndefined();
    expect(result.status).toBe(value === null ? "clarification" : "ready");
    expect(result.pending).toEqual(value === null ? [field] : []);
    if (value === null) expect(result.recommendation).toBeNull();
  });
});
