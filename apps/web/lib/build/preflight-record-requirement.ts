/**
 * Publishing requires a PASSING in-platform preflight record for the EXACT tree
 * being published (BI-0700B79C).
 *
 * The earlier slices made the guard gauntlet run and made its result a
 * tree-keyed record. Neither has force on its own. On the external path `git
 * push` is refused without a gate record, and that refusal IS the mechanism —
 * the record only matters because publishing is impossible without it. The
 * in-platform path had no equivalent, so it could put a branch on a shared
 * repository with no verification having run at all.
 *
 * Two properties this has to get right, because both are the way to get it
 * wrong:
 *
 * 1. **Exact tree.** "A gate ran for this build" is not the contract; "a gate
 *    passed for THIS tree" is. A record for an earlier tree of the same build
 *    must not satisfy it — that is precisely the case where someone fixed the
 *    guards, changed the code again, and published the unverified version.
 * 2. **Unreadable is not permission.** If the tree cannot be determined, or no
 *    record can be read, publication is refused. The safe direction here is to
 *    stop: the cost of a wrong "yes" is unverified code on a shared repository.
 */
import { deriveGauntletGateKey } from "@/lib/build/sandbox/guard-gauntlet-evidence";

export type PreflightRequirementResult = {
  /** Empty when publication may proceed. */
  blockers: string[];
  /** The record that satisfied the requirement, when one did. */
  evidenceRecordId?: string;
  treeSha?: string;
};

export type PreflightEvidenceRow = {
  id: string;
  details: unknown;
};

/**
 * The allowlisted override reasons, mirroring the closed set the pre-push hook
 * already uses. An override is recorded honesty, never a silent bypass, and
 * there must be exactly one vocabulary of reasons the platform accepts rather
 * than a second one invented here.
 */
export const PREFLIGHT_OVERRIDE_CODES = Object.freeze([
  "external-contribution-no-install",
  "infrastructure-unavailable",
]);

export function isPreflightOverrideCode(value: unknown): value is string {
  return typeof value === "string" && (PREFLIGHT_OVERRIDE_CODES as readonly string[]).includes(value);
}

/**
 * Whether a candidate record is a PASSING in-platform preflight for `gateKey`.
 *
 * Reads only what the writer wrote. A record missing its key, carrying a
 * different one, or not passing does not satisfy the requirement — and none of
 * those are errors, they are simply other records.
 */
export function recordSatisfiesPreflight(row: PreflightEvidenceRow, gateKey: string): boolean {
  const details = row.details as
    | { gateKey?: unknown; status?: unknown; evidence?: { gateKey?: unknown; gatePassed?: unknown } }
    | null;
  if (!details) return false;
  const recordedKey = typeof details.gateKey === "string"
    ? details.gateKey
    : typeof details.evidence?.gateKey === "string"
      ? details.evidence.gateKey
      : null;
  if (recordedKey !== gateKey) return false;
  // Both the record's own status and the gauntlet's verdict must say pass, so a
  // record written for a failing run can never satisfy this by key alone.
  return details.status === "passed" && details.evidence?.gatePassed !== false;
}

/**
 * Evaluate the requirement. Pure: the caller supplies the tree and the candidate
 * records, so this is testable without a database or a sandbox.
 */
export function evaluatePreflightRequirement(input: {
  repository: string;
  treeSha: string | null;
  guardPlanDigest: string | null;
  toolchainFingerprint: string | null;
  records: readonly PreflightEvidenceRow[];
  overrideCode?: unknown;
}): PreflightRequirementResult {
  if (isPreflightOverrideCode(input.overrideCode)) return { blockers: [] };

  if (!input.treeSha) {
    return {
      blockers: [
        "The exact version of this change could not be identified, so no verification record can be matched to it. "
        + "Publishing would put unverified content on a shared repository.",
      ],
    };
  }
  if (!input.guardPlanDigest || !input.toolchainFingerprint) {
    return {
      blockers: [
        `No verification record could be matched for this change (${input.treeSha.slice(0, 12)}): `
        + "what was checked, or what checked it, is unknown.",
      ],
      treeSha: input.treeSha,
    };
  }

  let gateKey: string;
  try {
    gateKey = deriveGauntletGateKey({
      repository: input.repository,
      treeSha: input.treeSha,
      guardPlanDigest: input.guardPlanDigest,
      toolchainFingerprint: input.toolchainFingerprint,
    });
  } catch (err) {
    return {
      blockers: [`The verification key for this change could not be derived: ${(err as Error).message}`],
      treeSha: input.treeSha,
    };
  }

  const match = input.records.find((row) => recordSatisfiesPreflight(row, gateKey));
  if (!match) {
    return {
      blockers: [
        `Verification has not passed for this exact change (${input.treeSha.slice(0, 12)}). `
        + "Run the checks on it before publishing — a result from an earlier version of this build "
        + "does not carry over, because the code has changed since.",
      ],
      treeSha: input.treeSha,
    };
  }

  return { blockers: [], evidenceRecordId: match.id, treeSha: input.treeSha };
}
