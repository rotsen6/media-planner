import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error(
    'Usage: node scripts/import-data.mjs "/path/to/extracted folder or AI_Engineer_Case_Study.zip"',
  );
  process.exit(1);
}
const source = resolve(input),
  directory = resolve("data/private");
const files = [
  "product_catalog.csv",
  "campaign_history.csv",
  "inventory_forecaster.csv",
  "client_briefs.json",
];
await mkdir(directory, { recursive: true });
const isDirectory = (await stat(source)).isDirectory();
for (const file of files) {
  if (isDirectory)
    await copyFile(resolve(source, file), resolve(directory, file));
  else {
    // Fixed member names; never extract arbitrary archive paths or execute a shell.
    const contents = execFileSync(
      "unzip",
      ["-p", source, `AI Engineer Case Study/${file}`],
      { maxBuffer: 10_000_000 },
    );
    await writeFile(resolve(directory, file), contents);
  }
}
console.log(
  "Imported four local assessment files into ignored data/private. Restart the app after changing datasets.",
);
