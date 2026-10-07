// Records /api/chat brief-mode responses over a grid of briefs, plus HTTP boundary cases.
import { writeFile } from "node:fs/promises";
const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
const out = process.argv[2];
const post = async (body, headers = {}) => {
  const r = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
};
const lines = [];
for (const vertical of ["Retail", "Finance", "Travel", "QSR", "Entertainment"])
  for (const geo of ["US", "EMEA", "APAC"])
    for (const kpi of ["ctr", "inViewRate"])
      for (const budget of [500, 5000, 15000, 20000, 30000, 100000])
        for (const impressionGoal of [null, 100000, 800000, 1000000, 2000000, 3000000, 10000000]) {
          const brief = { clientName: "Golden", vertical, geo, kpi, budget, impressionGoal };
          lines.push(JSON.stringify({ brief, ...(await post({ mode: "brief", brief })) }));
        }
const edge = [
  { mode: "brief", brief: {} },
  { mode: "brief", brief: { geo: "US", kpi: "inViewRate", budget: 25000 } },
  { mode: "brief", brief: { vertical: "Finance", budget: 999.999, kpi: "ctr", geo: "US", impressionGoal: 50000 } },
  { mode: "brief", brief: { budget: -2 } },
  { mode: "brief", brief: {}, rankings: [] },
  { mode: "chat", brief: {}, message: "" },
  { mode: "brief", brief: {}, pending: ["geo"] },
  "{",
  "x".repeat(17000),
];
for (const body of edge) lines.push(JSON.stringify({ edge: body.length > 100 ? "oversized" : body, ...(await post(body)) }));
lines.push(JSON.stringify({ edge: "cross-origin", ...(await post({ mode: "brief", brief: {} }, { Origin: "https://unrelated.example" })) }));
lines.push(JSON.stringify({ edge: "text/plain", ...(await post({ mode: "brief", brief: {} }, { "Content-Type": "text/plain" })) }));
const status = await fetch(`${base}/api/status`).then((r) => r.json());
lines.push(JSON.stringify({ status }));
await writeFile(out, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} cases to ${out}`);
