// Fetches a page and every script/stylesheet it references; reports raw and gzip-transferred bytes.
import { gzipSync } from "node:zlib";
const base = process.argv[2];
const html = await (await fetch(base)).text();
const urls = [...html.matchAll(/<(?:script[^>]+src|link[^>]+href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => /\.(js|css)(\?|$)/.test(u) || u.includes("/_next/static/"))
  .map((u) => new URL(u, base).href);
let raw = html.length, gz = gzipSync(html).length, n = 0;
for (const u of new Set(urls)) {
  const r = await fetch(u); if (!r.ok) continue;
  const buf = Buffer.from(await r.arrayBuffer()); raw += buf.length; gz += gzipSync(buf).length; n++;
}
console.log(`${base}: ${n} assets, raw ${(raw / 1024).toFixed(0)} KB, gzip ${(gz / 1024).toFixed(0)} KB`);
if (process.argv[3] === "--list") for (const u of new Set(urls)) console.log("  " + u.replace(base, ""));
