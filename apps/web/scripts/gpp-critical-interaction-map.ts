/**
 * GPP critical-interaction map (Phase 1, T1).
 *
 * Every platform tool, how it can be reached, and which gates guard it, with
 * each gate's mode. On demand only: it is not a CI gate and its output is not
 * committed, so it adds no churn.
 *
 * Usage:
 *   pnpm --filter web exec tsx --tsconfig scripts/tsconfig.gpp-map.json scripts/gpp-critical-interaction-map.ts <out-dir>
 *
 * The tsconfig maps the Next-only `server-only` guard to the same empty shim the
 * vitest config uses, so the registry loads outside the app.
 *
 * Writes <out-dir>/critical-interaction-map.json and .md.
 * Plan: docs/superpowers/plans/2026-10-01-gpp-phase-1-see-and-ratchet.md
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { HARDCODED_COWORKER_GRANTS } from "@dpf/db/workforce-seed";

import { buildCriticalInteractionMap, renderCriticalInteractionMarkdown } from "../lib/gpp/critical-interaction-map";
import { readWebSourceFiles } from "../lib/gpp/source-files";
import { findUnmediatedExecuteSites } from "../lib/gpp/unmediated-execute-sites";
import { resolveWorkroomGateMode } from "../lib/governance/workroom-shape-governance-hook";
import { PLATFORM_TOOLS } from "../lib/mcp-tools";
import { TOOL_TO_GRANTS } from "../lib/tak/agent-grants";
import { classifyConsequentialTool } from "../lib/tak/consequential-tool-policy";
import { INITIATIVE_READINESS_LANES } from "../lib/tak/initiative-readiness-tool-grants";

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: tsx scripts/gpp-critical-interaction-map.ts <out-dir>");
  process.exit(2);
}

const holdersByGrant = new Map<string, string[]>();
for (const [agent, grants] of Object.entries(HARDCODED_COWORKER_GRANTS)) {
  for (const grant of grants) holdersByGrant.set(grant, [...(holdersByGrant.get(grant) ?? []), agent]);
}

const directSites = new Map<string, string[]>();
for (const site of findUnmediatedExecuteSites(readWebSourceFiles())) {
  directSites.set(site.toolName, [...(directSites.get(site.toolName) ?? []), `${site.path}:${site.line}`]);
}

const gateMode = resolveWorkroomGateMode();
let gitSha: string | null = null;
try {
  gitSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  gitSha = null;
}

const map = buildCriticalInteractionMap(
  PLATFORM_TOOLS.map((tool) => ({
    name: tool.name,
    sideEffect: tool.sideEffect,
    consequence: tool.consequence ?? null,
    consequenceScope: tool.consequenceScope ?? null,
    buildPhases: tool.buildPhases ?? null,
  })),
  {
    classify: (tool) =>
      classifyConsequentialTool({
        toolName: tool.name,
        tool: {
          sideEffect: tool.sideEffect,
          consequence: (tool.consequence ?? undefined) as never,
          consequenceScope: (tool.consequenceScope ?? undefined) as never,
        },
      }),
    grantsFor: (name) => TOOL_TO_GRANTS[name] ?? [],
    holdersOf: (grant) => holdersByGrant.get(grant) ?? [],
    projectableTools: new Set(Object.keys(INITIATIVE_READINESS_LANES)),
    shapeGateMode: gateMode === "enforce" ? "enforced" : gateMode === "shadow" ? "shadow" : "none",
    directSites,
  },
  { generatedAt: new Date().toISOString(), gitSha },
);

const dir = resolve(outDir);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "critical-interaction-map.json"), JSON.stringify(map, null, 2));
writeFileSync(join(dir, "critical-interaction-map.md"), renderCriticalInteractionMarkdown(map));
console.log(JSON.stringify({ out: dir, ...map.totals, dynamicDirectSites: map.dynamicDirectSites.length }));
