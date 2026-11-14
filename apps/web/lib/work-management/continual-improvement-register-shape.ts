// The continual improvement register: the standing room the Continual
// Improvement Manager (AGT-908) drives (BI-CE564FBB; spec
// docs/superpowers/specs/2026-10-28-harness-evolution-loop-design.md,
// "Continual improvement as a standing operation").
//
// This is the ITIL 4 continual improvement register run as a DMAIC cycle. It
// bounds work that ALREADY RUNS: the typed daily `harness-evolution-loop`
// job records each room's recurring misses (slice 1), screens and probes them
// against the operating criteria (slice 2, lib/continual-improvement/), and
// records verdicts on the rooms. The stages below are that job, decomposed.
//
// Registered with the standing operations (STANDING_SHAPES) so the existing
// derivation in lib/authority/coordination-bindings.ts gives AGT-908 its
// explicit coordination binding (BI-E0728215): the shape proposes the driver,
// the binding grants it. No new authority path.
//
// The one consequential act, adopting a harness edit, stays a governed
// decision: it lands as governed change (a reviewed PR or a shape version
// bump), never as a write the job makes. Detection, screening, probing and the
// control checks need no person.

import type { WorkShapeDefinition } from "./work-shapes";

export const CONTINUAL_IMPROVEMENT_REGISTER_SHAPE_KEY = "continual-improvement-register";

export const CONTINUAL_IMPROVEMENT_REGISTER_SHAPE: WorkShapeDefinition = {
  key: CONTINUAL_IMPROVEMENT_REGISTER_SHAPE_KEY,
  version: "1.0.0",
  title: "Continual improvement register",
  description:
    "The Continual Improvement Manager runs every room's recurring misses through one DMAIC cycle: "
    + "define the misses worth working against the operating criteria, measure and rank them, probe "
    + "the vital few at K=1, record each verdict on its room, and schedule the control checks that "
    + "reopen a fix that recurs. Adopting an edit is a governed change; the register never writes "
    + "a room's harness itself.",
  triggers: ["cadence", "evidence-decay"],
  stages: [
    {
      key: "define",
      title: "Define the misses worth working",
      accountablePrincipalRef: "agent:continual-improvement-manager",
      advance: {
        kind: "status-change",
        condition:
          "Every ring-0 room's recurring misses are recorded as candidates, and each one is screened: "
          + "eligible, or skipped with its reason (single run, shape too rare, below the cost floor, "
          + "parked after KEEP_BASE, inside control limits).",
      },
      evidence: ["assurance-run"],
      tools: ["query_backlog", "get_backlog_item"],
    },
    {
      key: "measure",
      title: "Rank the eligible misses",
      accountablePrincipalRef: "agent:continual-improvement-manager",
      advance: {
        kind: "status-change",
        condition:
          "Eligible misses are ranked by frequency × cost × horizon, weighted human above AI above "
          + "code, and the vital few are named within the cycle's probe budget.",
      },
      evidence: ["cited-finding-list"],
      tools: ["query_backlog", "wiki_query"],
    },
    {
      key: "improve",
      title: "Probe the vital few and record the verdict",
      accountablePrincipalRef: "agent:continual-improvement-manager",
      advance: {
        kind: "status-change",
        condition:
          "Each worked miss has a probe at K=1 (K=2 only after KEEP_BASE in the top cost decile), a "
          + "scope decision, and an ADOPT or KEEP_BASE verdict recorded on its room.",
      },
      evidence: ["assurance-finding"],
      tools: ["principle_decide", "wiki_query"],
    },
    {
      key: "control",
      title: "Schedule the control checks",
      accountablePrincipalRef: "agent:continual-improvement-manager",
      advance: {
        kind: "status-change",
        condition:
          "Every verdict has its recurrence checks at 7 and 14 days on the same miss key, and every "
          + "room's control limits are recomputed so common-cause variation gets no edit.",
      },
      evidence: ["runtime-check"],
      tools: ["get_backlog_item", "query_backlog"],
    },
    {
      key: "decide",
      title: "Adopt a winning edit through governed change",
      // The register prepares; adoption is a change to the harness, so it is a
      // governed decision. Until GPP permits can steer (BI-6B610D94) it lands as
      // a reviewed PR or a shape version bump; then, under a narrow permit.
      accountablePrincipalRef: "role:platform-owner",
      advance: {
        kind: "governed-decision",
        condition:
          "An ADOPT verdict lands as governed change, or is returned with the reason; a KEEP_BASE "
          + "verdict needs no decision.",
        decisionScope: "harness-edit-adoption",
      },
      evidence: ["decision-record"],
    },
  ],
  stopConditions: [
    { kind: "success", condition: "Every recurring miss in the window is worked, skipped with a reason, or parked; none is unaccounted for.", disposition: "proceed" },
    { kind: "failure", condition: "The room activity or tool-execution records cannot be read — the cycle stops and reports, and does NOT conclude that a room has no misses from a failed read.", disposition: "inconclusive" },
    { kind: "budget", condition: "The cycle's probe or token cap is reached — it stops working new misses and records the rest as budget-exhausted rather than raising the cap.", disposition: "awaiting-person" },
  ],
  grants: ["tool:read", "tool:workroom_evidence_write"],
  measures: [
    { key: "misses-eligible", description: "Recurring misses that passed the Define screen in one cycle." },
    { key: "misses-worked", description: "Misses probed in one cycle." },
    { key: "recurrence-after-fix", description: "Misses that recurred at their 7- or 14-day control check." },
  ],
  budgets: [
    { kind: "findings-per-run", limit: 20, unit: "probe replays" },
    { kind: "spend", limit: 200_000, unit: "tokens" },
  ],
  reviewPoint: {
    everyDays: 7,
    description:
      "Reviewed weekly with the rollup whether or not it moved: a register that worked nothing for a "
      + "week is as likely to be broken as to be finished.",
  },
  collaborationShape: "approval-sign-off",
};
