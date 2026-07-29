// apps/web/lib/assurance/remediation-merge-gate.ts
//
// P2 of the assurance remediation loop (BI-204EE70B): the WWMD-gated decision for
// whether a Build-Studio-produced remediation PR may merge AUTONOMOUSLY, or must
// escalate to the human responder.
//
// Founder-kernel ruling (principle_decide 2026-06-22, surface
// "assurance-remediation-merge-gate"): PATCH-ONLY-AUTO (composite 6.27, margin
// 0.41, high confidence, no commandment conflict) — auto-merge only patch bumps
// when every hard precondition passes; escalate every minor/major and anything
// uncertain. This is the supply-chain-careful far end of the loop.
//
// This module is PURE: the semver classifier + the decision policy. The live
// GitHub actuation (read PR checks, read the diff, arm auto-merge) lives behind
// injectable adapters in the orchestration so this gate stays fully unit-testable
// and free of irreversible side effects.

export type DepChangeClass = "patch" | "minor" | "major" | "unknown";

type Semver = { major: number; minor: number; patch: number };

/** Strip a range/prefix to a bare x.y.z and parse it; null when not parseable. */
function parseSemver(raw: string): Semver | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(raw ?? "");
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/**
 * Classify the semver distance of a dependency bump from `from` to `to`. Inputs
 * may carry range prefixes (e.g. "^4.12.19" → "4.12.25"); the first x.y.z wins.
 * Returns "unknown" when either side is unparseable or `to` is not strictly
 * greater than `from` (we never auto-merge a change we cannot positively classify
 * as a forward patch).
 */
export function classifyDepChange(from: string, to: string): DepChangeClass {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b) return "unknown";
  if (b.major !== a.major) return b.major > a.major ? "major" : "unknown";
  if (b.minor !== a.minor) return b.minor > a.minor ? "minor" : "unknown";
  if (b.patch !== a.patch) return b.patch > a.patch ? "patch" : "unknown";
  return "unknown"; // equal versions — nothing to merge
}

export type MergeGateAction = "auto-merge" | "escalate";

export interface RemediationMergeFacts {
  /** Semver class of the dependency bump in the PR. */
  changeClass: DepChangeClass;
  /** All required CI checks green on the PR head. */
  ciGreen: boolean;
  /** Release-age cooldown observed for the bumped version (hijacked-release guard). */
  cooldownMet: boolean;
  /** The OSV target (the version being bumped TO) is clean. */
  osvClean: boolean;
  /** The PR has a merge conflict / is not mergeable. */
  hasConflict: boolean;
}

export interface MergeGateDecision {
  action: MergeGateAction;
  reason: string;
}

/**
 * Decide whether a remediation PR may auto-merge. Hard preconditions are checked
 * first (any failure escalates); then the WWMD class ceiling (patch-only). Anything
 * unclassifiable escalates — never auto-merge on uncertainty.
 */
export function decideRemediationMerge(facts: RemediationMergeFacts): MergeGateDecision {
  if (facts.hasConflict) {
    return { action: "escalate", reason: "merge-conflict — PR is not cleanly mergeable" };
  }
  if (!facts.ciGreen) {
    return { action: "escalate", reason: "ci-not-green — required checks have not all passed" };
  }
  if (!facts.osvClean) {
    return { action: "escalate", reason: "osv-target-not-clean — the bumped version still has an advisory" };
  }
  if (!facts.cooldownMet) {
    return { action: "escalate", reason: "cooldown-not-met — bumped release is younger than the release-age cooldown" };
  }
  if (facts.changeClass === "patch") {
    return { action: "auto-merge", reason: "patch bump, all preconditions met (WWMD patch-only-auto)" };
  }
  if (facts.changeClass === "minor" || facts.changeClass === "major") {
    return { action: "escalate", reason: `${facts.changeClass}-bump requires employee review (WWMD patch-only-auto ceiling)` };
  }
  return { action: "escalate", reason: "unclassified change — cannot confirm a forward patch; escalating on uncertainty" };
}
