import { z } from "zod";
import { decodeWorkCaseKey, encodeWorkCaseKey } from "./case-key";
import { SHAPE_NODE_STATES, type ShapeGraph } from "./shape-projection";
import { WORK_SHAPE_TRIGGER_CLASSES } from "./work-shapes";
import { readRoutingEligibility } from "@/lib/inference/routing-exclusion-buckets";
import type { WorkroomView } from "./room-types";
import type { WorkroomFlowMapModel } from "./workroom-flow-map";

export type WorkroomRefreshTarget = { caseKey: string; workroomRowId: string; workroom?: string | null };
export type WorkroomProcessContext = { definition: WorkroomView["identity"]["definition"]; mode: WorkroomView["mode"]; activeCycle: boolean };
export type WorkroomProcessSnapshot = {
  version: 1;
  identity: { caseKey: string; workroomRowId: string; workroom: string | null };
  graph: ShapeGraph;
  context: WorkroomProcessContext;
  flowMap: WorkroomFlowMapModel | null;
  flowHealth: "ok" | "unavailable" | "not-applicable";
};
export const PROCESS_READ_TIMEOUT_MS = 15_000;
export const PROCESS_RESPONSE_MAX_CHARS = 1_000_000;

export function normalizeProcessCaseKey(value: string): string | null {
  try { const ref = decodeWorkCaseKey(value); return ref ? encodeWorkCaseKey(ref) : null; }
  catch { return null; }
}
export function processTargetIdentity(target: WorkroomRefreshTarget) {
  return { caseKey: normalizeProcessCaseKey(target.caseKey) ?? "", workroomRowId: target.workroomRowId, workroom: target.workroom ?? null };
}
export function processTargetKey(target: WorkroomRefreshTarget) { return JSON.stringify(processTargetIdentity(target)); }

const text = z.string().max(32_000), optionalText = text.nullable().optional();
const source = z.object({ kind: z.enum(["source", "work-item", "work-capsule", "coworker-engagement", "task-run", "task-artifact", "decision-interaction", "runtime-verification", "receipt", "evidence"]), id: text, status: text.optional(), sourceType: text.optional() });
const row = z.object({ key: text, label: text, state: z.enum(SHAPE_NODE_STATES), detail: text.nullable(), receiptRef: z.object({ table: text, id: text }).nullable(), sourceRef: source.optional(), actor: text.nullable(), occurredAt: text.optional(), summary: text.optional() });
const eligibility = z.unknown().transform((value, ctx) => {
  const parsed = readRoutingEligibility(value);
  if (parsed) return parsed;
  ctx.addIssue({ code: "custom", message: "Invalid routing observation" }); return z.NEVER;
});
const reviewer = z.object({
  reviewKind: z.enum(["semantic-review", "initiative-review"]).optional(), reviewGate: optionalText, requestDigest: optionalText, artifactVersion: optionalText,
  executionUncertain: z.boolean().optional(), identityConflict: z.boolean().optional(), capsuleId: optionalText, requesterAgentId: optionalText,
  taskRunId: text, recordId: text, status: text, requesterId: text.nullable(), requesterName: optionalText,
  reason: text.nullable(), nextAction: text, readAt: text, lastHeartbeatAt: text.nullable(), heartbeat: z.enum(["historical", "unknown", "stale", "recent"]),
  recoveryWait: z.boolean(), budget: z.object({ deadlineAt: text.nullable(), recoveryAttempt: z.number().nullable(), eligibilityBlocked: z.boolean().optional(), routingEligibility: z.array(eligibility).max(5).optional() }),
  identityScope: z.enum(["current", "historical", "unknown"]).optional(), sourceHeadSha: optionalText,
  receipt: z.object({ id: text, decision: z.enum(["pass", "fail", "inconclusive"]), summary: text }).optional(),
  checkpoints: z.array(z.object({ taskNodeId: text, recordId: text, title: text, status: text, actorId: text.nullable() })).max(12),
});
const graph: z.ZodType<ShapeGraph> = z.object({
  stages: z.array(z.object({ key: text, label: text, state: z.enum(SHAPE_NODE_STATES), parallel: z.boolean(), rows: z.array(row), inspection: z.object({ position: text, reason: text, next: text, owner: text, expectedEvidence: z.array(text), affected: z.array(source) }).optional() })),
  blockingStageKey: text.nullable(), progress: z.object({ passed: z.number(), total: z.number() }),
  process: z.object({ definitionRef: text.nullable(), title: text, currentStageKey: text.nullable(), nextPermittedStageKey: text.nullable(), readAt: text.nullable(), lastEvidenceAt: text.nullable(), sourceHealth: z.enum(["ok", "partial", "unavailable"]), gaps: z.array(text), receipts: z.array(row), events: z.array(row).optional(), reviewerRuns: z.array(reviewer).optional() }).optional(),
});
const flowMap: z.ZodType<WorkroomFlowMapModel> = z.object({
  shapeRef: text, title: text, signature: text, triggers: z.array(z.enum(WORK_SHAPE_TRIGGER_CLASSES)),
  stages: z.array(z.object({ key: text, title: text, lane: z.enum(["AI", "Person", "Unknown"]), touchesOutside: z.boolean(), governed: z.boolean(), principalRef: text, state: z.enum(["done", "working", "awaiting-person", "blocked", "ahead"]), holdCause: text.nullable(), room: z.object({ dwellMs: z.number(), processMs: z.number().nullable(), heldMs: z.number().nullable(), open: z.boolean() }).nullable(), typical: z.object({ dwellMs: z.number(), exits: z.number() }).nullable(), slow: z.boolean(), queue: z.object({ wip: z.number(), depth: z.number() }).optional() })),
  ends: z.object({ success: z.boolean(), failure: z.boolean(), budget: z.boolean() }), finished: z.boolean(), graphFlow: z.boolean(), aggregate: z.object({ roomsInFlow: z.number() }).optional(),
});
const snapshotSchema: z.ZodType<WorkroomProcessSnapshot> = z.object({
  version: z.literal(1), identity: z.object({ caseKey: text, workroomRowId: text, workroom: text.nullable() }), graph,
  context: z.object({ definition: z.object({ definitionId: text, version: z.number(), sourceKey: text, label: text, mode: z.enum(["finite", "standing"]), decisionScope: z.enum(["wwmd", "wwwd", "wsid"]) }).nullable(), mode: z.enum(["finite", "standing"]), activeCycle: z.boolean() }),
  flowMap: flowMap.nullable(), flowHealth: z.enum(["ok", "unavailable", "not-applicable"]),
});

export function createWorkroomProcessSnapshot(target: WorkroomRefreshTarget, graph: ShapeGraph, context: WorkroomProcessContext, map: WorkroomFlowMapModel | null, flowReadFailed = false): WorkroomProcessSnapshot {
  const inconsistent = Boolean(map && map.shapeRef !== graph.process?.definitionRef);
  const unavailable = flowReadFailed || inconsistent;
  return { version: 1, identity: processTargetIdentity(target), context,
    graph: unavailable && graph.process ? { ...graph, process: { ...graph.process, sourceHealth: "partial", gaps: [...graph.process.gaps, "Flow map unavailable for this snapshot."] } } : graph,
    flowMap: unavailable ? null : map, flowHealth: unavailable ? "unavailable" : map ? "ok" : "not-applicable" };
}
export function parseWorkroomProcessSnapshot(value: unknown, target: WorkroomRefreshTarget): WorkroomProcessSnapshot | null {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || !processTargetIdentity(target).caseKey) return null;
  const snapshot = parsed.data;
  if (JSON.stringify(snapshot.identity) !== processTargetKey(target)) return null;
  if (snapshot.flowHealth === "ok" ? !snapshot.flowMap : snapshot.flowMap !== null) return null;
  if (snapshot.flowMap && snapshot.flowMap.shapeRef !== snapshot.graph.process?.definitionRef) return null;
  return snapshot;
}
