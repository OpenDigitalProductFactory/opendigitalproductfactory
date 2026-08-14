#!/usr/bin/env node
// Universal Work Formula conformance guard (BI-BC6099FE).
// New carrier/projector code must adapt into WorkUnit instead of forking lifecycle.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL = "apps/web/lib/work-management/status-projection.ts";
const THIN_BUILD_ADAPTER = "apps/web/lib/build/customer-status-projection.ts";

export function auditWorkUnitConformance(files, workUnitSource) {
  const findings = [];
  for (const file of files) {
    const source = file.source ?? "";
    const path = file.path;
    const projectorName = /(?:status|state|lifecycle)-projection\.ts$/i.test(path);
    if (projectorName && ![CANONICAL, THIN_BUILD_ADAPTER].includes(path)
      && !/projectWorkUnitState|toWorkUnitFrom/.test(source)) {
      findings.push(`${path}: bespoke projector has no WorkUnit adapter`);
    }
    if (path !== "apps/web/lib/work-management/work-unit.ts"
      && /export\s+type\s+\w*(?:WorkCarrier|WorkUnitCarrier)/.test(source)) {
      findings.push(`${path}: declares a second work-carrier type outside work-unit.ts`);
    }
  }
  for (const adapter of ["toWorkUnitFromCapsule", "toWorkUnitFromWorkItem", "toWorkUnitFromTaskRun"]) {
    if (!workUnitSource.includes(`adapter: "${adapter}"`) || !workUnitSource.includes(`function ${adapter}`)) {
      findings.push(`work-unit.ts: ${adapter} must be both implemented and registered`);
    }
  }
  return findings;
}

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (error) {
    return error.stdout?.toString() ?? "";
  }
}

function main() {
  git("fetch", "--no-tags", "origin", "main");
  const paths = git("diff", "--name-only", "--diff-filter=AM", "origin/main...HEAD")
    .split("\n").map((line) => line.trim()).filter(Boolean)
    .filter((path) => path.startsWith("apps/web/lib/") && path.endsWith(".ts") && existsSync(path));
  const files = paths.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const workUnitSource = readFileSync("apps/web/lib/work-management/work-unit.ts", "utf8");
  const findings = auditWorkUnitConformance(files, workUnitSource);
  if (findings.length) {
    console.error("WorkUnit conformance failed:\n" + findings.map((finding) => `- ${finding}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`✓ WorkUnit conformance: ${paths.length} changed runtime module(s) follow the canonical formula.`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
