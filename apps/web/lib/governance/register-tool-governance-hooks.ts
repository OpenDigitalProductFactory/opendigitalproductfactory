import { prisma, type Prisma } from "@dpf/db";

import {
  createCompletionEvidenceGovernanceHook,
  type CompletionEvidenceHookDeps,
} from "@/lib/backlog/completion-evidence-governance-hook";
import { registerToolLifecycleHook } from "@/lib/mcp-governed-execute";
import type { ToolLifecycleHook } from "@/lib/mcp-governed-execute-types";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import {
  createDecisionRoutingGovernanceHook,
  installConsequentialToolResolver,
} from "@/lib/tak/decision-routing-governance-hook";
import { getConsequentialToolNames } from "@/lib/tak/consequential-tool-coverage";
import type { WorkroomParticipantRole } from "@/lib/work-management/room-types";

import {
  createWorkroomShapeGovernanceHook,
  type WorkroomShapeGateRoom,
  type WorkroomShapeShadowRecord,
} from "./workroom-shape-governance-hook";

/** The client every governance hook reads and writes through. */
export type GovernanceHookDb = Pick<
  Prisma.TransactionClient,
  "workroom" | "workroomActivity" | "toolExecution" | "backlogItemActivity"
>;

/** One shadow record per room+tool per window keeps the audit stream readable. */
const SHADOW_DEDUPE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Pre-W2 minimal participant projection: the Workroom row has no participant
 * relation yet (BI-640B011D), so the envelope binds against the principals the
 * row itself names — creator as accountable (deriveRoomCoordinator promotes
 * them to coordinator), lease holder as the executing specialist, requester as
 * the accepting approver. The W2 participant substrate replaces this.
 */
async function loadWorkroomForShapeGate(
  workroomId: string,
  db: GovernanceHookDb,
): Promise<WorkroomShapeGateRoom | null> {
  const room = await db.workroom.findFirst({
    where: { OR: [{ id: workroomId }, { capsuleId: workroomId }] },
    select: {
      id: true,
      capsuleId: true,
      scopeClaims: true,
      createdByPrincipalId: true,
      leaseHolderPrincipalId: true,
      requestedByPrincipalId: true,
      runtimeVerifications: {
        where: { status: "passed" },
        select: { status: true, completedAt: true },
      },
    },
  });
  if (!room) return null;
  const participants: Array<{ principalRef: string; roles: WorkroomParticipantRole[] }> = [];
  if (room.createdByPrincipalId) {
    participants.push({ principalRef: room.createdByPrincipalId, roles: ["accountable"] });
  }
  if (room.leaseHolderPrincipalId) {
    participants.push({ principalRef: room.leaseHolderPrincipalId, roles: ["specialist"] });
  }
  if (room.requestedByPrincipalId) {
    participants.push({ principalRef: room.requestedByPrincipalId, roles: ["approver"] });
  }
  return {
    id: room.id,
    capsuleId: room.capsuleId,
    scopeClaims: room.scopeClaims,
    verificationEvidence: room.runtimeVerifications,
    participants,
  };
}

/**
 * Shadow/audit sink, mirroring the completion-evidence mechanism: a deduped
 * WorkroomActivity append when the room row resolved, a structured console
 * signal otherwise. Audit-only by contract — callers swallow failures.
 */
async function recordWorkroomShapeShadow(
  input: WorkroomShapeShadowRecord,
  db: GovernanceHookDb,
): Promise<void> {
  if (!input.roomRowId) {
    console.warn(
      "[workroom-shape-gate] %s verdict tool=%s room=%s resolution=%s user=%s agent=%s",
      JSON.stringify(input.verdict.mode),
      JSON.stringify(input.verdict.toolName),
      JSON.stringify(input.verdict.workroomId),
      JSON.stringify(input.verdict.roomResolution),
      JSON.stringify(input.userId),
      JSON.stringify(input.agentId),
    );
    return;
  }
  const recent = await db.workroomActivity.findFirst({
    where: {
      workCapsuleId: input.roomRowId,
      kind: "workroom_shape_gate_shadow",
      summary: { contains: input.verdict.toolName },
      recordedAt: { gte: new Date(Date.now() - SHADOW_DEDUPE_WINDOW_MS) },
    },
    select: { id: true },
  });
  if (recent) return;
  const envelope = input.verdict.withinEnvelope
    ? "within envelope"
    : `gaps: ${input.verdict.gaps.join(", ") || "none"}`;
  await db.workroomActivity.create({
    data: {
      workCapsuleId: input.roomRowId,
      kind: "workroom_shape_gate_shadow",
      summary:
        `Workroom shape gate (${input.verdict.mode}): ${input.verdict.toolName} — `
          .concat(`${input.verdict.declaredShape ?? "no shape"} ${envelope}`)
          .slice(0, 240),
      payload: {
        verdict: input.verdict,
        source: input.source,
        callerClient: input.callerClient,
      },
      recordedById: input.userId,
      recordedByAgentId: input.agentId,
    },
  });
}

/**
 * The server's tool governance hooks, bound to `db`. The live registration
 * binds them to the shared client; the AC-PROBE runner binds the same hooks to
 * a read-only transaction and replaces the attention notification, which
 * writes through its own client, with a refusal (BI-129EFFD1).
 */
export function buildServerToolGovernanceHooks(
  db: GovernanceHookDb = prisma,
  completionEvidence: Partial<Pick<CompletionEvidenceHookDeps, "notifyCircuit">> = {},
): ToolLifecycleHook[] {
  // Give the decision-routing gate its real reach BEFORE the hook is live:
  // derived from every ToolDefinition.consequence, not the two-name seed
  // (TAK §8.4.1). Installed here because the hook must not statically import
  // the tool catalog. A conformance test pins that this call is present.
  installConsequentialToolResolver(getConsequentialToolNames);
  return [
    createDecisionRoutingGovernanceHook(),
    createCompletionEvidenceGovernanceHook(completionEvidence, db),
    createWorkroomShapeGovernanceHook({
      findTool: (toolName) => PLATFORM_TOOLS.find((tool) => tool.name === toolName),
      loadRoom: (workroomId) => loadWorkroomForShapeGate(workroomId, db),
      recordShadow: (input) => recordWorkroomShapeShadow(input, db),
    }),
  ];
}

export function registerServerToolGovernanceHooks(): void {
  for (const hook of buildServerToolGovernanceHooks()) registerToolLifecycleHook(hook);
}
