import type { EvaluatedProduct, Recommendation } from "./recommend";

export const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
export const percent = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(value);
export const kpiLabel = (kpi: string) =>
  kpi === "ctr" ? "click-through rate" : "in-view rate";

export function productReason(product: EvaluatedProduct): string {
  switch (product.reason) {
    case "no_inventory":
      return "No forecast inventory in this vertical and geography.";
    case "budget_goal":
      return `Budget buys ${number(product.budgetImpressions)} impressions, below the goal.`;
    case "inventory_goal":
      return `Inventory supports ${number(product.availableImpressions)} impressions, below the goal.`;
    case "budget_and_inventory_goal":
      return "Both budget-supported impressions and inventory fall below the goal.";
    case "eligible":
      return "Meets the constraints; ranked by the primary KPI, then forecast confidence on ties.";
  }
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
