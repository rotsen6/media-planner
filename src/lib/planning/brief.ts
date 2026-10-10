import { z } from "zod";

export const VERTICALS = [
  "Retail",
  "Finance",
  "Travel",
  "QSR",
  "Entertainment",
] as const;
export const GEOS = ["US", "EMEA", "APAC"] as const;
export const KPIS = ["ctr", "inViewRate"] as const;
export type Kpi = (typeof KPIS)[number];
export const KPI_LABELS: Record<Kpi, string> = {
  ctr: "Click-through rate",
  inViewRate: "In-view rate",
};
const budget = z.number().finite().min(0.01).max(1_000_000_000);

// null deliberately clears a field. An omitted field preserves its prior value.
export const briefSchema = z.strictObject({
  clientName: z.string().trim().min(1).max(120).nullish(),
  vertical: z.enum(VERTICALS).nullish(),
  kpi: z.enum(KPIS).nullish(),
  geo: z.enum(GEOS).nullish(),
  budget: budget.nullish(),
  impressionGoal: z.number().int().min(1).max(1_000_000_000_000).nullish(),
});
export const briefFieldSchema = briefSchema.keyof();
export const completeBriefSchema = briefSchema.extend({
  vertical: z.enum(VERTICALS),
  kpi: z.enum(KPIS),
  geo: z.enum(GEOS),
  budget,
});

export type Brief = z.infer<typeof briefSchema>;
export type BriefField = keyof Brief;
export type CompleteBrief = z.infer<typeof completeBriefSchema>;
export const REQUIRED_FIELDS = ["vertical", "kpi", "geo", "budget"] as const;
/** Evidence lookup keys: product and vertical for benchmarks, plus geo for inventory. */
export const evidenceKey = (...parts: string[]) => parts.join(":");

export const missingFields = (brief: Brief) =>
  REQUIRED_FIELDS.filter((key) => brief[key] == null);

/** Undefined (omitted) fields keep their prior value; the merged brief is validated once. */
export const mergeBrief = (
  current: Brief,
  patch: Record<string, unknown>,
): Brief =>
  briefSchema.parse({
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ),
  });
