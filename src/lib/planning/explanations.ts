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
  type EvaluatedProduct,
  type Plan,
  type Recommendation,
} from "./recommendation";
import type { TurnResponse } from "../chat/protocol";

const format = (options: Intl.NumberFormatOptions) =>
  new Intl.NumberFormat("en-US", options).format;
export const number = format({ maximumFractionDigits: 1 });
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
  const gap = goal == null ? "" : number(goal - p.deliverableImpressions);
  const shortfall = goal == null ? "below your impression goal"
    : `${gap === "0" ? "less than 0.1" : gap} below your ${number(goal)} minimum`;
  switch (p.reason) {
    case "no_inventory":
      return "No forecast inventory in this vertical and geography.";
    case "budget_goal":
      return `Your budget buys ${number(p.budgetImpressions)} impressions, ${shortfall}.`;
    case "inventory_goal":
      return `Inventory supports ${number(p.availableImpressions)} impressions, ${shortfall}.`;
    case "budget_and_inventory_goal":
      return `Your budget buys ${number(p.budgetImpressions)} impressions and inventory supports ${number(p.availableImpressions)}. Delivery is limited to ${number(p.deliverableImpressions)}, ${shortfall}.`;
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
  const { criterion } = comparePlans(plan, otherPlan, brief.kpi, bundleSearchUsed);
  if (criterion === "id")
    return `The ${kpi} and ${bundleSearchUsed ? "spend" : "forecast confidence"} tie; fixed product ordering selects ${plan.name}.`;
  const field = criterion === "kpi" ? brief.kpi
    : bundleSearchUsed ? "spend" : "lowestConfidence";
  const formatValue = field === "spend" ? cents : percent;
  const [chosen, other] = [plan, otherPlan].map((p) => formatValue(p[field]));
  const lower = criterion === "kpi" ? kpi
    : bundleSearchUsed ? "spend" : "forecast confidence";
  return `${criterion === "kpi" ? "Lower" : `The ${kpi} ties; lower`} ${lower} (${other} vs ${chosen})${precisionNote(chosen, other)}.`;
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
    impressionGoal: `${number(Number(value))} minimum impressions`,
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
  const flagged = new Set(issues.map((i) => i.field));
  const got = changed.flatMap((field) => {
    const value = brief[field];
    return value == null || flagged.has(field) ? [] : [shown(field, value)];
  });
  const needed = missing.filter((field) => !flagged.has(field));
  return [
    got.length ? `Got it: ${list(got)}.` : "",
    ...issues.map((i) =>
      i.reason === "ambiguous" || UNKNOWN.test(i.quote)
        ? `“${i.quote}” leaves the ${labels[i.field]} open. What ${labels[i.field]} should I use (${choices[i.field]})?`
        : `“${i.quote}” ${verbs[i.reason]} ${labels[i.field]}. Please use ${choices[i.field]}.`,
    ),
    !issues.length && pending.length
      ? `Please settle the ${list(pending.map((f) => labels[f]))}: give a value or drop it if it is optional.`
      : "",
    needed.length
      ? `What ${needed.length > 1 ? "are" : "is"} your ${list(needed.map((f) => `${labels[f]} (${choices[f]})`))}?`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export const caveat =
  "Historical benchmarks are not guaranteed outcomes. History is vertical-specific, has no geography or dates, and inventory has no time dimension.";
/** A bundle leg was selected, even when it could not meet the brief alone. */
const rejectedOutsidePlan = ({ recommended: plan }: Recommendation, p: EvaluatedProduct) =>
  plan && !p.eligible && !plan.legs.some((leg) => leg.productId === p.productId);
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
    `${plan.name} is the highest-ranked feasible ${plan.legs.length === 1 ? "single product" : "two-product fallback"}, with a ${percent(plan[brief.kpi])} historical ${kpi} benchmark.`,
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
  return { ...response, recommendation: {
    ...result,
    evaluatedProducts: result.evaluatedProducts.map((p) => ({
      ...p,
      assessment: !p.eligible ? productReason(p, result.brief.impressionGoal)
        : p.productId === result.recommended?.id ? "Selected product."
        : alternativeReason(result, p),
    })),
    alternatives: result.alternatives.map((p) => ({ ...p, rankingReason: alternativeReason(result, p) })),
  } };
}
