// Run against the local Next.js server after starting Ollama. This intentionally
// calls the real model and never substitutes a fake response.
import { readFile } from "node:fs/promises";
const base = process.env.APP_URL ?? "http://127.0.0.1:3000";
const briefs = JSON.parse(
  await readFile("data/private/client_briefs.json", "utf8"),
);
const expected = ["P003", "P004", "P006", "P003", "P006", "vertical", "kpi"];
let failures = 0;
async function check(label, message, state, accepts) {
  const start = performance.now();
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "chat", brief: state.brief, pending: state.pending, message,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  const result = await response.json();
  const correct =
    response.ok &&
    result.modelStatus === "used" && accepts(result);
  console.log(
    `${label}: ${correct ? "PASS" : "FAIL"} · ${result.status ?? response.status} · ${((performance.now() - start) / 1000).toFixed(1)}s`,
  );
  if (!correct) {
    console.error({
      error: result.errorCode,
      brief: result.brief,
      missing: result.missing,
    });
    failures++;
  }
  return result;
}

for (const [index, message] of briefs.entries()) {
  await check(`Brief ${index + 1}`, message, { brief: {} }, result => index < 5
    ? result.status === "ready" && result.recommendation?.recommended?.id === expected[index]
    : result.status === "clarification" && result.missing?.length === 1 && result.missing[0] === expected[index]);
}
const unresolved = await check("Unsupported geography", "Change geography to Canada.", {
  brief: { vertical: "Finance", kpi: "ctr", geo: "EMEA", budget: 15000 },
}, result => result.status === "clarification" && result.brief.geo === null && result.pending.includes("geo"));
await check("Geography correction", "Use US instead.", unresolved,
  result => result.status === "ready" && result.brief.geo === "US" && !result.pending.length);
if (failures) process.exitCode = 1;
