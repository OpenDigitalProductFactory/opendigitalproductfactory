import type { WorkCaseSourceRef } from "./case-types";
import {
  getWorkRoomLifecycleAction,
  type WorkRoomLifecycleOperation,
} from "./action-registry";
import {
  evaluateWorkCasePolicy,
  type WorkCasePolicyDecision,
  type WorkCasePolicyInput,
} from "./policy-envelope";
import { dedupeRoomSourceRefs, roomText } from "./room-projection-utils";
import { getWorkCaseSourceEntry } from "./source-registry";
import type { WorkRoomCycleView, WorkRoomOutcomePacket } from "./room-types";

export interface WorkRoomCycleCarrierCandidate {
  cycleKey: string;
  carrierKind: WorkRoomCycleView["carrierKind"];
  carrierId: string;
  trigger: string | null;
  objective: string | null;
  accountablePrincipalRef: string | null;
  openedAt: Date | string | null;
  expectedReviewAt: Date | string | null;
  stopConditions: readonly string[];
  measureSummary: string | null;
  contextRefs: readonly WorkCaseSourceRef[];
  status: WorkRoomCycleView["status"];
  outcomePacket?: WorkRoomOutcomePacket | null;
  sourceRefs: readonly WorkCaseSourceRef[];
}

export type WorkRoomCycleErrorReason =
  | "unknown_source"
  | "finite_room_has_cycle"
  | "multiple_active_cycles"
  | "missing_cycle_boundary"
  | "unsupported_cycle_carrier";

export class WorkRoomCycleError extends Error {
  constructor(readonly reason: WorkRoomCycleErrorReason, message: string) {
    super(message);
    this.name = "WorkRoomCycleError";
  }
}

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function buildWorkRoomCycle(candidate: WorkRoomCycleCarrierCandidate): WorkRoomCycleView {
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
    throw new WorkRoomCycleError(
      "missing_cycle_boundary",
      `Cycle '${candidate.cycleKey}' requires trigger, objective, accountable principal, opened/review times, stop condition, measure, and scoped context.`,
    );
  }
  if ((candidate.status === "closed" || candidate.status === "carried-over") && !candidate.outcomePacket) {
    throw new WorkRoomCycleError(
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

export function selectCurrentWorkRoomCycle(
  sourceKey: string,
  candidates: readonly WorkRoomCycleCarrierCandidate[],
): WorkRoomCycleView | null {
  const source = getWorkCaseSourceEntry(sourceKey);
  if (!source) {
    throw new WorkRoomCycleError("unknown_source", `Work Room source '${sourceKey}' is not registered.`);
  }
  const active = candidates.filter((candidate) => candidate.status === "open" || candidate.status === "verifying");
  if (source.roomProjection.mode === "finite") {
    if (active.length > 0) {
      throw new WorkRoomCycleError("finite_room_has_cycle", `${source.displayLabel} is finite and cannot project a recurring cycle.`);
    }
    return null;
  }
  const logicalCycles = new Set(active.map((candidate) => candidate.cycleKey));
  if (logicalCycles.size > 1) {
    throw new WorkRoomCycleError("multiple_active_cycles", "A standing Work Room can have only one active logical cycle.");
  }
  if (active.length === 0) return null;

  const precedence = source.roomProjection.cycleCarrierPrecedence;
  const selected = [...active].sort((left, right) => {
    const rank = precedence.indexOf(left.carrierKind) - precedence.indexOf(right.carrierKind);
    return rank || left.carrierId.localeCompare(right.carrierId);
  })[0];
  if (!selected || !precedence.includes(selected.carrierKind)) {
    throw new WorkRoomCycleError("unsupported_cycle_carrier", "No supported carrier can project the active cycle.");
  }
  return buildWorkRoomCycle(selected);
}

export function selectCompletedWorkRoomCycles(
  sourceKey: string,
  candidates: readonly WorkRoomCycleCarrierCandidate[],
): WorkRoomCycleView[] {
  const source = getWorkCaseSourceEntry(sourceKey);
  if (!source) {
    throw new WorkRoomCycleError("unknown_source", `Work Room source '${sourceKey}' is not registered.`);
  }

  const precedence = source.roomProjection.cycleCarrierPrecedence;
  const completed = candidates.filter(
    (candidate) => candidate.status === "closed" || candidate.status === "carried-over",
  );
  const byLogicalCycle = new Map<string, WorkRoomCycleCarrierCandidate>();
  for (const candidate of completed) {
    if (!precedence.includes(candidate.carrierKind)) continue;
    const existing = byLogicalCycle.get(candidate.cycleKey);
    if (!existing || precedence.indexOf(candidate.carrierKind) < precedence.indexOf(existing.carrierKind)) {
      byLogicalCycle.set(candidate.cycleKey, candidate);
    }
  }

  return [...byLogicalCycle.values()]
    .map(buildWorkRoomCycle)
    .sort((left, right) => {
      const completedOrder = (right.outcomePacket?.completedAt ?? "")
        .localeCompare(left.outcomePacket?.completedAt ?? "");
      return completedOrder || left.cycleKey.localeCompare(right.cycleKey);
    });
}

export type WorkRoomCyclePolicyDecision =
  | WorkCasePolicyDecision
  | { ok: false; reason: "unknown_lifecycle_operation" | "missing_current_cycle" | "closed_cycle_sealed"; message: string };

export function evaluateWorkRoomCyclePolicy(input: {
  operation: WorkRoomLifecycleOperation | string;
  cycle: WorkRoomCycleView | null;
  policy: Omit<WorkCasePolicyInput, "action">;
}): WorkRoomCyclePolicyDecision {
  const lifecycle = getWorkRoomLifecycleAction(input.operation);
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
  return evaluateWorkCasePolicy({ ...input.policy, action: lifecycle.canonicalAction });
}

export interface WorkRoomCarryOverCommand {
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

export function planWorkRoomCarryOver(input: {
  roomKey: string;
  fromCycleKey: string;
  toCycleKey?: string | null;
  unresolvedWork: WorkRoomOutcomePacket["unresolvedWork"];
}): WorkRoomCarryOverCommand[] {
  const commands = input.unresolvedWork.flatMap((item) => {
    if (item.disposition !== "carry-over" && item.disposition !== "new-case") return [];
    if (item.disposition === "carry-over" && !roomText(input.toCycleKey)) {
      throw new WorkRoomCycleError("missing_cycle_boundary", "Carry-over requires a target cycle.");
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
