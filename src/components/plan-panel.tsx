"use client";

import { Fragment, useState, type InputHTMLAttributes } from "react";
import {
  GEOS,
  KPI_LABELS,
  KPIS,
  LIMITS,
  REQUIRED_FIELDS,
  VERTICALS,
  type BriefField as Field,
} from "@/lib/brief";
import type { Conversation } from "@/lib/conversations";
import {
  caveat,
  currency,
  explainRecommendation,
  kpiLabel,
  number,
  percent,
  productReason,
} from "@/lib/evidence";
import type { Plan, Recommendation } from "@/lib/recommend";
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
    placeholder: "No minimum",
    input: {
      type: "number",
      inputMode: "numeric",
      ...LIMITS.impressionGoal,
      step: "1",
    },
  },
};
const display = (field: Field, value: string) =>
  field === "kpi"
    ? kpiLabel(value)
    : field === "budget"
      ? currency(Number(value))
      : field === "impressionGoal"
        ? number(Number(value))
        : value;

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
        ([key, { label, hint, options, ...rest }]) => {
          const field = key as Field;
          const props = {
            id: `brief-${field}`,
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

function PlanMetrics({ plan, kpi }: { plan: Plan; kpi: "ctr" | "inViewRate" }) {
  return (
    <dl className="plan-metrics">
      <div className="lead-metric">
        <dt>Historical {kpiLabel(kpi)}</dt>
        <dd>{percent(plan[kpi])}</dd>
      </div>
      <div>
        <dt>Estimated impressions</dt>
        <dd>{number(plan.impressions)}</dd>
      </div>
      <div>
        <dt>Planned spend</dt>
        <dd>{currency(plan.spend)}</dd>
      </div>
    </dl>
  );
}

function Confidence({ plan }: { plan: Plan }) {
  return (
    <div className="confidence">
      {plan.legs.map((leg) => (
        <div key={leg.productId}>
          <span>
            {plan.legs.length > 1
              ? `${leg.name} confidence`
              : "Forecast confidence"}
          </span>
          <strong>{percent(leg.confidence)}</strong>
        </div>
      ))}
      <p className="muted micro">
        Inventory estimate confidence, not a delivery probability.
      </p>
    </div>
  );
}

function Evidence({ result }: { result: Recommendation }) {
  const { kpi } = result.brief;
  return (
    <details className="evidence">
      <summary>
        Evidence & alternatives <Icon name="chevron" />
      </summary>
      <div className="evidence-body">
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
        {result.alternatives.length > 0 && (
          <section>
            <h3>Feasible alternatives</h3>
            {result.alternatives.map((plan) => (
              <article className="alternative" key={plan.id}>
                <h4>{plan.name}</h4>
                <p>
                  {percent(plan[kpi])} historical {kpiLabel(kpi)}
                </p>
                <p className="muted small">
                  {currency(plan.spend)} · {number(plan.impressions)}{" "}
                  impressions · {currency(plan.unspentBudget)} unused
                </p>
                <Confidence plan={plan} />
              </article>
            ))}
          </section>
        )}
        <section>
          <h3>All products considered</h3>
          {result.evaluatedProducts.map((product) => (
            <div className="evidence-item" key={product.productId}>
              <div className="product-heading">
                <h4>{product.name}</h4>
                <span className="muted micro">
                  {product.eligible ? "Feasible" : "Not feasible alone"}
                </span>
              </div>
              <p className="small">{productReason(product)}</p>
              <p className="muted micro">
                {percent(product[kpi])} historical {kpiLabel(kpi)} ·{" "}
                {percent(product.confidence)} confidence
              </p>
              <p className="muted micro">
                {number(product.deliverableImpressions)} impressions ·{" "}
                {currency(product.spend)} spend · {currency(product.cpm)} CPM
              </p>
            </div>
          ))}
        </section>
        <section className="muted small">
          <h3>How this was calculated</h3>
          <p>
            Benchmarks use total outcomes divided by total historical
            impressions for this vertical. Historical data has no geography or
            dates; inventory has no time dimension.
          </p>
          <p>
            Raw inventory caps delivery. Single products rank by the primary
            KPI, with forecast confidence breaking equal-KPI ties. Two-product
            bundles are considered only when no single can meet a supplied
            impression goal.
          </p>
          {result.bundleSearchUsed && (
            <p>
              Bundles maximize the impression-weighted KPI within budget and
              inventory. Equal-KPI bundles prefer greater spend. Product
              impressions are added; they are not deduplicated audience reach.
            </p>
          )}
          <p className="micro source-version">
            Source version: {result.datasetVersion}
          </p>
        </section>
      </div>
    </details>
  );
}

export function PlanPanel({ close, ...props }: Props & { close: () => void }) {
  const { chat, submit } = props;
  const [editing, setEditing] = useState(
    !Object.values(chat.form).some(Boolean),
  );
  const complete = REQUIRED_FIELDS.every((key) => chat.form[key].trim());
  const result = chat.result?.recommendation;
  const plan = result?.recommended;
  const known = (Object.entries(chat.form) as [Field, string][]).filter(
    ([, value]) => value.trim(),
  );
  const pair = plan && plan.legs.length > 1;
  const summary = result && explainRecommendation(result)[0];
  return (
    <aside className="plan-pane" aria-labelledby="plan-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {result ? "Recommendation" : "Coming together"}
          </p>
          <h2 id="plan-heading" tabIndex={-1}>
            {result ? "Your plan" : "Your brief"}
          </h2>
        </div>
        <button className="icon-button" aria-label="Close plan" onClick={close}>
          <Icon name="close" />
        </button>
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
            {known.length > 0 && (
              <section className="brief-summary">
                <div className="section-heading">
                  <h3>{chat.form.clientName || "Campaign brief"}</h3>
                  <button
                    className="text-button"
                    onClick={() => setEditing(true)}
                  >
                    Edit details
                  </button>
                </div>
                <dl>
                  {known
                    .filter(([key]) => key !== "clientName")
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{FIELDS[key].label}</dt>
                        <dd>{display(key, value)}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            )}
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
                <p className="muted small">{summary}</p>
                <PlanMetrics plan={plan} kpi={result.brief.kpi} />
                <p className="budget-note">
                  {currency(plan.unspentBudget)} unused of your{" "}
                  {currency(result.brief.budget)} budget ceiling.
                </p>
                {result.brief.impressionGoal && (
                  <p className="goal-note">
                    <Icon name="check" />
                    Minimum of {number(result.brief.impressionGoal)} impressions
                    met
                  </p>
                )}
                {pair && (
                  <p className="small muted">
                    No single product meets your impression goal. This pair
                    maximizes the impression-weighted KPI within your limits.
                  </p>
                )}
                <Confidence plan={plan} />
                <p className="muted micro benchmark-note">{caveat}</p>
              </section>
            )}
            {result && !plan && (
              <div className="infeasible">
                <h3>No feasible plan yet</h3>
                <p>{summary}</p>
                <button
                  className="secondary-button"
                  onClick={() => setEditing(true)}
                >
                  Adjust brief
                </button>
              </div>
            )}
            {result && <Evidence result={result} />}
          </>
        )}
      </div>
    </aside>
  );
}
