import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { GEOS, key, VERTICALS } from "./brief";

const numeric = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .transform(Number)
  .pipe(z.number().finite());
const count = numeric.pipe(
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const productRow = z.strictObject({
  product_id: id,
  product_name: z.string().min(1).max(120),
  product_description: z.string().min(1).max(1000),
  cpm: numeric.pipe(z.number().positive()),
});
const historyRow = z
  .strictObject({
    product_id: id,
    vertical: z.enum(VERTICALS),
    impressions: count.pipe(z.number().positive()),
    clicks: count,
    viewable_impressions: count,
  })
  .refine(
    (r) => r.clicks <= r.impressions && r.viewable_impressions <= r.impressions,
    "Clicks and viewable impressions cannot exceed impressions",
  );
const inventoryRow = z.strictObject({
  product_id: id,
  vertical: z.enum(VERTICALS),
  geo: z.enum(GEOS),
  available_imps: count,
  inventory_risk: numeric.pipe(z.number().min(0).max(1)),
});

export type Dataset = ReturnType<typeof parseDataset>;
export type DataSources = Record<"catalog" | "history" | "inventory", string>;
const csv = { columns: true, bom: true, skip_empty_lines: true, trim: true };
const readRows = <T>(source: string, schema: z.ZodType<T>) =>
  z.array(schema).min(1).parse(parse(source, csv));

// Benchmarks are ratios of totals, never averages of row rates.
function benchmark(rows: z.infer<typeof historyRow>[]) {
  const total = (field: "impressions" | "clicks" | "viewable_impressions") =>
    rows.reduce((sum, row) => sum + row[field], 0);
  const impressions = total("impressions");
  const clicks = total("clicks");
  const viewableImpressions = total("viewable_impressions");
  if (![impressions, clicks, viewableImpressions].every(Number.isSafeInteger))
    throw new Error("Historical totals exceed safe integer precision");
  return {
    productId: rows[0].product_id,
    vertical: rows[0].vertical,
    impressions,
    clicks,
    viewableImpressions,
    lineItems: rows.length,
    ctr: clicks / impressions,
    inViewRate: viewableImpressions / impressions,
  };
}

/** Validate once, aggregate before joining, index by key, and fingerprint the evidence. */
export function parseDataset(sources: DataSources) {
  const catalog = readRows(sources.catalog, productRow);
  const history = readRows(sources.history, historyRow);
  const stock = readRows(sources.inventory, inventoryRow);
  const products = new Map(catalog.map((p) => [p.product_id, p]));
  if (products.size !== catalog.length)
    throw new Error("Duplicate catalog product ID");
  if (history.some((row) => !products.has(row.product_id)))
    throw new Error("History references an unknown product");
  if (stock.some((row) => !products.has(row.product_id)))
    throw new Error("Inventory references an unknown product");
  const inventory = new Map(
    stock.map((r) => [key(r.product_id, r.vertical, r.geo), r]),
  );
  if (inventory.size !== stock.length)
    throw new Error("Duplicate inventory key");
  const benchmarks = new Map(
    [...Map.groupBy(history, (r) => key(r.product_id, r.vertical))].map(
      ([k, rows]) => [k, benchmark(rows)] as const,
    ),
  );
  for (const product of products.keys())
    for (const vertical of VERTICALS) {
      if (!benchmarks.has(key(product, vertical)))
        throw new Error("Missing product/vertical history");
      if (GEOS.some((geo) => !inventory.has(key(product, vertical, geo))))
        throw new Error("Missing inventory combination");
    }
  const version = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex")
    .slice(0, 16);
  return {
    version,
    products,
    benchmarks,
    inventory,
    historyRows: history.length,
  };
}

const read = (name: string) =>
  readFile(resolve("data/private", name), "utf8");
let dataset: Promise<Dataset> | undefined;

/** One immutable dataset per server process; a failed load is retried on the next call. */
export function loadDataset(): Promise<Dataset> {
  dataset ??= Promise.all(
    [
      "product_catalog.csv",
      "campaign_history.csv",
      "inventory_forecaster.csv",
    ].map(read),
  )
    .then(([catalog, history, inventory]) =>
      parseDataset({ catalog, history, inventory }),
    )
    .catch((error) => {
      dataset = undefined;
      throw error;
    });
  return dataset;
}

export const loadExampleBriefs = async () =>
  z
    .array(z.string().max(4000))
    .max(30)
    .parse(JSON.parse(await read("client_briefs.json")));
