// Compares two golden runs. Structure must match (key order ignored); explanation text may differ.
import { readFile } from "node:fs/promises";
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const load = async (f) => (await readFile(f, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
const [before, after] = await Promise.all(process.argv.slice(2, 4).map(load));
const split = (line) => { const body = typeof line.body === "string" && line.body.startsWith("{") ? JSON.parse(line.body) : line.body; const { explanation, ...rest } = body && typeof body === "object" ? body : { body }; return { shape: JSON.stringify(canon({ ...line, body: rest })), text: JSON.stringify(explanation ?? null) }; };
let structural = 0, textChanged = 0; const samples = [];
before.forEach((b, i) => {
  const [x, y] = [split(b), split(after[i])];
  if (x.shape !== y.shape) { structural++; if (structural <= 3) console.log("STRUCTURAL DIFF", i, "\n  before:", x.shape.slice(0, 220), "\n  after: ", y.shape.slice(0, 220)); }
  if (x.text !== y.text) { textChanged++; if (samples.length < 4) samples.push({ i, before: x.text, after: y.text }); }
});
console.log(`cases: ${before.length}  structural differences: ${structural}  explanation changes: ${textChanged}`);
for (const s of samples) console.log(`#${s.i}\n  before: ${s.before}\n  after:  ${s.after}`);
