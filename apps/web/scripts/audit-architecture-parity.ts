/**
 * Architecture Parity audit — design↔implementation drift gate.
 * (docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md)
 *
 * Scans the hand-authored SysML current-state view seeds
 * (packages/db/src/seed-ea-sysml-*.ts) for deterministic-provenance sourceKeys —
 * the `det("...")` claims that an EA element models real code — and verifies each
 * still resolves to a real file (and named symbol). A claim that no longer resolves
 * is design↔implementation drift: the model says one thing, the code says another.
 *
 * This is the first systemic increment of the parity engine: it makes the
 * hand-seeded models self-policing so no human/AI has to manually re-check them —
 * "remove avoidable failure opportunities, automation over vigilance."
 *
 * Static — no DB. Read-only — no edits. Same baseline-diff shape as the routing /
 * coworker-tool-grant audits: fail CI only on NEW findings vs the tracked baseline.
 *
 * Usage (local):
 *   pnpm --filter web exec tsx scripts/audit-architecture-parity.ts
 *   pnpm --filter web exec tsx scripts/audit-architecture-parity.ts --baseline docs/superpowers/audits/2026-06-14-architecture-parity-baseline.json
 *   pnpm --filter web exec tsx scripts/audit-architecture-parity.ts --json-out docs/superpowers/audits/2026-06-14-architecture-parity-baseline.json
 */

import { readFileSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  extractDeterministicSourceKeys,
  auditSourceKeys,
  type ParityFinding,
} from "../lib/ea/architecture-parity";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Report {
  generatedAt: string;
  spec: string;
  seedsScanned: string[];
  deterministicSourceKeys: number;
  errorCount: number;
  warnCount: number;
  findings: ParityFinding[];
}

// ─── Repo root ─────────────────────────────────────────────────────────────

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== "/" && dir !== resolve(dir, "..")) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = resolve(dir, "..");
  }
  return process.cwd();
}
const ROOT = repoRoot();

// ─── Seed discovery + resolver ───────────────────────────────────────────────

const SEED_DIR = "packages/db/src";

/** The SysML current-state VIEW seeds (seed-ea-sysml-<name>.ts), excluding the
 *  sysml2 notation metamodel (seed-ea-sysml2.ts, no trailing dash) and tests. */
function findViewSeeds(): string[] {
  const dir = join(ROOT, SEED_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^seed-ea-sysml-.+\.ts$/.test(f) && !f.endsWith(".test.ts"))
    .map((f) => `${SEED_DIR}/${f}`)
    .sort();
}

function makeResolver(): (path: string) => string | null {
  const cache = new Map<string, string | null>();
  return (relPath: string): string | null => {
    if (cache.has(relPath)) return cache.get(relPath)!;
    const abs = join(ROOT, relPath);
    const text = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    cache.set(relPath, text);
    return text;
  };
}

// ─── Baseline diff (same shape as audit-coworker-tool-grants.ts) ─────────────

interface BaselineDiff {
  newViolations: ParityFinding[];
  resolvedViolations: ParityFinding[];
  unchanged: ParityFinding[];
}

function findingKey(f: ParityFinding): string {
  return `${f.invariantId}::${f.sourceKey}::${f.file ?? ""}`;
}

function diffAgainstBaseline(current: ParityFinding[], baselinePath: string): BaselineDiff | null {
  if (!existsSync(baselinePath)) return null;
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Report;
  const baselineKeys = new Set(baseline.findings.map(findingKey));
  const currentKeys = new Set(current.map(findingKey));
  return {
    newViolations: current.filter((f) => !baselineKeys.has(findingKey(f))),
    resolvedViolations: baseline.findings.filter((f) => !currentKeys.has(findingKey(f))),
    unchanged: current.filter((f) => baselineKeys.has(findingKey(f))),
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  let baselinePath: string | null = null;
  let jsonOutPath: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--baseline" && args[i + 1]) {
      baselinePath = args[++i];
    } else if (args[i] === "--json-out" && args[i + 1]) {
      jsonOutPath = args[++i];
    }
  }
  if (baselinePath && !baselinePath.match(/^([a-zA-Z]:[\\/]|\/)/)) baselinePath = join(ROOT, baselinePath);
  if (jsonOutPath && !jsonOutPath.match(/^([a-zA-Z]:[\\/]|\/)/)) jsonOutPath = join(ROOT, jsonOutPath);

  const seeds = findViewSeeds();
  const resolver = makeResolver();
  const allKeys: string[] = [];
  for (const seed of seeds) {
    const src = readFileSync(join(ROOT, seed), "utf8");
    allKeys.push(...extractDeterministicSourceKeys(src));
  }

  const findings = auditSourceKeys(allKeys, resolver);
  findings.sort((a, b) => findingKey(a).localeCompare(findingKey(b)));

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warnCount = findings.filter((f) => f.severity === "warn").length;

  const report: Report = {
    generatedAt: new Date().toISOString(),
    spec: "docs/superpowers/specs/2026-06-14-design-implementation-parity-engine-design.md",
    seedsScanned: seeds,
    deterministicSourceKeys: allKeys.length,
    errorCount,
    warnCount,
    findings,
  };

  console.log(JSON.stringify(report, null, 2));

  if (jsonOutPath) {
    writeFileSync(jsonOutPath, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.error(`[parity] wrote ${jsonOutPath}`);
  }

  let exitCode = 0;
  if (baselinePath) {
    const diff = diffAgainstBaseline(findings, baselinePath);
    if (diff === null) {
      console.error(`[parity] baseline ${baselinePath} not found — treating all findings as new`);
      exitCode = errorCount > 0 ? 1 : 0;
    } else {
      console.error(`[parity] baseline diff: unchanged=${diff.unchanged.length} resolved=${diff.resolvedViolations.length} new=${diff.newViolations.length}`);
      const newErrors = diff.newViolations.filter((f) => f.severity === "error");
      if (newErrors.length > 0) {
        console.error(`\n[parity] NEW design↔implementation DRIFT blocks merge:`);
        for (const f of newErrors) console.error(`  [${f.invariantId}] ${f.summary}`);
        exitCode = 1;
      }
      if (diff.resolvedViolations.length > 0) {
        console.error(`\n[parity] resolved (remove from baseline):`);
        for (const f of diff.resolvedViolations) console.error(`  [${f.invariantId}] ${f.summary}`);
      }
    }
  } else {
    exitCode = errorCount > 0 ? 1 : 0;
  }

  process.exit(exitCode);
}

main();
