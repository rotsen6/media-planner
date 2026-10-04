import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset, loadExampleBriefs } from "../src/lib/data";
import { recommend } from "../src/lib/recommend";
import { createWorkflow } from "../src/lib/workflow";
import type { Brief, CompleteBrief } from "../src/lib/brief";
import type { LanguageModel } from "../src/lib/model";

// These are regression expectations, not labels supplied by the assessment.
// The evaluator's private fixtures are imported locally and excluded from publication.
const brief = (
  vertical: CompleteBrief["vertical"],
  geo: CompleteBrief["geo"],
  kpi: CompleteBrief["kpi"],
  budget: number,
  impressionGoal?: number,
): CompleteBrief => ({ vertical, geo, kpi, budget, impressionGoal });
const qsr = brief("QSR", "US", "inViewRate", 15000, 800000);
const finance = brief("Finance", "US", "ctr", 20000, 800000);
const cases: { brief: Brief; winner?: string; missing?: string[] }[] = [
  { brief: brief("Retail", "US", "ctr", 30000), winner: "P003" },
  { brief: qsr, winner: "P004" },
  { brief: brief("Entertainment", "EMEA", "ctr", 40000), winner: "P006" },
  { brief: finance, winner: "P003" },
  {
    brief: brief("Travel", "APAC", "inViewRate", 18000, 850000),
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

const dataDir = process.env.DATA_DIR ?? "data/private";
describe.skipIf(!existsSync(resolve(dataDir, "product_catalog.csv")))(
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
      expect(recommend(qsr, data).recommended).toMatchObject({
        id: "P004",
        spend: 14949,
        unspentBudget: 51,
        impressions: 1661000,
      });
      const result = recommend(finance, data);
      expect(
        result.evaluatedProducts.find((p) => p.productId === "P005"),
      ).toMatchObject({ budgetImpressions: 625000, reason: "budget_goal" });
      expect(result.recommended?.impressions).toBeCloseTo(1333333.3333333333);
    });
  },
);
