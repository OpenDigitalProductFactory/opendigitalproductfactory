import { prisma } from "@dpf/db";

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import {
  authorizeObjectiveMappingRequestKeyEvolution,
  type ObjectiveMappingRequestHistory,
} from "@/lib/mcp-task-objective-mapping-request-key";
import {
  resolveInitiativeReviewerRecovery,
  type InitiativeReviewerRecovery,
} from "@/lib/tak/initiative-readiness-tool-grants";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";

import { validateInitiativeBaselineChainHead } from "./baseline-repository";
import { discoverCanonicalDesignArtifact } from "./canonical-artifact-discovery";
import {
  MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES,
  selectEligibleObjectiveEvidenceActivityIds,
} from "./objective-reconciliation";
import type { InitiativeReadinessDecision } from "./types";

export type TerminalRecoveryRoom = {
  capsuleId: string;
  backlogItemId: string | null;
  repositoryFullName: string | null;
  baseSha: string | null;
  headBranch: string | null;
  headSha: string | null;
  isLive: boolean;
};

export type TerminalRecoveryEscalationReason =
  | "workroom-not-found"
  | "workroom-ambiguous"
  | "workroom-identity-incomplete"
  | "baseline-not-found"
  | "baseline-ambiguous"
  | "eligible-evidence-not-found"
  | "eligible-evidence-unbounded"
  | "objective-mapping-history-unavailable"
  | "objective-mapping-identity-conflict"
  | "objective-mapping-prior-authority-active"
  | "objective-mapping-authoritative-output-exists"
  | "canonical-artifact-unavailable";

type TerminalEscalation = {
  accountableRole: "acceptance-reviewer";
  toolName: "record_initiative_evidence";
  grant: "initiative_evidence_write";
  reason: TerminalRecoveryEscalationReason;
  nextAction: string;
};

export type TerminalInitiativeRecovery = Omit<InitiativeReviewerRecovery, "escalations"> & {
  escalations: Array<InitiativeReviewerRecovery["escalations"][number] | TerminalEscalation>;
};

type BaselinePayload = {
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactRef?: {
    kind: "repo-blob-at-commit";
    repositoryFullName: string;
    commitSha: string;
    path: string;
    providerBlobId: string;
  };
};

export type TerminalRecoveryPorts = {
  loadLiveRooms(args: { itemId: string; refusedWorkroomId: string | null }): Promise<TerminalRecoveryRoom[]>;
  loadBaselinePayloads(itemId: string): Promise<unknown[]>;
  loadEligibleEvidenceActivityIds(args: {
    itemId: string;
    baselineId: string;
  }): Promise<ActionResult<{ activityIds: string[] }>>;
  loadObjectiveMappingHistory(args: {
    itemId: string;
    headSha: string;
  }): Promise<ActionResult<{ history: ObjectiveMappingRequestHistory[] }>>;
  discoverArtifact(args: {
    repositoryFullName: string;
    baseSha: string;
    headSha: string;
  }): Promise<Awaited<ReturnType<typeof discoverCanonicalDesignArtifact>>>;
  resolveRecovery(args: Parameters<typeof resolveInitiativeReviewerRecovery>[0]): Promise<InitiativeReviewerRecovery>;
};

function escalation(reason: TerminalRecoveryEscalationReason, nextAction: string): TerminalInitiativeRecovery {
  return {
    reviewerRoutes: [],
    unroutable: [],
    escalations: [{
      accountableRole: "acceptance-reviewer",
      toolName: "record_initiative_evidence",
      grant: "initiative_evidence_write",
      reason,
      nextAction,
    }],
  };
}

function parseBaselinePayloads(payloads: unknown[]): BaselinePayload[] | null {
  const rows: BaselinePayload[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const row = payload as Record<string, unknown>;
    if (typeof row.baselineId !== "string"
      || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")) return null;
    const ref = row.artifactRef;
    const artifactRef = ref && typeof ref === "object" && !Array.isArray(ref)
      && (ref as Record<string, unknown>).kind === "repo-blob-at-commit"
      && typeof (ref as Record<string, unknown>).repositoryFullName === "string"
      && typeof (ref as Record<string, unknown>).commitSha === "string"
      && typeof (ref as Record<string, unknown>).path === "string"
      && typeof (ref as Record<string, unknown>).providerBlobId === "string"
      ? {
        kind: "repo-blob-at-commit" as const,
        repositoryFullName: (ref as Record<string, unknown>).repositoryFullName as string,
        commitSha: (ref as Record<string, unknown>).commitSha as string,
        path: (ref as Record<string, unknown>).path as string,
        providerBlobId: (ref as Record<string, unknown>).providerBlobId as string,
      }
      : undefined;
    rows.push({
      baselineId: row.baselineId,
      supersedesBaselineId: row.supersedesBaselineId as string | null,
      ...(artifactRef ? { artifactRef } : {}),
    });
  }
  return rows;
}

function currentBaseline(rows: BaselinePayload[]): BaselinePayload | null {
  const superseded = new Set(rows.map((row) => row.supersedesBaselineId).filter((id): id is string => Boolean(id)));
  const heads = rows.filter((row) => !superseded.has(row.baselineId));
  if (heads.length !== 1) return null;
  const expected = heads[0]!.baselineId;
  const validation = validateInitiativeBaselineChainHead(rows, expected);
  return validation.ok ? heads[0]! : null;
}

async function defaultLoadLiveRooms(args: {
  itemId: string;
  refusedWorkroomId: string | null;
}): Promise<TerminalRecoveryRoom[]> {
  const inventory = await loadCapsuleLivenessInventory(prisma as never, {
    where: {
      backlogItemId: args.itemId,
      archivedAt: null,
      ...(args.refusedWorkroomId ? { capsuleId: args.refusedWorkroomId } : {}),
    },
    take: args.refusedWorkroomId ? 2 : 3,
  });
  const liveIds = inventory.capsulesAll
    .filter((row) => row.isLive === true)
    .map((row) => row.capsuleId as string);
  if (liveIds.length === 0) return [];
  const rows = await prisma.workroom.findMany({
    where: { capsuleId: { in: liveIds } },
    select: {
      capsuleId: true,
      backlogItemId: true,
      repositoryFullName: true,
      baseSha: true,
      headBranch: true,
      headSha: true,
    },
  });
  return rows.map((row) => ({ ...row, isLive: true }));
}

async function defaultLoadBaselinePayloads(itemId: string): Promise<unknown[]> {
  const item = await prisma.backlogItem.findFirst({
    where: { OR: [{ itemId }, { id: itemId }] },
    select: { id: true },
  });
  if (!item) return [];
  const rows = await prisma.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { payload: true },
  });
  return rows.map((row) => row.payload);
}

async function defaultLoadEligibleEvidenceActivityIds(args: {
  itemId: string;
  baselineId: string;
}): Promise<ActionResult<{ activityIds: string[] }>> {
  const item = await prisma.backlogItem.findFirst({
    where: { OR: [{ itemId: args.itemId }, { id: args.itemId }] },
    select: { id: true, itemId: true },
  });
  if (!item) return err("baseline-row-unavailable");
  const baselines = await prisma.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    select: { recordedAt: true, payload: true },
  });
  const matchingBaselines = baselines.filter((row) => {
    if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return false;
    return (row.payload as Record<string, unknown>).baselineId === args.baselineId;
  });
  if (matchingBaselines.length !== 1) return err("baseline-row-unavailable");
  const evidence = await prisma.backlogItemActivity.findMany({
    where: {
      backlogItemId: item.id,
      kind: "evidence",
      recordedAt: { gte: matchingBaselines[0]!.recordedAt },
    },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    take: MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES + 1,
    select: { id: true, backlogItemId: true, kind: true, recordedAt: true, payload: true },
  });
  return selectEligibleObjectiveEvidenceActivityIds({
    itemId: item.itemId,
    itemRowId: item.id,
    baselineRecordedAt: matchingBaselines[0]!.recordedAt,
    activities: evidence,
  });
}

const MAX_OBJECTIVE_MAPPING_HISTORY_ROWS = 50;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseHistoricalObjectiveMappingBinding(value: unknown): ObjectiveMappingRequestHistory["binding"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = value as Record<string, unknown>;
  const artifactValue = binding.artifactRef;
  if (!artifactValue || typeof artifactValue !== "object" || Array.isArray(artifactValue)) return null;
  const artifact = artifactValue as Record<string, unknown>;
  const writerToolName = nonEmptyString(binding.writerToolName);
  const itemId = nonEmptyString(binding.itemId);
  const expectedCurrentBaselineId = binding.expectedCurrentBaselineId;
  const repositoryFullName = nonEmptyString(artifact.repositoryFullName);
  const commitSha = nonEmptyString(artifact.commitSha);
  const path = nonEmptyString(artifact.path);
  const providerBlobId = nonEmptyString(artifact.providerBlobId);
  if (!writerToolName || !itemId || binding.gate !== "objective-mapping"
    || (expectedCurrentBaselineId !== undefined && expectedCurrentBaselineId !== null
      && typeof expectedCurrentBaselineId !== "string")
    || artifact.kind !== "repo-blob-at-commit" || !repositoryFullName || !commitSha || !path || !providerBlobId) {
    return null;
  }
  const evidence = binding.eligibleEvidenceActivityIds;
  const eligibleEvidenceActivityIds = evidence === undefined
    ? undefined
    : Array.isArray(evidence) && evidence.length > 0
      && evidence.every((entry) => typeof entry === "string" && entry.trim())
      ? [...new Set(evidence.map((entry) => String(entry).trim()))].sort()
      : null;
  if (evidence !== undefined && !eligibleEvidenceActivityIds) return null;
  const refValue = binding.workroomRef;
  const ref = refValue && typeof refValue === "object" && !Array.isArray(refValue)
    ? refValue as Record<string, unknown>
    : null;
  const workroomId = nonEmptyString(ref?.workroomId);
  const workroomRepository = nonEmptyString(ref?.repositoryFullName);
  const branchName = nonEmptyString(ref?.branchName);
  const headSha = nonEmptyString(ref?.headSha);
  if (refValue !== undefined && (ref?.kind !== "workroom-head" || !workroomId || !workroomRepository || !branchName || !headSha)) {
    return null;
  }
  return {
    writerToolName,
    itemId,
    gate: "objective-mapping",
    ...(expectedCurrentBaselineId !== undefined
      ? { expectedCurrentBaselineId: expectedCurrentBaselineId as string | null }
      : {}),
    ...(eligibleEvidenceActivityIds ? { eligibleEvidenceActivityIds } : {}),
    ...(ref && workroomId && workroomRepository && branchName && headSha
      ? {
        workroomRef: {
          kind: "workroom-head",
          workroomId,
          repositoryFullName: workroomRepository,
          branchName,
          headSha,
        },
      }
      : {}),
    artifactRef: {
      kind: "repo-blob-at-commit",
      repositoryFullName,
      commitSha,
      path,
      providerBlobId,
    },
  };
}

async function defaultLoadObjectiveMappingHistory(args: {
  itemId: string;
  headSha: string;
}): Promise<ActionResult<{ history: ObjectiveMappingRequestHistory[] }>> {
  const keyPrefix = `initiative-readiness:${args.itemId}:objective-mapping:${args.headSha}`;
  const rows = await prisma.taskRun.findMany({
    where: {
      a2aMetadata: { path: ["idempotencyKey"], string_starts_with: keyPrefix },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_OBJECTIVE_MAPPING_HISTORY_ROWS + 1,
    select: {
      taskRunId: true,
      status: true,
      objective: true,
      a2aMetadata: true,
      actionEnvelopes: { select: { status: true } },
    },
  });
  if (rows.length > MAX_OBJECTIVE_MAPPING_HISTORY_ROWS) return err("objective-mapping-history-unbounded");
  const matching: Array<{
    row: (typeof rows)[number];
    idempotencyKey: string;
    binding: ObjectiveMappingRequestHistory["binding"];
  }> = [];
  for (const row of rows) {
    const metadata = row.a2aMetadata && typeof row.a2aMetadata === "object" && !Array.isArray(row.a2aMetadata)
      ? row.a2aMetadata as Record<string, unknown>
      : null;
    const idempotencyKey = nonEmptyString(metadata?.idempotencyKey);
    if (!idempotencyKey?.startsWith(keyPrefix)) continue;
    const binding = parseHistoricalObjectiveMappingBinding(metadata?.initiativeReviewBinding);
    if (!binding) return err("objective-mapping-history-invalid");
    matching.push({ row, idempotencyKey, binding });
  }
  const taskRunIds = matching.map((entry) => entry.row.taskRunId);
  const executions = taskRunIds.length === 0 ? [] : await prisma.toolExecution.findMany({
    where: {
      taskRunId: { in: taskRunIds },
      toolName: "record_initiative_evidence",
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { taskRunId: true, success: true, receipt: { select: { id: true } } },
  });
  return ok({
    history: matching.map((entry) => ({
      taskRunId: entry.row.taskRunId,
      status: entry.row.status,
      objective: entry.row.objective,
      idempotencyKey: entry.idempotencyKey,
      binding: entry.binding!,
      actionEnvelopeStatuses: entry.row.actionEnvelopes.map((envelope) => envelope.status),
      writerExecutions: executions
        .filter((execution) => execution.taskRunId === entry.row.taskRunId)
        .map((execution) => ({ success: execution.success, hasReceipt: execution.receipt !== null })),
    })),
  });
}

const DEFAULT_PORTS: TerminalRecoveryPorts = {
  loadLiveRooms: defaultLoadLiveRooms,
  loadBaselinePayloads: defaultLoadBaselinePayloads,
  loadEligibleEvidenceActivityIds: defaultLoadEligibleEvidenceActivityIds,
  loadObjectiveMappingHistory: defaultLoadObjectiveMappingHistory,
  discoverArtifact: discoverCanonicalDesignArtifact,
  resolveRecovery: (args) => resolveInitiativeReviewerRecovery({ ...args, db: prisma as never }),
};

/** Build an exact, executable reviewer handoff after — and only after — denial. */
export async function resolveTerminalInitiativeRecovery(args: {
  decision: InitiativeReadinessDecision;
  currentAgentId: string | null;
  refusedWorkroomId: string | null;
  ports?: TerminalRecoveryPorts;
}): Promise<TerminalInitiativeRecovery> {
  const ports = args.ports ?? DEFAULT_PORTS;
  const rooms = await ports.loadLiveRooms({
    itemId: args.decision.subject.id,
    refusedWorkroomId: args.refusedWorkroomId,
  });
  if (rooms.length === 0) {
    return escalation("workroom-not-found", "No live Workroom is bound to this item. Claim or resume the exact Workroom, then retry completion.");
  }
  if (rooms.length !== 1) {
    return escalation("workroom-ambiguous", "More than one live Workroom is bound to this item. Reconcile ownership before dispatching an acceptance reviewer.");
  }
  const room = rooms[0]!;
  if (!room.repositoryFullName || !room.baseSha || !room.headBranch || !room.headSha) {
    return escalation("workroom-identity-incomplete", "The Workroom lacks repository, branch, immutable base, or immutable head. Re-sync it with adopt_worktree, then retry.");
  }

  const payloads = await ports.loadBaselinePayloads(args.decision.subject.id);
  if (payloads.length === 0) {
    return escalation("baseline-not-found", "No current objective baseline exists. Complete independent spec approval before acceptance mapping.");
  }
  const baselineRows = parseBaselinePayloads(payloads);
  const baseline = baselineRows ? currentBaseline(baselineRows) : null;
  if (!baseline) {
    return escalation("baseline-ambiguous", "The objective baseline chain has no unique valid head. Reconcile or supersede the conflicting baseline before dispatch.");
  }

  const needsObjectiveMapping = [...args.decision.blockers, ...args.decision.unmet]
    .some((entry) => entry.code === "ACCEPTANCE_EVIDENCE_REQUIRED"
      || entry.code === "OBJECTIVE_RECONCILIATION_REQUIRED");
  const eligibleEvidence = needsObjectiveMapping
    ? await ports.loadEligibleEvidenceActivityIds({
        itemId: args.decision.subject.id,
        baselineId: baseline.baselineId,
      })
    : ok({ activityIds: [] });
  if (!eligibleEvidence.ok) {
    return escalation(
      "eligible-evidence-unbounded",
      "The current post-baseline evidence set could not be bounded and validated. Reconcile the evidence inventory before dispatch; do not truncate or infer activity IDs.",
    );
  }
  if (needsObjectiveMapping && eligibleEvidence.data.activityIds.length === 0) {
    return escalation(
      "eligible-evidence-not-found",
      "No same-item passing evidence exists at or after the current objective baseline. Record delivery evidence, then retry objective mapping.",
    );
  }

  const baselineArtifact = baseline.artifactRef?.repositoryFullName.toLocaleLowerCase("en-US")
      === room.repositoryFullName.toLocaleLowerCase("en-US")
    ? {
      commitSha: baseline.artifactRef.commitSha,
      path: baseline.artifactRef.path,
      providerBlobId: baseline.artifactRef.providerBlobId,
    }
    : null;
  const discovered = baselineArtifact ? null : await ports.discoverArtifact({
      repositoryFullName: room.repositoryFullName,
      baseSha: room.baseSha,
      headSha: room.headSha,
    });
  if (discovered && !discovered.resolved) {
    return escalation("canonical-artifact-unavailable", discovered.nextAction);
  }
  const artifact = baselineArtifact ?? (discovered?.resolved ? discovered.artifact : null);
  if (!artifact) {
    return escalation("canonical-artifact-unavailable", "The current baseline has no provider-verified canonical source binding.");
  }

  const recovery = await ports.resolveRecovery({
    decision: args.decision,
    currentAgentId: args.currentAgentId,
    db: prisma as never,
    dispatchContext: {
      workroomId: room.capsuleId,
      repositoryFullName: room.repositoryFullName,
      branchName: room.headBranch,
      headSha: room.headSha,
    },
    canonicalArtifact: { resolved: true, ...artifact },
    expectedCurrentBaselineId: baseline.baselineId,
    ...(needsObjectiveMapping
      ? { eligibleEvidenceActivityIds: eligibleEvidence.data.activityIds }
      : {}),
  });
  if (!needsObjectiveMapping) return recovery;

  const packet = recovery.reviewerRoutes.find((route) => route.gate === "objective-mapping")?.requestCoworker;
  const binding = packet?.initiativeReviewBinding;
  const requiredToolNames = packet?.requiredToolNames;
  if (!packet || !binding || !requiredToolNames) {
    return escalation(
      "objective-mapping-history-unavailable",
      "The readiness resolver did not produce a complete objective-mapping packet. Refresh readiness; do not invent a request identity.",
    );
  }
  const historyResult = await ports.loadObjectiveMappingHistory({
    itemId: args.decision.subject.id,
    headSha: room.headSha,
  });
  if (!historyResult.ok) {
    return escalation(
      "objective-mapping-history-unavailable",
      "Historical objective-mapping authority could not be bounded and validated. Reconcile the TaskRun history before dispatch.",
    );
  }
  if (binding.gate !== "objective-mapping" || !binding.eligibleEvidenceActivityIds || !binding.workroomRef) {
    return escalation(
      "objective-mapping-history-unavailable",
      "The server-issued objective-mapping packet lacks its versioned evidence or Workroom identity.",
    );
  }
  const authorization = authorizeObjectiveMappingRequestKeyEvolution({
    packet: {
      targetAgent: packet.targetAgent,
      objective: packet.objective,
      questionPacketSummary: packet.questionPacketSummary,
      requestKey: packet.requestKey,
      requiredToolNames,
      binding: {
        ...binding,
        gate: "objective-mapping",
        eligibleEvidenceActivityIds: binding.eligibleEvidenceActivityIds,
        workroomRef: binding.workroomRef,
      },
    },
    history: historyResult.data.history,
  });
  if (!authorization.authorized) {
    const reason = authorization.reason === "immutable-identity-conflict"
      ? "objective-mapping-identity-conflict"
      : authorization.reason === "prior-authority-active"
        ? "objective-mapping-prior-authority-active"
        : authorization.reason === "authoritative-output-exists"
          ? "objective-mapping-authoritative-output-exists"
          : "objective-mapping-history-unavailable";
    return escalation(
      reason,
      `Objective-mapping history refused a successor request (${authorization.reason}${authorization.taskRunId ? ` on ${authorization.taskRunId}` : ""}). Resolve that exact authority state; do not churn the key.`,
    );
  }
  return recovery;
}
