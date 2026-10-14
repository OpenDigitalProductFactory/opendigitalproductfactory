// Escalations for lanes a delivery shape owns, which never route through
// objective mapping. Split from terminal-recovery.ts to keep it under the
// module-size ceiling; the routing that picks them stays there.

import type { TerminalInitiativeRecovery } from "./terminal-recovery";
import type { InitiativeReadinessDecision } from "./types";

/**
 * BI-05F8860A: under readiness.v3 a small or break-fix item owes no objective
 * mapping — its acceptance lane belongs to the delivery-coordinator and is met
 * by cited manual/ux evidence (the runtime check or the failing-to-passing
 * test). Routing that lane at objective-mapping produced "baseline-not-found",
 * then "eligible-evidence-not-found", then "objective-mapping-history-
 * unavailable" — three misleading escalations for one missing evidence row.
 */
export function smallShapeAcceptanceEscalation(): TerminalInitiativeRecovery {
  return {
    reviewerRoutes: [],
    unroutable: [],
    escalations: [{
      accountableRole: "delivery-coordinator",
      toolName: "record_execution_evidence",
      grant: "backlog_write",
      reason: "acceptance-evidence-required",
      nextAction: "This delivery shape is accepted by the runtime check on the live install or by the failing-to-passing test, not by objective mapping. Record it with record_execution_evidence (kind manual_check or ux_verified) inside the current completion window, then cite that activity id in completionEvidence.evidenceActivityIds. Do not re-claim the item to refresh readiness; a re-claim does not reopen the window.",
    }],
  };
}

/**
 * BI-7876699F: research is satisfied by the AUTHOR, never by objective mapping.
 *
 * When RESEARCH_REQUIRED was the only unmet lane this function did not exist, so
 * the packet fell through to the workroom/baseline chain and answered
 * "baseline-not-found — complete independent spec approval". A delivery-small
 * shape's requirement set contains no OBJECTIVE_BASELINE_REQUIRED at all, so that
 * route could never legally be taken: the item was unclosable by anyone, and the
 * packet was pointing at a gate its own policy said did not apply.
 *
 * Same principle as smallShapeAcceptanceEscalation above (BI-05F8860A): name the
 * writer the accountable role can actually reach, and do not consult machinery
 * this lane does not use.
 */
export function researchLaneEscalation(): TerminalInitiativeRecovery {
  return {
    reviewerRoutes: [],
    unroutable: [],
    escalations: [{
      accountableRole: "design-author",
      toolName: "record_initiative_evidence",
      grant: "initiative_evidence_write",
      reason: "research-evidence-required",
      nextAction: "Research is the reproduction, and its author records it: call record_initiative_evidence with gate \"research\", citing the defect on a named ref (commit or branch + file + line) and the failing-to-passing proof. This lane needs no objective baseline and no independent spec approval — the delivery shape does not require one.",
    }],
  };
}

/**
 * BI-0F8E39D5: a small or medium item's baseline is the acceptance criteria in
 * its body, and its shape owes no spec, so "complete independent spec approval"
 * was advice it could never follow. Two different gaps land here, and each gets
 * its own next step (DI-FDAB20135537):
 *
 * - The body has no criteria the parser can read. That is the common case, and
 *   the author fixes it by editing the body. The first version of this message
 *   told BI-FA769D87's author the body "satisfies its baseline" and that the
 *   item "cannot close"; adding a heading closed it minutes later.
 * - The criteria are there but acceptance is still unmet. Platform work is
 *   accepted when its merge through branch protection is recognized. Other
 *   medium work needs an independent objective-mapping receipt. The authorized
 *   completion mutation now retains body criteria when source and author
 *   prerequisites are available; recovery names those prerequisites otherwise.
 */
export function bodyBaselineEscalation(decision: InitiativeReadinessDecision): TerminalInitiativeRecovery {
  const criteriaMissing = [...decision.blockers, ...decision.unmet]
    .some((entry) => entry.code === "OBJECTIVE_BASELINE_REQUIRED");
  const escalation = criteriaMissing
    ? {
      accountableRole: "product-owner" as const,
      toolName: "update_backlog_item" as const,
      grant: "backlog_write" as const,
      reason: "acceptance-criteria-missing" as const,
      nextAction: "This item's baseline is the acceptance criteria in its body, and none could be read. With update_backlog_item, add a heading that contains \"Acceptance\" (for example \"## Acceptance criteria\") followed by one criterion per bullet, or bullets that start with \"AC-<id>:\". A bold line is not a heading. Then retry. No spec approval is needed.",
    }
    : {
      accountableRole: "acceptance-reviewer" as const,
      toolName: "update_backlog_item_status" as const,
      grant: "backlog_write" as const,
      reason: "body-baseline-unpersisted" as const,
      nextAction: "The body has readable criteria but no retained criteria version. Retry completion with update_backlog_item_status and a valid completionEvidence manifest to capture it through the authorized transition. Capture requires one current Workroom with a full repository/head identity, author provenance and retained document storage. Then record fresh passing evidence after that version and request the exact independent acceptance reviewer route. Product-linked work still requires independent acceptance; no spec approval is needed.",
    };
  return { reviewerRoutes: [], unroutable: [], escalations: [escalation] };
}
