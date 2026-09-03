import type { WorkCaseSourceRef } from "./case-types";
import {
  getWorkroomLifecycleAction,
  type WorkroomLifecycleOperation,
} from "./action-registry";
import {
  evaluateWorkCasePolicy,
  type WorkCasePolicyDecision,
  type WorkCasePolicyInput,
} from "./policy-envelope";
import { dedupeRoomSourceRefs, roomText } from "./room-projection-utils";
import { getWorkCaseSourceEntry } from "./source-registry";
import type { WorkroomCycleView, WorkroomOutcomePacket } from "./room-types";
import {
  evaluateWorkroomLifecycleConformance,
  type WorkroomLifecycleConformanceDecision,
  type WorkroomShapeConformance,
} from "./workroom-shape-conformance";

export interface WorkroomCycleCarrierCandidate {
  cycleKey: string;
  carrierKind: WorkroomCycleView["carrierKind"];
  carrierId: string;
  trigger: string | null;
  objective: string | null;
  accountablePrincipalRef: string | null;
  openedAt: Date | string | null;
  expectedReviewAt: Date | string | null;
  stopConditions: readonly string[];
  measureSummary: string | null;
  contextRefs: readonly WorkCaseSourceRef[];
  status: WorkroomCycleView["status"];
  outcomePacket?: WorkroomOutcomePacket | null;
  sourceRefs: readonly WorkCaseSourceRef[];
}

export type WorkroomCycleErrorReason =
  | "unknown_source"
  | "finite_room_has_cycle"
  | "multiple_active_cycles"
  | "missing_cycle_boundary"
  | "unsupported_cycle_carrier";

export class WorkroomCycleError extends Error {
  constructor(readonly reason: WorkroomCycleErrorReason, message: string) {
    super(message);
    this.name = "WorkroomCycleError";
  }
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildWorkroomCycle(candidate: WorkroomCycleCarrierCandidate): WorkroomCycleView {
  const trigger = roomText(candidate.trigger);
  const objective = roomText(candidate.objective);
  const accountablePrincipalRef = roomText(candidate.accountablePrincipalRef);
  const openedAt = iso(candidate.openedAt);
  const expectedReviewAt = iso(candidate.expectedReviewAt);
  const stopConditions = candidate.stopConditions.map(roomText).filter((value): value is string => Boolean(value));
  const measureSummary = roomText(candidate.measureSummary);
  const contextRefs = dedupeRoomSourceRefs(candidate.contextRefs);
  if (
    !trigger
    || !objective
    || !accountablePrincipalRef
    || !openedAt
    || !expectedReviewAt
    || stopConditions.length === 0
    || !measureSummary
    || contextRefs.length === 0
  ) {
    throw new WorkroomCycleError(
      "missing_cycle_boundary",
      `Cycle '${candidate.cycleKey}' requires trigger, objective, accountable principal, opened/review times, stop condition, measure, and scoped context.`,
    );
  }
  if ((candidate.status === "closed" || candidate.status === "carried-over") && !candidate.outcomePacket) {
    throw new WorkroomCycleError(
      "missing_cycle_boundary",
      `Closed cycle '${candidate.cycleKey}' requires a sealed Outcome Packet.`,
    );
  }
  return {
    cycleKey: candidate.cycleKey,
    carrierKind: candidate.carrierKind,
    carrierId: candidate.carrierId,
    trigger,
    objective,
    accountablePrincipalRef,
    openedAt,
    expectedReviewAt,
    stopConditions,
    measureSummary,
    status: candidate.status,
    outcomePacket: candidate.outcomePacket ?? null,
    sourceRefs: dedupeRoomSourceRefs([...candidate.sourceRefs, ...contextRefs]),
  };
}

export function selectCurrentWorkroomCycle(
  sourceKey: string,
  candidates: readonly WorkroomCycleCarrierCandidate[],
): WorkroomCycleView | null {
  const source = getWorkCaseSourceEntry(sourceKey);
  if (!source) {
    throw new WorkroomCycleError("unknown_source", `Work Room source '${sourceKey}' is not registered.`);
  }
  const active = candidates.filter((candidate) => candidate.status === "open" || candidate.status === "verifying");
  if (source.roomProjection.mode === "finite") {
    if (active.length > 0) {
      throw new WorkroomCycleError("finite_room_has_cycle", `${source.displayLabel} is finite and cannot project a recurring cycle.`);
    }
    return null;
  }
  const logicalCycles = new Set(active.map((candidate) => candidate.cycleKey));
  if (logicalCycles.size > 1) {
    throw new WorkroomCycleError("multiple_active_cycles", "A standing Work Room can have only one active logical cycle.");
  }
  if (active.length === 0) return null;

  const precedence = source.roomProjection.cycleCarrierPrecedence;
  const selected = [...active].sort((left, right) => {
    const rank = precedence.indexOf(left.carrierKind) - precedence.indexOf(right.carrierKind);
    return rank || left.carrierId.localeCompare(right.carrierId);
  })[0];
  if (!selected || !precedence.includes(selected.carrierKind)) {
    throw new WorkroomCycleError("unsupported_cycle_carrier", "No supported carrier can project the active cycle.");
  }
  return buildWorkroomCycle(selected);
}

export function selectCompletedWorkroomCycles(
  sourceKey: string,
  candidates: readonly WorkroomCycleCarrierCandidate[],
): WorkroomCycleView[] {
  const source = getWorkCaseSourceEntry(sourceKey);
  if (!source) {
    throw new WorkroomCycleError("unknown_source", `Work Room source '${sourceKey}' is not registered.`);
  }

  const precedence = source.roomProjection.cycleCarrierPrecedence;
  const completed = candidates.filter(
    (candidate) => candidate.status === "closed" || candidate.status === "carried-over",
  );
  const byLogicalCycle = new Map<string, WorkroomCycleCarrierCandidate>();
  for (const candidate of completed) {
    if (!precedence.includes(candidate.carrierKind)) continue;
    const existing = byLogicalCycle.get(candidate.cycleKey);
    if (!existing || precedence.indexOf(candidate.carrierKind) < precedence.indexOf(existing.carrierKind)) {
      byLogicalCycle.set(candidate.cycleKey, candidate);
    }
  }

  return [...byLogicalCycle.values()]
    .map(buildWorkroomCycle)
    .sort((left, right) => {
      const completedOrder = (right.outcomePacket?.completedAt ?? "")
        .localeCompare(left.outcomePacket?.completedAt ?? "");
      return completedOrder || left.cycleKey.localeCompare(right.cycleKey);
    });
}

export type WorkroomCyclePolicyDecision =
  | WorkCasePolicyDecision
  | Extract<WorkroomLifecycleConformanceDecision, { ok: false }>
  | { ok: false; reason: "unknown_lifecycle_operation" | "missing_current_cycle" | "closed_cycle_sealed"; message: string };

export type WorkroomShapeConformanceContext = {
  hasDeclaredWorkShape: boolean;
  result: WorkroomShapeConformance | null;
};

export function evaluateWorkroomCyclePolicy(input: {
  operation: WorkroomLifecycleOperation | string;
  cycle: WorkroomCycleView | null;
  policy: Omit<WorkCasePolicyInput, "action">;
  shapeConformance?: WorkroomShapeConformanceContext;
}): WorkroomCyclePolicyDecision {
  const lifecycle = getWorkroomLifecycleAction(input.operation);
  if (!lifecycle) {
    return { ok: false, reason: "unknown_lifecycle_operation", message: `Unknown Work Room lifecycle operation '${input.operation}'.` };
  }
  const opensNewCycle = lifecycle.operation === "open-cycle" || lifecycle.operation === "renew";
  if (!input.cycle && !opensNewCycle && lifecycle.operation !== "archive") {
    return { ok: false, reason: "missing_current_cycle", message: `${lifecycle.displayLabel} requires a current cycle.` };
  }
  if (input.cycle && ["closed", "carried-over"].includes(input.cycle.status) && !["renew", "archive"].includes(lifecycle.operation)) {
    return { ok: false, reason: "closed_cycle_sealed", message: `Cycle '${input.cycle.cycleKey}' is sealed.` };
  }
  if (input.shapeConformance) {
    const conformance = evaluateWorkroomLifecycleConformance({
      operation: lifecycle.operation,
      hasDeclaredWorkShape: input.shapeConformance.hasDeclaredWorkShape,
      conformance: input.shapeConformance.result,
    });
    if (!conformance.ok) return conformance;
  }
  return evaluateWorkCasePolicy({ ...input.policy, action: lifecycle.canonicalAction });
}

export interface WorkroomCarryOverCommand {
  kind: "attach-to-cycle" | "create-case";
  summary: string;
  ownerRef: string | null;
  targetCycleKey: string | null;
  idempotencyKey: string;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function planWorkroomCarryOver(input: {
  roomKey: string;
  fromCycleKey: string;
  toCycleKey?: string | null;
  unresolvedWork: WorkroomOutcomePacket["unresolvedWork"];
}): WorkroomCarryOverCommand[] {
  const commands = input.unresolvedWork.flatMap((item) => {
    if (item.disposition !== "carry-over" && item.disposition !== "new-case") return [];
    if (item.disposition === "carry-over" && !roomText(input.toCycleKey)) {
      throw new WorkroomCycleError("missing_cycle_boundary", "Carry-over requires a target cycle.");
    }
    const fingerprint = [item.summary.trim(), item.ownerRef ?? "", item.disposition].join("|");
    return [{
      kind: item.disposition === "carry-over" ? "attach-to-cycle" as const : "create-case" as const,
      summary: item.summary.trim(),
      ownerRef: item.ownerRef,
      targetCycleKey: item.disposition === "carry-over" ? input.toCycleKey ?? null : null,
      idempotencyKey: `work-room:${input.roomKey}:cycle:${input.fromCycleKey}:unresolved:${stableHash(fingerprint)}`,
    }];
  });
  return [...new Map(commands.map((command) => [command.idempotencyKey, command])).values()];
}
