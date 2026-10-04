import { z } from "zod";

export const VERTICALS = [
  "Retail",
  "Finance",
  "Travel",
  "QSR",
  "Entertainment",
] as const;
export const GEOS = ["US", "EMEA", "APAC"] as const;
const KPIS = ["ctr", "inViewRate"] as const;
const budget = z.number().finite().positive().max(1_000_000_000);

// null deliberately clears a field. An omitted field preserves its prior value.
export const briefSchema = z.strictObject({
  clientName: z.string().trim().min(1).max(120).nullish(),
  vertical: z.enum(VERTICALS).nullish(),
  kpi: z.enum(KPIS).nullish(),
  geo: z.enum(GEOS).nullish(),
  budget: budget.nullish(),
  impressionGoal: z.number().int().positive().max(1e12).nullish(),
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
export type Kpi = CompleteBrief["kpi"];
export const REQUIRED_FIELDS = ["vertical", "kpi", "geo", "budget"] as const;

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
