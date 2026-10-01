// Agent stages of standing (cadence-triggered) work shapes that cannot yet
// declare the tools they need (BI-43C3E914).
//
// GPP (docs/architecture/gated-permissions-process.md, draft 0.1) check
// "C-1 Stage coverage", proposed assertion GPP-001: every stage that does work
// has a capability set. A stage here has none because no suitable EXISTING
// platform tool reads what the stage must read, or because the tool exists but
// the stage's accountable agent does not hold its grant and granting it is a
// separate authority decision. Tools are not invented to empty this list.
//
// SHRINK-ONLY. stage-tool-parity.test.ts fails when a stage on this list
// declares `tools` (remove it here) and when an agent stage of a cadence shape
// neither declares tools nor appears here (declare them, or add it with a
// reason). Each entry is backlog-pending until a tool or grant lands.

export type StageToolGap = {
  shapeKey: string;
  stageKey: string;
  /** Why no existing tool can be declared, in plain words. */
  reason: string;
  /** The backlog item that closes the gap. every entry cites a filed item. */
  backlogRef: string;
};

export const KNOWN_STAGE_TOOL_GAPS: readonly StageToolGap[] = [
  {
    shapeKey: "obligation-assurance-watch",
    stageKey: "sweep",
    reason: "No read tool over Obligation, Control review dates or LicenseRequirementReference staleness.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "obligation-assurance-watch",
    stageKey: "raise",
    reason: "Raising needs the same obligation/control read as sweep; no such tool exists.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "repository-policy-drift-watch",
    stageKey: "read",
    reason: "No tool reads enforced branch protection, sign-off enforcement or token grants from the forge.",
    backlogRef: "BI-EBF0F6EE",
  },
  {
    shapeKey: "repository-policy-drift-watch",
    stageKey: "diff",
    reason: "The diff needs the enforced-policy read that does not exist yet.",
    backlogRef: "BI-EBF0F6EE",
  },
  {
    shapeKey: "credential-hygiene-watch",
    stageKey: "scan",
    reason: "No tool reports credential age or exposure status.",
    backlogRef: "BI-EBF0F6EE",
  },
  {
    shapeKey: "licence-currency-watch",
    stageKey: "determine",
    reason: "No read tool over recorded licence requirements for the legal-operations counsel.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "outward-surface-review",
    stageKey: "storefront-fit",
    reason: "No tool reads storefront offers, prices or availability; list_storefront_activity reads guest activity, not the offer record.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "mailroom-triage-and-dispatch",
    stageKey: "intake",
    reason: "No platform tool reads a mailbox; the mailroom coordinator holds only room and registry reads.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "mailroom-triage-and-dispatch",
    stageKey: "triage-and-route",
    reason: "No tool reads routed mail or its target queues within the coordinator's grants.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "mailroom-triage-and-dispatch",
    stageKey: "chase",
    reason: "Queue reads (get_queue_status, list_at_risk_queues) need work_capsule_read, which the coordinator does not hold.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "bookkeeping-period-cycle",
    stageKey: "import",
    reason: "Import is a write stage; it has no read tool to declare, and write capability sets wait on GPP write bindings.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "time-off-policy-currency",
    stageKey: "detect-drift",
    reason: "list_policies/get_policy exist but need policy_read, which the time-off advisor does not hold; granting it is a separate authority decision.",
    backlogRef: "BI-C882005C",
  },
  {
    shapeKey: "time-off-policy-currency",
    stageKey: "draft-revision",
    reason: "Same as detect-drift: the policy read needs policy_read, which the time-off advisor does not hold.",
    backlogRef: "BI-C882005C",
  },
];

export function stageToolGapKey(shapeKey: string, stageKey: string): string {
  return `${shapeKey}/${stageKey}`;
}
