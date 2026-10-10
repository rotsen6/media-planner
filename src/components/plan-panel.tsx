"use client";

import type { ReactNode } from "react";
import type { Brief, BriefField as Field, Kpi } from "@/lib/planning/brief";
import type { Conversation } from "@/lib/chat/conversations";
import {
  alternativeReason,
  comparisonCandidate,
  currency,
  explainRecommendation,
  impressions,
  kpiLabel,
  allocationImpressions,
  number,
  percent,
  productReason,
} from "@/lib/planning/explanations";
import {
  RANKING_POLICY,
  type EvaluatedProduct,
  type Plan,
  type Recommendation,
} from "@/lib/planning/recommendation";
import { Icon } from "./icons";

const LABELS: Record<Field, string> = {
  clientName: "Client name",
  vertical: "Vertical",
  geo: "Geography",
  kpi: "Primary KPI",
  budget: "Budget ceiling",
  impressionGoal: "Minimum impressions",
};
const display = (field: Field, value: Brief[Field], pending: boolean) => {
  if (pending) return `${LABELS[field]} needs confirmation`;
  if (value == null)
    return field === "impressionGoal"
      ? "No minimum impressions"
      : `${LABELS[field]} not set`;
  return field === "kpi"
    ? `Optimize for ${kpiLabel(String(value))}`
    : field === "budget"
      ? `${currency(Number(value))} budget`
      : field === "impressionGoal"
        ? `At least ${impressions(Number(value))} impressions`
        : String(value);
};
const metricLabel = (kpi: Kpi) => (kpi === "ctr" ? "CTR" : kpiLabel(kpi));

function PlanMetrics({
  plan,
  brief,
}: {
  plan: Plan;
  brief: Recommendation["brief"];
}) {
  return (
    <dl className="plan-metrics">
      <div>
        <dt>Historical {metricLabel(brief.kpi)}</dt>
        <dd>{percent(plan[brief.kpi])}</dd>
      </div>
      <div>
        <dt>Estimated impressions</dt>
        <dd>
          {impressions(plan.impressions)}
          {brief.impressionGoal && (
            <span className="metric-note goal-note">
              <Icon name="check" /> Impression goal met
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>Planned spend</dt>
        <dd>
          {currency(plan.spend)}
          <span
            className="budget-bar"
            aria-hidden="true"
            style={{
              background: `linear-gradient(to right, var(--orange) ${Math.min(100, plan.spend / brief.budget * 100)}%, var(--border) 0)`,
            }}
          />
          <span className="metric-note">
            {currency(plan.unspentBudget)} unused of {currency(brief.budget)}
          </span>
        </dd>
      </div>
    </dl>
  );
}

function Confidence({ plan }: { plan: Plan }) {
  return (
    <div className="confidence">
      {plan.allocations.map((allocation) => (
        <div key={allocation.productId}>
          <strong>{percent(allocation.confidence)}</strong>{" "}
          <span>
            {plan.allocations.length > 1
              ? `${allocation.name} inventory confidence`
              : "inventory confidence"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProductStatus({ product }: { product: EvaluatedProduct }) {
  return (
    <span className={product.eligible ? "muted" : "constraint-status"}>
      {product.eligible
        ? "Feasible"
        : product.reason === "no_inventory"
          ? "No inventory"
          : "Below impression goal"}
    </span>
  );
}

function PlanComparison({ result }: { result: Recommendation }) {
  const candidate = comparisonCandidate(result);
  if (!candidate) return null;
  const isProduct = "eligible" in candidate;
  return (
    <section className="plan-comparison" aria-label="Why this plan?">
      <h3>Why this plan?</h3>
      <dl>
        <div>
          <dt>{isProduct ? "Considered product" : "Feasible alternative"}</dt>
          <dd>{candidate.name}</dd>
        </div>
        <div>
          <dt>Historical {metricLabel(result.brief.kpi)}</dt>
          <dd>{percent(candidate[result.brief.kpi])}</dd>
        </div>
        <div>
          <dt>{isProduct ? "Possible" : "Estimated"} impressions</dt>
          <dd>{impressions(isProduct ? candidate.deliverableImpressions : candidate.impressions)}</dd>
        </div>
        {isProduct && (
          <div>
            <dt className="sr-only">Assessment</dt>
            <dd><ProductStatus product={candidate} /></dd>
          </div>
        )}
      </dl>
      <p>
        {isProduct
          ? productReason(candidate, result.brief.impressionGoal)
          : alternativeReason(result, candidate)}
      </p>
    </section>
  );
}

function ComparisonTable({ kpi, products = false, children }: {
  kpi: Kpi;
  products?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="comparison-scroll"
      role="region"
      tabIndex={0}
      aria-label={products ? "Products considered comparison" : "Feasible plan comparison"}
    >
      <table className="comparison-table">
        <caption>
          {products ? "All products considered" : "Feasible plans"}
          {products && (
            <span className="table-note">
              Each product alone; possible spend is not an allocation.
            </span>
          )}
        </caption>
        <thead>
          <tr>
            <th scope="col">{products ? "Product & assessment" : "Plan"}</th>
            <th scope="col">Historical {metricLabel(kpi)}</th>
            <th scope="col">{products ? "Possible impressions" : "Impressions"}</th>
            <th scope="col">{products ? "Possible spend" : "Spend"}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Evidence({ result }: { result: Recommendation }) {
  const { kpi } = result.brief;
  const displayedAllocationImpressions = result.recommended
    ? allocationImpressions(result.recommended)
    : [];
  const plans = result.recommended
    ? [result.recommended, ...result.alternatives]
    : [];
  return (
    <details className="evidence">
      <summary>
        Evidence & alternatives <Icon name="chevron" />
      </summary>
      <div className="evidence-body">
        {plans.length > 0 && (
          <ComparisonTable kpi={kpi}>
            {plans.map((plan, index) => (
              <tr key={plan.id}>
                <th scope="row">
                  {plan.name}
                  <span className="table-note">{index ? "Alternative" : "Recommended"}</span>
                  {index > 0 && <span className="table-note">{alternativeReason(result, plan)}</span>}
                  <Confidence plan={plan} />
                </th>
                <td>{percent(plan[kpi])}</td>
                <td>{impressions(plan.impressions)}</td>
                <td>
                  {currency(plan.spend)}
                  <span className="table-note">{currency(plan.unspentBudget)} unused</span>
                </td>
              </tr>
            ))}
          </ComparisonTable>
        )}
        {result.recommended && (
          <section>
            <h3>Allocation & source evidence</h3>
            {result.recommended.allocations.map((allocation, index) => (
              <div className="evidence-item" key={allocation.productId}>
                <h4>{allocation.name}</h4>
                <p>
                  {currency(allocation.spend)} · {number(displayedAllocationImpressions[index])} impressions
                  · {currency(allocation.cpm)} CPM
                </p>
                <p className="muted small">
                  {number(allocation.availableImpressions)} available impressions ·{" "}
                  {percent(allocation.confidence)} forecast confidence
                </p>
                <p className="muted small">
                  Historical CTR {percent(allocation.ctr)} · In-view rate{" "}
                  {percent(allocation.inViewRate)}
                </p>
                <p className="muted micro">
                  Based on {number(allocation.historyImpressions)} impressions,{" "}
                  {number(allocation.historyClicks)} clicks and{" "}
                  {number(allocation.historyViewableImpressions)} viewable impressions
                  across {number(allocation.historyLineItems)} line items.
                </p>
              </div>
            ))}
          </section>
        )}
        <ComparisonTable kpi={kpi} products>
          {result.evaluatedProducts.map((product) => (
            <tr key={product.productId}>
              <th scope="row">
                {product.name}
                <span className="table-note">
                  <ProductStatus product={product} />. {productReason(product, result.brief.impressionGoal)}
                </span>
              </th>
              <td>
                {percent(product[kpi])}
                <span className="table-note">
                  {percent(product.confidence)} inventory confidence
                </span>
              </td>
              <td>{impressions(product.deliverableImpressions)}</td>
              <td>
                {currency(product.spend)}
                <span className="table-note">{currency(product.cpm)} CPM</span>
              </td>
            </tr>
          ))}
        </ComparisonTable>
        <section className="muted small">
          <h3>How this was calculated</h3>
          <p>
            Benchmarks use total outcomes divided by total historical
            impressions for this vertical. Historical data has no geography or
            dates; inventory has no time dimension.
          </p>
          <p>{RANKING_POLICY.singles}</p>
          {result.bundleSearchUsed && <p>{RANKING_POLICY.bundles}</p>}
          <p className="micro source-version">
            Source version: {result.datasetVersion}
          </p>
        </section>
      </div>
    </details>
  );
}

export function PlanPanel({ chat }: { chat: Conversation }) {
  const result = chat.result?.recommendation;
  const plan = result?.recommended;
  const pair = plan && plan.allocations.length > 1;
  return (
    <aside className="plan-pane" aria-labelledby="plan-heading">
      <div className="panel-heading">
        <h2 id="plan-heading" tabIndex={-1}>
          {result ? "Your plan" : "Your brief"}
        </h2>
      </div>
      <div className="plan-scroll">
        {chat.error && (
          <p className="inline-error" role="alert">{chat.error}</p>
        )}
        <section className="brief-summary">
          <h3>{chat.brief.clientName || "Campaign brief"}</h3>
          {([
            ["vertical", "geo", "kpi"],
            ["budget", "impressionGoal"],
          ] as const).map((fields) => (
            <dl className="brief-metadata" key={fields[0]}>
              {fields.map((key) => (
                <div key={key}>
                  <dt className="sr-only">{LABELS[key]}</dt>
                  <dd>{display(key, chat.brief[key], chat.pending.includes(key))}</dd>
                </div>
              ))}
            </dl>
          ))}
        </section>
        {!result && (
          <p className="muted small">
            {chat.request ? "Updating your plan…" : "Continue in chat to complete or update your brief."}
          </p>
        )}
        {plan && result && (
          <section className="recommended-plan" aria-label="Recommended plan">
            <p className="eyebrow">
              {pair ? "Two-product plan" : "Recommended product"}
            </p>
            <h3 className="plan-name">{plan.name}</h3>
            <p className="plan-rationale">
              {result.brief.impressionGoal
                ? "Meets your impression goal within budget."
                : "Highest-ranked product within your budget and inventory."}
            </p>
            <PlanMetrics plan={plan} brief={result.brief} />
            {pair && (
              <p className="small muted">
                No single product meets your impression goal. This pair
                maximizes the impression-weighted KPI within your limits.
              </p>
            )}
            <Confidence plan={plan} />
            <p className="muted micro benchmark-note">
              Inventory confidence is not a delivery probability. Historical
              benchmarks are not guaranteed outcomes.
            </p>
          </section>
        )}
        {result && !plan && (
          <div className="infeasible">
            <h3>No feasible plan yet</h3>
            <p>{explainRecommendation(result)[0]}</p>
            <p className="muted small">Adjust your campaign details in chat.</p>
          </div>
        )}
        {result && (
          <>
            <PlanComparison result={result} />
            <Evidence result={result} />
          </>
        )}
      </div>
    </aside>
  );
}
