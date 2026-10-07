"use client";

import { Fragment, useState, type InputHTMLAttributes, type ReactNode } from "react";
import {
  GEOS,
  KPI_LABELS,
  KPIS,
  LIMITS,
  REQUIRED_FIELDS,
  VERTICALS,
  type BriefField as Field,
  type Kpi,
} from "@/lib/brief";
import type { Conversation } from "@/lib/conversations";
import {
  alternativeReason,
  comparisonCandidate,
  currency,
  explainRecommendation,
  kpiLabel,
  number,
  percent,
  productReason,
} from "@/lib/evidence";
import {
  RANKING_POLICY,
  type EvaluatedProduct,
  type Plan,
  type Recommendation,
} from "@/lib/recommend";
import { Icon } from "./icons";

type Props = {
  chat: Conversation;
  edit: (field: Field, value: string) => void;
  submit: () => void;
};
const same = (values: readonly string[]) => values.map((v) => [v, v]);
/** One table drives the form (in this order) and the summary labels. */
const FIELDS: Record<
  Field,
  {
    label: string;
    hint?: string;
    description?: string;
    placeholder: string;
    options?: string[][];
    input?: InputHTMLAttributes<HTMLInputElement>;
  }
> = {
  clientName: {
    label: "Client name",
    hint: "Optional",
    placeholder: "e.g. StellarBank",
    input: { maxLength: 120 },
  },
  vertical: {
    label: "Vertical",
    placeholder: "Choose a vertical",
    options: same(VERTICALS),
  },
  geo: {
    label: "Geography",
    placeholder: "Choose a geography",
    options: same(GEOS),
  },
  kpi: {
    label: "Primary KPI",
    placeholder: "Choose a KPI",
    options: KPIS.map((kpi) => [kpi, KPI_LABELS[kpi]]),
  },
  budget: {
    label: "Budget ceiling",
    hint: "USD",
    placeholder: "20,000",
    input: {
      type: "number",
      inputMode: "decimal",
      ...LIMITS.budget,
      step: "any",
      required: true,
    },
  },
  impressionGoal: {
    label: "Minimum impressions",
    hint: "Optional",
    description: "Only recommend plans estimated to deliver at least this many impressions.",
    placeholder: "No minimum",
    input: {
      type: "number",
      inputMode: "numeric",
      ...LIMITS.impressionGoal,
      step: "1",
    },
  },
};
const display = (field: Field, value: string, pending: boolean) => {
  if (pending) return `${FIELDS[field].label} needs confirmation`;
  if (!value.trim())
    return field === "impressionGoal"
      ? "No minimum impressions"
      : `${FIELDS[field].label} not set`;
  return field === "kpi"
    ? `Optimize for ${kpiLabel(value)}`
    : field === "budget"
      ? `${currency(Number(value))} budget`
      : field === "impressionGoal"
        ? `At least ${number(Number(value))} impressions`
        : value;
};
const metricLabel = (kpi: Kpi) => (kpi === "ctr" ? "CTR" : kpiLabel(kpi));

function BriefForm({ chat, edit, submit, done }: Props & { done: () => void }) {
  return (
    <form
      className="brief-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
        done();
      }}
    >
      <p className="muted small">
        Four details are needed to calculate a plan.
      </p>
      {Object.entries(FIELDS).map(
        ([key, { label, hint, description, options, ...rest }]) => {
          const field = key as Field;
          const props = {
            id: `brief-${field}`,
            "aria-describedby": description ? `brief-${field}-hint` : undefined,
            value: chat.form[field],
            onChange: (event: { target: { value: string } }) =>
              edit(field, event.target.value),
          };
          return (
            <Fragment key={field}>
              <label htmlFor={props.id}>
                {label} {hint && <span>{hint}</span>}
              </label>
              {options ? (
                <select {...props} required>
                  <option value="">{rest.placeholder}</option>
                  {options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  {...props}
                  {...rest.input}
                  placeholder={rest.placeholder}
                />
              )}
              {description && (
                <p className="muted micro" id={`${props.id}-hint`}>{description}</p>
              )}
            </Fragment>
          );
        },
      )}
      <button
        className="primary-button calculate"
        type="submit"
        disabled={!!chat.request}
      >
        Calculate plan <Icon name="chevron" />
      </button>
      <p className="muted micro">
        Works without chat. Budget is a ceiling; unused budget is shown.
      </p>
    </form>
  );
}

function PlanMetrics({
  plan,
  brief,
  onAddGoal,
}: {
  plan: Plan;
  brief: Recommendation["brief"];
  onAddGoal: () => void;
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
          {number(plan.impressions)}
          {brief.impressionGoal ? (
            <span className="metric-note goal-note">
              <Icon name="check" /> Impression goal met
            </span>
          ) : (
            <button className="text-button metric-note" onClick={onAddGoal}>
              Add minimum impressions
            </button>
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
      {plan.legs.map((leg) => (
        <div key={leg.productId}>
          <strong>{percent(leg.confidence)}</strong>{" "}
          <span>
            {plan.legs.length > 1
              ? `${leg.name} inventory confidence`
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
          <dd>{number(isProduct ? candidate.deliverableImpressions : candidate.impressions)}</dd>
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
                <td>{number(plan.impressions)}</td>
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
            {result.recommended.legs.map((leg) => (
              <div className="evidence-item" key={leg.productId}>
                <h4>{leg.name}</h4>
                <p>
                  {currency(leg.spend)} · {number(leg.impressions)} impressions
                  · {currency(leg.cpm)} CPM
                </p>
                <p className="muted small">
                  {number(leg.availableImpressions)} available impressions ·{" "}
                  {percent(leg.confidence)} forecast confidence
                </p>
                <p className="muted small">
                  Historical CTR {percent(leg.ctr)} · In-view rate{" "}
                  {percent(leg.inViewRate)}
                </p>
                <p className="muted micro">
                  Based on {number(leg.historyImpressions)} impressions,{" "}
                  {number(leg.historyClicks)} clicks and{" "}
                  {number(leg.historyViewableImpressions)} viewable impressions
                  across {number(leg.historyLineItems)} line items.
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
              <td>{number(product.deliverableImpressions)}</td>
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

export function PlanPanel(props: Props) {
  const { chat, submit } = props;
  const [editing, setEditing] = useState(
    !Object.values(chat.form).some(Boolean),
  );
  const complete = REQUIRED_FIELDS.every((key) => chat.form[key].trim());
  const result = chat.result?.recommendation;
  const plan = result?.recommended;
  const pair = plan && plan.legs.length > 1;
  return (
    <aside className="plan-pane" aria-labelledby="plan-heading">
      <div className="panel-heading">
        <h2 id="plan-heading" tabIndex={-1}>
          {result ? "Your plan" : "Your brief"}
        </h2>
        {!editing && (
          <button className="secondary-button" onClick={() => setEditing(true)}>
            <Icon name="compose" /> Edit brief
          </button>
        )}
      </div>
      <div className="plan-scroll">
        {chat.error && (
          <p className="inline-error" role="alert">
            {chat.error}
          </p>
        )}
        {editing ? (
          <BriefForm
            {...props}
            done={() => {
              setEditing(false);
              requestAnimationFrame(() =>
                document.getElementById("plan-heading")?.focus(),
              );
            }}
          />
        ) : (
          <>
            <section className="brief-summary">
              <h3>{chat.form.clientName || "Campaign brief"}</h3>
              {([
                ["vertical", "geo", "kpi"],
                ["budget", "impressionGoal"],
              ] as const).map((fields) => (
                <dl className="brief-metadata" key={fields[0]}>
                  {fields.map((key) => (
                    <div key={key}>
                      <dt className="sr-only">{FIELDS[key].label}</dt>
                      <dd>
                        {display(key, chat.form[key], chat.pending.includes(key))}
                      </dd>
                    </div>
                  ))}
                </dl>
              ))}
            </section>
            {!result && (
              <div className="brief-next">
                <p className="muted small">
                  {chat.request
                    ? "Updating your plan…"
                    : chat.dirty
                      ? "Your brief has changed. Calculate again to see the updated recommendation."
                      : "Add the missing details in chat or edit your brief here."}
                </p>
                <button
                  className="secondary-button"
                  disabled={!!chat.request}
                  onClick={() => (complete ? submit() : setEditing(true))}
                >
                  {complete ? "Calculate plan" : "Complete brief"}
                  <Icon name="chevron" />
                </button>
              </div>
            )}
            {plan && result && (
              <section
                className="recommended-plan"
                aria-label="Recommended plan"
              >
                <p className="eyebrow">
                  {pair ? "Two-product plan" : "Recommended product"}
                </p>
                <h3 className="plan-name">{plan.name}</h3>
                <p className="plan-rationale">
                  {result.brief.impressionGoal
                    ? "Meets your impression goal within budget."
                    : "Highest-ranked product within your budget and inventory."}
                </p>
                <PlanMetrics
                  plan={plan}
                  brief={result.brief}
                  onAddGoal={() => {
                    setEditing(true);
                    requestAnimationFrame(() =>
                      document.getElementById("brief-impressionGoal")?.focus(),
                    );
                  }}
                />
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
                <button
                  className="secondary-button"
                  onClick={() => setEditing(true)}
                >
                  Adjust brief
                </button>
              </div>
            )}
            {result && (
              <>
                <PlanComparison result={result} />
                <Evidence result={result} />
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
