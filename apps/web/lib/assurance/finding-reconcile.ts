// apps/web/lib/assurance/finding-reconcile.ts
//
// Reconcile + auto-file policy for Build Studio Assurance Gate findings.
//
// WHY: the gate's pnpm-audit runs in the build SANDBOX, whose lockfile can lag
// main's security overrides — so it surfaces vulnerabilities that main already
// floors (build FB-12D1D4FE filed 24 such phantom findings, all stale). Auto-
// filing every finding would auto-manufacture that noise. So a finding only
// becomes a backlog item if it survives reconciliation AND clears the severity
// policy the founder kernel ruled on (principle_decide 2026-06-22: SEVERITY-
// TIERED, composite 9.55, margin 0.40, high confidence, no commandment conflict).
//
// This module is PURE and deterministic — the I/O (reading the accepted-advisory
// baseline + main's resolved versions) lives in advisory-context.ts so this layer
// is fully unit-testable.

import type { AssurancePolicySeverity, AssuranceFindingStatus } from "./types";

/** The canonical "is this finding genuine on main?" context, built once per scan. */
export interface ReconcileContext {
  /**
   * False when the canonical context (main's resolved versions) could not be
   * loaded. Auto-file FAILS CLOSED in that case: we never auto-create a BI we
   * cannot verify against main, so a stripped image can't manufacture phantom
   * work. Findings still persist as evidence.
   */
  available: boolean;
  /** Advisory ids (GHSA + CVE) accepted + unexpired in sbom/vuln-baseline.json. */
  acceptedAdvisoryIds: Set<string>;
  /** packageName -> set of versions main currently resolves (incl. transitive). */
  resolvedVersionsByPackage: Map<string, Set<string>>;
}

export type AutoFileAction = "file" | "evidence-only" | "suppress";

export interface AutoFileDisposition {
  action: AutoFileAction;
  /** Stable, human-readable reason, persisted onto the finding for the panel. */
  reason: string;
  /** The status to set on the finding, when the disposition implies one. */
  findingStatus?: AssuranceFindingStatus;
  /** Set when action="file": the advisory outcome to propose at triage. */
  proposedOutcome?: "build" | "defer";
  /** Set when action="file": ranked priority (higher number = lower priority). */
  priority?: number;
}

/** Minimal finding shape the policy reads — NormalizedAssuranceFinding satisfies it. */
export interface ReconcileFindingInput {
  findingKey: string;
  vendorIdentifier: string;
  policySeverity: AssurancePolicySeverity;
  evidence: Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function evidenceAdvisoryIds(finding: ReconcileFindingInput): string[] {
  const ids = new Set<string>();
  if (finding.vendorIdentifier) ids.add(finding.vendorIdentifier);
  const cves = finding.evidence.cves;
  if (Array.isArray(cves)) {
    for (const cve of cves) {
      if (typeof cve === "string" && cve.trim()) ids.add(cve);
    }
  }
  return [...ids];
}

/** A finding already converted to a BI carries the id on its evidence. */
export function linkedBacklogItemId(finding: ReconcileFindingInput): string | null {
  return asString(finding.evidence.backlogItemId);
}

/** The vulnerable package + the version the sandbox audit observed. */
function observedComponent(finding: ReconcileFindingInput): { name: string | null; version: string | null } {
  return {
    name: asString(finding.evidence.moduleName),
    version: asString(finding.evidence.observedVersion),
  };
}

const AUTO_FILE_SEVERITIES = new Set<AssurancePolicySeverity>(["critical", "high"]);
const DEFERRED_AUTO_FILE_SEVERITIES = new Set<AssurancePolicySeverity>(["medium"]);
/** Low-priority rank for auto-filed moderate findings (higher number = lower). */
export const MODERATE_AUTO_FILE_PRIORITY = 900;

/**
 * Decide whether a single finding should auto-file a backlog item, be retained as
 * promotable evidence, or be suppressed as not-genuine-on-main.
 *
 * Order matters: cheap/safe checks first, then the staleness oracle, then policy.
 */
export function decideFindingDisposition(
  finding: ReconcileFindingInput,
  ctx: ReconcileContext,
): AutoFileDisposition {
  // Fail-closed: without a verifiable context we never auto-create work.
  if (!ctx.available) {
    return { action: "evidence-only", reason: "reconcile-context-unavailable (fail-closed: not auto-filed)" };
  }

  // Already converted — never double-file.
  const linked = linkedBacklogItemId(finding);
  if (linked) {
    return { action: "evidence-only", reason: `already-linked:${linked}` };
  }

  // (a) Accepted in the platform vuln-baseline (e.g. js-yaml CVE-2026-53550).
  for (const id of evidenceAdvisoryIds(finding)) {
    if (ctx.acceptedAdvisoryIds.has(id)) {
      return { action: "suppress", reason: `accepted-in-baseline:${id}`, findingStatus: "accepted" };
    }
  }

  // (c) Stale sandbox: the audited version is not what main resolves. Only
  // suppress when we positively know main's versions for the package AND the
  // observed version is absent — never hide a vuln on uncertainty.
  const { name, version } = observedComponent(finding);
  if (name && version) {
    const mainVersions = ctx.resolvedVersionsByPackage.get(name);
    if (mainVersions && mainVersions.size > 0 && !mainVersions.has(version)) {
      const sample = [...mainVersions].slice(0, 4).join(", ");
      return {
        action: "suppress",
        reason: `stale-sandbox: ${name}@${version} not resolved on main (main: ${sample})`,
        findingStatus: "false-positive",
      };
    }
  }

  // Severity-tiered policy (founder kernel ruling).
  if (AUTO_FILE_SEVERITIES.has(finding.policySeverity)) {
    return {
      action: "file",
      reason: `auto-file:${finding.policySeverity}`,
      findingStatus: "planned",
      proposedOutcome: "build",
    };
  }
  if (DEFERRED_AUTO_FILE_SEVERITIES.has(finding.policySeverity)) {
    return {
      action: "file",
      reason: `auto-file:moderate(deferred)`,
      findingStatus: "planned",
      proposedOutcome: "defer",
      priority: MODERATE_AUTO_FILE_PRIORITY,
    };
  }
  return { action: "evidence-only", reason: `below-auto-file-threshold:${finding.policySeverity}` };
}

export interface DispositionTotals {
  filed: number;
  suppressed: number;
  evidenceOnly: number;
}

export function emptyDispositionTotals(): DispositionTotals {
  return { filed: 0, suppressed: 0, evidenceOnly: 0 };
}
