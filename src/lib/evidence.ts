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

const tradeoff = (p: EvaluatedProduct, goal: number) =>
  ({
    no_inventory: "it has no forecast inventory in this vertical and geography",
    budget_goal: `your budget buys only ${number(p.budgetImpressions)} of the ${number(goal)} impressions you need`,
    inventory_goal: `only ${number(p.availableImpressions)} of the ${number(goal)} impressions you need are available`,
    budget_and_inventory_goal: `neither your budget nor its inventory reaches ${number(goal)} impressions`,
    eligible: "",
  })[p.reason];

const caveat =
  "Historical benchmarks are not guaranteed outcomes. History is vertical-specific, has no geography or dates, and inventory has no time dimension.";

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
  const best = result.evaluatedProducts[0];
  if (
    !best.eligible &&
    best[brief.kpi] > plan[brief.kpi] &&
    !plan.legs.some((leg) => leg.productId === best.productId)
  )
    sentences.push(
      `${best.name} has a higher ${kpi} (${percent(best[brief.kpi])}), but ${tradeoff(best, brief.impressionGoal ?? 0)}.`,
    );
  return [sentences.join(" "), caveat];
}

/** Why this plan: what makes it best, what rates higher but does not fit, and what else fits. */
export function explainChoice(result: Recommendation): string {
  const { brief, recommended: plan, alternatives } = result;
  if (!plan) return explainRecommendation(result)[0];
  const kpi = kpiLabel(brief.kpi);
  const rate = (p: { ctr: number; inViewRate: number }) =>
    percent(p[brief.kpi]);
  const goal = brief.impressionGoal ?? 0;
  const single = plan.legs.length === 1;
  const higher = result.evaluatedProducts.filter(
    (p) =>
      !p.eligible &&
      p[brief.kpi] > plan[brief.kpi] &&
      !plan.legs.some((leg) => leg.productId === p.productId),
  );
  const tied = alternatives.filter(
    (a) => Math.abs(a[brief.kpi] - plan[brief.kpi]) < 1e-9,
  );
  const lower = alternatives.filter((a) => !tied.includes(a));
  const unused = plan.unspentBudget
    ? `, leaving ${currency(plan.unspentBudget)} of your budget unused${single ? " because that is all of its inventory here" : ""}`
    : "";
  return [
    single
      ? `${plan.name} has the highest ${kpi} (${rate(plan)}) of the products that fit your budget${goal ? ` and ${number(goal)}-impression goal` : ""}.`
      : `No single product reaches ${number(goal)} impressions within your budget and inventory, so ${plan.name} is the pair with the highest blended ${kpi} (${rate(plan)}).`,
    ...higher.map(
      (p) => `${p.name} rates higher (${rate(p)}), but ${tradeoff(p, goal)}.`,
    ),
    `It buys ${number(plan.impressions)} impressions for ${currency(plan.spend)}${unused}.`,
    tied.length
      ? `${list(tied.map((a) => a.name))} ${tied.length > 1 ? "match" : "matches"} its ${kpi}; ties go to ${single ? "higher forecast confidence" : "greater spend"}.`
      : "",
    lower.length
      ? `${list(lower.map((a) => `${a.name} (${rate(a)})`))} also ${lower.length > 1 ? "fit" : "fits"}, but with a lower ${kpi}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Replies to a question or small talk, from the current plan when there is one. */
export function explainAnswer(
  intent: string | undefined,
  result: Recommendation | null,
  needs: string,
  message: string,
): string[] {
  if (intent === "question")
    return result
      ? [explainChoice(result), caveat]
      : [`I don't have a plan to explain yet. ${needs}`];
  // Small talk: answer a thank-you or a greeting in kind, then offer the next step.
  const opener = /\b(thanks|thank you|thank u|thx|ty|cheers|appreciate)/i.test(
    message,
  )
    ? "You're welcome! "
    : /^\W*(hi|hello|hey|hiya|good (morning|afternoon|evening))\b/i.test(
          message,
        )
      ? "Hi! "
      : "";
  return [
    result
      ? `${opener}I can explain this plan or change it. Feel free to ask why it was chosen, or tell me what to change.`
      : `${opener}I build media plans from a campaign brief. ${needs}`,
  ];
}
