import { GEOS, VERTICALS } from "../src/lib/brief";
import { parseDataset, type Dataset } from "../src/lib/data";

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
