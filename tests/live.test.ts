import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/chat/route";
import type { TurnResponse } from "../src/lib/contract";
import { loadExampleBriefs } from "../src/lib/data";
import { chatRequest } from "./fixtures";

// Opt-in (npm run test:live): the real local model, real data, and the real chat route.
const live = !!process.env.LIVE;
const briefs = live ? await loadExampleBriefs() : [];
const expected = ["P003", "P004", "P006", "P003", "P006", "vertical", "kpi"];
// What the browser sends for a new chat: every field, all null.
const blank = {
  clientName: null,
  vertical: null,
  kpi: null,
  geo: null,
  budget: null,
  impressionGoal: null,
};

async function chat(body: object): Promise<TurnResponse> {
  const json = JSON.stringify({ mode: "chat", ...body });
  const result = await (await POST(chatRequest(json))).json();
  expect(result.modelStatus).toBe("used");
  return result;
}

describe.skipIf(!live)("live model", { timeout: 180_000 }, () => {
  it.each(
    briefs.map((message, i) => ({ message, n: i + 1, want: expected[i] })),
  )("brief $n: $want", async ({ message, n, want }) => {
    const result = await chat({ brief: blank, message });
    if (n <= 5)
      expect(result).toMatchObject({
        status: "ready",
        recommendation: { recommended: { id: want } },
      });
    else
      expect(result).toMatchObject({
        status: "clarification",
        missing: [want],
      });
  });
  it("maps a mobile game to Entertainment and asks only for what is missing", async () => {
    const message =
      "im making a mobile video game and looking to setup an ad campaign";
    expect(await chat({ brief: blank, message })).toMatchObject({
      status: "clarification",
      brief: { vertical: "Entertainment" },
      missing: ["kpi", "geo", "budget"],
      pending: [],
    });
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
});
