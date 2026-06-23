// apps/web/lib/assurance/remediation-merge-orchestrator.ts
//
// P2 orchestration: walk the ready assurance-remediation PRs, run each through the
// WWMD-gated decision (remediation-merge-gate.ts), and either arm auto-merge or
// escalate to the human responder.
//
// The merge actuation is the ONLY irreversible step, so it is behind two seams:
//   1. injectable adapters (live GitHub I/O is supplied by the caller, never
//      imported here) → fully unit-testable;
//   2. `actuationEnabled` (DARK-LAUNCH gate) → when false, an auto-merge decision
//      is RECORDED but not actuated, so the gate can run and be observed against
//      real PRs before it is allowed to merge anything autonomously.
// Escalation always actuates (filing an issue report is safe and the whole point).

import {
  classifyDepChange,
  decideRemediationMerge,
  type DepChangeClass,
} from "./remediation-merge-gate";

export interface ReadyRemediationPR {
  buildId: string;
  buildPk: string;
  backlogItemId: string;
  prNumber: number;
  title: string;
  /** Old → new dependency version from the PR diff (null when not extractable). */
  fromVersion: string | null;
  toVersion: string | null;
}

export interface PrReadiness {
  ciGreen: boolean;
  cooldownMet: boolean;
  osvClean: boolean;
  hasConflict: boolean;
}

export interface MergeGateAdapters {
  listReadyRemediationPRs: () => Promise<ReadyRemediationPR[]>;
  getReadiness: (pr: ReadyRemediationPR) => Promise<PrReadiness>;
  /** Arm GitHub auto-merge on the PR. Only invoked when actuationEnabled. */
  armAutoMerge: (pr: ReadyRemediationPR) => Promise<void>;
  /** File a human escalation (e.g. createPlatformIssueReport). Always invoked. */
  escalate: (pr: ReadyRemediationPR, reason: string) => Promise<void>;
  /** DARK-LAUNCH gate: when false, auto-merge is decided but not actuated. */
  actuationEnabled: boolean;
}

export interface MergeGateOutcome {
  buildId: string;
  prNumber: number;
  decision: "auto-merge" | "escalate";
  actuated: boolean;
  reason: string;
}

export interface RunMergeGateResult {
  processed: number;
  merged: number;
  escalated: number;
  dryRun: number;
  outcomes: MergeGateOutcome[];
}

export async function runRemediationMergeGate(input: {
  adapters: MergeGateAdapters;
  budget: number;
}): Promise<RunMergeGateResult> {
  const { adapters, budget } = input;
  const result: RunMergeGateResult = { processed: 0, merged: 0, escalated: 0, dryRun: 0, outcomes: [] };
  if (budget <= 0) return result;

  const prs = (await adapters.listReadyRemediationPRs()).slice(0, budget);
  result.processed = prs.length;

  for (const pr of prs) {
    const readiness = await adapters.getReadiness(pr);
    const changeClass: DepChangeClass =
      pr.fromVersion && pr.toVersion ? classifyDepChange(pr.fromVersion, pr.toVersion) : "unknown";
    const decision = decideRemediationMerge({ changeClass, ...readiness });

    if (decision.action === "auto-merge") {
      if (adapters.actuationEnabled) {
        await adapters.armAutoMerge(pr);
        result.merged += 1;
        result.outcomes.push({ buildId: pr.buildId, prNumber: pr.prNumber, decision: "auto-merge", actuated: true, reason: decision.reason });
      } else {
        result.dryRun += 1;
        result.outcomes.push({ buildId: pr.buildId, prNumber: pr.prNumber, decision: "auto-merge", actuated: false, reason: `${decision.reason} [dark: actuation disabled]` });
      }
      continue;
    }

    await adapters.escalate(pr, decision.reason);
    result.escalated += 1;
    result.outcomes.push({ buildId: pr.buildId, prNumber: pr.prNumber, decision: "escalate", actuated: true, reason: decision.reason });
  }

  return result;
}
