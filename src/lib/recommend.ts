import { z } from "zod";
import { completeBriefSchema, type CompleteBrief } from "./brief";
import type { Benchmark, Dataset, Inventory, Product } from "./data";

export const POLICY_VERSION = "ceiling-confidence-tie-single-first-v1";
const amount = z.number().finite().nonnegative();
const rate = amount.max(1);
export const legSchema = z.object({
  productId: z.string(),
  name: z.string(),
  cpm: amount.positive(),
  impressions: amount.positive(),
  spend: amount,
  availableImpressions: amount,
  confidence: rate,
  ctr: rate,
  inViewRate: rate,
  historyImpressions: amount.positive(),
  historyClicks: amount,
  historyViewableImpressions: amount,
  historyLineItems: amount.int().positive(),
});
export const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  legs: z.array(legSchema).min(1).max(2),
  impressions: amount.positive(),
  spend: amount,
  unspentBudget: amount,
  ctr: rate,
  inViewRate: rate,
  lowestConfidence: rate,
});
export const evaluatedSchema = z.object({
  productId: z.string(),
  name: z.string(),
  cpm: amount.positive(),
  ctr: rate,
  inViewRate: rate,
  confidence: rate,
  budgetImpressions: amount,
  availableImpressions: amount,
  deliverableImpressions: amount,
  spend: amount,
  eligible: z.boolean(),
  reason: z.enum([
    "eligible",
    "no_inventory",
    "budget_goal",
    "inventory_goal",
    "budget_and_inventory_goal",
  ]),
});
export const recommendationSchema = z.object({
  status: z.enum(["ready", "infeasible"]),
  brief: completeBriefSchema,
  datasetVersion: z.string(),
  policyVersion: z.literal(POLICY_VERSION),
  recommended: planSchema.nullable(),
  alternatives: z.array(planSchema).max(2),
  evaluatedProducts: z.array(evaluatedSchema),
  bundleSearchUsed: z.boolean(),
});
export type Plan = z.infer<typeof planSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type EvaluatedProduct = z.infer<typeof evaluatedSchema>;
type Evidence = {
  product: Product;
  benchmark: Benchmark;
  inventory: Inventory;
};

// Only absorb floating-point noise, never round impressions before checking a goal.
function tolerance(a: number, b: number) {
  return Number.EPSILON * 32 * Math.max(1, Math.abs(a), Math.abs(b));
}
function atLeast(a: number, b: number) {
  return a >= b - tolerance(a, b);
}
function atMost(a: number, b: number) {
  return a <= b + tolerance(a, b);
}

function makePlan(
  brief: CompleteBrief,
  allocations: { source: Evidence; impressions: number }[],
): Plan {
  const legs = allocations.map(
    ({ source: { product: p, benchmark: b, inventory: i }, impressions }) => ({
      productId: p.product_id,
      name: p.product_name,
      cpm: p.cpm,
      impressions,
      spend: (impressions * p.cpm) / 1000,
      availableImpressions: i.available_imps,
      confidence: i.inventory_risk,
      ctr: b.ctr,
      inViewRate: b.inViewRate,
      historyImpressions: b.impressions,
      historyClicks: b.clicks,
      historyViewableImpressions: b.viewableImpressions,
      historyLineItems: b.lineItems,
    }),
  );
  const impressions = legs.reduce((sum, leg) => sum + leg.impressions, 0);
  const spend = legs.reduce((sum, leg) => sum + leg.spend, 0);
  return planSchema.parse({
    id: legs.map((l) => l.productId).join("+"),
    name: legs.map((l) => l.name).join(" + "),
    legs,
    impressions,
    spend,
    unspentBudget: Math.max(0, brief.budget - spend),
    ctr:
      legs.length === 1
        ? legs[0].ctr
        : legs.reduce((sum, l) => sum + l.impressions * l.ctr, 0) / impressions,
    inViewRate:
      legs.length === 1
        ? legs[0].inViewRate
        : legs.reduce((sum, l) => sum + l.impressions * l.inViewRate, 0) /
          impressions,
    lowestConfidence: Math.min(...legs.map((l) => l.confidence)),
  });
}

/**
 * For each pair, optimize the impression-weighted KPI over a bounded polygon.
 * A linear-fractional objective with a positive denominator reaches an optimum
 * at a vertex. Enumerating six constraint lines avoids an opaque solver package.
 * Inventory is additive across products for impressions (not deduplicated reach).
 */
function bestPair(brief: CompleteBrief, a: Evidence, b: Evidence): Plan | null {
  const goal = brief.impressionGoal!;
  const costA = a.product.cpm / 1000,
    costB = b.product.cpm / 1000;
  const maxA = a.inventory.available_imps,
    maxB = b.inventory.available_imps;
  const lines = [
    [1, 0, 0],
    [0, 1, 0],
    [1, 0, maxA],
    [0, 1, maxB],
    [costA, costB, brief.budget],
    [1, 1, goal],
  ];
  let best: Plan | null = null;
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const [aa, ab, ac] = lines[i],
        [ba, bb, bc] = lines[j];
      const determinant = aa * bb - ba * ab;
      if (Math.abs(determinant) < 1e-14) continue;
      const x = (ac * bb - bc * ab) / determinant;
      const y = (aa * bc - ba * ac) / determinant;
      if (
        x <= 0 ||
        y <= 0 ||
        !atMost(x, maxA) ||
        !atMost(y, maxB) ||
        !atMost(x * costA + y * costB, brief.budget) ||
        !atLeast(x + y, goal)
      )
        continue;
      const candidate = makePlan(brief, [
        { source: a, impressions: x },
        { source: b, impressions: y },
      ]);
      if (!best || comparePlans(candidate, best, brief.kpi, true) < 0)
        best = candidate;
    }
  }
  return best;
}

function comparePlans(
  a: Plan,
  b: Plan,
  kpi: CompleteBrief["kpi"],
  bundle: boolean,
) {
  const difference = b[kpi] - a[kpi];
  const rateOrder =
    Math.abs(difference) > tolerance(a[kpi], b[kpi]) ? difference : 0;
  return (
    rateOrder ||
    (bundle ? b.spend - a.spend : b.lowestConfidence - a.lowestConfidence) ||
    a.id.localeCompare(b.id)
  );
}

/** The calculator has no model, I/O, session state, or side effects. */
export function recommend(input: CompleteBrief, data: Dataset): Recommendation {
  const brief = completeBriefSchema.parse(input);
  const sources: Evidence[] = data.products.map((product) => {
    const benchmark = data.benchmarks.find(
      (b) =>
        b.productId === product.product_id && b.vertical === brief.vertical,
    );
    const inventory = data.inventory.find(
      (i) =>
        i.product_id === product.product_id &&
        i.vertical === brief.vertical &&
        i.geo === brief.geo,
    );
    if (!benchmark || !inventory)
      throw new Error("Incomplete evidence for campaign brief");
    return { product, benchmark, inventory };
  });
  const singles: Plan[] = [];
  const evaluatedProducts = sources
    .map((source): EvaluatedProduct => {
      const { product: p, benchmark: b, inventory: i } = source;
      const budgetImpressions = (brief.budget / p.cpm) * 1000;
      const deliverableImpressions = Math.min(
        budgetImpressions,
        i.available_imps,
      );
      const budgetShort =
        brief.impressionGoal != null &&
        !atLeast(budgetImpressions, brief.impressionGoal);
      const inventoryShort =
        brief.impressionGoal != null &&
        !atLeast(i.available_imps, brief.impressionGoal);
      const reason =
        i.available_imps === 0
          ? "no_inventory"
          : budgetShort && inventoryShort
            ? "budget_and_inventory_goal"
            : budgetShort
              ? "budget_goal"
              : inventoryShort
                ? "inventory_goal"
                : "eligible";
      if (reason === "eligible")
        singles.push(
          makePlan(brief, [{ source, impressions: deliverableImpressions }]),
        );
      return {
        productId: p.product_id,
        name: p.product_name,
        cpm: p.cpm,
        ctr: b.ctr,
        inViewRate: b.inViewRate,
        confidence: i.inventory_risk,
        budgetImpressions,
        availableImpressions: i.available_imps,
        deliverableImpressions,
        spend: (deliverableImpressions * p.cpm) / 1000,
        eligible: reason === "eligible",
        reason,
      };
    })
    .sort(
      (a, b) =>
        b[brief.kpi] - a[brief.kpi] ||
        b.confidence - a.confidence ||
        a.productId.localeCompare(b.productId),
    );
  const bundleSearchUsed = singles.length === 0 && brief.impressionGoal != null;
  const candidates = [...singles];
  if (bundleSearchUsed) {
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const plan = bestPair(brief, sources[i], sources[j]);
        if (plan) candidates.push(plan);
      }
    }
  }
  candidates.sort((a, b) => comparePlans(a, b, brief.kpi, bundleSearchUsed));
  const result = recommendationSchema.parse({
    status: candidates.length ? "ready" : "infeasible",
    brief,
    datasetVersion: data.version,
    policyVersion: POLICY_VERSION,
    recommended: candidates[0] ?? null,
    alternatives: candidates.slice(1, 3),
    evaluatedProducts,
    bundleSearchUsed,
  });
  validateRecommendation(result, data);
  return result;
}

/** Independent invariants catch invalid allocations before any explanation is requested. */
export function validateRecommendation(
  result: Recommendation,
  data: Dataset,
): void {
  recommendationSchema.parse(result);
  if (result.datasetVersion !== data.version)
    throw new Error("Evidence version mismatch");
  if ((result.status === "ready") !== (result.recommended !== null))
    throw new Error("Invalid result status");
  for (const plan of [result.recommended, ...result.alternatives]) {
    if (!plan) continue;
    let spend = 0,
      impressions = 0,
      clicks = 0,
      viewable = 0;
    if (
      new Set(plan.legs.map((leg) => leg.productId)).size !== plan.legs.length
    )
      throw new Error("Duplicate allocation");
    for (const leg of plan.legs) {
      const stock = data.inventory.find(
        (i) =>
          i.product_id === leg.productId &&
          i.vertical === result.brief.vertical &&
          i.geo === result.brief.geo,
      );
      const product = data.products.find((p) => p.product_id === leg.productId);
      const benchmark = data.benchmarks.find(
        (b) =>
          b.productId === leg.productId && b.vertical === result.brief.vertical,
      );
      if (
        !stock ||
        !product ||
        !benchmark ||
        !atMost(leg.impressions, stock.available_imps)
      )
        throw new Error("Invalid inventory allocation");
      if (
        leg.cpm !== product.cpm ||
        leg.name !== product.product_name ||
        leg.confidence !== stock.inventory_risk ||
        leg.availableImpressions !== stock.available_imps ||
        leg.ctr !== benchmark.ctr ||
        leg.inViewRate !== benchmark.inViewRate ||
        leg.historyImpressions !== benchmark.impressions ||
        leg.historyClicks !== benchmark.clicks ||
        leg.historyViewableImpressions !== benchmark.viewableImpressions ||
        leg.historyLineItems !== benchmark.lineItems
      )
        throw new Error("Evidence was changed");
      const cost = (leg.impressions * product.cpm) / 1000;
      if (Math.abs(leg.spend - cost) > tolerance(leg.spend, cost))
        throw new Error("Invalid leg cost");
      spend += cost;
      impressions += leg.impressions;
      clicks += leg.impressions * benchmark.ctr;
      viewable += leg.impressions * benchmark.inViewRate;
    }
    const expected: [number, number][] = [
      [plan.spend, spend],
      [plan.impressions, impressions],
      [plan.ctr, clicks / impressions],
      [plan.inViewRate, viewable / impressions],
      [plan.unspentBudget, Math.max(0, result.brief.budget - spend)],
    ];
    if (
      expected.some(
        ([actual, value]) =>
          Math.abs(actual - value) > tolerance(actual, value),
      ) ||
      !atMost(spend, result.brief.budget) ||
      !atLeast(impressions, result.brief.impressionGoal ?? 0)
    ) {
      throw new Error("Plan violates campaign constraints or arithmetic");
    }
  }
}
