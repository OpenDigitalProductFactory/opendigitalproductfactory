// The platform post-implementation review work shape (BI-AA47C672).
//
// A merged break-fix owes an independent post-implementation review (PIR).
// The platform reviewer dispatch first sends the server-issued request on a
// live connection of the room's author or requester. When none is live, the
// platform no longer waits for a client: it opens one review room for the item
// and issues the same packet to it (backlog/initiative-readiness/
// platform-review-room.ts). This is the activity that room runs: one
// non-governed stage in which an in-platform reviewer coworker reads the bound
// merged change and records the review receipt. The Workroom drive dispatches
// that coworker through the ordinary ScheduledAgentTask path.
//
// The stage is answered by a ROLE bound per room to the packet's reviewer
// (workShapeRoleBindings), never a fixed agent. The receipt writer accepts the
// room's run only for the packet the platform issued, re-derived from current
// readiness where the write happens; independence is enforced there and again
// by the receipt repository.
//
// Type-only import back to work-shapes.ts, like the other declaration modules.

import type { WorkShapeDefinition } from "./work-shapes";

export const PLATFORM_REVIEW_SHAPE_KEY = "platform-post-implementation-review";
export const PLATFORM_REVIEW_SHAPE_VERSION = "1.0.0";
export const PLATFORM_REVIEW_SHAPE_REF = `${PLATFORM_REVIEW_SHAPE_KEY}@${PLATFORM_REVIEW_SHAPE_VERSION}`;

/** The role each platform review room binds to the packet's reviewer. */
export const PLATFORM_REVIEWER_ROLE = "post-implementation-reviewer";

/** The stage the reviewer completes. */
export const PLATFORM_REVIEW_STAGE_KEY = "review";

/** The packet-bound review writer. */
export const PLATFORM_REVIEW_WRITER = "record_initiative_post_implementation_review";

/** The writes the review stage declares, and the only ones its scheduled run is steered for. */
export const PLATFORM_REVIEW_WRITES: readonly string[] = [PLATFORM_REVIEW_WRITER, "record_workroom_evidence"];

/** The grants the declared writes require (TOOL_TO_GRANTS): the room's write ceiling. */
export const PLATFORM_REVIEW_WRITE_GRANTS: readonly string[] = ["initiative_design_review", "workroom_evidence_write"];

export const PLATFORM_REVIEW_SHAPES: Record<string, WorkShapeDefinition> = {
  [PLATFORM_REVIEW_SHAPE_KEY]: {
    key: PLATFORM_REVIEW_SHAPE_KEY,
    version: PLATFORM_REVIEW_SHAPE_VERSION,
    title: "Post-implementation review",
    description:
      "A merged break-fix owes an independent post-implementation review and no assistant of the "
      + "person who delivered it is connected to request one. The in-platform reviewer named for this "
      + "room reads the merged change the platform bound and records the review receipt. It does not "
      + "change the item's status or review any other change.",
    // The dispatcher escalates an owed review to the platform; the room is finite work.
    triggers: ["escalation"],
    stages: [
      {
        key: PLATFORM_REVIEW_STAGE_KEY,
        title: "Review the merged change and record the receipt",
        accountablePrincipalRef: `role:${PLATFORM_REVIEWER_ROLE}`,
        advance: {
          kind: "status-change",
          condition:
            "The reviewer recorded the post-implementation review receipt for the bound change, or a "
            + "blocked record says why it could not.",
        },
        evidence: ["pir-receipt"],
        mandatedTools: PLATFORM_REVIEW_WRITES,
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The review receipt is recorded; the item's completion gate decides the rest.", disposition: "proceed" },
      { kind: "failure", condition: "The bound change, the packet or the writer cannot be reached — the run records blocked and stops, and does not report success.", disposition: "inconclusive" },
      { kind: "budget", condition: "Three review cycles have run without a receipt — the room stops and the dispatcher reports it.", disposition: "awaiting-person" },
    ],
    // The read baseline, the immutable source reader, and exactly the grants
    // the declared writes require (the shape test holds them equal).
    grants: ["tool:read", "file_read", ...PLATFORM_REVIEW_WRITE_GRANTS],
    measures: [
      { key: "hours-to-receipt", description: "Hours from the room's creation to the recorded review receipt." },
    ],
    budgets: [
      { kind: "cycles-per-window", limit: 3, unit: "review cycles" },
    ],
    reviewPoint: {
      everyDays: 7,
      description: "Reviewed weekly whether or not the receipt landed, matching the delivery rooms' review point.",
    },
    collaborationShape: null,
  },
};
