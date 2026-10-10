import {
  GEOS,
  KPI_LABELS,
  KPIS,
  VERTICALS,
  type Brief,
  type BriefField,
  type Kpi,
} from "./brief";
import {
  comparePlans,
  nearlyEqual,
  tolerance,
  type EvaluatedProduct,
  type Plan,
  type Recommendation,
} from "./recommendation";
import type { TurnResponse } from "../chat/protocol";

const format = (options: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", options).format;
export const number = format({ maximumFractionDigits: 1 });
/** Whole impressions, rounded down so a plan never overstates delivery; float noise is not a shortfall. */
export const wholeImpressions = (value: number) =>
  Math.floor(value + tolerance(value, value));
export const impressions = (value: number) => number(wholeImpressions(value));
/** Whole impressions per allocation that add up to the plan's whole total; the last allocation takes the rounding. */
export function allocationImpressions(plan: Plan): number[] {
  const leading = plan.allocations.slice(0, -1).map((allocation) => wholeImpressions(allocation.impressions));
  return [...leading, wholeImpressions(plan.impressions) - leading.reduce((sum, n) => sum + n, 0)];
}
export const percent = format({ style: "percent", maximumFractionDigits: 2 });
const [dollars, cents] = [0, 2].map((maximumFractionDigits) =>
  format({ style: "currency", currency: "USD", maximumFractionDigits }),
);
export const currency = (value: number) =>
  (Number.isInteger(value) ? dollars : cents)(value);
export const kpiLabel = (kpi: string) =>
  (KPI_LABELS[kpi as Kpi] ?? "").toLowerCase();
const precisionNote = (chosen: string, other: string) => chosen === other
  ? "; the difference is below displayed precision" : "";
/** "a", "a and b", "a, b, and c"; the conjunction can be "or". */
export const list = (items: readonly string[], conjunction = "and") =>
  items.length < 3
    ? items.join(` ${conjunction} `)
    : `${items.slice(0, -1).join(", ")}, ${conjunction} ${items.at(-1)}`;

export function productReason(p: EvaluatedProduct, goal?: number | null): string {
  // Shown delivery plus the shortfall adds up to the goal.
  const shortfall = goal == null ? "below your impression goal"
    : `${number(goal - wholeImpressions(p.deliverableImpressions))} below your ${number(goal)} minimum`;
  switch (p.reason) {
    case "no_inventory":
      return "No forecast inventory in this vertical and geography.";
    case "budget_goal":
      return `Your budget buys ${impressions(p.budgetImpressions)} impressions, ${shortfall}.`;
    case "inventory_goal":
      return `Inventory supports ${number(p.availableImpressions)} impressions, ${shortfall}.`;
    case "budget_and_inventory_goal":
      return `Your budget buys ${impressions(p.budgetImpressions)} impressions and inventory supports ${number(p.availableImpressions)}. Delivery is limited to ${impressions(p.deliverableImpressions)}, ${shortfall}.`;
    case "eligible":
      return "Meets the constraints; ranked by historical KPI, forecast confidence, then fixed product ordering.";
  }
}

/** The actual ranking decision, including differences concealed by display rounding. */
export function alternativeReason(
  result: Recommendation,
  alternative: Plan | EvaluatedProduct,
): string {
  const { brief, recommended: plan, bundleSearchUsed } = result;
  if (!plan) return "";
  const otherPlan = "productId" in alternative
    ? { ...alternative, id: alternative.productId, lowestConfidence: alternative.confidence }
    : alternative;
  const kpi = `${bundleSearchUsed ? "blended " : ""}historical ${kpiLabel(brief.kpi)}`;
  const tieBreaker = bundleSearchUsed ? "spend" : "forecast confidence";
  const { criterion } = comparePlans(plan, otherPlan, brief.kpi, bundleSearchUsed);
  if (criterion === "id")
    return `The ${kpi} and ${tieBreaker} tie; fixed product ordering selects ${plan.name}.`;
  let field: Kpi | "spend" | "lowestConfidence" = brief.kpi;
  let prefix = `Lower ${kpi}`;
  if (criterion !== "kpi") {
    field = bundleSearchUsed ? "spend" : "lowestConfidence";
    prefix = `The ${kpi} ties; lower ${tieBreaker}`;
  }
  const formatValue = field === "spend" ? cents : percent;
  const chosen = formatValue(plan[field]);
  const other = formatValue(otherPlan[field]);
  return `${prefix} (${other} vs ${chosen})${precisionNote(chosen, other)}.`;
}

const labels: Record<BriefField, string> = {
  clientName: "client name",
  vertical: "vertical",
  kpi: "primary KPI",
  geo: "geography",
  budget: "budget",
  impressionGoal: "minimum impression goal",
};
/** What each field accepts, from the same lists the schema enforces. */
const choices: Record<BriefField, string> = {
  clientName: "the client or advertiser name",
  vertical: list(VERTICALS, "or"),
  kpi: list(KPIS.map(kpiLabel), "or"),
  geo: list(GEOS, "or"),
  budget: "dollars",
  impressionGoal: "a number of impressions, or no minimum",
};
const verbs = { unsupported: "isn't a supported", invalid: "isn't a valid" };
// Unknown constraints still block a plan; this affects only how we ask for them.
const UNKNOWN =
  /(?:\bnot\b|n't|\bno\b|\bnever\b)[^.]{0,24}\b(provided|said|specified|decided|given|known|sure|chosen|confirmed|determined|mentioned|settled)\b|\b(tbd|tba|unknown|undecided|unspecified|unsure)\b/i;
const shown = (field: BriefField, value: string | number) =>
  ({
    clientName: `client ${value}`,
    vertical: `${value} vertical`,
    kpi: `${kpiLabel(String(value))} as the KPI`,
    geo: `${value} geography`,
    budget: `${currency(Number(value))} budget`,
    impressionGoal: `${impressions(Number(value))} minimum impressions`,
  })[field];

/** One paragraph: what this message set, what it could not use, and what is still needed. */
export function explainClarification({
  brief,
  changed = [],
  issues = [],
  pending,
  missing,
}: {
  brief: Brief;
  changed?: BriefField[];
  issues?: {
    field: BriefField;
    reason: keyof typeof verbs | "ambiguous";
    quote: string;
  }[];
  pending: BriefField[];
  missing: BriefField[];
}): string {
  const flagged = new Set(issues.map((issue) => issue.field));
  const accepted = changed.flatMap((field) => {
    const value = brief[field];
    return value == null || flagged.has(field) ? [] : [shown(field, value)];
  });
  const needed = missing.filter((field) => !flagged.has(field));
  const sentences: string[] = [];
  if (accepted.length) sentences.push(`Got it: ${list(accepted)}.`);
  for (const { field, reason, quote } of issues) {
    if (reason === "ambiguous" || UNKNOWN.test(quote)) {
      sentences.push(`“${quote}” leaves the ${labels[field]} open. What ${labels[field]} should I use (${choices[field]})?`);
    } else {
      sentences.push(`“${quote}” ${verbs[reason]} ${labels[field]}. Please use ${choices[field]}.`);
    }
  }
  if (!issues.length && pending.length)
    sentences.push(`Please settle the ${list(pending.map((field) => labels[field]))}: give a value or drop it if it is optional.`);
  if (needed.length) {
    const fields = list(needed.map((field) => `${labels[field]} (${choices[field]})`));
    sentences.push(`What ${needed.length > 1 ? "are" : "is"} your ${fields}?`);
  }
  return sentences.join(" ");
}

export const caveat =
  "Historical benchmarks are not guaranteed outcomes. History is vertical-specific, has no geography or dates, and inventory has no time dimension.";
/** A product can be included in a bundle even when it cannot meet the brief alone. */
const rejectedOutsidePlan = ({ recommended: plan }: Recommendation, p: EvaluatedProduct) =>
  plan && !p.eligible && !plan.allocations.some((allocation) => allocation.productId === p.productId);
/** Products that rate above the plan but could not be used. */
const rejectedAbovePlan = (
  result: Recommendation,
  p: EvaluatedProduct,
) =>
  rejectedOutsidePlan(result, p) && result.recommended &&
  p[result.brief.kpi] > result.recommended[result.brief.kpi] &&
  !nearlyEqual(p[result.brief.kpi], result.recommended[result.brief.kpi]);

/** Existing evaluation order already puts the strongest rejected product first. */
export function comparisonCandidate(
  result: Recommendation,
): EvaluatedProduct | Plan | undefined {
  if (!result.recommended) return;
  return result.evaluatedProducts.find((p) => rejectedOutsidePlan(result, p)) ??
    result.alternatives[0];
}

const rejectedReason = ({ brief, recommended }: Recommendation, p: EvaluatedProduct) => {
  if (!recommended) return "";
  const shown = percent(p[brief.kpi]);
  return `${p.name} has a higher historical ${kpiLabel(brief.kpi)} (${shown})${precisionNote(shown, percent(recommended[brief.kpi]))}. ${productReason(p, brief.impressionGoal)}`;
};

/** The plan message: the pick, and why the top-KPI product lost when it did. */
export function explainRecommendation(result: Recommendation): string[] {
  const { brief, recommended: plan } = result;
  const kpi = kpiLabel(brief.kpi);
  if (!plan)
    return [
      `No single product${result.bundleSearchUsed ? " or two-product bundle" : ""} can meet these constraints. Try reducing the impression goal or increasing the budget; available inventory may still limit scale.`,
      caveat,
    ];
  const sentences = [
    `${plan.name} is the highest-ranked feasible ${plan.allocations.length === 1 ? "single product" : "two-product fallback"}, with a ${percent(plan[brief.kpi])} historical ${kpi} benchmark.`,
  ];
  const best = comparisonCandidate(result);
  if (best && "eligible" in best && rejectedAbovePlan(result, best))
    sentences.push(rejectedReason(result, best));
  return [sentences.join(" "), caveat];
}

/** Give the model the same constraint and tie decisions that the UI displays. */
export function answerEvidence(response: TurnResponse) {
  const result = response.recommendation;
  if (!result) return response;
  const evaluatedProducts = result.evaluatedProducts.map((product) => {
    let assessment: string;
    if (!product.eligible) {
      assessment = productReason(product, result.brief.impressionGoal);
    } else if (product.productId === result.recommended?.id) {
      assessment = "Selected product.";
    } else {
      assessment = alternativeReason(result, product);
    }
    return { ...product, assessment };
  });
  const alternatives = result.alternatives.map((plan) => ({
    ...plan,
    rankingReason: alternativeReason(result, plan),
  }));
  return { ...response, recommendation: { ...result, evaluatedProducts, alternatives } };
}
