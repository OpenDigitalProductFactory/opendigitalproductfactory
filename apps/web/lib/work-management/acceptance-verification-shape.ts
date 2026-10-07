// The acceptance-verification work shape (BI-C1781121, slice 3 of BI-5F3D6A37).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.4.
//
// The daily acceptance sweep creates one steward Workroom per aged
// awaiting-acceptance item. This is the activity that room runs: one
// non-governed stage in which a coworker verifies the item's unmet acceptance
// criteria on the live install and records the evidence. Recording evidence
// changes no status; moving the item to `done` still passes the completion
// readiness gate, which is where independence is enforced.
//
// The stage is answered by a ROLE, not a fixed agent: who verifies differs per
// item (it is the grant-backed lane owner, never the author). Each room binds
// the role to its resolved agent through a `workShapeRoleBindings` scope claim
// (workroom-shape-claim.ts), and the drive dispatches that agent
// (drive-resolution.ts roleBindings). A room with no binding raises attention
// for the role instead, so an unbound room never runs.
//
// Type-only import back to work-shapes.ts, like the other declaration modules.

import type { WorkShapeDefinition } from "./work-shapes";

export const ACCEPTANCE_VERIFICATION_SHAPE_KEY = "acceptance-verification";
export const ACCEPTANCE_VERIFICATION_SHAPE_VERSION = "1.0.0";
export const ACCEPTANCE_VERIFICATION_SHAPE_REF =
  `${ACCEPTANCE_VERIFICATION_SHAPE_KEY}@${ACCEPTANCE_VERIFICATION_SHAPE_VERSION}`;

/** The role each acceptance steward room binds to its resolved coworker. */
export const ACCEPTANCE_VERIFIER_ROLE = "acceptance-verifier";

/**
 * The evidence writes the verify stage declares for what the coworker
 * observed on the live install.
 */
export const ACCEPTANCE_VERIFIER_EVIDENCE_WRITES: readonly string[] = ["record_execution_evidence", "record_workroom_evidence"];

/**
 * The acceptance-reviewer lane's writer (BI-099A0BA3). Its objective-mapping
 * operation accepts a run only when it carries an exact server-issued packet.
 * For a steward room, the daily sweep issues that packet to the room and the
 * repository verifies it server-side (acceptance-sweep/
 * steward-objective-mapping-authority.ts); with no current packet the handler
 * refuses the call, and in a steward room it refuses every other operation.
 */
export const ACCEPTANCE_OBJECTIVE_MAPPING_WRITER = "record_initiative_evidence";

/**
 * The writes the verify stage declares, and the only ones its scheduled run is
 * steered for (room-stage-mandate.ts).
 */
export const ACCEPTANCE_VERIFIER_WRITES: readonly string[] = [...ACCEPTANCE_VERIFIER_EVIDENCE_WRITES, ACCEPTANCE_OBJECTIVE_MAPPING_WRITER];

/** The grants ACCEPTANCE_VERIFIER_WRITES require: the room's write ceiling, nothing wider. */
export const ACCEPTANCE_VERIFIER_WRITE_GRANTS: readonly string[] = ["build_evidence", "workroom_evidence_write", "initiative_evidence_write"];

export const ACCEPTANCE_VERIFICATION_SHAPES: Record<string, WorkShapeDefinition> = {
  [ACCEPTANCE_VERIFICATION_SHAPE_KEY]: {
    key: ACCEPTANCE_VERIFICATION_SHAPE_KEY,
    version: ACCEPTANCE_VERIFICATION_SHAPE_VERSION,
    title: "Acceptance verification",
    description:
      "A delivered backlog item has waited in awaiting-acceptance past the aged threshold. The "
      + "coworker named for this room verifies the item's unmet acceptance criteria against the live "
      + "install and records the acceptance evidence through the governed evidence tools. It does "
      + "not change the item's status, close it, or record evidence it did not observe.",
    // The sweep escalates an aged item to a coworker; the room is finite work,
    // not a standing cadence.
    triggers: ["escalation"],
    stages: [
      {
        key: "verify",
        title: "Verify the acceptance criteria and record the evidence",
        accountablePrincipalRef: `role:${ACCEPTANCE_VERIFIER_ROLE}`,
        advance: {
          kind: "status-change",
          condition:
            "Every owed acceptance requirement named in the room objective has evidence recorded by "
            + "this coworker, or a blocked record says what could not be verified.",
        },
        evidence: ["acceptance-receipt"],
        mandatedTools: ACCEPTANCE_VERIFIER_WRITES,
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The acceptance evidence is recorded; the item's completion gate decides whether it closes.", disposition: "proceed" },
      { kind: "failure", condition: "The item, the live install or an evidence tool cannot be reached — the run records blocked and stops, and does not report success.", disposition: "inconclusive" },
      { kind: "budget", condition: "Three verification cycles have run without a completing receipt — the room stops and the sweep reports the item as routed-unresolved.", disposition: "awaiting-person" },
    ],
    // The read baseline plus exactly the grants the declared writes require
    // (TOOL_TO_GRANTS: record_execution_evidence -> build_evidence,
    // record_workroom_evidence -> workroom_evidence_write,
    // record_initiative_evidence -> initiative_evidence_write); the shape test
    // holds the two equal.
    grants: ["tool:read", ...ACCEPTANCE_VERIFIER_WRITE_GRANTS],
    measures: [
      { key: "days-to-evidence", description: "Days from the room's creation to recorded acceptance evidence." },
    ],
    budgets: [
      { kind: "cycles-per-window", limit: 3, unit: "verification cycles" },
    ],
    reviewPoint: {
      everyDays: 7,
      description: "Reviewed weekly whether or not evidence landed, matching the delivery rooms' review point.",
    },
    collaborationShape: null,
  },
};
