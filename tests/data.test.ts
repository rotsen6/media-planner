import { describe, expect, it } from "vitest";
import { parseDataset, type DataSources } from "../src/lib/data";
import { GEOS, VERTICALS, mergeBrief, missingFields } from "../src/lib/brief";

// Original synthetic fixtures; no supplied assessment rows are embedded in tests.
function fixture(): DataSources {
  return {
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
}

describe("validated evidence", () => {
  it("uses ratios of totals, preserves quoted CSV fields, and fingerprints evidence", () => {
    const sources = fixture();
    const data = parseDataset(sources);
    expect(data.benchmarks[0]).toMatchObject({
      ctr: 0.019,
      inViewRate: 0.86,
      lineItems: 2,
      impressions: 1000,
    });
    expect(data.products[0].product_description).toBe(
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
  it("rejects duplicate inventory rather than silently multiplying joins", () => {
    const s = fixture();
    expect(() =>
      parseDataset({
        ...s,
        inventory: s.inventory + "\nX,Retail,US,100000,0.8",
      }),
    ).toThrow("Duplicate");
  });
  it("rejects duplicate product IDs and unknown references", () => {
    const s = fixture();
    expect(() =>
      parseDataset({ ...s, catalog: s.catalog + "X,Other,Other,10\n" }),
    ).toThrow("Duplicate");
    expect(() =>
      parseDataset({
        ...s,
        history: s.history.replace("X,Retail", "UNKNOWN,Retail"),
      }),
    ).toThrow("unknown");
  });
  it("rejects missing coverage, impossible counts, empty CPMs, and out-of-range confidence", () => {
    const s = fixture();
    expect(() =>
      parseDataset({
        ...s,
        inventory: s.inventory.split("\n").slice(0, -1).join("\n"),
      }),
    ).toThrow("Missing");
    expect(() =>
      parseDataset({
        ...s,
        history: s.history.replace("100,10,50", "100,101,50"),
      }),
    ).toThrow();
    expect(() =>
      parseDataset({ ...s, catalog: s.catalog.replace(",10\n", ",\n") }),
    ).toThrow();
    expect(() =>
      parseDataset({ ...s, inventory: s.inventory.replace("0.8", "1.1") }),
    ).toThrow();
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
