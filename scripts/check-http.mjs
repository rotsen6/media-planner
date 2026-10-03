import assert from "node:assert/strict";
const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
const cases = [
  [
    {
      vertical: "Finance",
      geo: "US",
      kpi: "ctr",
      budget: 20000,
      impressionGoal: 800000,
    },
    "P003",
  ],
  [
    {
      vertical: "QSR",
      geo: "US",
      kpi: "inViewRate",
      budget: 15000,
      impressionGoal: 800000,
    },
    "P004",
  ],
];
for (const [brief, winner] of cases) {
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ mode: "brief", brief }),
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.recommendation?.recommended?.id, winner);
  assert.equal(result.modelStatus, "not_used");
  console.log(`${brief.vertical} HTTP calculation: PASS`);
}
const status = await (await fetch(`${base}/api/status`)).json();
console.log(
  `Evidence ready: ${status.data.ready}; configured model ready: ${status.modelReady}`,
);
