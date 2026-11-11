// The platform review work shapes (BI-AA47C672 PIR, BI-9CCB88C4 design-stage).
//
// A review packet the author-assistant carrier cannot send is handed to an
// in-platform reviewer. PIR identity (shape key, room key, capsule prefix) is
// byte-compatible. Design-spec, spec-approval and architecture-review each get
// their own room. Design-spec and spec-approval share one sibling shape because
// they share the same writer.
//
// Type-only import back to work-shapes.ts, like the other declaration modules.

import type { WorkShapeDefinition } from "./work-shapes";

export const PLATFORM_REVIEW_SHAPE_KEY = "platform-post-implementation-review";
export const PLATFORM_REVIEW_SHAPE_VERSION = "1.0.0";
export const PLATFORM_REVIEW_SHAPE_REF = `${PLATFORM_REVIEW_SHAPE_KEY}@${PLATFORM_REVIEW_SHAPE_VERSION}`;

/** The role each PIR room binds to the packet's reviewer. */
export const PLATFORM_REVIEWER_ROLE = "post-implementation-reviewer";

/** The stage the reviewer completes. */
export const PLATFORM_REVIEW_STAGE_KEY = "review";

/** The packet-bound PIR writer. */
export const PLATFORM_REVIEW_WRITER = "record_initiative_post_implementation_review";

/** The writes the PIR review stage declares, and the only ones its scheduled run is steered for. */
export const PLATFORM_REVIEW_WRITES: readonly string[] = [PLATFORM_REVIEW_WRITER, "record_workroom_evidence"];

/** The grants the PIR declared writes require (TOOL_TO_GRANTS): the room's write ceiling. */
export const PLATFORM_REVIEW_WRITE_GRANTS: readonly string[] = ["initiative_design_review", "workroom_evidence_write"];

export const PLATFORM_DESIGN_REVIEW_SHAPE_KEY = "platform-design-review";
export const PLATFORM_DESIGN_REVIEW_SHAPE_VERSION = "1.0.0";
export const PLATFORM_DESIGN_REVIEW_SHAPE_REF = `${PLATFORM_DESIGN_REVIEW_SHAPE_KEY}@${PLATFORM_DESIGN_REVIEW_SHAPE_VERSION}`;
export const PLATFORM_DESIGN_REVIEWER_ROLE = "design-checklist-reviewer";
export const PLATFORM_DESIGN_REVIEW_WRITER = "record_initiative_design_review";
export const PLATFORM_DESIGN_REVIEW_WRITES: readonly string[] = [PLATFORM_DESIGN_REVIEW_WRITER, "record_workroom_evidence"];
export const PLATFORM_DESIGN_REVIEW_WRITE_GRANTS: readonly string[] = ["initiative_design_review", "workroom_evidence_write"];

export const PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY = "platform-architecture-review";
export const PLATFORM_ARCHITECTURE_REVIEW_SHAPE_VERSION = "1.0.0";
export const PLATFORM_ARCHITECTURE_REVIEW_SHAPE_REF = `${PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY}@${PLATFORM_ARCHITECTURE_REVIEW_SHAPE_VERSION}`;
export const PLATFORM_ARCHITECTURE_REVIEWER_ROLE = "architecture-reviewer";
export const PLATFORM_ARCHITECTURE_REVIEW_WRITER = "record_initiative_architecture_review";
export const PLATFORM_ARCHITECTURE_REVIEW_WRITES: readonly string[] = [PLATFORM_ARCHITECTURE_REVIEW_WRITER, "record_workroom_evidence"];
export const PLATFORM_ARCHITECTURE_REVIEW_WRITE_GRANTS: readonly string[] = ["initiative_architecture_review", "workroom_evidence_write"];

export type PlatformReviewStewardGate =
  | "post-implementation-review"
  | "design-spec"
  | "spec-approval"
  | "architecture-review";

export type PlatformReviewGateSpec = {
  gate: PlatformReviewStewardGate;
  writer: string;
  evidence: "pir-receipt" | "spec-approval-receipt" | "architecture-review-receipt";
  shapeKey: string;
  shapeRef: string;
  role: string;
  capsulePrefix: string;
  writes: readonly string[];
  writeGrants: readonly string[];
};

/** Closed table the parser admits. Any other gate stays not-applicable. */
export const PLATFORM_REVIEW_GATE_SPECS: readonly PlatformReviewGateSpec[] = [
  {
    gate: "post-implementation-review",
    writer: PLATFORM_REVIEW_WRITER,
    evidence: "pir-receipt",
    shapeKey: PLATFORM_REVIEW_SHAPE_KEY,
    shapeRef: PLATFORM_REVIEW_SHAPE_REF,
    role: PLATFORM_REVIEWER_ROLE,
    capsulePrefix: "WC-PIR-",
    writes: PLATFORM_REVIEW_WRITES,
    writeGrants: PLATFORM_REVIEW_WRITE_GRANTS,
  },
  {
    gate: "design-spec",
    writer: PLATFORM_DESIGN_REVIEW_WRITER,
    evidence: "spec-approval-receipt",
    shapeKey: PLATFORM_DESIGN_REVIEW_SHAPE_KEY,
    shapeRef: PLATFORM_DESIGN_REVIEW_SHAPE_REF,
    role: PLATFORM_DESIGN_REVIEWER_ROLE,
    capsulePrefix: "WC-DSR-",
    writes: PLATFORM_DESIGN_REVIEW_WRITES,
    writeGrants: PLATFORM_DESIGN_REVIEW_WRITE_GRANTS,
  },
  {
    gate: "spec-approval",
    writer: PLATFORM_DESIGN_REVIEW_WRITER,
    evidence: "spec-approval-receipt",
    shapeKey: PLATFORM_DESIGN_REVIEW_SHAPE_KEY,
    shapeRef: PLATFORM_DESIGN_REVIEW_SHAPE_REF,
    role: PLATFORM_DESIGN_REVIEWER_ROLE,
    capsulePrefix: "WC-SAR-",
    writes: PLATFORM_DESIGN_REVIEW_WRITES,
    writeGrants: PLATFORM_DESIGN_REVIEW_WRITE_GRANTS,
  },
  {
    gate: "architecture-review",
    writer: PLATFORM_ARCHITECTURE_REVIEW_WRITER,
    evidence: "architecture-review-receipt",
    shapeKey: PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY,
    shapeRef: PLATFORM_ARCHITECTURE_REVIEW_SHAPE_REF,
    role: PLATFORM_ARCHITECTURE_REVIEWER_ROLE,
    capsulePrefix: "WC-ARR-",
    writes: PLATFORM_ARCHITECTURE_REVIEW_WRITES,
    writeGrants: PLATFORM_ARCHITECTURE_REVIEW_WRITE_GRANTS,
  },
];

export const PLATFORM_REVIEW_WRITERS: readonly string[] = [
  PLATFORM_REVIEW_WRITER,
  PLATFORM_DESIGN_REVIEW_WRITER,
  PLATFORM_ARCHITECTURE_REVIEW_WRITER,
];

export function platformReviewGateSpec(gate: string): PlatformReviewGateSpec | null {
  return PLATFORM_REVIEW_GATE_SPECS.find((spec) => spec.gate === gate) ?? null;
}

export function platformReviewSpecFromCapsuleId(capsuleId: string): PlatformReviewGateSpec | null {
  return PLATFORM_REVIEW_GATE_SPECS.find(
    (spec) => capsuleId.startsWith(spec.capsulePrefix) && capsuleId.length > spec.capsulePrefix.length,
  ) ?? null;
}

export function platformReviewRoomKeyForGate(gate: PlatformReviewStewardGate, itemId: string): string {
  return gate === "post-implementation-review" ? `platform-review:${itemId}` : `platform-review:${gate}:${itemId}`;
}

export function platformReviewRoomCapsuleIdForGate(gate: PlatformReviewStewardGate, itemId: string): string {
  const spec = platformReviewGateSpec(gate);
  return `${spec?.capsulePrefix ?? "WC-PIR-"}${itemId.replace(/^BI-/i, "").toUpperCase()}`;
}

function defineFiniteReviewShape(input: {
  key: string;
  version: string;
  title: string;
  description: string;
  role: string;
  stageTitle: string;
  condition: string;
  evidence: PlatformReviewGateSpec["evidence"];
  writes: readonly string[];
  grants: readonly string[];
}): WorkShapeDefinition {
  return {
    key: input.key,
    version: input.version,
    title: input.title,
    description: input.description,
    triggers: ["escalation"],
    stages: [
      {
        key: PLATFORM_REVIEW_STAGE_KEY,
        title: input.stageTitle,
        accountablePrincipalRef: `role:${input.role}`,
        advance: {
          kind: "status-change",
          condition: input.condition,
        },
        evidence: [input.evidence],
        mandatedTools: [...input.writes],
      },
    ],
    stopConditions: [
      { kind: "success", condition: "The review receipt is recorded; the item's completion gate decides the rest.", disposition: "proceed" },
      { kind: "failure", condition: "The bound change, the packet or the writer cannot be reached — the run records blocked and stops, and does not report success.", disposition: "inconclusive" },
      { kind: "budget", condition: "Three review cycles have run without a receipt — the room stops and the dispatcher reports it.", disposition: "awaiting-person" },
    ],
    grants: ["tool:read", "file_read", ...input.grants],
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
  };
}

export const PLATFORM_REVIEW_SHAPES: Record<string, WorkShapeDefinition> = {
  [PLATFORM_REVIEW_SHAPE_KEY]: defineFiniteReviewShape({
    key: PLATFORM_REVIEW_SHAPE_KEY,
    version: PLATFORM_REVIEW_SHAPE_VERSION,
    title: "Post-implementation review",
    description:
      "A merged break-fix owes an independent post-implementation review and no assistant of the "
      + "person who delivered it is connected to request one. The in-platform reviewer named for this "
      + "room reads the merged change the platform bound and records the review receipt. It does not "
      + "change the item's status or review any other change.",
    role: PLATFORM_REVIEWER_ROLE,
    stageTitle: "Review the merged change and record the receipt",
    condition:
      "The reviewer recorded the post-implementation review receipt for the bound change, or a "
      + "blocked record says why it could not.",
    evidence: "pir-receipt",
    writes: PLATFORM_REVIEW_WRITES,
    grants: PLATFORM_REVIEW_WRITE_GRANTS,
  }),
  [PLATFORM_DESIGN_REVIEW_SHAPE_KEY]: defineFiniteReviewShape({
    key: PLATFORM_DESIGN_REVIEW_SHAPE_KEY,
    version: PLATFORM_DESIGN_REVIEW_SHAPE_VERSION,
    title: "Design-stage review",
    description:
      "An owed design-spec or spec-approval review has no consent-bound author connection that "
      + "can request it. The in-platform reviewer named for this room reads the bound design artifact "
      + "and records the review receipt. It does not change the item's status or review any other change.",
    role: PLATFORM_DESIGN_REVIEWER_ROLE,
    stageTitle: "Review the bound design and record the receipt",
    condition:
      "The reviewer recorded the spec-approval receipt for the bound design, or a blocked record says why it could not.",
    evidence: "spec-approval-receipt",
    writes: PLATFORM_DESIGN_REVIEW_WRITES,
    grants: PLATFORM_DESIGN_REVIEW_WRITE_GRANTS,
  }),
  [PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY]: defineFiniteReviewShape({
    key: PLATFORM_ARCHITECTURE_REVIEW_SHAPE_KEY,
    version: PLATFORM_ARCHITECTURE_REVIEW_SHAPE_VERSION,
    title: "Architecture review",
    description:
      "An owed architecture review has no consent-bound author connection that can request it. "
      + "The in-platform reviewer named for this room reads the bound design artifact and records the "
      + "architecture-review receipt. It does not change the item's status or review any other change.",
    role: PLATFORM_ARCHITECTURE_REVIEWER_ROLE,
    stageTitle: "Review the bound architecture and record the receipt",
    condition:
      "The reviewer recorded the architecture-review receipt for the bound design, or a blocked record says why it could not.",
    evidence: "architecture-review-receipt",
    writes: PLATFORM_ARCHITECTURE_REVIEW_WRITES,
    grants: PLATFORM_ARCHITECTURE_REVIEW_WRITE_GRANTS,
  }),
};
