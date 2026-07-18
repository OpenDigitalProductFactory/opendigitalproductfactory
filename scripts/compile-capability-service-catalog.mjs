#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compileCapabilityServiceCatalog, serializeCapabilityServiceCatalog } from "./lib/capability-service-projection.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const outputPath = fileURLToPath(new URL("./capability-service-catalog.generated.json", import.meta.url));
const [substrate, capabilitySeed] = await Promise.all([
  readFile(`${root}scripts/platform-substrate-manifest.json`, "utf8").then(JSON.parse),
  readFile(`${root}packages/db/data/platform-runtime-capabilities.json`, "utf8").then(JSON.parse),
]);
const generated = serializeCapabilityServiceCatalog(compileCapabilityServiceCatalog({ substrate, capabilities: capabilitySeed.capabilities }));
if (process.argv.includes("--check")) {
  const current = await readFile(outputPath, "utf8").catch(() => "");
  if (current !== generated) {
    console.error("stale_capability_service_catalog");
    process.exitCode = 1;
  } else console.log("capability_service_catalog_current");
} else {
  await writeFile(outputPath, generated, "utf8");
  console.log("capability_service_catalog_compiled");
}

