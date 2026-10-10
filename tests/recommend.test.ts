import { describe, expect, it } from "vitest";
import {
  comparePlans,
  recommend,
  validateRecommendation,
} from "../src/lib/planning/recommendation";
import {
  alternativeReason,
  comparisonCandidate,
  explainRecommendation,
  productReason,
} from "../src/lib/planning/explanations";
import { financeBrief as brief, syntheticData } from "./fixtures";

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
    expect(comparisonCandidate(result)).toBe(result.alternatives[0]);
    expect(alternativeReason(result, result.alternatives[0]))
      .toMatch(/Lower historical.*2% vs 3%/);
    const data = syntheticData();
    data.inventory.get("C:Finance:US")!.available_imps = 0;
    const rejected = recommend(brief, data);
    expect(comparisonCandidate(rejected)).toMatchObject({ productId: "C" });
    expect(explainRecommendation(rejected)[0]).not.toContain("Gamma has a higher");
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
    const candidate = result.evaluatedProducts[0];
    const reason = productReason(candidate, result.brief.impressionGoal);
    expect(comparisonCandidate(result)).toBe(candidate);
    expect(reason).toContain("50,000 impressions, 30,000 below your 80,000 minimum");
    expect(explainRecommendation(result)[0]).toContain(reason);
    const data = syntheticData();
    data.benchmarks.get("B:Finance")!.ctr = 0.02 + 5e-10;
    const precise = recommend({ ...brief, impressionGoal: 80000 }, data);
    expect(explainRecommendation(precise)[0])
      .toMatch(/higher historical.*2%.*below displayed precision/);
  });
  it("shows whole impressions, rounding what is bought down and the shortfall up to the goal", () => {
    const data = syntheticData();
    data.products.get("B")!.cpm = 30; // $1,000 buys 33,333.3 impressions
    const goal = { ...brief, impressionGoal: 80000 };
    const budgetShort = recommend(goal, data).evaluatedProducts.find((p) => p.productId === "B")!;
    expect(productReason(budgetShort, 80000)).toBe(
      "Your budget buys 33,333 impressions, 46,667 below your 80,000 minimum.",
    );
    data.inventory.get("B:Finance:US")!.available_imps = 40000;
    const bothShort = recommend(goal, data).evaluatedProducts.find((p) => p.productId === "B")!;
    expect(productReason(bothShort, 80000)).toBe(
      "Your budget buys 33,333 impressions and inventory supports 40,000. Delivery is limited to 33,333, 46,667 below your 80,000 minimum.",
    );
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
    for (const delta of [Number.EPSILON, 5e-10]) {
      data.benchmarks.get("A:Finance")!.ctr = 0.02 + delta;
      const ranked = recommend(brief, data);
      const tied = delta === Number.EPSILON;
      expect(ranked.recommended?.id).toBe(tied ? "B" : "A");
      if (!tied) {
        expect(alternativeReason(ranked, ranked.alternatives[0]))
          .toContain("below displayed precision");
      }
    }
    data.benchmarks.get("A:Finance")!.ctr = 0.02;
    data.inventory.forEach((row) => {
      row.inventory_risk = 0.7;
    });
    const equal = recommend(brief, data);
    expect(equal.recommended?.id).toBe("A");
    expect(alternativeReason(equal, equal.alternatives[0]))
      .toContain("fixed product ordering");
    data.inventory.get("B:Finance:US")!.inventory_risk += Number.EPSILON;
    const precise = recommend(brief, data);
    expect(precise.recommended?.id).toBe("B");
    expect(alternativeReason(precise, precise.alternatives[0]))
      .toMatch(/lower forecast confidence.*below displayed precision/);
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
    expect(
      result.recommended?.allocations.map((allocation) => allocation.impressions),
    ).toEqual([50000, 100000]);
    expect(result.recommended?.spend).toBe(2500);
    expect(result.recommended?.ctr).toBeCloseTo(0.02666666667);
    // Spending the remaining budget on Alpha would lower the requested rate.
    expect(result.recommended?.unspentBudget).toBe(500);
    // Beta rates above the blend, but is already included rather than rejected.
    expect(comparisonCandidate(result)).toMatchObject({ productId: "C" });
    const data = syntheticData();
    data.products.delete("C");
    const onlyPair = recommend({ ...brief, budget: 3000, impressionGoal: 150000 }, data);
    expect(comparisonCandidate(onlyPair)).toBeUndefined();
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
    expect(comparisonCandidate(result)).toBeUndefined();
  });
  it("breaks pair KPI ties by spend, then stable product IDs", () => {
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
    expect(alternativeReason(result, result.alternatives[0])).toContain("lower spend");
    const precise = { ...result.recommended!, spend: 3000 - Number.EPSILON * 2048 };
    expect(comparePlans(result.recommended!, precise, brief.kpi, true).order)
      .toBeLessThan(0);
    expect(alternativeReason(result, precise))
      .toMatch(/lower spend.*below displayed precision/);
    data.products.forEach((p) => {
      p.cpm = 10;
    });
    for (const ids of [
      ["A", "B", "C"],
      ["B", "A", "C"],
      ["C", "B", "A"],
    ]) {
      const reordered = {
        ...data,
        products: new Map(ids.map((id) => [id, data.products.get(id)!])),
      };
      const tied = recommend(
        { ...brief, budget: 2000, impressionGoal: 150000 }, reordered,
      );
      expect(tied.recommended).toMatchObject({ id: "A+B", spend: 2000 });
      expect(alternativeReason(tied, tied.alternatives[0]))
        .toContain("fixed product ordering");
    }
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
