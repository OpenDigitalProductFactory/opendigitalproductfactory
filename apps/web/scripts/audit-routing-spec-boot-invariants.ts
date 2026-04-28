/**
 * Boot-invariant audit for the routing architectural spec
 * (docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md).
 *
 * Runs the spec's §8.1 routing invariants and §12.7 pricing invariants against
 * the current database. Read-only — does not modify state.
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/audit-routing-spec-boot-invariants.ts
 *
 * Usage (CI): wired into .github/workflows/audit-routing-invariants.yml
 *
 * Output: JSON report on stdout. Exit code 0 if no findings, 1 if any.
 *   --baseline <path>  compare against a prior report; exit 1 only if NEW
 *                      findings appeared (existing findings are tolerated as
 *                      already-tracked backlog items).
 *   --json-out <path>  write the structured report to a file in addition to
 *                      stdout.
 *
 * Why this script exists
 * ----------------------
 * Per the routing-substrate constraint document (attempt-history.md), prior
 * fix attempts shipped before measuring the gap they meant to close. Running
 * the audit on every PR turns "we documented this" into "CI rejects new
 * violations before merge." That conversion from optional to enforced is the
 * structural difference between attempt #11 and attempts 1-10.
 *
 * What this script does NOT do
 * ----------------------------
 *   - Fix violations. Each finding becomes a backlog item; fixing is separate.
 *   - Replace the eventual boot-time enforcement (Phase B of the routing
 *     migration). This script is a measurement tool that bridges to that.
 *   - Cover all invariants the spec eventually adds. As new invariants land,
 *     they should be added here so the CI guard tracks the spec's growth.
 */

import { prisma } from "@dpf/db";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Finding {
  invariantId: string;
  summary: string;
  detail: string;
}

interface Report {
  generatedAt: string;
  spec: string;
  invariantsChecked: number;
  violationCount: number;
  findings: Finding[];
}

const findings: Finding[] = [];

function violation(invariantId: string, summary: string, detail: string): void {
  findings.push({ invariantId, summary, detail });
}

// ─── Repo root resolution ──────────────────────────────────────────────────
//
// The script is invoked either from apps/web (pnpm --filter web exec) or from
// the repo root (CI). Both should work. We anchor file reads to the repo root
// regardless of cwd by walking up until we find a marker.

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  // Fallback: assume cwd is repo root
  return process.cwd();
}

const ROOT = repoRoot();

// ─── Helpers ───────────────────────────────────────────────────────────────

function readSourceFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function fileExists(relativePath: string): boolean {
  return existsSync(join(ROOT, relativePath));
}

// ─── Invariant 1: every PLATFORM_TOOLS entry has a TOOL_TO_GRANTS mapping ─

function checkInv1(): void {
  const mcpToolsSrc = readSourceFile("apps/web/lib/mcp-tools.ts");
  const grantsSrc = readSourceFile("apps/web/lib/tak/agent-grants.ts");

  // Extract tool names from PLATFORM_TOOLS — `name: "X"` lines with 4-space
  // indent (inside the array).
  const platformTools = [...mcpToolsSrc.matchAll(/^ {4}name: "([a-z_]+)"/gm)].map((m) => m[1]);

  // Extract keys from TOOL_TO_GRANTS map.
  const block = grantsSrc.match(/TOOL_TO_GRANTS:[^=]*= \{([\s\S]*?)\n\};/);
  const grantsMap: Record<string, boolean> = {};
  if (block) {
    for (const line of block[1].split("\n")) {
      const m = line.match(/^\s*([a-zA-Z0-9_]+):\s*\[/);
      if (m) grantsMap[m[1]] = true;
    }
  }

  const missing = platformTools.filter((t) => !grantsMap[t]);
  if (missing.length > 0) {
    violation(
      "INV-1",
      `${missing.length} PLATFORM_TOOLS entries have no TOOL_TO_GRANTS mapping`,
      `Tools (default-deny by the agent-grants policy, unreachable from any coworker chat): ${missing.join(", ")}.\n\nFix: add an entry per tool in apps/web/lib/tak/agent-grants.ts.`,
    );
  }
}

// ─── Invariant 2: every active LLM provider has at least one active model ──

async function checkInv2(): Promise<void> {
  const orphans = await prisma.$queryRaw<Array<{ providerId: string }>>`
    SELECT p."providerId"
    FROM "ModelProvider" p
    LEFT JOIN "ModelProfile" mp
      ON mp."providerId" = p."providerId"
      AND mp."modelStatus" = 'active'
      AND mp."retiredAt" IS NULL
    WHERE p.status = 'active' AND p."endpointType" = 'llm'
    GROUP BY p."providerId"
    HAVING COUNT(mp.id) = 0
  `;
  if (orphans.length > 0) {
    violation(
      "INV-2",
      `${orphans.length} active LLM provider(s) have zero active model profiles`,
      `Providers: ${orphans.map((r) => r.providerId).join(", ")}.\n\nThese providers cannot be selected by routing because no candidate models exist.`,
    );
  }
}

// ─── Invariant 3: status fields are in the canonical enum ──────────────────

const CANONICAL_PROVIDER_STATUS = new Set([
  "active",
  "degraded",
  "unconfigured",
  "disabled",
  "retired",
  "inactive",
]);

const CANONICAL_PROFILE_STATUS = new Set(["active", "degraded", "retired", "disabled"]);

async function checkInv3(): Promise<void> {
  const badProviders = await prisma.$queryRaw<Array<{ providerId: string; status: string }>>`
    SELECT "providerId", status FROM "ModelProvider"
  `;
  const violatingProviders = badProviders.filter((r) => !CANONICAL_PROVIDER_STATUS.has(r.status));
  if (violatingProviders.length > 0) {
    violation(
      "INV-3a",
      `${violatingProviders.length} ModelProvider row(s) have non-canonical status`,
      violatingProviders.map((r) => `  ${r.providerId}: ${r.status}`).join("\n"),
    );
  }

  const badProfiles = await prisma.$queryRaw<Array<{ providerId: string; modelId: string; modelStatus: string }>>`
    SELECT "providerId", "modelId", "modelStatus" FROM "ModelProfile"
  `;
  const violatingProfiles = badProfiles.filter((r) => !CANONICAL_PROFILE_STATUS.has(r.modelStatus));
  if (violatingProfiles.length > 0) {
    violation(
      "INV-3b",
      `${violatingProfiles.length} ModelProfile row(s) have non-canonical modelStatus`,
      violatingProfiles.map((r) => `  ${r.providerId}/${r.modelId}: ${r.modelStatus}`).join("\n"),
    );
  }
}

// ─── Invariant 4: qualityTier matches assignTierFromModelId prediction ─────

const FAMILY_TIERS: Record<string, string> = {
  "claude-opus-4":    "frontier",
  "claude-sonnet-4":  "frontier",
  "claude-haiku-4":   "strong",
  "claude-3-haiku":   "adequate",
  "gpt-5":            "frontier",
  "o1":               "frontier",
  "o3":               "frontier",
  "o4":               "frontier",
  "gpt-4o-mini":      "adequate",
  "gpt-4o":           "strong",
  "gemini-2.5-pro":   "strong",
  "gemini-2.5-flash": "adequate",
  "gemini-2.0-flash": "adequate",
  "gemma4":           "adequate",
  "gemma":            "basic",
  "llama":            "basic",
  "phi":              "basic",
  "qwen":             "basic",
  "mistral":          "basic",
  "deepseek":         "basic",
  "command-r":        "adequate",
};

function predictTier(modelId: string): { tier: string | null; matched: boolean } {
  const id = modelId.toLowerCase();
  let bestPrefix = "";
  let bestTier: string | null = null;
  for (const [prefix, tier] of Object.entries(FAMILY_TIERS)) {
    if (id.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestTier = tier;
    }
    const basename = id.split("/").pop()?.split(":")[0] ?? "";
    if (basename.startsWith(prefix) && prefix.length > bestPrefix.length) {
      bestPrefix = prefix;
      bestTier = tier;
    }
  }
  return { tier: bestTier, matched: bestPrefix.length > 0 };
}

async function checkInv4(): Promise<void> {
  const profiles = await prisma.$queryRaw<Array<{ providerId: string; modelId: string; qualityTier: string | null }>>`
    SELECT "providerId", "modelId", "qualityTier" FROM "ModelProfile" WHERE "modelStatus" = 'active'
  `;

  const mismatches: string[] = [];
  for (const r of profiles) {
    const { tier, matched } = predictTier(r.modelId);
    if (matched && r.qualityTier && r.qualityTier !== tier) {
      mismatches.push(`  ${r.providerId}/${r.modelId}: qualityTier='${r.qualityTier}' but family-tier table predicts '${tier}'`);
    }
  }
  if (mismatches.length > 0) {
    violation(
      "INV-4",
      `${mismatches.length} model profile(s) have a qualityTier that disagrees with the family-tier table`,
      mismatches.slice(0, 30).join("\n") + (mismatches.length > 30 ? `\n... ${mismatches.length - 30} more` : ""),
    );
  }
}

// ─── Invariant 5: no duplicate (providerId, modelId) pairs ────────────────

async function checkInv5(): Promise<void> {
  const dupes = await prisma.$queryRaw<Array<{ providerId: string; modelId: string; count: bigint }>>`
    SELECT "providerId", "modelId", COUNT(*)::bigint AS count
    FROM "ModelProfile"
    GROUP BY "providerId", "modelId"
    HAVING COUNT(*) > 1
  `;
  if (dupes.length > 0) {
    violation(
      "INV-5",
      `${dupes.length} duplicate (providerId, modelId) pair(s) in ModelProfile`,
      dupes.map((r) => `  ${r.providerId}/${r.modelId}: ${r.count} rows`).join("\n"),
    );
  }
}

// ─── Invariant 6: legacy capabilityTier vocabulary ────────────────────────

const LEGACY_CAPABILITY_TIER_VALUES = new Set([
  "deep-thinker",
  "fast-worker",
  "specialist",
  "budget",
  "embedding",
  "moderate",
  "advanced",
]);

async function checkInv6(): Promise<void> {
  // Phase B of the routing migration renamed ModelProfile.capabilityTier to
  // capabilityCategory (per spec §7.2). After that rename the column itself
  // is fine — the invariant is now about the *values* still carrying the
  // legacy LLM-grading vocabulary. Read whichever column name exists so the
  // audit works against pre- and post-migration installs.
  const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ModelProfile'
      AND column_name IN ('capabilityTier', 'capabilityCategory')
  `;
  const columnName = columns.find((c) => c.column_name === "capabilityCategory")
    ? "capabilityCategory"
    : "capabilityTier";

  const tiers = await prisma.$queryRawUnsafe<Array<{ value: string; count: bigint }>>(
    `SELECT "${columnName}" AS value, COUNT(*)::bigint AS count
     FROM "ModelProfile"
     GROUP BY "${columnName}"
     ORDER BY "${columnName}"`,
  );
  const legacyRows = tiers
    .filter((r) => LEGACY_CAPABILITY_TIER_VALUES.has(r.value))
    .reduce((s, r) => s + Number(r.count), 0);

  if (legacyRows > 0) {
    violation(
      "INV-6",
      `ModelProfile.${columnName} still carries legacy LLM-grading vocabulary (${legacyRows} rows)`,
      `Distinct values seen:\n${tiers.map((r) => `  '${r.value}' (${r.count} rows)`).join("\n")}\n\nFix: stop seeding the legacy vocabulary and migrate live rows to the post-rename admin-UI categorization. The routing layer reads only qualityTier; this column is admin-display only.`,
    );
  }
}

// ─── Invariant 6b: routing source files referencing capabilityTier ────────

function checkInv6b(): void {
  // Walk apps/web/lib/routing/ and look for `capabilityTier` references.
  // Static check, no DB.
  //
  // Post-rename (Phase B), the catalog field is `capabilityCategory`.
  // Any remaining `capabilityTier` reference in routing source is either:
  //   - the legacy non-canonical low|medium|high vocabulary on
  //     RoleRoutingRecipe.capabilityTier (recipe-types.ts) — a routing
  //     input that should be switched to qualityTier (canonical), or
  //   - a stale reference left behind by an incomplete rename.
  // Either case is a violation worth surfacing.
  const routingDir = join(ROOT, "apps/web/lib/routing");
  if (!existsSync(routingDir)) return;

  const matches: string[] = [];
  walkDir(routingDir, (fpath) => {
    if (!fpath.endsWith(".ts") && !fpath.endsWith(".tsx")) return;
    if (fpath.endsWith(".test.ts") || fpath.endsWith(".test.tsx")) return;
    const content = readFileSync(fpath, "utf8");
    if (content.includes("capabilityTier")) {
      const rel = fpath.slice(ROOT.length + 1).replace(/\\/g, "/");
      matches.push(rel);
    }
  });

  if (matches.length > 0) {
    violation(
      "INV-6b",
      `${matches.length} routing source file(s) still reference capabilityTier`,
      matches.map((f) => `  ${f}`).join("\n") +
        "\n\nThe canonical routing-input vocabulary is `qualityTier` (see quality-tiers.ts). Any `capabilityTier` reference in routing source is suspect: either a routing input using a non-canonical vocabulary (the bug), or a stale reference left after the Phase B rename.",
    );
  }
}

function walkDir(dir: string, visit: (path: string) => void): void {
  // Synchronous walk; the routing dir is small.
  const fs = require("node:fs") as typeof import("node:fs");
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, visit);
    else visit(full);
  }
}

// ─── Invariant 7: every active LLM provider has a non-null costModel ──────

async function checkInv7(): Promise<void> {
  const noModel = await prisma.$queryRaw<Array<{ providerId: string }>>`
    SELECT "providerId" FROM "ModelProvider"
    WHERE status = 'active' AND "endpointType" = 'llm' AND "costModel" IS NULL
  `;
  if (noModel.length > 0) {
    violation(
      "INV-7",
      `${noModel.length} active LLM provider(s) have null costModel`,
      `Providers: ${noModel.map((r) => r.providerId).join(", ")}.\n\nFix: every active LLM provider must declare its pricing kind (token | compute | subscription | flat-rate).`,
    );
  }
}

// ─── Invariant 8: token-priced providers must have non-null prices ────────

async function checkInv8(): Promise<void> {
  const incomplete = await prisma.$queryRaw<Array<{ providerId: string; inputPricePerMToken: number | null; outputPricePerMToken: number | null }>>`
    SELECT "providerId", "inputPricePerMToken", "outputPricePerMToken"
    FROM "ModelProvider"
    WHERE status = 'active' AND "endpointType" = 'llm' AND "costModel" = 'token'
      AND ("inputPricePerMToken" IS NULL OR "outputPricePerMToken" IS NULL
           OR "inputPricePerMToken" < 0 OR "outputPricePerMToken" < 0)
  `;
  if (incomplete.length > 0) {
    violation(
      "INV-8",
      `${incomplete.length} token-priced provider(s) are missing or have negative prices`,
      incomplete.map((r) => `  ${r.providerId}: input=${r.inputPricePerMToken ?? "NULL"} output=${r.outputPricePerMToken ?? "NULL"}`).join("\n"),
    );
  }
}

// ─── Invariant 9: subscription imposters (token-priced with $0) ────────────

async function checkInv9(): Promise<void> {
  const imposters = await prisma.$queryRaw<Array<{ providerId: string; costModel: string; inputPricePerMToken: number | null; outputPricePerMToken: number | null }>>`
    SELECT "providerId", "costModel", "inputPricePerMToken", "outputPricePerMToken"
    FROM "ModelProvider"
    WHERE status = 'active' AND "endpointType" = 'llm'
      AND "providerId" IN ('anthropic-sub','chatgpt')
      AND "costModel" = 'token'
      AND ("inputPricePerMToken" = 0 OR "outputPricePerMToken" = 0)
  `;
  if (imposters.length > 0) {
    violation(
      "INV-9",
      `${imposters.length} subscription-style provider(s) report costModel='token' with $0 pricing — should be costModel='subscription'`,
      imposters.map((r) => `  ${r.providerId}: costModel=${r.costModel} input=${r.inputPricePerMToken} output=${r.outputPricePerMToken}`).join("\n") +
        "\n\nFix: spec §12.2 introduces costModel='subscription' with subscriptionWindowKind. Until that lands, the $0 token pricing means real spend (subscription quota) goes uncaptured in the cost ledger.",
    );
  }
}

// ─── Invariant 10: compute providers must have watts + rate ───────────────

async function checkInv10(): Promise<void> {
  const incomplete = await prisma.$queryRaw<Array<{ providerId: string; computeWatts: number | null; electricityRateKwh: number | null }>>`
    SELECT "providerId", "computeWatts", "electricityRateKwh"
    FROM "ModelProvider"
    WHERE status = 'active' AND "endpointType" = 'llm' AND "costModel" = 'compute'
      AND ("computeWatts" IS NULL OR "electricityRateKwh" IS NULL)
  `;
  if (incomplete.length > 0) {
    violation(
      "INV-10",
      `${incomplete.length} compute-priced provider(s) missing watts or rate`,
      incomplete.map((r) => `  ${r.providerId}: watts=${r.computeWatts ?? "NULL"} rate=${r.electricityRateKwh ?? "NULL"}`).join("\n"),
    );
  }
}

// ─── Baseline comparison ───────────────────────────────────────────────────

interface BaselineDiff {
  newViolations: Finding[];
  resolvedViolations: Finding[];
  unchanged: Finding[];
}

function diffAgainstBaseline(current: Finding[], baselinePath: string): BaselineDiff | null {
  if (!existsSync(baselinePath)) return null;
  const raw = readFileSync(baselinePath, "utf8");
  const baseline = JSON.parse(raw) as Report;

  const baselineIds = new Set(baseline.findings.map((f) => f.invariantId));
  const currentIds = new Set(current.map((f) => f.invariantId));

  return {
    newViolations: current.filter((f) => !baselineIds.has(f.invariantId)),
    resolvedViolations: baseline.findings.filter((f) => !currentIds.has(f.invariantId)),
    unchanged: current.filter((f) => baselineIds.has(f.invariantId)),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let baselinePath: string | null = null;
  let jsonOutPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) {
      baselinePath = args[i + 1];
      i++;
    } else if (args[i] === "--json-out" && args[i + 1]) {
      jsonOutPath = args[i + 1];
      i++;
    }
  }

  // Resolve relative paths against repo root so the script works the same
  // whether invoked from apps/web (pnpm --filter web exec) or from the repo
  // root (CI). Absolute paths pass through unchanged.
  if (baselinePath && !baselinePath.match(/^([a-zA-Z]:[\\/]|\/)/)) {
    baselinePath = join(ROOT, baselinePath);
  }
  if (jsonOutPath && !jsonOutPath.match(/^([a-zA-Z]:[\\/]|\/)/)) {
    jsonOutPath = join(ROOT, jsonOutPath);
  }

  // Static (no DB) checks
  checkInv1();
  checkInv6b();

  // DB checks
  await checkInv2();
  await checkInv3();
  await checkInv4();
  await checkInv5();
  await checkInv6();
  await checkInv7();
  await checkInv8();
  await checkInv9();
  await checkInv10();

  const report: Report = {
    generatedAt: new Date().toISOString(),
    spec: "docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md",
    invariantsChecked: 10,
    violationCount: findings.length,
    findings,
  };

  // Always emit JSON to stdout for tooling.
  console.log(JSON.stringify(report, null, 2));

  if (jsonOutPath) {
    writeFileSync(jsonOutPath, JSON.stringify(report, null, 2), "utf8");
    console.error(`[audit] wrote ${jsonOutPath}`);
  }

  // Decide exit code.
  let exitCode = 0;
  if (baselinePath) {
    const diff = diffAgainstBaseline(findings, baselinePath);
    if (diff === null) {
      console.error(`[audit] baseline ${baselinePath} not found — treating all findings as new`);
      exitCode = findings.length > 0 ? 1 : 0;
    } else {
      console.error(`[audit] baseline diff:`);
      console.error(`  unchanged: ${diff.unchanged.length}`);
      console.error(`  resolved : ${diff.resolvedViolations.length}`);
      console.error(`  new      : ${diff.newViolations.length}`);
      if (diff.newViolations.length > 0) {
        console.error(`\n[audit] NEW VIOLATIONS BLOCK MERGE:`);
        for (const f of diff.newViolations) {
          console.error(`  [${f.invariantId}] ${f.summary}`);
        }
        exitCode = 1;
      }
      if (diff.resolvedViolations.length > 0) {
        console.error(`\n[audit] resolved (these can be removed from the baseline):`);
        for (const f of diff.resolvedViolations) {
          console.error(`  [${f.invariantId}] ${f.summary}`);
        }
      }
    }
  } else {
    // No baseline → exit non-zero if any findings (caller can override by
    // ignoring the exit code, but the default is strict).
    exitCode = findings.length > 0 ? 1 : 0;
  }

  await prisma.$disconnect();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[audit] failed:", err);
  process.exit(2);
});
