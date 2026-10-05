import { z } from "zod";
import {
  completeBriefSchema,
  key,
  type CompleteBrief,
  type Kpi,
} from "./brief";
import type { Dataset } from "./data";

const POLICY_VERSION = "ceiling-confidence-tie-single-first-v1";
const amount = z.number().finite().nonnegative();
const rate = amount.max(1);
const rates = { ctr: rate, inViewRate: rate };
const legSchema = z.object({
  productId: z.string(),
  name: z.string(),
  cpm: amount.positive(),
  impressions: amount.positive(),
  spend: amount,
  availableImpressions: amount,
  confidence: rate,
  ...rates,
  historyImpressions: amount.positive(),
  historyClicks: amount,
  historyViewableImpressions: amount,
  historyLineItems: amount.int().positive(),
});
const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  legs: z.array(legSchema).min(1).max(2),
  impressions: amount.positive(),
  spend: amount,
  unspentBudget: amount,
  ...rates,
  lowestConfidence: rate,
});
const evaluatedSchema = z.object({
  productId: z.string(),
  name: z.string(),
  cpm: amount.positive(),
  ...rates,
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
type Facts = ReturnType<typeof facts>;
type RankKey<T> = (item: T) => [kpi: number, tieBreak: number, id: string];

// Only absorb floating-point noise, never round impressions before checking a goal.
const tolerance = (a: number, b: number) =>
  Number.EPSILON * 32 * Math.max(1, Math.abs(a), Math.abs(b));
const near = (a: number, b: number) => Math.abs(a - b) <= tolerance(a, b);
const atLeast = (a: number, b: number) => a >= b - tolerance(a, b);
const atMost = (a: number, b: number) => a <= b + tolerance(a, b);

/** Higher KPI first (float noise is a tie), then the higher tie-break, then the stable ID. */
function rank<T>(items: T[], key: RankKey<T>): T[] {
  return items.sort((a, b) => {
    const [kpiA, tieA, idA] = key(a);
    const [kpiB, tieB, idB] = key(b);
    return (
      (near(kpiA, kpiB) ? 0 : kpiB - kpiA) ||
      tieB - tieA ||
      idA.localeCompare(idB)
    );
  });
}

/** One product's catalog row, vertical benchmark, and vertical/geo inventory. */
function facts(data: Dataset, brief: CompleteBrief, productId: string) {
  const { vertical, geo } = brief;
  const product = data.products.get(productId);
  const history = data.benchmarks.get(key(productId, vertical));
  const stock = data.inventory.get(key(productId, vertical, geo));
  if (!product || !history || !stock)
    throw new Error("Incomplete evidence for campaign brief");
  return {
    productId,
    name: product.product_name,
    cpm: product.cpm,
    ctr: history.ctr,
    inViewRate: history.inViewRate,
    confidence: stock.inventory_risk,
    availableImpressions: stock.available_imps,
    historyImpressions: history.impressions,
    historyClicks: history.clicks,
    historyViewableImpressions: history.viewableImpressions,
    historyLineItems: history.lineItems,
  };
}

/** One product alone: the budget buys impressions at its CPM; raw inventory caps delivery. */
function evaluate(brief: CompleteBrief, product: Facts): EvaluatedProduct {
  const goal = brief.impressionGoal ?? 0;
  const budgetImpressions = (brief.budget / product.cpm) * 1000;
  const available = product.availableImpressions;
  const deliverableImpressions = Math.min(budgetImpressions, available);
  const budgetShort = !atLeast(budgetImpressions, goal);
  const inventoryShort = !atLeast(available, goal);
  const reason =
    available === 0
      ? "no_inventory"
      : budgetShort && inventoryShort
        ? "budget_and_inventory_goal"
        : budgetShort
          ? "budget_goal"
          : inventoryShort
            ? "inventory_goal"
            : "eligible";
  return {
    ...product,
    budgetImpressions,
    deliverableImpressions,
    spend: (deliverableImpressions * product.cpm) / 1000,
    eligible: reason === "eligible",
    reason,
  };
}

function makePlan(
  brief: CompleteBrief,
  ...allocations: [Facts, number][]
): Plan {
  const legs = allocations.map(([product, impressions]) => ({
    ...product,
    impressions,
    spend: (impressions * product.cpm) / 1000,
  }));
  const sum = (value: (leg: (typeof legs)[number]) => number) =>
    legs.reduce((total, leg) => total + value(leg), 0);
  const impressions = sum((leg) => leg.impressions);
  const spend = sum((leg) => leg.spend);
  // A single leg keeps its benchmark exactly; a pair blends benchmarks by impressions.
  const blend = (kpi: Kpi) =>
    legs.length === 1
      ? legs[0][kpi]
      : sum((leg) => leg.impressions * leg[kpi]) / impressions;
  return {
    id: legs.map((leg) => leg.productId).join("+"),
    name: legs.map((leg) => leg.name).join(" + "),
    legs,
    impressions,
    spend,
    unspentBudget: Math.max(0, brief.budget - spend),
    ctr: blend("ctr"),
    inViewRate: blend("inViewRate"),
    lowestConfidence: Math.min(...legs.map((leg) => leg.confidence)),
  };
}

/**
 * Best allocation across two products. The impression-weighted KPI is
 * linear-fractional, so its optimum over the feasible polygon is a vertex:
 * try every intersection of two of the six constraint lines a·x + b·y = c.
 * Inventory adds across products as impressions, not deduplicated reach.
 */
function bestPair(
  brief: CompleteBrief,
  a: Facts,
  b: Facts,
  key: RankKey<Plan>,
): Plan | undefined {
  const goal = brief.impressionGoal ?? 0;
  const [costA, costB] = [a.cpm / 1000, b.cpm / 1000];
  const [maxA, maxB] = [a.availableImpressions, b.availableImpressions];
  const lines = [
    [1, 0, 0],
    [0, 1, 0],
    [1, 0, maxA],
    [0, 1, maxB],
    [costA, costB, brief.budget],
    [1, 1, goal],
  ];
  const vertices = lines.flatMap(([a1, b1, c1], i) =>
    lines.slice(i + 1).flatMap(([a2, b2, c2]) => {
      const determinant = a1 * b2 - a2 * b1;
      if (Math.abs(determinant) < 1e-14) return [];
      const x = (c1 * b2 - c2 * b1) / determinant;
      const y = (a1 * c2 - a2 * c1) / determinant;
      const feasible =
        x > 0 &&
        y > 0 &&
        atMost(x, maxA) &&
        atMost(y, maxB) &&
        atMost(x * costA + y * costB, brief.budget) &&
        atLeast(x + y, goal);
      return feasible ? [makePlan(brief, [a, x], [b, y])] : [];
    }),
  );
  return rank(vertices, key)[0];
}

/** The calculator has no model, I/O, session state, or side effects. */
export function recommend(input: CompleteBrief, data: Dataset): Recommendation {
  const brief = completeBriefSchema.parse(input);
  const products = [...data.products.keys()].map((id) =>
    facts(data, brief, id),
  );
  const evaluated = products.map((product) => evaluate(brief, product));
  const singles = products.flatMap((product, i) =>
    evaluated[i].eligible
      ? [makePlan(brief, [product, evaluated[i].deliverableImpressions])]
      : [],
  );
  // Pairs are considered only when no single product meets a supplied goal.
  const bundleSearchUsed = !singles.length && !!brief.impressionGoal;
  const key: RankKey<Plan> = (plan) => [
    plan[brief.kpi],
    bundleSearchUsed ? plan.spend : plan.lowestConfidence,
    plan.id,
  ];
  const candidates = rank(
    bundleSearchUsed
      ? products.flatMap((a, i) =>
          products
            .slice(i + 1)
            .flatMap((b) => bestPair(brief, a, b, key) ?? []),
        )
      : singles,
    key,
  );
  const result = recommendationSchema.parse({
    status: candidates.length ? "ready" : "infeasible",
    brief,
    datasetVersion: data.version,
    policyVersion: POLICY_VERSION,
    recommended: candidates[0] ?? null,
    alternatives: candidates.slice(1, 3),
    evaluatedProducts: rank(evaluated, (p) => [
      p[brief.kpi],
      p.confidence,
      p.productId,
    ]),
    bundleSearchUsed,
  });
  validateRecommendation(result, data);
  return result;
}

/** Feasibility invariants, recomputed from the catalog rather than trusted from the plan. */
export function validateRecommendation(result: Recommendation, data: Dataset) {
  const { brief, recommended, alternatives } = result;
  if ((result.status === "ready") !== !!recommended)
    throw new Error("Invalid result status");
  for (const plan of [recommended ?? [], alternatives].flat()) {
    let spend = 0;
    for (const leg of plan.legs) {
      const product = facts(data, brief, leg.productId);
      if (!atMost(leg.impressions, product.availableImpressions))
        throw new Error("Allocation exceeds inventory");
      spend += (leg.impressions * product.cpm) / 1000;
    }
    const impressions = plan.legs.reduce(
      (total, leg) => total + leg.impressions,
      0,
    );
    if (
      new Set(plan.legs.map((leg) => leg.productId)).size < plan.legs.length ||
      !near(plan.spend, spend) ||
      !near(plan.impressions, impressions) ||
      !atMost(spend, brief.budget) ||
      !atLeast(impressions, brief.impressionGoal ?? 0)
    )
      throw new Error("Plan violates campaign constraints or arithmetic");
  }
}
