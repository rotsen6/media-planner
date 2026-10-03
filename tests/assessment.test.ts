import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadDataset, loadExampleBriefs } from "../src/lib/data";
import { recommend } from "../src/lib/recommend";
import { createWorkflow } from "../src/lib/workflow";
import type { Brief } from "../src/lib/brief";
import type { LanguageModel } from "../src/lib/model";

// These are regression expectations, not labels supplied by the assessment.
// The evaluator's private fixtures are imported locally and excluded from publication.
const cases: { brief: Brief; winner?: string; missing?: string[] }[] = [
  {
    brief: { vertical: "Retail", geo: "US", kpi: "ctr", budget: 30000 },
    winner: "P003",
  },
  {
    brief: {
      vertical: "QSR",
      geo: "US",
      kpi: "inViewRate",
      budget: 15000,
      impressionGoal: 800000,
    },
    winner: "P004",
  },
  {
    brief: {
      vertical: "Entertainment",
      geo: "EMEA",
      kpi: "ctr",
      budget: 40000,
    },
    winner: "P006",
  },
  {
    brief: {
      vertical: "Finance",
      geo: "US",
      kpi: "ctr",
      budget: 20000,
      impressionGoal: 800000,
    },
    winner: "P003",
  },
  {
    brief: {
      vertical: "Travel",
      geo: "APAC",
      kpi: "inViewRate",
      budget: 18000,
      impressionGoal: 850000,
    },
    winner: "P006",
  },
  {
    brief: { geo: "US", kpi: "inViewRate", budget: 25000 },
    missing: ["vertical"],
  },
  {
    brief: { vertical: "Finance", geo: "EMEA", budget: 25000 },
    missing: ["kpi"],
  },
];
const noModel: LanguageModel = {
  extract: async () => {
    throw new Error("Unexpected model call");
  },
};

describe.skipIf(!existsSync("data/private/product_catalog.csv"))(
  "supplied assessment evidence (local only)",
  () => {
    it("validates all supplied rows and balanced history", async () => {
      const data = await loadDataset();
      expect(data.products).toHaveLength(6);
      expect(data.historyRows).toBe(1200);
      expect(data.inventory).toHaveLength(90);
      expect(data.benchmarks).toHaveLength(30);
      expect(data.benchmarks.every((b) => b.lineItems === 40)).toBe(true);
      expect(await loadExampleBriefs()).toHaveLength(7);
    });
    it.each(cases.map((test, index) => ({ ...test, index })))(
      "handles supplied brief $index after its interpreted fields are supplied",
      async ({ brief, winner, missing }) => {
        const data = await loadDataset();
        const result = await createWorkflow({
          model: noModel,
          loadData: async () => data,
        })({ mode: "brief", brief });
        if (winner) {
          expect(result.status).toBe("ready");
          expect(result.recommendation?.recommended?.id).toBe(winner);
        } else {
          expect(result.status).toBe("clarification");
          expect(result.missing).toEqual(missing);
        }
      },
    );
    it("preserves the 51-dollar QSR edge and the Finance CPM constraint", async () => {
      const data = await loadDataset();
      const qsr = recommend(
        {
          vertical: "QSR",
          geo: "US",
          kpi: "inViewRate",
          budget: 15000,
          impressionGoal: 800000,
        },
        data,
      );
      expect(qsr.recommended).toMatchObject({
        id: "P004",
        spend: 14949,
        unspentBudget: 51,
        impressions: 1661000,
      });
      const finance = recommend(
        {
          vertical: "Finance",
          geo: "US",
          kpi: "ctr",
          budget: 20000,
          impressionGoal: 800000,
        },
        data,
      );
      expect(
        finance.evaluatedProducts.find((p) => p.productId === "P005"),
      ).toMatchObject({ budgetImpressions: 625000, reason: "budget_goal" });
      expect(finance.recommended?.impressions).toBeCloseTo(1333333.3333333333);
    });
  },
);
