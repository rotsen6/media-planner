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
export const moneySchema = z.number().finite().positive().max(1_000_000_000);
export const impressionGoalSchema = z
  .number()
  .int()
  .positive()
  .max(1_000_000_000_000);

// null deliberately clears a field. An omitted field preserves its prior value.
export const briefSchema = z
  .object({
    clientName: z.string().trim().min(1).max(120).nullable().optional(),
    vertical: z.enum(VERTICALS).nullable().optional(),
    kpi: z.enum(KPIS).nullable().optional(),
    geo: z.enum(GEOS).nullable().optional(),
    budget: moneySchema.nullable().optional(),
    impressionGoal: impressionGoalSchema.nullable().optional(),
  })
  .strict();

export const briefFieldSchema = briefSchema.keyof();

export const completeBriefSchema = briefSchema.extend({
  vertical: z.enum(VERTICALS),
  kpi: z.enum(KPIS),
  geo: z.enum(GEOS),
  budget: moneySchema,
});

export type Brief = z.infer<typeof briefSchema>;
export type CompleteBrief = z.infer<typeof completeBriefSchema>;
export const REQUIRED_FIELDS = ["vertical", "kpi", "geo", "budget"] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export function missingFields(brief: Brief): RequiredField[] {
  return REQUIRED_FIELDS.filter((key) => brief[key] == null);
}

export function mergeBrief(current: Brief, patch: Brief): Brief {
  const validated = briefSchema.parse(patch);
  return briefSchema.parse({
    ...briefSchema.parse(current),
    ...Object.fromEntries(
      Object.entries(validated).filter(([, value]) => value !== undefined),
    ),
  });
}

export const fieldLabels: Record<RequiredField, string> = {
  vertical: "vertical (Retail, Finance, Travel, QSR, or Entertainment)",
  kpi: "primary KPI (click-through rate or in-view rate)",
  geo: "geography (US, EMEA, or APAC)",
  budget: "budget in dollars",
};
