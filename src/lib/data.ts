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
const productRow = z
  .object({
    product_id: id,
    product_name: z.string().min(1).max(120),
    product_description: z.string().min(1).max(1000),
    cpm: numeric.pipe(z.number().positive()),
  })
  .strict();
const historyRow = z
  .object({
    product_id: id,
    vertical: z.enum(VERTICALS),
    impressions: count.pipe(z.number().positive()),
    clicks: count,
    viewable_impressions: count,
  })
  .strict()
  .refine(
    (r) => r.clicks <= r.impressions && r.viewable_impressions <= r.impressions,
    "Clicks and viewable impressions cannot exceed impressions",
  );
const inventoryRow = z
  .object({
    product_id: id,
    vertical: z.enum(VERTICALS),
    geo: z.enum(GEOS),
    available_imps: count,
    inventory_risk: numeric.pipe(z.number().min(0).max(1)),
  })
  .strict();

export type Product = z.infer<typeof productRow>;
export type Inventory = z.infer<typeof inventoryRow>;
export type Benchmark = {
  productId: string;
  vertical: (typeof VERTICALS)[number];
  impressions: number;
  clicks: number;
  viewableImpressions: number;
  lineItems: number;
  ctr: number;
  inViewRate: number;
};
export type Dataset = {
  version: string;
  products: Product[];
  benchmarks: Benchmark[];
  inventory: Inventory[];
  historyRows: number;
};
export type DataSources = {
  catalog: string;
  history: string;
  inventory: string;
};

function readRows<T>(source: string, schema: z.ZodType<T>): T[] {
  const rows: unknown = parse(source, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  });
  return z.array(schema).min(1).parse(rows);
}

/** Validate once, aggregate before joining, and fingerprint the exact evidence used. */
export function parseDataset(sources: DataSources): Dataset {
  const products = readRows(sources.catalog, productRow);
  const history = readRows(sources.history, historyRow);
  const inventory = readRows(sources.inventory, inventoryRow);
  const ids = new Set(products.map((p) => p.product_id));
  if (ids.size !== products.length)
    throw new Error("Duplicate catalog product ID");
  const grouped = new Map<string, Benchmark>();
  for (const row of history) {
    if (!ids.has(row.product_id))
      throw new Error("History references an unknown product");
    const key = `${row.product_id}:${row.vertical}`;
    const total = grouped.get(key) ?? {
      productId: row.product_id,
      vertical: row.vertical,
      impressions: 0,
      clicks: 0,
      viewableImpressions: 0,
      lineItems: 0,
      ctr: 0,
      inViewRate: 0,
    };
    total.impressions += row.impressions;
    total.clicks += row.clicks;
    total.viewableImpressions += row.viewable_impressions;
    total.lineItems++;
    if (
      ![total.impressions, total.clicks, total.viewableImpressions].every(
        Number.isSafeInteger,
      )
    ) {
      throw new Error("Historical totals exceed safe integer precision");
    }
    grouped.set(key, total);
  }
  for (const total of grouped.values()) {
    total.ctr = total.clicks / total.impressions;
    total.inViewRate = total.viewableImpressions / total.impressions;
  }
  const inventoryKeys = new Set<string>();
  for (const row of inventory) {
    if (!ids.has(row.product_id))
      throw new Error("Inventory references an unknown product");
    const key = `${row.product_id}:${row.vertical}:${row.geo}`;
    if (inventoryKeys.has(key)) throw new Error("Duplicate inventory key");
    inventoryKeys.add(key);
  }
  for (const productId of ids) {
    for (const vertical of VERTICALS) {
      if (!grouped.has(`${productId}:${vertical}`))
        throw new Error("Missing product/vertical history");
      for (const geo of GEOS) {
        if (!inventoryKeys.has(`${productId}:${vertical}:${geo}`))
          throw new Error("Missing inventory combination");
      }
    }
  }
  const version = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex")
    .slice(0, 16);
  return {
    version,
    products,
    benchmarks: [...grouped.values()],
    inventory,
    historyRows: history.length,
  };
}

export async function loadDataset(
  directory = process.env.DATA_DIR ?? "data/private",
): Promise<Dataset> {
  const [catalog, history, inventory] = await Promise.all(
    [
      "product_catalog.csv",
      "campaign_history.csv",
      "inventory_forecaster.csv",
    ].map((name) => readFile(resolve(directory, name), "utf8")),
  );
  return parseDataset({ catalog, history, inventory });
}

export async function loadExampleBriefs(
  directory = process.env.DATA_DIR ?? "data/private",
): Promise<string[]> {
  return z
    .array(z.string().max(4000))
    .max(30)
    .parse(
      JSON.parse(
        await readFile(resolve(directory, "client_briefs.json"), "utf8"),
      ),
    );
}
