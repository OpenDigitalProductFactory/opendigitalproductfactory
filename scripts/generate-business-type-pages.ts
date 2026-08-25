import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildPublicArchetypeProcessProjection } from "../packages/storefront-templates/src/public-process-projection";

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const checkOnly = process.argv.includes("--check");
  const projectionPath = resolve(
    repoRoot,
    "docs/business-types/_process-projection.generated.json",
  );

  const projection = `${JSON.stringify(buildPublicArchetypeProcessProjection(), null, 2)}\n`;
  if (checkOnly) {
    if (!existsSync(projectionPath) || readFileSync(projectionPath, "utf8") !== projection) {
      console.error("Public archetype process projection is stale: _process-projection.generated.json");
      process.exitCode = 1;
    }
  } else {
    writeFileSync(projectionPath, projection, "utf8");
  }

  const generator = await import(
    pathToFileURL(resolve(repoRoot, "docs/business-types/_generate.mjs")).href
  );
  generator.generateBusinessTypeOutputs(checkOnly);
}

void main();
