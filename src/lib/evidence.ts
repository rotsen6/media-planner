import type { Brief, BriefField } from "./brief";
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

const needs = {
  vertical: "vertical (Retail, Finance, Travel, QSR, or Entertainment)",
  kpi: "primary KPI (click-through rate or in-view rate)",
  geo: "geography (US, EMEA, or APAC)",
  budget: "budget in dollars",
};
const labels: Record<BriefField, string> = {
  clientName: "client name",
  vertical: "vertical",
  kpi: "primary KPI",
  geo: "geography",
  budget: "budget",
  impressionGoal: "minimum impression goal",
};
const choices: Record<BriefField, string> = {
  clientName: "the client or advertiser name",
  vertical: "Retail, Finance, Travel, QSR, or Entertainment",
  kpi: "click-through rate or in-view rate",
  geo: "US, EMEA, or APAC",
  budget: "a dollar amount",
  impressionGoal: "a number of impressions, or no minimum",
};
const verbs = {
  unsupported: "isn't a supported",
  invalid: "isn't a valid",
  ambiguous: "is ambiguous for the",
};
const shown = (field: BriefField, value: string | number) =>
  ({
    clientName: `client ${value}`,
    vertical: `${value} vertical`,
    kpi: `${kpiLabel(String(value))} as the KPI`,
    geo: `${value} geography`,
    budget: `${currency(Number(value))} budget`,
    impressionGoal: `${number(Number(value))} minimum impressions`,
  })[field];
const list = (items: string[]) =>
  items.length < 3
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

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
  issues?: { field: BriefField; reason: keyof typeof verbs; quote: string }[];
  pending: BriefField[];
  missing: (keyof typeof needs)[];
}): string {
  const flagged = new Set(issues.map((i) => i.field));
  const got = changed.flatMap((field) => {
    const value = brief[field];
    return value == null || flagged.has(field) ? [] : [shown(field, value)];
  });
  const needed = missing.filter((field) => !flagged.has(field));
  return [
    got.length ? `Got it: ${list(got)}.` : "",
    ...issues.map(
      (i) =>
        `“${i.quote}” ${verbs[i.reason]} ${labels[i.field]}. Please use ${choices[i.field]}.`,
    ),
    !issues.length && pending.length
      ? `Please settle the ${list(pending.map((f) => labels[f]))}: give a value, drop it if it is optional, or edit the brief.`
      : "",
    needed.length
      ? `To build your plan I still need your ${list(needed.map((f) => needs[f]))}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
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
