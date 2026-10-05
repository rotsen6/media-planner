import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset, loadExampleBriefs } from "../src/lib/data";
import { recommend } from "../src/lib/recommend";
import type { CompleteBrief } from "../src/lib/brief";

// Regression expectations for the real dataset, which is not part of the repository.
const brief = (
  vertical: CompleteBrief["vertical"],
  geo: CompleteBrief["geo"],
  kpi: CompleteBrief["kpi"],
  budget: number,
  impressionGoal?: number,
): CompleteBrief => ({ vertical, geo, kpi, budget, impressionGoal });
const qsr = brief("QSR", "US", "inViewRate", 15000, 800000);
const finance = brief("Finance", "US", "ctr", 20000, 800000);
const cases = [
  { brief: brief("Retail", "US", "ctr", 30000), winner: "P003" },
  { brief: qsr, winner: "P004" },
  { brief: brief("Entertainment", "EMEA", "ctr", 40000), winner: "P006" },
  { brief: finance, winner: "P003" },
  {
    brief: brief("Travel", "APAC", "inViewRate", 18000, 850000),
    winner: "P006",
  },
];

const dataDir = process.env.DATA_DIR ?? "data/private";
describe.skipIf(!existsSync(resolve(dataDir, "product_catalog.csv")))(
  "real dataset (local only)",
  () => {
    it("validates all supplied rows and balanced history", async () => {
      const data = await loadDataset();
      expect(data.products.size).toBe(6);
      expect(data.historyRows).toBe(1200);
      expect(data.inventory.size).toBe(90);
      expect(data.benchmarks.size).toBe(30);
      expect(
        [...data.benchmarks.values()].every((b) => b.lineItems === 40),
      ).toBe(true);
      expect(await loadExampleBriefs()).toHaveLength(7);
    });
    it.each(cases)(
      "selects $winner for $brief.vertical in $brief.geo",
      async ({ brief, winner }) => {
        expect(recommend(brief, await loadDataset()).recommended?.id).toBe(
          winner,
        );
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
