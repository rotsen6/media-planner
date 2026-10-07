import { GEOS, VERTICALS } from "../src/lib/brief";
import { parseDataset, type Dataset } from "../src/lib/data";

export const financeBrief = {
  vertical: "Finance",
  geo: "US",
  kpi: "ctr",
  budget: 1000,
} as const;
// A new chat sends every field, all null.
export const blankBrief = {
  clientName: null,
  vertical: null,
  kpi: null,
  geo: null,
  budget: null,
  impressionGoal: null,
};

export function syntheticData(): Dataset {
  return parseDataset({
    catalog:
      "product_id,product_name,product_description,cpm\nA,Alpha,Example alpha,10\nB,Beta,Example beta,20\nC,Gamma,Example gamma,5",
    history:
      "product_id,vertical,impressions,clicks,viewable_impressions\n" +
      VERTICALS.flatMap((v) => [
        `A,${v},1000,20,800`,
        `B,${v},1000,30,700`,
        `C,${v},1000,10,600`,
      ]).join("\n"),
    inventory:
      "product_id,vertical,geo,available_imps,inventory_risk\n" +
      VERTICALS.flatMap((v) =>
        GEOS.flatMap((g) => [
          `A,${v},${g},100000,0.7`,
          `B,${v},${g},100000,0.9`,
          `C,${v},${g},100000,0.8`,
        ]),
      ).join("\n"),
  });
}

/** A JSON POST to the chat route, sent the way the browser sends it. */
export const chatRequest = (body: string, origin = "http://127.0.0.1:3000") =>
  new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      host: "127.0.0.1:3000",
      origin,
    },
    body,
  });
