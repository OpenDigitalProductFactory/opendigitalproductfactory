#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  extractPlatformToolNames,
  validateGovernedSurfaceContracts,
} from "./lib/governed-surface-tool-guard.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const registryPath = resolve(repoRoot, "apps/web/lib/mcp/governed-surface-tool-contracts.json");
const contracts = JSON.parse(readFileSync(registryPath, "utf8"));
const failures = validateGovernedSurfaceContracts(
  contracts,
  extractPlatformToolNames(repoRoot),
  { repoRoot },
);

if (failures.length > 0) {
  console.error("Governed surface MCP agency guard failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Governed surface MCP agency guard passed (${contracts.length} surfaces).`);
}
