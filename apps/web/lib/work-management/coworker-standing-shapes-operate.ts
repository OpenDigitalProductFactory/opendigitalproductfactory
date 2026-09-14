// Coworker standing shapes — the `operate` value stream.
//
// WHY A SECOND FILE. coworker-standing-shapes.ts holds the same contract and is
// at 741 of its 800-LOC ceiling; a shape belongs beside its peers, not wedged in
// under the cap. THIS FILE MUST BE LISTED IN `SHAPE_SOURCE_FILES`
// (scripts/measure-capability-completeness.mjs). A registry that spans two files
// while the measure reads one is the exact defect found four separate times in
// this codebase — shapes, self-tasks, skills, grants — each time reading as
// "the coworker has nothing" when the second file held everything. A guard test
// fails the build if a work-management file declares an accountable agent and is
// not listed there, so this cannot silently repeat.
//
// THE RULE THESE FOLLOW. Every stage names a real accountable principal, and
// every shape ends in a governed decision taken by a HUMAN ROLE, never by the
// coworker that prepared it (§8.11.2). A shape bounds what standing work may do,
// so a shape whose gates are all status-changes would declare an unbounded
// coworker in the shape of a bounded one.
//
// STAGES ARE DRAWN FROM WHAT ALREADY RUNS, not invented from the slug. Each
// shape below cites the running loop or the authored grant intent it bounds.
//
// GRANTS ARE CAPPED. `specialization-over-generalization` (core kernel): no more
// than 10 tools relevant to the current task, degrading past 15 "regardless of
// model capability".

import type { WorkShapeDefinition } from "./work-shapes";

export const COWORKER_STANDING_SHAPES_OPERATE: Record<string, WorkShapeDefinition> = {
  // ── Bookkeeper (AGT-907) ──────────────────────────────────────────────────
  //
  // This one bounds work that ALREADY RUNS. packages/db/src/bookkeeping-cycle-config.ts
  // seeds a standing weekly task (`bookkeeping-cycle-weekly`, Mondays 09:00 UTC)
  // against the standing `bookkeeping-period` room, with a deterministic handler
  // — no LLM loop. The stages below are that config's own prompt, decomposed:
  // gather → import with provenance → categorize/except → reconcile → owner
  // review. Nothing here is invented; the cycle was running unbounded.
  //
  // The config's last sentence is the shape's load-bearing constraint: "Never
  // fabricate a transaction; the reconciled period is owner-gated on the real
  // statement export." So the closing gate is the owner's, and the failure stop
  // fires on a missing statement rather than letting the period close on
  // inferred rows.
  "bookkeeping-period-cycle": {
    key: "bookkeeping-period-cycle",
    version: "1.0.0",
    title: "Bookkeeping period cycle",
    description:
      "The day-to-day books loop for one accounting period: statements and receipts are gathered "
      + "and imported with provenance, every transaction is categorized and matched or surfaced as "
      + "an exception, the balance is reconciled, and the period is closed ONLY by the owner "
      + "against the real statement export.",
    triggers: ["cadence", "claim"],
    stages: [
      {
        key: "gather",
        title: "Gather the period's statements and receipts",
        accountablePrincipalRef: "agent:bookkeeper",
        advance: {
          kind: "status-change",
          condition:
            "Every expected statement and receipt for the period is attached with its source, or "
            + "the missing ones are named. A period that cannot name what is missing does not advance.",
        },
        evidence: ["source-document-set"],
      },
      {
        key: "import",
        title: "Import with provenance",
        accountablePrincipalRef: "agent:bookkeeper",
        advance: {
          kind: "status-change",
          condition:
            "Each imported transaction carries its originating document and import run. An "
            + "unprovenanced row is an exception, not a transaction.",
        },
        evidence: ["import-run"],
      },
      {
        key: "categorize",
        title: "Categorize and match, or raise an exception",
        accountablePrincipalRef: "agent:bookkeeper",
        advance: {
          kind: "status-change",
          condition:
            "Every transaction is either categorized and matched to a counterparty, or surfaced as "
            + "a named exception. Silence is not a category.",
        },
        evidence: ["exception-list"],
      },
      {
        key: "reconcile",
        title: "Reconcile the balance",
        accountablePrincipalRef: "agent:bookkeeper",
        advance: {
          kind: "status-change",
          condition:
            "The computed balance agrees with the statement, or the variance is quantified and "
            + "attributed to named exceptions.",
        },
        evidence: ["reconciliation"],
      },
      {
        key: "owner-close",
        title: "Close the period",
        // The books coworker prepares; the owner closes. Closing a period is a
        // financial assertion, and the config is explicit that it is gated on
        // the real statement export.
        accountablePrincipalRef: "role:finance-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "The owner accepts the reconciled period against the real statement export, or returns "
            + "it with the exceptions they will not accept.",
          decisionScope: "bookkeeping-period-close",
        },
        evidence: ["decision-record", "outcome-packet"],
      },
    ],
    stopConditions: [
      {
        kind: "success",
        condition: "The period is closed by the owner with a reconciliation and an Outcome Packet.",
      },
      {
        kind: "failure",
        condition:
          "A required statement cannot be read. The cycle stops and reports the gap rather than "
          + "reconciling against inferred rows — the config's 'never fabricate a transaction' rule "
          + "is a stop condition, not advice.",
      },
      {
        kind: "budget",
        condition:
          "More than 500 unmatched exceptions in one period — the cycle stops and escalates rather "
          + "than handing the owner a review nobody can finish.",
      },
    ],
    grants: ["tool:banking_read", "tool:banking_write", "tool:document_read", "tool:enrichment_write", "tool:crm_read"],
    measures: [
      { key: "transactions-matched", description: "Share of the period's transactions matched without an exception." },
      { key: "period-close-latency", description: "Days from period end to owner close." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 500, unit: "exceptions" }],
    reviewPoint: {
      everyDays: 90,
      description:
        "Reviewed quarterly. A cycle that never raises an exception is as likely to be matching too "
        + "eagerly as to be clean.",
    },
    collaborationShape: "approval-sign-off",
  },

  // ── Time-off Advisor (AGT-WS-TIME-OFF) ────────────────────────────────────
  //
  // Grant intent (coworker-grants.ts, BI-3CDEC5F0): policy_read/write so it can
  // draft company policy into Policy rather than answering in chat only — and
  // "Publish remains human HITL on /compliance/policies." That sentence is the
  // shape: it drafts, a human publishes. Its grants are deliberately narrow
  // (consumer_read, registry_read), so the shape must not imply it can decide
  // leave entitlement.
  "time-off-policy-currency": {
    key: "time-off-policy-currency",
    version: "1.0.0",
    title: "Time-off policy currency",
    description:
      "Keeps the written time-off policy current and answerable: drift between the published "
      + "policy and what the org actually applies is surfaced, a revision is DRAFTED, and a human "
      + "publishes. The advisor never publishes and never rules on an individual entitlement.",
    triggers: ["cadence", "escalation"],
    stages: [
      {
        key: "detect-drift",
        title: "Find where the written policy and the applied practice disagree",
        accountablePrincipalRef: "agent:time-off-advisor",
        advance: {
          kind: "status-change",
          condition:
            "Each divergence is named with the policy clause and the practice that contradicts it, "
            + "or the review records that none was found.",
        },
        evidence: ["policy-divergence-list"],
      },
      {
        key: "draft-revision",
        title: "Draft the revision into Policy",
        accountablePrincipalRef: "agent:time-off-advisor",
        advance: {
          kind: "status-change",
          condition:
            "A revision exists as a DRAFT against the named clauses, with the jurisdictional "
            + "constraint cited where one applies. Drafting is the ceiling of this stage.",
        },
        evidence: ["policy-draft"],
      },
      {
        key: "publish",
        title: "Publish the policy",
        // BI-3CDEC5F0 is explicit: publish is human HITL on /compliance/policies.
        // Leave rules create entitlement, and an entitlement an agent published
        // is one nobody agreed to.
        accountablePrincipalRef: "role:people-owner",
        advance: {
          kind: "governed-decision",
          condition:
            "A human publishes the revision on /compliance/policies, or returns it. The advisor "
            + "cannot publish and cannot self-approve.",
          decisionScope: "time-off-policy-publication",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The published policy matches applied practice, or every remaining divergence is one a human declined to change." },
      {
        kind: "failure",
        condition:
          "The applicable jurisdiction cannot be established. The cycle stops rather than drafting "
          + "leave rules against the wrong statute.",
      },
      { kind: "budget", condition: "More than 25 divergences in one cycle — stop and escalate; that is a policy rewrite, not a currency check." },
    ],
    grants: ["tool:policy_read", "tool:policy_write", "tool:consumer_read", "tool:registry_read"],
    measures: [
      { key: "divergences-closed", description: "Divergences resolved by a published revision." },
      { key: "policy-age", description: "Days since the time-off policy was last reviewed against practice." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 25, unit: "divergences" }],
    reviewPoint: {
      everyDays: 90,
      description:
        "Quarterly, matching the platform's 90-day reference-staleness ceiling: a leave policy more "
        + "than a quarter stale is a policy the org cannot rely on.",
    },
    collaborationShape: "approval-sign-off",
  },
};
