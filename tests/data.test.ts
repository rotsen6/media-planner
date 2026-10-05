import { describe, expect, it } from "vitest";
import { parseDataset, type DataSources } from "../src/lib/data";
import { GEOS, VERTICALS, mergeBrief, missingFields } from "../src/lib/brief";

// Synthetic fixtures; no rows from the real dataset are embedded in tests.
const sources: DataSources = {
  catalog:
    'product_id,product_name,product_description,cpm\nX,Example,"Rich media, for testing",10\n',
  history:
    "product_id,vertical,impressions,clicks,viewable_impressions\n" +
    VERTICALS.flatMap((v) => [`X,${v},100,10,50`, `X,${v},900,9,810`]).join(
      "\n",
    ),
  inventory:
    "product_id,vertical,geo,available_imps,inventory_risk\n" +
    VERTICALS.flatMap((v) => GEOS.map((g) => `X,${v},${g},100000,0.8`)).join(
      "\n",
    ),
};

describe("validated evidence", () => {
  it("uses ratios of totals, preserves quoted CSV fields, and fingerprints evidence", () => {
    const data = parseDataset(sources);
    expect(data.benchmarks.get("X:Retail")).toMatchObject({
      ctr: 0.019,
      inViewRate: 0.86,
      lineItems: 2,
      impressions: 1000,
    });
    expect(data.products.get("X")?.product_description).toBe(
      "Rich media, for testing",
    );
    expect(data.version).toBe(parseDataset(sources).version);
    expect(data.version).not.toBe(
      parseDataset({
        ...sources,
        inventory: sources.inventory.replace("0.8", "0.9"),
      }).version,
    );
  });
  it.each([
    [
      "Duplicate inventory",
      { inventory: sources.inventory + "\nX,Retail,US,100000,0.8" },
    ],
    ["Duplicate catalog", { catalog: sources.catalog + "X,Other,Other,10\n" }],
    [
      "unknown product",
      { history: sources.history.replace("X,Retail", "UNKNOWN,Retail") },
    ],
    [
      "Missing inventory",
      { inventory: sources.inventory.split("\n").slice(0, -1).join("\n") },
    ],
    [
      "cannot exceed impressions",
      { history: sources.history.replace("100,10,50", "100,101,50") },
    ],
    ["cpm", { catalog: sources.catalog.replace(",10\n", ",\n") }],
    ["inventory_risk", { inventory: sources.inventory.replace("0.8", "1.1") }],
  ] as const)("rejects invalid evidence: %s", (message, overrides) => {
    expect(() => parseDataset({ ...sources, ...overrides })).toThrow(message);
  });
});

describe("canonical brief", () => {
  it("collects required fields without requiring an advertiser name", () => {
    expect(
      missingFields({
        vertical: "Finance",
        geo: "US",
        kpi: "ctr",
        budget: 20_000,
      }),
    ).toEqual([]);
    expect(missingFields({ geo: "US" })).toEqual(["vertical", "kpi", "budget"]);
  });
  it("preserves omitted fields, applies corrections, and deliberately clears fields", () => {
    const initial = {
      vertical: "Finance",
      geo: "US",
      budget: 20_000,
      impressionGoal: 800_000,
    } as const;
    expect(
      mergeBrief(initial, { budget: 15_000, impressionGoal: null }),
    ).toEqual({ ...initial, budget: 15_000, impressionGoal: null });
    expect(mergeBrief(initial, { budget: undefined })).toEqual(initial);
  });
  it("rejects invalid values and all derived or unexpected fields", () => {
    expect(() => mergeBrief({}, { budget: -1 })).toThrow();
    expect(() => mergeBrief({}, { budget: Infinity })).toThrow();
    expect(() => mergeBrief({}, { ctr: 1 } as never)).toThrow();
    expect(() => mergeBrief({}, { geo: "Worldwide" } as never)).toThrow();
  });
});
