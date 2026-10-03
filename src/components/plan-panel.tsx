"use client";

import { useState } from "react";
import { GEOS, REQUIRED_FIELDS, VERTICALS } from "@/lib/brief";
import { kpiLabel, number, percent, productReason } from "@/lib/evidence";
import type { Conversation, FormBrief } from "@/lib/conversations";
import type { Plan, Recommendation } from "@/lib/recommend";
import { Icon } from "./icons";

export const currency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
const labels: Record<keyof FormBrief, string> = {
  clientName: "Campaign name",
  vertical: "Vertical",
  geo: "Geography",
  kpi: "Primary KPI",
  budget: "Budget ceiling",
  impressionGoal: "Minimum impressions",
};
function displayValue(field: keyof FormBrief, value: string) {
  if (field === "kpi") return kpiLabel(value);
  if (field === "budget") return currency(Number(value));
  if (field === "impressionGoal") return number(Number(value));
  return value;
}

function BriefForm({
  chat,
  edit,
  submit,
  done,
}: {
  chat: Conversation;
  edit: (field: keyof FormBrief, value: string) => void;
  submit: () => void;
  done: () => void;
}) {
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
      <label htmlFor="brief-name">
        Campaign name <span>Optional</span>
      </label>
      <input
        id="brief-name"
        value={chat.form.clientName}
        maxLength={120}
        placeholder="e.g. StellarBank"
        onChange={(event) => edit("clientName", event.target.value)}
      />
      <label htmlFor="brief-vertical">Vertical</label>
      <select
        id="brief-vertical"
        required
        value={chat.form.vertical}
        onChange={(event) => edit("vertical", event.target.value)}
      >
        <option value="">Choose a vertical</option>
        {VERTICALS.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <label htmlFor="brief-geo">Geography</label>
      <select
        id="brief-geo"
        required
        value={chat.form.geo}
        onChange={(event) => edit("geo", event.target.value)}
      >
        <option value="">Choose a geography</option>
        {GEOS.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
      <label htmlFor="brief-kpi">Primary KPI</label>
      <select
        id="brief-kpi"
        required
        value={chat.form.kpi}
        onChange={(event) => edit("kpi", event.target.value)}
      >
        <option value="">Choose a KPI</option>
        <option value="ctr">Click-through rate</option>
        <option value="inViewRate">In-view rate</option>
      </select>
      <label htmlFor="brief-budget">
        Budget ceiling <span>USD</span>
      </label>
      <input
        id="brief-budget"
        type="number"
        inputMode="decimal"
        min="0.01"
        max="1000000000"
        step="any"
        required
        placeholder="20,000"
        value={chat.form.budget}
        onChange={(event) => edit("budget", event.target.value)}
      />
      <label htmlFor="brief-goal">
        Minimum impressions <span>Optional</span>
      </label>
      <input
        id="brief-goal"
        type="number"
        inputMode="numeric"
        min="1"
        max="1000000000000"
        step="1"
        placeholder="No minimum"
        value={chat.form.impressionGoal}
        onChange={(event) => edit("impressionGoal", event.target.value)}
      />
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
                  {percent(plan[result.brief.kpi])} historical{" "}
                  {kpiLabel(result.brief.kpi)}
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
                {percent(product[result.brief.kpi])} historical{" "}
                {kpiLabel(result.brief.kpi)} · {percent(product.confidence)}{" "}
                confidence
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

export function PlanPanel({
  chat,
  edit,
  submit,
  close,
}: {
  chat: Conversation;
  edit: (field: keyof FormBrief, value: string) => void;
  submit: () => void;
  close: () => void;
}) {
  const [editing, setEditing] = useState(
    !Object.values(chat.form).some(Boolean),
  );
  const complete = REQUIRED_FIELDS.every((key) => chat.form[key].trim());
  const result = chat.result?.recommendation;
  const plan = result?.recommended;
  const known = (
    Object.entries(chat.form) as [keyof FormBrief, string][]
  ).filter(([, value]) => value.trim());
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
            chat={chat}
            edit={edit}
            submit={submit}
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
                        <dt>{labels[key]}</dt>
                        <dd>{displayValue(key, value)}</dd>
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
                  onClick={() => {
                    if (complete) submit();
                    else setEditing(true);
                  }}
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
                  {plan.legs.length > 1
                    ? "Two-product plan"
                    : "Recommended product"}
                </p>
                <h3 className="plan-name">{plan.name}</h3>
                <p className="muted small">
                  Highest-ranked feasible{" "}
                  {plan.legs.length > 1 ? "bundle" : "single product"} for your{" "}
                  {kpiLabel(result.brief.kpi)} objective.
                </p>
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
                {plan.legs.length > 1 && (
                  <p className="small muted">
                    No single product meets your impression goal. This pair
                    maximizes the impression-weighted KPI within your limits.
                  </p>
                )}
                <Confidence plan={plan} />
                <p className="muted micro benchmark-note">
                  Historical benchmarks are not guaranteed outcomes. Performance
                  history is specific to the vertical, not geography or dates;
                  inventory is not time-bound.
                </p>
              </section>
            )}
            {result && !plan && (
              <div className="infeasible">
                <h3>No feasible plan yet</h3>
                <p>
                  No single product
                  {result.bundleSearchUsed ? " or two-product bundle" : ""}{" "}
                  meets these constraints. Adjust the budget or impression goal;
                  inventory may still limit delivery.
                </p>
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
