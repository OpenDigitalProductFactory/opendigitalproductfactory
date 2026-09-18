import type { WorkroomAccessLevel } from "./room-participation";
import type { WorkroomParticipantRole } from "./room-types";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle/types";
import { preferenceFromPreset, type GoldenTriangleNamedPreset } from "@/lib/golden-triangle/presets";

export const WORKROOM_SHAPE_KEYS = [
  "specialist-alignment",
  "approval-sign-off",
  "outward-review",
  "change-consequential",
  "escalation",
  "craft-stewardship",
] as const;
export type WorkroomShapeKey = (typeof WORKROOM_SHAPE_KEYS)[number];

type ShapeRole = Extract<
  WorkroomParticipantRole,
  "coordinator" | "specialist" | "approver" | "reviewer"
>;

export type WorkroomShapeDefinition = {
  key: WorkroomShapeKey;
  inclusionOrder: readonly ShapeRole[];
  authorityLadderLevel: WorkroomAccessLevel;
  sensitivityStepUp: boolean;
  description: string;
  /**
   * The Cost/Quality/Time posture a room of this shape runs at unless the room
   * declares its own (BI-7ADEBDC1). A parameter of the room definition, chosen
   * for the shape's expected outcome — never a coworker's identity preference.
   */
  defaultPriority: GoldenTriangleNamedPreset;
};

const SHAPES: Record<WorkroomShapeKey, WorkroomShapeDefinition> = {
  "specialist-alignment": {
    key: "specialist-alignment",
    defaultPriority: "assured",
    inclusionOrder: ["coordinator", "specialist", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "Coordinator routes a corpus check to a qualified specialist before the accountable approver receives the verdict.",
  },
  "approval-sign-off": {
    key: "approval-sign-off",
    defaultPriority: "assured",
    inclusionOrder: ["coordinator", "specialist", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "The domain specialist prepares evidence and an accountable approver signs off.",
  },
  "outward-review": {
    key: "outward-review",
    defaultPriority: "assured",
    inclusionOrder: ["coordinator", "specialist", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "An outward-facing action receives specialist review and explicit send or publish approval.",
  },
  "change-consequential": {
    key: "change-consequential",
    defaultPriority: "assured",
    inclusionOrder: ["coordinator", "reviewer", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "A consequential change is reviewed and confirmed before execution.",
  },
  escalation: {
    key: "escalation",
    defaultPriority: "fast",
    inclusionOrder: ["coordinator", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "A veto returns to the originating coordinator and accountable owner for accept-block or amendment.",
  },
  "craft-stewardship": {
    key: "craft-stewardship",
    defaultPriority: "balanced",
    inclusionOrder: ["coordinator", "specialist"],
    authorityLadderLevel: "content",
    sensitivityStepUp: false,
    description: "The standing WSID craft-stewardship room: profession specialists curate the corpus and triage findings under a coordinator at content-level authority.",
  },
};

export function getWorkroomShape(key: WorkroomShapeKey): WorkroomShapeDefinition {
  return SHAPES[key];
}

/** The full Golden Triangle preference a shape runs at by default (BI-7ADEBDC1). */
export function shapeDefaultPriority(key: WorkroomShapeKey): GoldenTrianglePreference {
  return preferenceFromPreset(SHAPES[key].defaultPriority);
}

export type WorkroomShapeBinding = {
  shape: WorkroomShapeKey;
  initiator: { principalRef: string; kind: "person" | "agent" };
  requiredParticipants: Array<{ role: ShapeRole; principalRef: string }>;
  authorityLadderLevel: WorkroomAccessLevel;
  stepUpRequired: boolean;
  gaps: ShapeRole[];
  allowed: boolean;
};

export function bindWorkroomShape(input: {
  shape: WorkroomShapeKey;
  initiator: WorkroomShapeBinding["initiator"];
  participants: Partial<Record<ShapeRole, string>>;
  sensitivityCeiling: string | null;
}): WorkroomShapeBinding {
  const definition = getWorkroomShape(input.shape);
  const gaps = definition.inclusionOrder.filter((role) => !input.participants[role]);
  const requiredParticipants = definition.inclusionOrder.flatMap((role) => {
    const principalRef = input.participants[role];
    return principalRef ? [{ role, principalRef }] : [];
  });
  const sensitivity = input.sensitivityCeiling ?? "public";
  return {
    shape: input.shape,
    initiator: input.initiator,
    requiredParticipants,
    authorityLadderLevel: definition.authorityLadderLevel,
    stepUpRequired: definition.sensitivityStepUp && ["confidential", "restricted", "critical"].includes(sensitivity),
    gaps: [...gaps],
    allowed: gaps.length === 0,
  };
}
