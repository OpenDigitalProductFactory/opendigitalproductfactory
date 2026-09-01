/**
 * Standing-room drive resolution (BI-FCD639D9).
 *
 * Pure: declared shape + posture + Process Overseer conformance → a dispatch
 * plan. The Inngest job executes the plan. Never invents occupants, skips
 * stages, widens grants, or runs `role:` / `person:` / governed-decision stages.
 */
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import type { WorkroomParticipantRole, WorkroomParticipantView } from "./room-types";
import {
  projectWorkShapeCycleBoundary,
  type ProjectedWorkShapeCycle,
  type WorkShapeDefinition,
  type WorkShapeDefinitionContract,
  type WorkShapeTriggerClass,
} from "./work-shapes";
import {
  evaluateWorkroomShapeConformance,
  type WorkroomShapeConformance,
  type WorkroomShapeConformanceDeviation,
} from "./workroom-shape-conformance";

export type DriveAction =
  | "do_not_wake"
  | "stop"
  | "pause"
  | "escalate"
  | "dispatch_agent"
  | "attention";

export type AccountablePrincipalKind = "agent" | "role" | "person" | "unknown";

export type DriveResolutionInput = {
  roomId: string;
  definition: WorkShapeDefinitionContract | null;
  collaborationShape: string | null;
  postureLevel: ProactivityLevel | null;
  participants: readonly WorkroomParticipantView[];
  currentStageKey: string | null;
  receipts: readonly { stageKey: string; kind: string }[];
  budgetUsage: readonly { kind: string; used: number }[];
  stopConditionHits: readonly string[];
  reviewDue: boolean;
  substrateReachable: boolean;
  substrateEmpty: boolean;
  proposedGrants?: readonly string[];
  coordinatorHasProcessCoordinationAuthority?: boolean;
  independentEvaluatorPrincipalRef?: string | null;
  independentApproverPrincipalRef?: string | null;
  requiredRoles?: readonly WorkroomParticipantRole[];
  now?: Date;
  trigger?: WorkShapeTriggerClass;
  /** Test/override only. Production callers omit this and the next permitted stage is derived. */
  proposedStageKey?: string | null;
};

export type DrivePlan = {
  action: DriveAction;
  reason: string;
  roomId: string;
  shapeKey: string | null;
  shapeVersion: string | null;
  stageKey: string | null;
  accountablePrincipalRef: string | null;
  agentId: string | null;
  attentionPrincipalRef: string | null;
  taskId: string | null;
  conformance: WorkroomShapeConformance | null;
  cycle: ProjectedWorkShapeCycle | null;
  deviations: WorkroomShapeConformanceDeviation[];
  ledger: string[];
};

export function workroomDriveTaskId(roomId: string, shapeKey: string): string {
  return `workroom-${roomId}-${shapeKey}`;
}

export function parseAccountablePrincipalRef(
  ref: string,
): { kind: AccountablePrincipalKind; value: string } {
  if (ref.startsWith("agent:")) return { kind: "agent", value: ref.slice("agent:".length) };
  if (ref.startsWith("role:")) return { kind: "role", value: ref.slice("role:".length) };
  if (ref.startsWith("person:")) return { kind: "person", value: ref.slice("person:".length) };
  return { kind: "unknown", value: ref };
}

function emptyPlan(
  input: DriveResolutionInput,
  action: DriveAction,
  reason: string,
  extras: Partial<DrivePlan> = {},
): DrivePlan {
  return {
    action,
    reason,
    roomId: input.roomId,
    shapeKey: input.definition?.key ?? null,
    shapeVersion: input.definition?.version ?? null,
    stageKey: null,
    accountablePrincipalRef: null,
    agentId: null,
    attentionPrincipalRef: null,
    taskId: null,
    conformance: extras.conformance ?? null,
    cycle: extras.cycle ?? null,
    deviations: extras.deviations ?? extras.conformance?.deviations ?? [],
    ledger: extras.ledger ?? [reason],
  };
}

function nextStageKey(
  definition: WorkShapeDefinitionContract,
  currentStageKey: string | null,
  receipts: readonly { stageKey: string; kind: string }[],
): string | null {
  if (definition.stages.length === 0) return null;
  if (!currentStageKey) return definition.stages[0]?.key ?? null;
  const currentHasReceipt = receipts.some((receipt) => receipt.stageKey === currentStageKey);
  if (!currentHasReceipt) return currentStageKey;
  const index = definition.stages.findIndex((stage) => stage.key === currentStageKey);
  if (index < 0 || index + 1 >= definition.stages.length) return null;
  return definition.stages[index + 1]?.key ?? null;
}

function asShape(
  definition: WorkShapeDefinitionContract,
  collaborationShape: string | null,
): WorkShapeDefinition {
  return {
    key: definition.key,
    version: definition.version,
    title: definition.key,
    description: definition.key,
    triggers: definition.triggers,
    stages: definition.stages,
    stopConditions: definition.stopConditions,
    grants: definition.grants,
    measures: definition.measures,
    budgets: definition.budgets,
    reviewPoint: definition.reviewPoint,
    collaborationShape: (collaborationShape as WorkShapeDefinition["collaborationShape"]) ?? null,
  };
}

function ledgerFrom(conformance: WorkroomShapeConformance, extra: string[]): string[] {
  const fromDeviations = conformance.deviations.map((deviation) => `${deviation.code}: ${deviation.summary}`);
  return [...fromDeviations, ...extra];
}

export function resolveDrivePlan(input: DriveResolutionInput): DrivePlan {
  if (!input.definition) {
    return emptyPlan(input, "do_not_wake", "missing_shape");
  }

  if (input.postureLevel === "quiet") {
    return emptyPlan(input, "do_not_wake", "quiet");
  }

  if (input.postureLevel == null) {
    return emptyPlan(input, "do_not_wake", "no_posture");
  }

  if (!input.substrateReachable) {
    return emptyPlan(input, "stop", "unreachable_substrate", {
      ledger: ["Substrate unreachable; drive stopped and raised nothing."],
    });
  }

  if (input.substrateEmpty) {
    return emptyPlan(input, "stop", "empty_read", {
      ledger: ["Substrate empty; drive stopped and raised nothing."],
    });
  }

  const proposedStageKey = input.proposedStageKey !== undefined
    ? input.proposedStageKey
    : nextStageKey(
      input.definition,
      input.currentStageKey,
      input.receipts,
    );
  const conformance = evaluateWorkroomShapeConformance({
    definition: input.definition,
    collaborationShape: input.collaborationShape,
    participants: input.participants,
    currentStageKey: input.currentStageKey,
    proposedStageKey,
    receipts: input.receipts,
    budgetUsage: input.budgetUsage,
    stopConditionHits: input.stopConditionHits,
    reviewDue: input.reviewDue,
    proposedGrants: input.proposedGrants,
    coordinatorHasProcessCoordinationAuthority: input.coordinatorHasProcessCoordinationAuthority,
    independentEvaluatorPrincipalRef: input.independentEvaluatorPrincipalRef,
    independentApproverPrincipalRef: input.independentApproverPrincipalRef,
    requiredRoles: input.requiredRoles,
  });

  const trigger = input.trigger
    ?? (input.definition.triggers[0] as WorkShapeTriggerClass | undefined)
    ?? "cadence";
  const cycle = projectWorkShapeCycleBoundary({
    shape: asShape(input.definition, input.collaborationShape),
    trigger,
    startedAt: input.now ?? new Date(0),
  });

  if (conformance.disposition === "stop") {
    return emptyPlan(input, "stop", "conformance_stop", {
      conformance,
      cycle,
      deviations: conformance.deviations,
      ledger: ledgerFrom(conformance, []),
    });
  }
  if (conformance.disposition === "escalate") {
    return emptyPlan(input, "escalate", "conformance_escalate", {
      conformance,
      cycle,
      deviations: conformance.deviations,
      ledger: ledgerFrom(conformance, []),
    });
  }
  if (conformance.disposition === "pause") {
    return emptyPlan(input, "pause", "conformance_pause", {
      conformance,
      cycle,
      deviations: conformance.deviations,
      ledger: ledgerFrom(conformance, []),
    });
  }

  const stage = proposedStageKey
    ? input.definition.stages.find((entry) => entry.key === proposedStageKey) ?? null
    : null;
  if (!stage) {
    return emptyPlan(input, "stop", "success", {
      conformance,
      cycle,
      ledger: ["No further permitted stage; cycle complete."],
    });
  }

  const parsed = parseAccountablePrincipalRef(stage.accountablePrincipalRef);
  const governed = stage.advance.kind === "governed-decision";
  const humanStage = parsed.kind === "role" || parsed.kind === "person";
  if (governed || humanStage) {
    const reason = governed ? "governed_decision" : parsed.kind === "role" ? "role_stage" : "person_stage";
    return {
      action: "attention",
      reason,
      roomId: input.roomId,
      shapeKey: input.definition.key,
      shapeVersion: input.definition.version,
      stageKey: stage.key,
      accountablePrincipalRef: stage.accountablePrincipalRef,
      agentId: null,
      attentionPrincipalRef: stage.accountablePrincipalRef,
      taskId: null,
      conformance,
      cycle,
      deviations: [],
      ledger: [`Stage ${stage.key} becomes attention (${reason}); the runner does not execute it.`],
    };
  }

  if (parsed.kind !== "agent" || !parsed.value) {
    return emptyPlan(input, "pause", "unknown_principal", {
      conformance,
      cycle,
      ledger: [`Stage ${stage.key} has no dispatchable agent principal.`],
    });
  }

  return {
    action: "dispatch_agent",
    reason: "agent_stage",
    roomId: input.roomId,
    shapeKey: input.definition.key,
    shapeVersion: input.definition.version,
    stageKey: stage.key,
    accountablePrincipalRef: stage.accountablePrincipalRef,
    agentId: parsed.value,
    attentionPrincipalRef: null,
    taskId: workroomDriveTaskId(input.roomId, input.definition.key),
    conformance,
    cycle,
    deviations: [],
    ledger: [`Dispatch agent:${parsed.value} for stage ${stage.key}.`],
  };
}
