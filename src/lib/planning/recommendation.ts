import { z } from "zod";
import {
  completeBriefSchema,
  evidenceKey,
  type CompleteBrief,
  type Kpi,
} from "./brief";
import type { Dataset } from "./dataset";

const POLICY_VERSION = "ceiling-confidence-tie-single-first-v1";
export const RANKING_POLICY = {
  singles: "Raw inventory caps delivery. Feasible single products rank by the requested historical KPI, then higher inventory confidence, then fixed product ID ordering. Two-product bundles are considered only when no single product meets a supplied impression goal.",
  bundles: "Bundles maximize the impression-weighted historical KPI within budget and inventory. Equal-KPI bundles prefer greater planned spend, then fixed product ID ordering; inventory confidence is not a bundle tie-breaker. Product impressions are added; they are not deduplicated audience reach.",
};
const amount = z.number().finite().nonnegative();
const rate = amount.max(1);
const rates = { ctr: rate, inViewRate: rate };
const productFields = {
  productId: z.string(),
  name: z.string(),
  cpm: amount.positive(),
  availableImpressions: amount,
  confidence: rate,
  ...rates,
};
const productAllocationSchema = z.object({
  ...productFields,
  impressions: amount.positive(),
  spend: amount,
  historyImpressions: amount.positive(),
  historyClicks: amount,
  historyViewableImpressions: amount,
  historyLineItems: amount.int().positive(),
});
const planSchema = z.object({
  id: z.string(),
  name: z.string(),
  allocations: z.array(productAllocationSchema).min(1).max(2),
  impressions: amount.positive(),
  spend: amount,
  unspentBudget: amount,
  ...rates,
  lowestConfidence: rate,
});
const evaluatedSchema = z.object({
  ...productFields,
  budgetImpressions: amount,
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
type ProductFacts = ReturnType<typeof getProductFacts>;
type RankValues = [kpi: number, tieBreak: number, id: string];

// Only absorb floating-point noise, never round impressions before checking a goal.
export const tolerance = (a: number, b: number) =>
  Number.EPSILON * 32 * Math.max(1, Math.abs(a), Math.abs(b));
export const nearlyEqual = (a: number, b: number) =>
  Math.abs(a - b) <= tolerance(a, b);
const atLeast = (a: number, b: number) => a >= b - tolerance(a, b);
const atMost = (a: number, b: number) => a <= b + tolerance(a, b);

/** Keep the deciding criterion with the ordering so explanations follow the same policy. */
function compareRank([kpiA, tieA, idA]: RankValues, [kpiB, tieB, idB]: RankValues) {
  if (!nearlyEqual(kpiA, kpiB))
    return { order: kpiB - kpiA, criterion: "kpi" as const };
  if (tieA !== tieB)
    return { order: tieB - tieA, criterion: "secondary" as const };
  return { order: idA.localeCompare(idB), criterion: "id" as const };
}

type RankedPlan = Pick<Plan, "id" | "ctr" | "inViewRate" | "spend" | "lowestConfidence">;
export function comparePlans(a: RankedPlan, b: RankedPlan, kpi: Kpi, bundle: boolean) {
  return compareRank(
    [a[kpi], bundle ? a.spend : a.lowestConfidence, a.id],
    [b[kpi], bundle ? b.spend : b.lowestConfidence, b.id],
  );
}

/** One product's catalog row, vertical benchmark, and vertical/geo inventory. */
function getProductFacts(data: Dataset, brief: CompleteBrief, productId: string) {
  const { vertical, geo } = brief;
  const product = data.products.get(productId);
  const history = data.benchmarks.get(evidenceKey(productId, vertical));
  const stock = data.inventory.get(evidenceKey(productId, vertical, geo));
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
function evaluateSingleProduct(brief: CompleteBrief, product: ProductFacts): EvaluatedProduct {
  const goal = brief.impressionGoal ?? 0;
  const budgetImpressions = (brief.budget / product.cpm) * 1000;
  const available = product.availableImpressions;
  const deliverableImpressions = Math.min(budgetImpressions, available);
  const budgetShort = !atLeast(budgetImpressions, goal);
  const inventoryShort = !atLeast(available, goal);

  let reason: EvaluatedProduct["reason"];
  if (available === 0) {
    reason = "no_inventory";
  } else if (budgetShort && inventoryShort) {
    reason = "budget_and_inventory_goal";
  } else if (budgetShort) {
    reason = "budget_goal";
  } else if (inventoryShort) {
    reason = "inventory_goal";
  } else {
    reason = "eligible";
  }

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
  ...productImpressions: [product: ProductFacts, impressions: number][]
): Plan {
  const allocations = productImpressions.map(([product, impressions]) => ({
    ...product,
    impressions,
    spend: (impressions * product.cpm) / 1000,
  }));
  let impressions = 0;
  let spend = 0;
  for (const allocation of allocations) {
    impressions += allocation.impressions;
    spend += allocation.spend;
  }

  // A single allocation keeps its benchmark exactly; a pair blends benchmarks by impressions.
  const weightedRate = (kpi: Kpi) => {
    if (allocations.length === 1) return allocations[0][kpi];
    let weightedTotal = 0;
    for (const allocation of allocations) {
      weightedTotal += allocation.impressions * allocation[kpi];
    }
    return weightedTotal / impressions;
  };
  return {
    id: allocations.map((allocation) => allocation.productId).join("+"),
    name: allocations.map((allocation) => allocation.name).join(" + "),
    allocations,
    impressions,
    spend,
    unspentBudget: Math.max(0, brief.budget - spend),
    ctr: weightedRate("ctr"),
    inViewRate: weightedRate("inViewRate"),
    lowestConfidence: Math.min(...allocations.map((allocation) => allocation.confidence)),
  };
}

/**
 * Budget, inventory, and the minimum form a polygon of allowed allocations.
 * Along each edge, the weighted rate rises, falls, or stays constant, so a best
 * allocation is at a corner: a point where two of the limits meet.
 * Inventory adds across products as impressions, not deduplicated reach.
 */
function bestPair(
  brief: CompleteBrief,
  productA: ProductFacts,
  productB: ProductFacts,
  compare: (a: Plan, b: Plan) => number,
): Plan | undefined {
  const goal = brief.impressionGoal ?? 0;
  const costPerImpressionA = productA.cpm / 1000;
  const costPerImpressionB = productB.cpm / 1000;
  const inventoryA = productA.availableImpressions;
  const inventoryB = productB.availableImpressions;
  // Each row means: a × impressionsA + b × impressionsB = limit.
  const constraintLines = [
    [1, 0, 0], // No impressions from A.
    [0, 1, 0], // No impressions from B.
    [1, 0, inventoryA], // All inventory from A.
    [0, 1, inventoryB], // All inventory from B.
    [costPerImpressionA, costPerImpressionB, brief.budget], // Full budget.
    [1, 1, goal], // Exactly the minimum impressions.
  ];
  const candidates: Plan[] = [];
  for (let i = 0; i < constraintLines.length; i++) {
    const [a1, b1, limit1] = constraintLines[i];
    for (let j = i + 1; j < constraintLines.length; j++) {
      const [a2, b2, limit2] = constraintLines[j];
      const determinant = a1 * b2 - a2 * b1;
      // Parallel limits have no unique intersection.
      if (Math.abs(determinant) < 1e-14) continue;
      // Solve both boundary equations for the two impression quantities.
      const impressionsA = (limit1 * b2 - limit2 * b1) / determinant;
      const impressionsB = (a1 * limit2 - a2 * limit1) / determinant;
      const spend = impressionsA * costPerImpressionA + impressionsB * costPerImpressionB;
      const feasible =
        impressionsA > 0 &&
        impressionsB > 0 &&
        atMost(impressionsA, inventoryA) &&
        atMost(impressionsB, inventoryB) &&
        atMost(spend, brief.budget) &&
        atLeast(impressionsA + impressionsB, goal);
      if (feasible) {
        candidates.push(makePlan(brief, [productA, impressionsA], [productB, impressionsB]));
      }
    }
  }
  return candidates.sort(compare)[0];
}

/** The calculator has no model, I/O, session state, or side effects. */
export function recommend(input: CompleteBrief, data: Dataset): Recommendation {
  const brief = completeBriefSchema.parse(input);
  const products = [...data.products.keys()]
    .sort()
    .map((id) => getProductFacts(data, brief, id));
  const evaluated: EvaluatedProduct[] = [];
  const candidates: Plan[] = [];
  for (const product of products) {
    const evaluation = evaluateSingleProduct(brief, product);
    evaluated.push(evaluation);
    if (evaluation.eligible) {
      candidates.push(makePlan(brief, [product, evaluation.deliverableImpressions]));
    }
  }
  // Pairs are considered only when no single product meets a supplied goal.
  const bundleSearchUsed = candidates.length === 0 && Boolean(brief.impressionGoal);
  const compare = (a: Plan, b: Plan) =>
    comparePlans(a, b, brief.kpi, bundleSearchUsed).order;
  if (bundleSearchUsed) {
    for (let i = 0; i < products.length; i++) {
      for (let j = i + 1; j < products.length; j++) {
        const pair = bestPair(brief, products[i], products[j], compare);
        if (pair) candidates.push(pair);
      }
    }
  }
  candidates.sort(compare);
  const result = recommendationSchema.parse({
    status: candidates.length ? "ready" : "infeasible",
    brief,
    datasetVersion: data.version,
    policyVersion: POLICY_VERSION,
    recommended: candidates[0] ?? null,
    alternatives: candidates.slice(1, 3),
    evaluatedProducts: evaluated.sort((a, b) =>
      compareRank(
        [a[brief.kpi], a.confidence, a.productId],
        [b[brief.kpi], b.confidence, b.productId],
      ).order,
    ),
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
  const plans = recommended ? [recommended, ...alternatives] : alternatives;
  for (const plan of plans) {
    let spend = 0;
    for (const allocation of plan.allocations) {
      const product = getProductFacts(data, brief, allocation.productId);
      if (!atMost(allocation.impressions, product.availableImpressions))
        throw new Error("Allocation exceeds inventory");
      spend += (allocation.impressions * product.cpm) / 1000;
    }
    const impressions = plan.allocations.reduce(
      (total, allocation) => total + allocation.impressions,
      0,
    );
    if (
      new Set(plan.allocations.map((allocation) => allocation.productId)).size < plan.allocations.length ||
      !nearlyEqual(plan.spend, spend) ||
      !nearlyEqual(plan.impressions, impressions) ||
      !atMost(spend, brief.budget) ||
      !atLeast(impressions, brief.impressionGoal ?? 0)
    )
      throw new Error("Plan violates campaign constraints or arithmetic");
  }
}
