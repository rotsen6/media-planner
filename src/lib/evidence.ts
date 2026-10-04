import type { EvaluatedProduct, Recommendation } from "./recommend";

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
  kpi === "ctr" ? "click-through rate" : "in-view rate";

export const productReason = (p: EvaluatedProduct) =>
  ({
    no_inventory: "No forecast inventory in this vertical and geography.",
    budget_goal: `Budget buys ${number(p.budgetImpressions)} impressions, below the goal.`,
    inventory_goal: `Inventory supports ${number(p.availableImpressions)} impressions, below the goal.`,
    budget_and_inventory_goal:
      "Both budget-supported impressions and inventory fall below the goal.",
    eligible:
      "Meets the constraints; ranked by the primary KPI, then forecast confidence on ties.",
  })[p.reason];

const fieldLabels = {
  vertical: "vertical (Retail, Finance, Travel, QSR, or Entertainment)",
  kpi: "primary KPI (click-through rate or in-view rate)",
  geo: "geography (US, EMEA, or APAC)",
  budget: "budget in dollars",
};

/** Invalid values first; earlier open questions only when nothing new is invalid. */
export function explainClarification(
  issues: { field: string; reason: string }[],
  pending: string[],
  missing: (keyof typeof fieldLabels)[],
): string[] {
  const lines = issues.map(
    (i) =>
      `The requested ${i.field} is ${i.reason}. Please provide a supported value or edit the campaign brief.`,
  );
  if (!issues.length && pending.length)
    lines.push(
      `Please resolve the earlier question about ${pending.join(", ")}. Provide a value, explicitly remove an optional requirement, or edit the brief and recalculate.`,
    );
  if (missing.length)
    lines.push(
      `To recommend a plan, I need your ${missing.map((key) => fieldLabels[key]).join(", ")}.`,
    );
  return lines;
}

export function explainRecommendation(result: Recommendation): string[] {
  const plan = result.recommended;
  return [
    plan
      ? `${plan.name} is the highest-ranked feasible ${plan.legs.length === 1 ? "single product" : "two-product fallback"}, with a ${percent(plan[result.brief.kpi])} historical ${kpiLabel(result.brief.kpi)} benchmark.`
      : `No single product${result.bundleSearchUsed ? " or two-product bundle" : ""} can meet these constraints. Try reducing the impression goal or increasing the budget; available inventory may still limit scale.`,
    "Historical benchmarks are not guaranteed outcomes. History is vertical-specific, has no geography or dates, and inventory has no time dimension.",
  ];
}
