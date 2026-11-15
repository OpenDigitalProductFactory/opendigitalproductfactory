// Standing stewardship shapes: the platform watching its own coworkers and
// backlog (BI-7E7B93DF family). Split out of standing-operations-shapes.ts,
// which spreads them in at the end so registry order is unchanged; that module
// re-exports the shape keys, so existing importers are unaffected.
//
// Type-only import back to work-shapes.ts, as in standing-operations-shapes.ts:
// no runtime cycle.

import type { WorkShapeDefinition } from "./work-shapes";
import { MONTHLY_REVIEW } from "./standing-shape-review";

export const COWORKER_FITNESS_WATCH_SHAPE_KEY = "coworker-fitness-watch";
export const BACKLOG_STEWARD_WATCH_SHAPE_KEY = "backlog-steward-watch";

export const STANDING_STEWARDSHIP_SHAPES: Record<string, WorkShapeDefinition> = {
  [COWORKER_FITNESS_WATCH_SHAPE_KEY]: {
    key: COWORKER_FITNESS_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Coworker fitness watch",
    description:
      "The platform engineer reports which AI coworkers have unresolved capability gaps or "
      + "stale qualifications. Granting or revoking authority is a human stage — a watch that "
      + "could widen a grant could widen its own.",
    triggers: ["cadence", "evidence-decay"],
    stages: [
      {
        key: "measure",
        title: "Measure coworker capability and qualification freshness",
        effort: "low",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Every registered coworker has a measured capability and qualification state.",
        },
        evidence: ["assurance-run"],
        tools: ["get_capability_completeness"],
      },
      {
        key: "report",
        title: "Report gaps and stale qualifications",
        effort: "low",
        accountablePrincipalRef: "agent:platform-engineer",
        advance: {
          kind: "status-change",
          condition: "Each unresolved gap or stale qualification is reported with what would close it.",
        },
        evidence: ["assurance-finding"],
        tools: ["get_capability_completeness", "list_all_capability_needs"],
      },
      {
        key: "grant",
        title: "Grant or revoke",
        // Authority change. Never an agent.
        accountablePrincipalRef: "role:workforce-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner grants, revokes, or accepts the gap with a reason.",
          decisionScope: "coworker-authority-change",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "Every registered coworker has a current capability and qualification report.", disposition: "proceed" },
      { kind: "failure", condition: "The coworker registry cannot be read — the run stops and reports, and never reports an unread coworker as fit.", disposition: "inconclusive" },
      { kind: "budget", condition: "More than 100 coworkers assessed in one run — the run stops and escalates.", disposition: "awaiting-person" },
    ],
    grants: ["tool:read", "tool:workroom_evidence_write"],
    measures: [
      { key: "coworkers-measured", description: "Coworkers whose capability state was measured." },
      { key: "open-gaps", description: "Unresolved capability gaps reported." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "coworkers" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },

  [BACKLOG_STEWARD_WATCH_SHAPE_KEY]: {
    key: BACKLOG_STEWARD_WATCH_SHAPE_KEY,
    version: "1.0.0",
    title: "Backlog stewardship watch",
    description:
      "The portfolio advisor reviews the complete active backlog and same-organization "
      + "work sync, distinguishes duplicate demand from related variants, checks epic placement and "
      + "records evidence in this Workroom. The standing watch remains advisory: an accountable "
      + "backlog owner decides proposed corrections before the existing governed action lane executes them.",
    triggers: ["cadence", "estate-drift"],
    stages: [
      {
        key: "observe",
        title: "Read the complete active backlog",
        effort: "low",
        accountablePrincipalRef: "agent:portfolio-advisor",
        advance: {
          kind: "status-change",
          condition: "The run records the exact eligible and scanned populations, reads every active local or mirrored item and every epic, and treats any truncated or failed read as incomplete rather than clean.",
        },
        evidence: ["assurance-run"],
        tools: ["sweep_duplicate_demand", "list_epics", "query_backlog"],
      },
      {
        key: "reconcile",
        title: "Classify findings and propose corrections",
        effort: "medium",
        accountablePrincipalRef: "agent:portfolio-advisor",
        advance: {
          kind: "status-change",
          condition: "Every finding is classified as a true duplicate, repeated occurrence, related variant, epic-placement correction, cross-reference gap, peer-owned correction or no change. Deterministic local corrections are proposed with evidence; ambiguous and peer-owned changes remain explicitly routed proposals.",
        },
        evidence: ["assurance-finding"],
        tools: ["find_duplicate_candidates", "query_backlog"],
      },
      {
        key: "decide",
        title: "Decide proposed corrections",
        accountablePrincipalRef: "role:backlog-owner",
        advance: {
          kind: "governed-decision",
          condition: "The accountable owner confirms, rejects or routes each proposal to its owning installation, with a reason. Accepted changes execute through the existing governed backlog action lane rather than this advisory watch.",
          decisionScope: "backlog-admission",
        },
        evidence: ["decision-record"],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The complete active population is accounted for and every finding has a proposed or no-change disposition.", disposition: "proceed" },
      { kind: "failure", condition: "The backlog, epic inventory or peer ownership evidence cannot be read — the run stops and reports, and never describes partial coverage as complete.", disposition: "inconclusive" },
      { kind: "budget", condition: "More than 100 proposed corrections remain in one run — the run stops and escalates rather than burying the owner.", disposition: "awaiting-person" },
    ],
    grants: ["tool:registry_read", "tool:backlog_read", "tool:workroom_evidence_write"],
    measures: [
      { key: "items-reviewed", description: "Active backlog items included in the completed population." },
      { key: "proposals-raised", description: "Findings proposed for an accountable decision." },
      { key: "peer-routes", description: "Peer-owned findings routed without local mutation." },
    ],
    budgets: [{ kind: "findings-per-run", limit: 100, unit: "proposals" }],
    reviewPoint: MONTHLY_REVIEW,
    collaborationShape: "approval-sign-off",
  },
};
