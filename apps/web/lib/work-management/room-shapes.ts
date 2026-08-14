import type { WorkRoomAccessLevel } from "./room-participation";
import type { WorkRoomParticipantRole } from "./room-types";

export const WORK_ROOM_SHAPE_KEYS = [
  "specialist-alignment",
  "approval-sign-off",
  "outward-review",
  "change-consequential",
  "escalation",
] as const;
export type WorkRoomShapeKey = (typeof WORK_ROOM_SHAPE_KEYS)[number];

type ShapeRole = Extract<
  WorkRoomParticipantRole,
  "coordinator" | "specialist" | "approver" | "reviewer"
>;

export type WorkRoomShapeDefinition = {
  key: WorkRoomShapeKey;
  inclusionOrder: readonly ShapeRole[];
  authorityLadderLevel: WorkRoomAccessLevel;
  sensitivityStepUp: boolean;
  description: string;
};

const SHAPES: Record<WorkRoomShapeKey, WorkRoomShapeDefinition> = {
  "specialist-alignment": {
    key: "specialist-alignment",
    inclusionOrder: ["coordinator", "specialist", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "Coordinator routes a corpus check to a qualified specialist before the accountable approver receives the verdict.",
  },
  "approval-sign-off": {
    key: "approval-sign-off",
    inclusionOrder: ["coordinator", "specialist", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "The domain specialist prepares evidence and an accountable approver signs off.",
  },
  "outward-review": {
    key: "outward-review",
    inclusionOrder: ["coordinator", "specialist", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "An outward-facing action receives specialist review and explicit send or publish approval.",
  },
  "change-consequential": {
    key: "change-consequential",
    inclusionOrder: ["coordinator", "reviewer", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "A consequential change is reviewed and confirmed before execution.",
  },
  escalation: {
    key: "escalation",
    inclusionOrder: ["coordinator", "approver"],
    authorityLadderLevel: "action",
    sensitivityStepUp: true,
    description: "A veto returns to the originating coordinator and accountable owner for accept-block or amendment.",
  },
};

export function getWorkRoomShape(key: WorkRoomShapeKey): WorkRoomShapeDefinition {
  return SHAPES[key];
}

export type WorkRoomShapeBinding = {
  shape: WorkRoomShapeKey;
  initiator: { principalRef: string; kind: "person" | "agent" };
  requiredParticipants: Array<{ role: ShapeRole; principalRef: string }>;
  authorityLadderLevel: WorkRoomAccessLevel;
  stepUpRequired: boolean;
  gaps: ShapeRole[];
  allowed: boolean;
};

export function bindWorkRoomShape(input: {
  shape: WorkRoomShapeKey;
  initiator: WorkRoomShapeBinding["initiator"];
  participants: Partial<Record<ShapeRole, string>>;
  sensitivityCeiling: string | null;
}): WorkRoomShapeBinding {
  const definition = getWorkRoomShape(input.shape);
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
