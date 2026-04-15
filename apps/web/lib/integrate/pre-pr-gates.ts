/**
 * Pre-PR Security Gates — orchestrator for all checks that must pass
 * before a PR is created or auto-merged.
 *
 * Gates:
 *   1. Security scan (regex-based: SQL injection, XSS, secrets, backdoors, etc.)
 *   2. Destructive operations (DROP TABLE, TRUNCATE, etc. in migrations)
 *   3. Architecture compliance (file placement, import conventions)
 *   4. Dependency audit (new packages in package.json)
 *
 * Each gate returns pass/fail with findings. The orchestrator aggregates
 * results and determines whether the PR can proceed.
 */

import { scanDiffForSecurityIssues, type SecurityScanResult } from "./security-scan";
import { scanForDestructiveOps } from "./sandbox/sandbox-promotion";

// ─── Types ──────────────────────────────────────────────────────────────────

export type GateVerdict = "pass" | "warn" | "block";

export interface GateResult {
  gate: string;
  verdict: GateVerdict;
  findings: string[];
}

export interface PrePRGateResult {
  canProceed: boolean;
  requiresHumanReview: boolean;
  gates: GateResult[];
  securityScan: SecurityScanResult;
  summary: string;
}

// ─── Diff Helpers ───────────────────────────────────────────────────────────

function extractFilePaths(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
}

function extractAddedLinesForFile(diff: string, filePath: string): string[] {
  const escaped = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileRegex = new RegExp(
    `^diff --git a/${escaped} b/.+\\n[\\s\\S]*?(?=^diff --git|$)`,
    "m",
  );
  const match = fileRegex.exec(diff);
  if (!match) return [];

  return match[0]
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

// ─── Gate 1: Security Scan ──────────────────────────────────────────────────

function runSecurityGate(diff: string): { result: GateResult; scan: SecurityScanResult } {
  const scan = scanDiffForSecurityIssues(diff);

  const findings: string[] = [];
  for (const f of scan.findings) {
    findings.push(`[${f.severity}] ${f.category}: ${f.message} (${f.file}:${f.line})`);
  }

  return {
    result: {
      gate: "security-scan",
      verdict: scan.criticalCount > 0 ? "block" : scan.warningCount > 0 ? "warn" : "pass",
      findings,
    },
    scan,
  };
}

// ─── Gate 2: Destructive Operations ─────────────────────────────────────────

function runDestructiveOpsGate(diff: string): GateResult {
  const files = extractFilePaths(diff);
  const migrationFiles = files.filter((f) =>
    f.startsWith("prisma/migrations/") || f.endsWith(".sql"),
  );

  if (migrationFiles.length === 0) {
    return { gate: "destructive-ops", verdict: "pass", findings: [] };
  }

  const allWarnings: string[] = [];
  for (const mf of migrationFiles) {
    const lines = extractAddedLinesForFile(diff, mf);
    const sql = lines.join("\n");
    const warnings = scanForDestructiveOps(sql);
    allWarnings.push(...warnings.map((w) => `${mf}: ${w}`));
  }

  return {
    gate: "destructive-ops",
    verdict: allWarnings.length > 0 ? "block" : "pass",
    findings: allWarnings,
  };
}

// ─── Gate 3: Architecture Compliance ────────────────────────────────────────

const ALLOWED_TOP_DIRS = new Set([
  "apps", "packages", "prisma", "scripts", "prompts", "skills",
  "docs", "e2e", "services", "public",
]);

function runArchitectureGate(diff: string): GateResult {
  const files = extractFilePaths(diff);
  const findings: string[] = [];

  for (const file of files) {
    const topDir = file.split("/")[0];

    // Files must be in recognized directories
    if (topDir && !ALLOWED_TOP_DIRS.has(topDir) && file.includes("/")) {
      findings.push(`Unexpected directory: ${file} (expected: ${[...ALLOWED_TOP_DIRS].join(", ")})`);
    }

    // TypeScript imports should use @/lib paths, not relative paths reaching outside
    const lines = extractAddedLinesForFile(diff, file);
    for (const line of lines) {
      // Detect relative imports that go up more than 3 levels (likely wrong)
      if (/from\s+['"]\.\.\/\.\.\/\.\.\/\.\.\//.test(line)) {
        findings.push(`${file}: Deep relative import — use @/lib path alias instead`);
        break;
      }
    }
  }

  return {
    gate: "architecture",
    verdict: findings.length > 0 ? "warn" : "pass",
    findings,
  };
}

// ─── Gate 4: Dependency Audit ───────────────────────────────────────────────

function runDependencyGate(diff: string): GateResult {
  const files = extractFilePaths(diff);
  const packageFiles = files.filter((f) => f.endsWith("package.json"));

  if (packageFiles.length === 0) {
    return { gate: "dependency-audit", verdict: "pass", findings: [] };
  }

  const findings: string[] = [];
  for (const pf of packageFiles) {
    const lines = extractAddedLinesForFile(diff, pf);
    for (const line of lines) {
      // Match new dependency additions: "name": "^version"
      const depMatch = line.match(/^\s*"([^"]+)"\s*:\s*"([~^]?\d[^"]*)"$/);
      if (depMatch) {
        const [, name, version] = depMatch;
        findings.push(`New dependency: ${name}@${version} (in ${pf}) — verify it is vetted and license-compatible`);
      }
    }
  }

  return {
    gate: "dependency-audit",
    verdict: findings.length > 0 ? "warn" : "pass",
    findings,
  };
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Run all pre-PR gates on a diff. Returns an aggregate result.
 *
 * Rules:
 *   - ANY "block" verdict → canProceed=false, requiresHumanReview=true
 *   - ANY "warn" verdict  → canProceed=true, requiresHumanReview=true
 *   - ALL "pass"          → canProceed=true, requiresHumanReview=false
 */
export function runPrePRGates(diff: string): PrePRGateResult {
  const { result: securityResult, scan: securityScan } = runSecurityGate(diff);
  const destructiveResult = runDestructiveOpsGate(diff);
  const architectureResult = runArchitectureGate(diff);
  const dependencyResult = runDependencyGate(diff);

  const gates = [securityResult, destructiveResult, architectureResult, dependencyResult];

  const hasBlock = gates.some((g) => g.verdict === "block");
  const hasWarn = gates.some((g) => g.verdict === "warn");

  const summaryParts: string[] = [];
  for (const gate of gates) {
    const icon = gate.verdict === "pass" ? "PASS" : gate.verdict === "warn" ? "WARN" : "BLOCK";
    summaryParts.push(`${gate.gate}: ${icon} (${gate.findings.length} finding${gate.findings.length === 1 ? "" : "s"})`);
  }

  return {
    canProceed: !hasBlock,
    requiresHumanReview: hasBlock || hasWarn,
    gates,
    securityScan,
    summary: summaryParts.join(" | "),
  };
}

/**
 * Format gate results as a markdown report for PR body or comment.
 */
export function formatGateReport(result: PrePRGateResult): string {
  const lines: string[] = [];

  const status = result.canProceed
    ? result.requiresHumanReview ? "PASSED with warnings" : "PASSED"
    : "BLOCKED";
  lines.push(`## Pre-PR Security Gates: ${status}`);
  lines.push("");

  for (const gate of result.gates) {
    const icon = gate.verdict === "pass" ? "+" : gate.verdict === "warn" ? "!" : "x";
    lines.push(`### [${icon}] ${gate.gate}`);
    if (gate.findings.length === 0) {
      lines.push("No issues found.");
    } else {
      for (const finding of gate.findings.slice(0, 15)) {
        lines.push(`- ${finding}`);
      }
      if (gate.findings.length > 15) {
        lines.push(`- ... and ${gate.findings.length - 15} more`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
