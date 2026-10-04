import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { GEOS, VERTICALS } from "./brief";

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

/** Validate once, aggregate before joining, and fingerprint the exact evidence used. */
export function parseDataset(sources: DataSources) {
  const products = readRows(sources.catalog, productRow);
  const history = readRows(sources.history, historyRow);
  const inventory = readRows(sources.inventory, inventoryRow);
  const ids = new Set(products.map((p) => p.product_id));
  if (ids.size !== products.length)
    throw new Error("Duplicate catalog product ID");
  if (history.some((row) => !ids.has(row.product_id)))
    throw new Error("History references an unknown product");
  if (inventory.some((row) => !ids.has(row.product_id)))
    throw new Error("Inventory references an unknown product");
  const groups = Map.groupBy(history, (r) => `${r.product_id}:${r.vertical}`);
  const stock = new Set(
    inventory.map((r) => `${r.product_id}:${r.vertical}:${r.geo}`),
  );
  if (stock.size !== inventory.length)
    throw new Error("Duplicate inventory key");
  for (const product of ids)
    for (const vertical of VERTICALS) {
      if (!groups.has(`${product}:${vertical}`))
        throw new Error("Missing product/vertical history");
      if (GEOS.some((geo) => !stock.has(`${product}:${vertical}:${geo}`)))
        throw new Error("Missing inventory combination");
    }
  // Benchmarks are ratios of totals, never averages of row rates.
  const benchmarks = [...groups.values()].map((rows) => {
    const total = (key: "impressions" | "clicks" | "viewable_impressions") =>
      rows.reduce((sum, row) => sum + row[key], 0);
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
  });
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
  readFile(resolve(process.env.DATA_DIR ?? "data/private", name), "utf8");
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
