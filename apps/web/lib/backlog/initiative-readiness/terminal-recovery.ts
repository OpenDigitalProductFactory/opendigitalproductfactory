import { immutableArtifactIdentity, parseInitiativeReviewArtifactRef, type InitiativeReviewArtifactRef } from "@/lib/mcp-task-review-contract";
import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

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
import { loadBaselineSource, type BaselineSourceDb } from "./baseline-source";
import { discoverCanonicalReviewArtifact } from "./canonical-artifact-discovery";
import { designPhaseReviewDecision, isArchetypePhaseReview, loadPlanReviewArtifact, routeDesignReviewsBeforeBaseline } from "./design-phase-recovery";
import {
  MAX_OBJECTIVE_MAPPING_EVIDENCE_ACTIVITIES,
  selectEligibleObjectiveEvidenceActivityIds,
} from "./objective-reconciliation";
import { bodyBaselineEscalation, researchLaneEscalation, smallShapeAcceptanceEscalation } from "./shape-lane-escalations";
import type { InitiativeReadinessDecision } from "./types";
import { readRepositoryProviderBlob } from "./repository-artifact";
import { bodyBaselineInputsMatch } from "./body-baseline-binding";
import { resolveReviewerIdentity } from "./reviewer-identity";

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
  | "acceptance-evidence-required"
  | "research-evidence-required"
  | "workroom-not-found"
  | "workroom-ambiguous"
  | "workroom-identity-incomplete"
  | "baseline-not-found"
  | "body-baseline-unpersisted"
  | "acceptance-criteria-missing"
  | "baseline-ambiguous"
  | "baseline-stale"
  | "reviewer-context-required"
  | "eligible-evidence-not-found"
  | "eligible-evidence-unbounded"
  | "objective-mapping-history-unavailable"
  | "objective-mapping-identity-conflict"
  | "objective-mapping-prior-authority-active"
  | "objective-mapping-authoritative-output-exists"
  | "canonical-artifact-unavailable";

type TerminalEscalation = {
  // design-author owns RESEARCH_REQUIRED on every shape that carries it
  // (shape-requirements.ts small() and medium()), so the research lane's
  // escalation is addressed to the author, not to a reviewer (BI-7876699F).
  accountableRole: "acceptance-reviewer" | "delivery-coordinator" | "design-author" | "product-owner";
  toolName: "record_initiative_evidence" | "record_execution_evidence" | "update_backlog_item" | "update_backlog_item_status";
  grant: "initiative_evidence_write" | "backlog_write";
  reason: TerminalRecoveryEscalationReason;
  nextAction: string;
};

export type TerminalInitiativeRecovery = Omit<InitiativeReviewerRecovery, "escalations"> & {
  escalations: Array<InitiativeReviewerRecovery["escalations"][number] | TerminalEscalation>;
};

export type BaselinePayload = Record<string, unknown> & {
  baselineId: string;
  supersedesBaselineId: string | null;
  artifactRef?: InitiativeReviewArtifactRef;
};

export type TerminalRecoveryPorts = {
  bodyReviewerCanRead?(args: { userId: string; agentId: string; capsuleId: string; baseline: BaselinePayload }): Promise<boolean>;
  validateBodyBaselineCurrent?(args: { baseline: BaselinePayload; room: TerminalRecoveryRoom; itemId: string }): Promise<boolean>;
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
  verifyHistoricalArtifact(args: {
    repositoryFullName: string;
    commitSha: string;
    path: string;
    expectedBlobId: string;
  }): Promise<Awaited<ReturnType<typeof readRepositoryProviderBlob>>>;
  discoverArtifact(args: {
    repositoryFullName: string;
    baseSha: string;
    headSha: string;
    purpose?: "post-implementation-review";
  }): Promise<Awaited<ReturnType<typeof discoverCanonicalReviewArtifact>>>;
  resolveRecovery(args: Parameters<typeof resolveInitiativeReviewerRecovery>[0]): Promise<InitiativeReviewerRecovery>;
  loadPlanArtifact(args: { itemId: string; repositoryFullName: string }): ReturnType<typeof loadPlanReviewArtifact>;
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

export function parseBaselinePayloads(payloads: unknown[]): BaselinePayload[] | null {
  const rows: BaselinePayload[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const row = payload as Record<string, unknown>;
    if (typeof row.baselineId !== "string"
      || (row.supersedesBaselineId !== null && typeof row.supersedesBaselineId !== "string")) return null;
    const artifactRef = parseInitiativeReviewArtifactRef(row.artifactRef) ?? undefined;
    rows.push({
      ...row,
      baselineId: row.baselineId,
      supersedesBaselineId: row.supersedesBaselineId as string | null,
      ...(artifactRef ? { artifactRef } : {}),
    });
  }
  return rows;
}

export function currentBaseline(rows: BaselinePayload[]): BaselinePayload | null {
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
  // BI-2515F779: a decomposed child inherits its parent's scope baseline for
  // routing exactly as the projection already does for OBJECTIVE_BASELINE_REQUIRED.
  const source = await loadBaselineSource(prisma as unknown as BaselineSourceDb, itemId);
  return source ? source.baselineRows.map((row) => row.payload) : [];
}

async function defaultLoadEligibleEvidenceActivityIds(args: {
  itemId: string;
  baselineId: string;
}): Promise<ActionResult<{ activityIds: string[] }>> {
  const source = await loadBaselineSource(prisma as unknown as BaselineSourceDb, args.itemId);
  if (!source) return err("baseline-row-unavailable");
  const item = { id: source.itemRowId, itemId: source.itemId };
  // The window opens at the baseline the route bound — own or inherited — and
  // the evidence inside it is always the subject's own (BI-2515F779).
  const matchingBaselines = source.baselineRows.filter((row) => {
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

export const MAX_OBJECTIVE_MAPPING_HISTORY_ROWS = 50;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseHistoricalObjectiveMappingBinding(value: unknown): ObjectiveMappingRequestHistory["binding"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const binding = value as Record<string, unknown>;
  const artifactValue = binding.artifactRef;
  if (!artifactValue || typeof artifactValue !== "object" || Array.isArray(artifactValue)) return null;
  const artifact = parseInitiativeReviewArtifactRef(artifactValue);
  const writerToolName = nonEmptyString(binding.writerToolName);
  const itemId = nonEmptyString(binding.itemId);
  const expectedCurrentBaselineId = binding.expectedCurrentBaselineId;
  if (!writerToolName || !itemId || binding.gate !== "objective-mapping"
    || (expectedCurrentBaselineId !== undefined && expectedCurrentBaselineId !== null
      && typeof expectedCurrentBaselineId !== "string")
    || !artifact || artifact.kind === "feature-build-revision") {
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
    artifactRef: artifact,
  };
}

type ObjectiveMappingHistoryDb = Pick<Prisma.TransactionClient, "taskRun" | "toolExecution">;

function parseHistoricalToolNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
  const names = [...new Set(value
    .filter((scope) => scope.startsWith("tool:"))
    .map((scope) => scope.slice("tool:".length).trim())
    .filter(Boolean))].sort();
  return names.length > 0 ? names : null;
}

export async function loadObjectiveMappingHistoryFromDb(db: ObjectiveMappingHistoryDb, args: {
  itemId: string;
  headSha: string;
}): Promise<ActionResult<{ history: ObjectiveMappingRequestHistory[] }>> {
  const keyPrefix = `initiative-readiness:${args.itemId}:objective-mapping:${args.headSha}`;
  const rows = await db.taskRun.findMany({
    where: {
      a2aMetadata: { path: ["idempotencyKey"], string_starts_with: keyPrefix },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_OBJECTIVE_MAPPING_HISTORY_ROWS + 1,
    select: {
      taskRunId: true,
      status: true,
      title: true,
      objective: true,
      authorityScope: true,
      a2aMetadata: true,
      actionEnvelopes: { select: { status: true } },
    },
  });
  if (rows.length > MAX_OBJECTIVE_MAPPING_HISTORY_ROWS) return err("objective-mapping-history-unbounded");
  const matching: Array<{
    row: (typeof rows)[number];
    idempotencyKey: string;
    binding: ObjectiveMappingRequestHistory["binding"];
    targetAgent: string;
    questionPacketSummary: string;
    requiredToolNames: string[];
    objective: string;
  }> = [];
  for (const row of rows) {
    const metadata = row.a2aMetadata && typeof row.a2aMetadata === "object" && !Array.isArray(row.a2aMetadata)
      ? row.a2aMetadata as Record<string, unknown>
      : null;
    const idempotencyKey = nonEmptyString(metadata?.idempotencyKey);
    if (!idempotencyKey?.startsWith(keyPrefix)) continue;
    const targetAgent = nonEmptyString(metadata?.requestedAgentId);
    const questionPacketSummary = nonEmptyString(row.title);
    const requiredToolNames = parseHistoricalToolNames(row.authorityScope);
    const binding = parseHistoricalObjectiveMappingBinding(metadata?.initiativeReviewBinding);
    // TaskRun.objective is a shortened display projection. Both recovery and
    // action-time admission must compare the immutable request preserved by the
    // submitter. Only older rows without that field may use the legacy value;
    // key validation still verifies it against the original complete request.
    const hasRequestObjective = metadata !== null
      && Object.prototype.hasOwnProperty.call(metadata, "requestObjective");
    const objective = nonEmptyString(hasRequestObjective ? metadata.requestObjective : row.objective);
    if (!binding || !targetAgent || !questionPacketSummary || !requiredToolNames || !objective) {
      return err("objective-mapping-history-invalid");
    }
    matching.push({ row, idempotencyKey, binding, targetAgent, questionPacketSummary, requiredToolNames, objective });
  }
  const taskRunIds = matching.map((entry) => entry.row.taskRunId);
  const executions = taskRunIds.length === 0 ? [] : await db.toolExecution.findMany({
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
      targetAgent: entry.targetAgent,
      objective: entry.objective,
      questionPacketSummary: entry.questionPacketSummary,
      idempotencyKey: entry.idempotencyKey,
      requiredToolNames: entry.requiredToolNames,
      binding: entry.binding!,
      actionEnvelopeStatuses: entry.row.actionEnvelopes.map((envelope) => envelope.status),
      writerExecutions: executions
        .filter((execution) => execution.taskRunId === entry.row.taskRunId)
        .map((execution) => ({ success: execution.success, hasReceipt: execution.receipt !== null })),
    })),
  });
}

async function defaultLoadObjectiveMappingHistory(args: {
  itemId: string;
  headSha: string;
}): Promise<ActionResult<{ history: ObjectiveMappingRequestHistory[] }>> {
  return loadObjectiveMappingHistoryFromDb(prisma, args);
}

/** Production ports; a caller overrides only the ports it must (the acceptance sweep excludes the author, BI-DF255666). */
export const DEFAULT_TERMINAL_RECOVERY_PORTS: TerminalRecoveryPorts = {
  bodyReviewerCanRead: async ({ userId, agentId, capsuleId, baseline }) => {
    const authorIds = [...new Set([baseline.bodyAuthorPrincipalId, baseline.sourceAuthorPrincipalId]
      .filter((id): id is string => typeof id === "string" && id.length > 0))];
    const reviewer = await resolveReviewerIdentity(prisma, { reviewerUserId: userId, reviewerAgentId: agentId });
    const authors = await prisma.principal.findMany({ where: { id: { in: authorIds } }, select: { principalId: true } });
    if (!reviewer || authorIds.length === 0 || authors.length !== authorIds.length
      || authors.some((author) => author.principalId === reviewer.principalId) || baseline.authorAgentId === agentId) return false;
    const room = await prisma.workroom.findUnique({ where: { capsuleId }, select: { id: true } });
    if (!room) return false;
    const { resolveAgentWorkroomAccess } = await import("@/lib/work-management/workroom-agent-access.server");
    return (await resolveAgentWorkroomAccess({ userId, agentId, workroomId: room.id, requested: "content" })).decision.level === "content";
  },
  validateBodyBaselineCurrent: async ({ baseline, room, itemId }) => {
    const item = await prisma.backlogItem.findUnique({ where: { itemId }, select: { itemId: true, body: true, organizationId: true } });
    return Boolean(item && baseline.artifactRef && room.repositoryFullName && room.headBranch && room.headSha
      && bodyBaselineInputsMatch(baseline, { ...item!, binding: {
        writerToolName: "record_initiative_evidence", gate: "objective-mapping", itemId,
        expectedCurrentBaselineId: baseline.baselineId, artifactRef: baseline.artifactRef!,
        workroomRef: { kind: "workroom-head", workroomId: room.capsuleId,
          repositoryFullName: room.repositoryFullName!, branchName: room.headBranch!, headSha: room.headSha! },
      } }));
  },
  loadLiveRooms: defaultLoadLiveRooms,
  loadBaselinePayloads: defaultLoadBaselinePayloads,
  loadEligibleEvidenceActivityIds: defaultLoadEligibleEvidenceActivityIds,
  loadObjectiveMappingHistory: defaultLoadObjectiveMappingHistory,
  verifyHistoricalArtifact: (args) => readRepositoryProviderBlob(args),
  discoverArtifact: discoverCanonicalReviewArtifact,
  resolveRecovery: (args) => resolveInitiativeReviewerRecovery({ ...args, db: prisma as never }),
  loadPlanArtifact: loadPlanReviewArtifact,
};

import { classifyHistoricalObjectiveMappingArtifacts } from "./objective-mapping-history-artifacts";
export { classifyHistoricalObjectiveMappingArtifacts, exactArtifactRefMatches, exactStringSetMatches } from "./objective-mapping-history-artifacts";
/** Build an exact, executable reviewer handoff after — and only after — denial. */
export async function resolveTerminalInitiativeRecovery(args: {
  currentUserId?: string;
  decision: InitiativeReadinessDecision;
  currentAgentId: string | null;
  refusedWorkroomId: string | null;
  taskAuthority?: import("./exhausted-plan-review").PlanReviewTaskAuthority | null;
  ports?: TerminalRecoveryPorts;
}): Promise<TerminalInitiativeRecovery> {
  const suppliedPorts = args.ports ?? DEFAULT_TERMINAL_RECOVERY_PORTS;
  const ports = args.taskAuthority ? { ...suppliedPorts, resolveRecovery:
    async (input: Parameters<typeof resolveInitiativeReviewerRecovery>[0]) => suppliedPorts.resolveRecovery({
      ...input, isPlanReviewExhausted: (await import("./exhausted-plan-review"))
        .createExhaustedPlanReviewPredicate(args.taskAuthority!, prisma),
    }) } : suppliedPorts;
  const acceptanceLane = [...args.decision.blockers, ...args.decision.unmet]
    .find((entry) => entry.code === "ACCEPTANCE_EVIDENCE_REQUIRED");
  if (acceptanceLane && acceptanceLane.accountableRole === "delivery-coordinator") {
    return smallShapeAcceptanceEscalation();
  }
  // BI-7876699F: an unmet research lane is author-satisfiable on every shape.
  // Checked after acceptance so the existing small-shape hint keeps precedence
  // when both are open, and before the room/baseline chain because research
  // does not use it.
  const researchLane = [...args.decision.blockers, ...args.decision.unmet]
    .find((entry) => entry.code === "RESEARCH_REQUIRED");
  if (researchLane) {
    return researchLaneEscalation();
  }
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
  const dispatchContext = {
    workroomId: room.capsuleId,
    repositoryFullName: room.repositoryFullName,
    branchName: room.headBranch,
    headSha: room.headSha,
  };

  // A break-fix review assesses the repair the Workroom authored. It does not
  // create or reconcile an objective baseline. Resolve its exact source before
  // entering the baseline-owned acceptance path below (BI-594CF003).
  const isPostImplementationReview = (entry: InitiativeReadinessDecision["unmet"][number]) =>
    entry.code === "POST_IMPLEMENTATION_REVIEW_REQUIRED";
  if ([...args.decision.blockers, ...args.decision.unmet].some(isPostImplementationReview)) {
    const discovered = await ports.discoverArtifact({
      repositoryFullName: room.repositoryFullName,
      baseSha: room.baseSha,
      headSha: room.headSha,
      purpose: "post-implementation-review",
    });
    return ports.resolveRecovery({
      decision: {
        ...args.decision,
        blockers: args.decision.blockers.filter(isPostImplementationReview),
        unmet: args.decision.unmet.filter(isPostImplementationReview),
      },
      currentAgentId: args.currentAgentId,
      db: prisma as never,
      dispatchContext,
      canonicalArtifact: discovered.resolved
        ? { resolved: true, ...discovered.artifact, commitSha: room.headSha }
        : { resolved: false, nextAction: discovered.nextAction },
      expectedCurrentBaselineId: null,
    });
  }

  const designPhase = designPhaseReviewDecision(args.decision); // BI-817556D8: before acceptance lanes fail closed
  const payloads = await ports.loadBaselinePayloads(args.decision.subject.id);
  if (payloads.length === 0) {
    if (designPhase) return routeDesignReviewsBeforeBaseline({ designPhase, currentAgentId: args.currentAgentId, baseSha: room.baseSha, dispatchContext, ports }); // BI-1D8E53D9
    const effective = args.decision.shapeDecision?.effective;
    if (effective === "small" || effective === "medium") return bodyBaselineEscalation(args.decision);
    return escalation("baseline-not-found", "No current objective baseline exists. Complete independent spec approval before acceptance mapping.");
  }
  const baselineRows = parseBaselinePayloads(payloads);
  const baseline = baselineRows ? currentBaseline(baselineRows) : null;
  if (!baseline) {
    return escalation("baseline-ambiguous", "The objective baseline chain has no unique valid head. Reconcile or supersede the conflicting baseline before dispatch.");
  }
  if (baseline.artifactRef?.kind === "document-version" && (!ports.validateBodyBaselineCurrent
    || !await ports.validateBodyBaselineCurrent({ baseline, room, itemId: args.decision.subject.id }))) {
    return escalation("baseline-stale", "The retained body criteria, organization or delivered source identity changed. Retry the authorized completion transition to capture the current criteria version, then record fresh eligible evidence. The earlier request cannot be reused.");
  }
  if (baseline.artifactRef?.kind === "document-version" && (!args.currentUserId || !ports.bodyReviewerCanRead)) {
    return escalation("reviewer-context-required", "Resolve body acceptance recovery from the current authorized connection so reviewer Workroom admission can be checked. A document snapshot never grants room access.");
  }

  const decision = designPhase ?? args.decision;
  // A plan-only review reads the baseline-validated covered plan, exactly as
  // the claim issuer does. An unchanged branch need not author a new design.
  // Other design and acceptance lanes retain their own artifact resolution.
  if (designPhase && [...designPhase.blockers, ...designPhase.unmet]
    .every((entry) => entry.code === "PLAN_REVIEW_REQUIRED")) {
    return ports.resolveRecovery({
      decision,
      currentAgentId: args.currentAgentId,
      db: prisma as never,
      dispatchContext,
      planArtifact: await ports.loadPlanArtifact({ itemId: decision.subject.id, repositoryFullName: room.repositoryFullName }),
      expectedCurrentBaselineId: baseline.baselineId,
    });
  }
  const needsObjectiveMapping = [...decision.blockers, ...decision.unmet]
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

  // BI-D3E1F6D9: a design review reads the room's current design at its head,
  // exactly as the refused claim issues it; only acceptance keeps the pinned commit.
  // BI-D9DECD1B: so do the archetype reviews owed before implementation. The
  // claim issues them at the head, and the review guard rebuilds them here.
  const readsHead = designPhase !== null || isArchetypePhaseReview(decision);
  const baselineArtifact = !readsHead && baseline.artifactRef?.kind === "repo-blob-at-commit" && baseline.artifactRef.repositoryFullName.toLocaleLowerCase("en-US")
      === room.repositoryFullName.toLocaleLowerCase("en-US")
    ? {
      commitSha: baseline.artifactRef.commitSha,
      path: baseline.artifactRef.path,
      providerBlobId: baseline.artifactRef.providerBlobId,
    }
    : null;
  const documentArtifact = !readsHead && baseline.artifactRef?.kind === "document-version"
    && baseline.artifactRef.repositoryFullName.toLocaleLowerCase("en-US") === room.repositoryFullName.toLocaleLowerCase("en-US")
    ? { kind: "document-version" as const, versionId: baseline.artifactRef.versionId, valueDigest: baseline.artifactRef.valueDigest } : null;
  const discovered = baselineArtifact || documentArtifact ? null : await ports.discoverArtifact({
      repositoryFullName: room.repositoryFullName,
      baseSha: room.baseSha,
      headSha: room.headSha,
    });
  if (discovered && !discovered.resolved) {
    return escalation("canonical-artifact-unavailable", discovered.nextAction);
  }
  const artifact = documentArtifact ?? baselineArtifact ?? (discovered?.resolved ? discovered.artifact : null);
  if (!artifact) {
    return escalation("canonical-artifact-unavailable", "The current baseline has no provider-verified canonical source binding.");
  }

  const recovery = await ports.resolveRecovery({
    decision,
    currentAgentId: baseline.origin === "item-body" && typeof baseline.authorAgentId === "string" ? baseline.authorAgentId : args.currentAgentId,
    ...(baseline.artifactRef?.kind === "document-version" ? { isReviewerEligible: (agentId: string) => ports.bodyReviewerCanRead!({ userId: args.currentUserId!, agentId, capsuleId: room.capsuleId, baseline }) } : {}),
    db: prisma as never,
    dispatchContext,
    canonicalArtifact: { resolved: true, ...artifact },
    ...(designPhase ? { planArtifact: await ports.loadPlanArtifact({ itemId: decision.subject.id, repositoryFullName: room.repositoryFullName }) } : {}),
    expectedCurrentBaselineId: baseline.baselineId,
    ...(needsObjectiveMapping
      ? { eligibleEvidenceActivityIds: eligibleEvidence.data.activityIds }
      : {}),
  });
  if (!needsObjectiveMapping) return recovery;

  const packet = recovery.reviewerRoutes.find((route) => route.gate === "objective-mapping")?.requestCoworker;
  const binding = packet?.initiativeReviewBinding;
  const requiredToolNames = packet?.requiredToolNames;
  // No packet because the resolver said why (no eligible reviewer, no artifact,
  // no evidence): that reason is the true one. "Refresh readiness" would send
  // the reader after the wrong remedy (BI-DF255666 found this through the sweep).
  if (!packet && (recovery.escalations.length > 0 || recovery.unroutable.length > 0)) {
    if (baseline.artifactRef?.kind === "document-version") return { ...recovery, escalations: recovery.escalations.map((entry) => entry.reason === "no-eligible-reviewer"
      ? { ...entry, nextAction: `${entry.nextAction} The reviewer and delegating person must also have current Workroom content access. Use the existing governed coworker engagement procedure; revoked or narrowed room access is never bypassed by a review request.` } : entry) };
    return recovery;
  }
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
  const classifiedHistory = await classifyHistoricalObjectiveMappingArtifacts({
    history: historyResult.data.history,
    baselineRows: baselineRows!,
    currentBaseline: baseline,
    currentArtifact: {
      repositoryFullName: immutableArtifactIdentity(binding.artifactRef).repositoryFullName,
      path: immutableArtifactIdentity(binding.artifactRef).path,
    },
    currentEvidenceActivityIds: binding.eligibleEvidenceActivityIds,
    room: {
      ...room,
      repositoryFullName: room.repositoryFullName,
      headSha: room.headSha,
    },
    verify: ports.verifyHistoricalArtifact,
  });
  if (!classifiedHistory.ok) {
    return escalation(
      "objective-mapping-history-unavailable",
      "Historical objective-mapping artifact provenance could not be verified. Retry after the repository provider is healthy; do not infer or churn the request identity.",
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
    history: classifiedHistory.data.history,
    providerProvenImpossibleTaskRunProofs: classifiedHistory.data.providerProvenImpossibleTaskRunProofs,
    serverProvenStaleBodyTaskRunProofs: classifiedHistory.data.serverProvenStaleBodyTaskRunProofs,
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
