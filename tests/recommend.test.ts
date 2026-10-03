import { describe, expect, it } from "vitest";
import { recommend, validateRecommendation } from "../src/lib/recommend";
import type { CompleteBrief } from "../src/lib/brief";
import { syntheticData } from "./fixtures";

const brief: CompleteBrief = {
  vertical: "Finance",
  geo: "US",
  kpi: "ctr",
  budget: 1000,
};

describe("decision policy", () => {
  it("ranks feasible singles by KPI, caps inventory, and discloses unused budget", () => {
    const result = recommend({ ...brief, budget: 10000 }, syntheticData());
    expect(result.recommended).toMatchObject({
      id: "B",
      spend: 2000,
      impressions: 100000,
      unspentBudget: 8000,
      ctr: 0.03,
    });
    expect(result.alternatives.map((p) => p.id)).toEqual(["A", "C"]);
    expect(result.bundleSearchUsed).toBe(false);
  });
  it("rejects the best benchmark when CPM makes its impression goal unaffordable", () => {
    const result = recommend(
      { ...brief, impressionGoal: 80000 },
      syntheticData(),
    );
    expect(result.recommended?.id).toBe("A");
    expect(result.evaluatedProducts[0]).toMatchObject({
      productId: "B",
      reason: "budget_goal",
      budgetImpressions: 50000,
    });
  });
  it("uses confidence only on KPI ties and does not discount inventory", () => {
    const data = syntheticData();
    data.benchmarks.forEach((b) => {
      b.ctr = 0.02;
      b.clicks = 20;
    });
    expect(recommend(brief, data).recommended?.id).toBe("B");
    const result = recommend({ ...brief, impressionGoal: 100000 }, data);
    expect(result.recommended?.id).toBe("C"); // Alpha and Gamma tie KPI; Gamma has higher confidence.
    expect(result.recommended?.impressions).toBe(100000);
  });
  it("checks exact boundaries without display rounding", () => {
    expect(
      recommend({ ...brief, impressionGoal: 50000 }, syntheticData())
        .recommended?.id,
    ).toBe("B");
    expect(
      recommend(
        { ...brief, budget: 999.999, impressionGoal: 50000 },
        syntheticData(),
      ).recommended?.id,
    ).toBe("A");
    expect(() => recommend({ ...brief, budget: 0 }, syntheticData())).toThrow();
  });
  it("chooses a pair only when singles cannot meet the goal and optimizes the blended rate", () => {
    const result = recommend(
      { ...brief, budget: 3000, impressionGoal: 150000 },
      syntheticData(),
    );
    expect(result.bundleSearchUsed).toBe(true);
    expect(result.recommended?.id).toBe("A+B");
    expect(result.recommended?.legs.map((l) => l.impressions)).toEqual([
      50000, 100000,
    ]);
    expect(result.recommended?.spend).toBe(2500);
    expect(result.recommended?.ctr).toBeCloseTo(0.02666666667);
    // Spending the remaining budget on Alpha would lower the requested rate.
    expect(result.recommended?.unspentBudget).toBe(500);
  });
  it("reports infeasibility if even two products cannot achieve scale", () => {
    const result = recommend(
      { ...brief, budget: 10000, impressionGoal: 250000 },
      syntheticData(),
    );
    expect(result.status).toBe("infeasible");
    expect(result.recommended).toBeNull();
    expect(result.alternatives).toEqual([]);
    expect(result.evaluatedProducts.every((p) => !p.eligible)).toBe(true);
  });
  it("maximizes spend when two-product plans have the same blended KPI", () => {
    const data = syntheticData();
    data.benchmarks.forEach((b) => {
      b.ctr = 0.02;
      b.clicks = 20;
    });
    const result = recommend(
      { ...brief, budget: 3000, impressionGoal: 150000 },
      data,
    );
    expect(result.recommended?.ctr).toBeCloseTo(0.02);
    expect(result.recommended?.spend).toBeCloseTo(3000);
  });
  it("does not invent stock when inventory is zero", () => {
    const data = syntheticData();
    data.inventory.forEach((row) => {
      row.available_imps = 0;
    });
    expect(recommend(brief, data).status).toBe("infeasible");
  });
  it("independently rejects modified derived values", () => {
    const data = syntheticData(),
      result = recommend(brief, data);
    result.recommended!.spend = 1;
    expect(() => validateRecommendation(result, data)).toThrow();
  });
});
