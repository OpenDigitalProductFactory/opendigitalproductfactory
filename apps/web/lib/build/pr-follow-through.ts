/**
 * PR follow-through is a Workroom duty (BI-88341B5D, EP-4614F35E).
 *
 * Design: docs/superpowers/specs/2026-10-01-pr-follow-through-workroom-duty-design.md
 * §3.2 (one record for every room), §3.4 (classify before acting) and §3.5
 * (who repairs, at the room's proactivity level).
 *
 * Pure. The reconciler owns persistence and every GitHub effect. Nothing here
 * merges, force-pushes, dismisses a check or edits required-check config: the
 * merge queue stays the only writer of `main`.
 */
import type { ProactivityActionBoundary, ProactivityLevel } from "@/lib/proactivity/proactivity-types";

import {
  decideAutonomousRecovery,
  initialAutonomousRecoveryState,
  AUTONOMOUS_RECOVERY_POLICY_VERSION,
  type AutonomousRecoveryStateV1,
} from "./autonomous-recovery-policy";
import type { BuildPrDeliveryStatus } from "./build-pr-delivery-state";
import type { GithubCheckObservation, GithubPrReadiness } from "./github-pr-readiness";

/** Infrastructure failures get one re-run per head; never the repair budget (§3.4). */
export const INFRA_RERUN_BOUND = 1;

const REPAIR_FAILURE_CLASS = "post-push-ci-failure" as const;
/** Mirrors autonomous-recovery-policy's bound for post-push-ci-failure; asserted in tests. */
const REPAIR_BOUND = 2;

export const PR_FOLLOW_THROUGH_STATUSES = [
  "watching",
  "repairing",
  "queued",
  "awaiting-person",
  "merged",
  "closed",
] as const;
export type PrFollowThroughStatus = (typeof PR_FOLLOW_THROUGH_STATUSES)[number];

export type PrCheckFailureClass = "infrastructure" | "defect" | "unclassified";

export type PrFailingCheck = {
  name: string;
  conclusion: string;
  runUrl: string | null;
  workflowRunId: number | null;
  class: PrCheckFailureClass;
};

export type PrFollowThroughHold = "repairing" | "awaiting-person";

export type PrFollowThroughV1 = {
  /** Set while CI is red on the judged head; cleared when the head moves. */
  hold: PrFollowThroughHold | null;
  failing: PrFailingCheck[];
  /** The reused recovery budget (§3.2) — never re-declared here. */
  attempts: AutonomousRecoveryStateV1;
  /** The head whose failure was already judged. One judgment per head SHA. */
  judgedHeadSha: string | null;
  infraReruns: { headSha: string; count: number } | null;
  /** Dedupe key of the last attention raised, so a hold is announced once. */
  attentionKey: string | null;
};

export type PrRepairAuthority = "dispatch" | "propose" | "record";

export type PrRepairPacket = {
  headSha: string;
  failureClass: typeof REPAIR_FAILURE_CLASS;
  attempt: number;
  bound: number;
  failingChecks: PrFailingCheck[];
  /** What the repair may and may not do (§3.5 "Never relaxed"). */
  constraints: readonly string[];
};

export const PR_REPAIR_CONSTRAINTS = [
  "Push a new DCO-signed commit to the same branch, after the local gate passes.",
  "Never merge, force-push, dismiss a check or edit required-check configuration.",
  "Never weaken a test to make it pass.",
  "Stay inside the pull request's existing diff scope; otherwise stop and raise attention.",
] as const;

export type PrAttentionReason =
  | "infrastructure-persists"
  | "infrastructure-not-rerunnable"
  | "repair-budget-exhausted"
  | "unclassified-check-failure";

export type PrFollowThroughDecision =
  | { kind: "none"; followThrough: PrFollowThroughV1 }
  | { kind: "hold"; headSha: string; followThrough: PrFollowThroughV1 }
  | { kind: "rerun-infrastructure"; headSha: string; workflowRunIds: number[]; followThrough: PrFollowThroughV1 }
  | {
      kind: "repair";
      mode: PrRepairAuthority;
      headSha: string;
      packet: PrRepairPacket;
      followThrough: PrFollowThroughV1;
    }
  | {
      kind: "attention";
      target: "platform-operator" | "process-overseer";
      reason: PrAttentionReason;
      headSha: string;
      followThrough: PrFollowThroughV1;
    };

export function createPrFollowThrough(): PrFollowThroughV1 {
  return {
    hold: null,
    failing: [],
    attempts: initialAutonomousRecoveryState(),
    judgedHeadSha: null,
    infraReruns: null,
    attentionKey: null,
  };
}

const PASSING = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
/** Conclusions where the gate could not run, so it reached no verdict. */
const INFRASTRUCTURE_CONCLUSIONS = new Set(["CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "STALE", "ERROR"]);

/**
 * Classify each completed, non-passing check (§3.4). Conclusions only: the
 * per-repository list of infra-only job names is an open question in §8 and is
 * deliberately not guessed here. Anything that is neither a failed run nor a
 * gate that could not run (e.g. ACTION_REQUIRED) is `unclassified` and goes to
 * a person.
 */
export function classifyFailingChecks(checks: readonly GithubCheckObservation[]): PrFailingCheck[] {
  return checks.flatMap((check) => {
    if (check.status.toUpperCase() !== "COMPLETED") return [];
    const conclusion = (check.conclusion ?? "").toUpperCase();
    if (PASSING.has(conclusion)) return [];
    const failureClass: PrCheckFailureClass = conclusion === "FAILURE"
      ? "defect"
      : INFRASTRUCTURE_CONCLUSIONS.has(conclusion)
        ? "infrastructure"
        : "unclassified";
    return [{
      name: check.name,
      conclusion: conclusion || "UNKNOWN",
      runUrl: check.detailsUrl ?? null,
      workflowRunId: check.workflowRunId ?? null,
      class: failureClass,
    }];
  });
}

/** §3.5: preauthorized dispatches; propose (or nothing declared) stages; advise or quiet records. */
export function resolvePrRepairAuthority(input: {
  level: ProactivityLevel | null;
  boundary: ProactivityActionBoundary | null;
}): PrRepairAuthority {
  if (input.level === "quiet" || input.boundary === "advise") return "record";
  if (input.boundary === "preauthorized") return "dispatch";
  return "propose";
}

function attentionKeyFor(reason: string, headSha: string): string {
  return `follow-through:${reason}:${headSha}`;
}

export function decidePrFollowThrough(input: {
  followThrough: PrFollowThroughV1;
  readiness: GithubPrReadiness;
  checks: readonly GithubCheckObservation[];
  authority: PrRepairAuthority;
}): PrFollowThroughDecision {
  const prior = input.followThrough;
  const headSha = input.readiness.headSha;
  const red = input.readiness.kind === "checking" && input.readiness.reason === "checks-failing";

  if (!red || !headSha) {
    // CI is not red. A hold survives only while its own head is still current
    // (e.g. a re-run or a repair is in flight); a new head starts clean.
    const keep = Boolean(headSha) && headSha === prior.judgedHeadSha;
    return {
      kind: "none",
      followThrough: keep ? prior : { ...prior, hold: null, failing: [], attentionKey: null },
    };
  }

  const failing = classifyFailingChecks(input.checks);
  if (prior.judgedHeadSha === headSha) {
    return { kind: "hold", headSha, followThrough: { ...prior, failing } };
  }

  const judged = (patch: Partial<PrFollowThroughV1>): PrFollowThroughV1 => ({
    ...prior,
    failing,
    judgedHeadSha: headSha,
    ...patch,
  });

  // A defect dominates: a repair produces a new head, which re-runs every check.
  if (failing.some((check) => check.class === "defect")) {
    if (input.authority !== "dispatch") {
      const packet = repairPacket(headSha, failing, (prior.attempts.attempts[REPAIR_FAILURE_CLASS] ?? 0) + 1);
      return {
        kind: "repair",
        mode: input.authority,
        headSha,
        packet,
        followThrough: judged({ hold: "awaiting-person", attentionKey: attentionKeyFor(`repair-${input.authority}`, headSha) }),
      };
    }
    const recovery = decideAutonomousRecovery({ failureClass: REPAIR_FAILURE_CLASS, state: prior.attempts });
    if (recovery.terminal) {
      return {
        kind: "attention",
        target: "process-overseer",
        reason: "repair-budget-exhausted",
        headSha,
        followThrough: judged({
          hold: "awaiting-person",
          attempts: recovery.state,
          attentionKey: attentionKeyFor("repair-budget-exhausted", headSha),
        }),
      };
    }
    const attempt = recovery.state.attempts[REPAIR_FAILURE_CLASS] ?? 1;
    return {
      kind: "repair",
      mode: "dispatch",
      headSha,
      packet: repairPacket(headSha, failing, attempt),
      followThrough: judged({ hold: "repairing", attempts: recovery.state, attentionKey: null }),
    };
  }

  if (failing.length === 0 || failing.some((check) => check.class === "unclassified")) {
    return {
      kind: "attention",
      target: "process-overseer",
      reason: "unclassified-check-failure",
      headSha,
      followThrough: judged({ hold: "awaiting-person", attentionKey: attentionKeyFor("unclassified-check-failure", headSha) }),
    };
  }

  // Every failure is infrastructure.
  const reruns = prior.infraReruns?.headSha === headSha ? prior.infraReruns.count : 0;
  const workflowRunIds = [...new Set(failing.flatMap((check) => (check.workflowRunId ? [check.workflowRunId] : [])))];
  if (reruns < INFRA_RERUN_BOUND && workflowRunIds.length > 0) {
    // Not "judged": the re-run's outcome on this same head is judged next.
    return {
      kind: "rerun-infrastructure",
      headSha,
      workflowRunIds,
      followThrough: { ...prior, failing, hold: null, infraReruns: { headSha, count: reruns + 1 } },
    };
  }
  const reason: PrAttentionReason = workflowRunIds.length === 0 ? "infrastructure-not-rerunnable" : "infrastructure-persists";
  return {
    kind: "attention",
    target: "platform-operator",
    reason,
    headSha,
    followThrough: judged({ hold: "awaiting-person", attentionKey: attentionKeyFor(reason, headSha) }),
  };
}

function repairPacket(headSha: string, failing: PrFailingCheck[], attempt: number): PrRepairPacket {
  return {
    headSha,
    failureClass: REPAIR_FAILURE_CLASS,
    attempt,
    bound: REPAIR_BOUND,
    failingChecks: failing,
    constraints: PR_REPAIR_CONSTRAINTS,
  };
}

/** One follow-through status for every room (§3.2), projected from the delivery record. */
export function projectPrFollowThroughStatus(
  delivery: { status: BuildPrDeliveryStatus; followThrough: PrFollowThroughV1 } | null,
): PrFollowThroughStatus | null {
  if (!delivery) return null;
  switch (delivery.status) {
    case "awaiting-release":
    case "deployed":
      return "merged";
    case "closed":
      return "closed";
    case "escalated":
      return "awaiting-person";
    case "queued":
      return "queued";
    case "created":
    case "checking":
    case "updating":
      return delivery.followThrough.hold ?? "watching";
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readAttempts(value: unknown): AutonomousRecoveryStateV1 {
  const raw = asObject(value);
  if (raw.schemaVersion !== 1 || raw.policyVersion !== AUTONOMOUS_RECOVERY_POLICY_VERSION) {
    return initialAutonomousRecoveryState();
  }
  const attempts: AutonomousRecoveryStateV1["attempts"] = {};
  for (const [key, count] of Object.entries(asObject(raw.attempts))) {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) {
      (attempts as Record<string, number>)[key] = count;
    }
  }
  const keys = Array.isArray(raw.emittedEscalationKeys)
    ? raw.emittedEscalationKeys.filter((key): key is string => typeof key === "string")
    : [];
  return { schemaVersion: 1, policyVersion: AUTONOMOUS_RECOVERY_POLICY_VERSION, attempts, emittedEscalationKeys: keys };
}

const FAILURE_CLASSES = new Set<PrCheckFailureClass>(["infrastructure", "defect", "unclassified"]);

function readFailing(value: unknown): PrFailingCheck[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const raw = asObject(entry);
    if (typeof raw.name !== "string" || typeof raw.conclusion !== "string") return [];
    if (!FAILURE_CLASSES.has(raw.class as PrCheckFailureClass)) return [];
    return [{
      name: raw.name,
      conclusion: raw.conclusion,
      runUrl: typeof raw.runUrl === "string" ? raw.runUrl : null,
      workflowRunId: typeof raw.workflowRunId === "number" ? raw.workflowRunId : null,
      class: raw.class as PrCheckFailureClass,
    }];
  });
}

/** Tolerant read: anything malformed starts a clean record rather than throwing. */
export function readPrFollowThrough(value: unknown): PrFollowThroughV1 {
  const raw = asObject(value);
  const reruns = asObject(raw.infraReruns);
  return {
    hold: raw.hold === "repairing" || raw.hold === "awaiting-person" ? raw.hold : null,
    failing: readFailing(raw.failing),
    attempts: readAttempts(raw.attempts),
    judgedHeadSha: typeof raw.judgedHeadSha === "string" ? raw.judgedHeadSha : null,
    infraReruns: typeof reruns.headSha === "string" && typeof reruns.count === "number"
      ? { headSha: reruns.headSha, count: reruns.count }
      : null,
    attentionKey: typeof raw.attentionKey === "string" ? raw.attentionKey : null,
  };
}
