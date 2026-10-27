import type { Prisma } from "@dpf/db";
import { resolveCanonicalAgentId } from "@dpf/db/agent-identity";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { currentUserContext } from "./govern/current-user-context";
import { can } from "./permissions";
import { expandGrants, isToolAllowedByGrants, persistedAgentToolGrants } from "./tak/agent-grants";
import { OAUTH_EXECUTION_AUTHORITY_SELECT, isCurrentOAuthExecutionAuthority } from "./auth/oauth-tokens";
import { resolveAgentWorkroomAccess } from "./work-management/workroom-agent-access.server";
import { revalidateApprovedReassessmentPolicy } from "./mcp-task-review-reassessment";
import { readReassessmentBudgetConfiguration, checkReassessmentBudget } from "./inference/budget-gate";
import { assertCurrentReassessmentContract } from "./mcp-task-reassessment-contract";
import { parseTerminalWriterWait } from "./mcp-task-replay-projection";
import { parseTerminalWriterEscalation, terminalWriterRetryIsExhausted } from "./mcp-task-terminal-writer-escalation";
import { validInitiativeGateReceipt } from "./backlog/initiative-readiness/receipt-validation";
import { readBoundReviewAuthorityTask } from "./backlog/initiative-readiness/bound-review-effect";
import { validateInitiativeReviewAuthorityScope } from "./mcp-task-review-contract";
import { collectReassessmentLineage } from "./mcp-task-reassessment-lineage";
import type { ReassessmentAdmissionAuthority } from "./mcp-task-reassessment-admission";
import type { RemoteTaskSubmitAuth } from "./mcp-task-submit-types";
import type { ReassessmentBudgetConfiguration } from "./shared/reassessment-budget-contract";
import type { ReassessmentRuntimeCompatibility } from "./shared/reassessment-owner-versions";

export type PresentReviewRequestAuthority = { authorityDecisionId: string; actingAgentId: string; tokenGrantScopes: readonly string[] };
export class ReassessmentAuthorityRefusal extends Error {
  constructor(readonly code: string, readonly receiptId?: string) { super(code); this.name = "ReassessmentAuthorityRefusal"; }
}
function refuse(code = "reassessment-authority-unproven", receiptId?: string): never { throw new ReassessmentAuthorityRefusal(code, receiptId); }
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function requestAuthoritySnapshot(value: unknown): PresentReviewRequestAuthority | null {
  const raw = object(value);
  if (Object.keys(raw).length !== 3 || !["authorityDecisionId", "actingAgentId", "tokenGrantScopes"].every(key => Object.hasOwn(raw, key))
    || ![raw.authorityDecisionId, raw.actingAgentId].every(entry => typeof entry === "string" && entry.length > 0 && entry.trim() === entry)
    || !Array.isArray(raw.tokenGrantScopes) || !raw.tokenGrantScopes.every(entry => typeof entry === "string" && entry.length > 0 && entry.trim() === entry)) return null;
  return Object.freeze({ authorityDecisionId: raw.authorityDecisionId as string, actingAgentId: raw.actingAgentId as string,
    tokenGrantScopes: Object.freeze([...(raw.tokenGrantScopes as string[])]) });
}
function knownWriterLimitExhausted(progress: unknown, writerToolName: string): boolean {
  const current = object(progress), prior = object(object(current.executionUncertaintyResolution).prior);
  return [current, prior].some(record => {
    const wait = parseTerminalWriterWait(record), escalation = parseTerminalWriterEscalation(record);
    const rejection = object(record.terminalWriterWait).writerRejection;
    const rejectedPacket = !!rejection && typeof rejection === "object" && !Array.isArray(rejection);
    return !!(wait && !rejectedPacket && wait.writerToolName === writerToolName && terminalWriterRetryIsExhausted(wait.attempt)
      || escalation && escalation.writerToolName === writerToolName && escalation.code === "terminal_writer_retry_exhausted"
      && terminalWriterRetryIsExhausted(escalation.attempt));
  });
}

/** Read-only normal authority, never a second grant store. The actual governed
 * request decision is injected by the server adapter and retained by admission.
 * Every phase repeats current consent, human, coworker, room and budget checks. */
export function createPresentReassessmentAuthority(input: {
  token: RemoteTaskSubmitAuth; requestAuthority: PresentReviewRequestAuthority;
  budgetConfiguration: ReassessmentBudgetConfiguration; compatibility: ReassessmentRuntimeCompatibility;
}): ReassessmentAdmissionAuthority {
  const token = Object.freeze({ ...input.token }), requestAuthority = requestAuthoritySnapshot(input.requestAuthority);
  if (token.source !== "oauth" || token.capability !== "write" || !requestAuthority) refuse();
  return async (tx, context) => {
    const { parsed, proof, root } = context, binding = parsed.initiativeReviewBinding;
    if (!binding?.workroomRef || binding.writerToolName !== "record_initiative_design_review"
      || validateInitiativeReviewAuthorityScope(binding, parsed.authorityScope)) refuse();
    assertCurrentReassessmentContract(root?.compatibility ?? input.compatibility);
    if (root && !equal(root.compatibility, input.compatibility)) refuse("reassessment-compatibility-changed");
    if (root) {
      const persisted = await tx.taskRun.findUnique({ where: { taskRunId: root.taskRunId }, select: {
        taskRunId: true, userId: true, currentAgentId: true, a2aMetadata: true } });
      const metadata = object(persisted?.a2aMetadata);
      if (!persisted || persisted.taskRunId !== root.taskRunId || persisted.userId !== token.userId || persisted.userId !== root.userId
        || persisted.currentAgentId !== parsed.agentId || persisted.currentAgentId !== root.agentId
        || metadata.trigger !== "external-mcp" || metadata.apiTokenId !== token.tokenId || metadata.tokenSource !== token.source
        || metadata.tokenCapability !== token.capability || metadata.requestDigest !== root.requestDigest
        || !equal(root.binding, binding) || !equal(metadata.initiativeReviewBinding, binding)
        || !equal(metadata.presentReviewAuthority, requestAuthority)) refuse();
    }
    await revalidateApprovedReassessmentPolicy(tx, proof, token.userId);
    const [human, credential, actor, reviewer, decision, room] = await Promise.all([
      currentUserContext(token.userId, tx),
      tx.mcpApiToken.findUnique({ where: { id: token.tokenId }, select: { ...OAUTH_EXECUTION_AUTHORITY_SELECT, capability: true, scopes: true } }),
      tx.agent.findUnique({ where: { agentId: requestAuthority.actingAgentId }, select: { agentId: true, status: true, archived: true,
        toolGrants: { select: { grantKey: true } }, toolGrantRevocations: { select: { grantKey: true } } } }),
      tx.agent.findUnique({ where: { agentId: resolveCanonicalAgentId(parsed.agentId) }, select: { agentId: true, status: true, archived: true, lifecycleStage: true,
        toolGrants: { select: { grantKey: true } }, toolGrantRevocations: { select: { grantKey: true } } } }),
      tx.authorizationDecisionLog.findUnique({ where: { decisionId: requestAuthority.authorityDecisionId }, select: {
        decision: true, actionKey: true, humanContextRef: true, agentContextRef: true, authorityBindingId: true } }),
      tx.workroom.findUnique({ where: { capsuleId: binding.workroomRef.workroomId }, select: {
        id: true, backlogItemId: true, repositoryFullName: true, headBranch: true, headSha: true, archivedAt: true } }),
    ]);
    if (!human || !can(human, "manage_backlog") || !credential || credential.userId !== token.userId || credential.capability !== "write"
      || !credential.agentId || resolveCanonicalAgentId(credential.agentId) !== resolveCanonicalAgentId(requestAuthority.actingAgentId)
      || credential.oauthClient?.registrationKind === "credentials" || !await isCurrentOAuthExecutionAuthority(credential, tx)
      || !actor || actor.status !== "active" || actor.archived || !reviewer || reviewer.status !== "active" || reviewer.archived
      || reviewer.lifecycleStage !== "production" || resolveCanonicalAgentId(actor.agentId) === resolveCanonicalAgentId(reviewer.agentId)
      || !decision || decision.decision !== "allow" || decision.actionKey !== "request_coworker" || decision.humanContextRef !== token.userId
      || !decision.agentContextRef || resolveCanonicalAgentId(decision.agentContextRef) !== resolveCanonicalAgentId(actor.agentId)
      || !credential.authorityBindingId || decision.authorityBindingId !== credential.authorityBindingId) refuse();
    const tokenGrants = expandGrants(credential.scopes), actorGrants = expandGrants(persistedAgentToolGrants(actor));
    // Normal bounded delegation separates the author's request grants from
    // the reviewer's actual autonomous tool grants. This lane receives no chat
    // read baseline; its existing surface baseline admits neither bound tool.
    const reviewerGrants = expandGrants(persistedAgentToolGrants(reviewer));
    const requestGrants = expandGrants(requestAuthority.tokenGrantScopes);
    const requiredTools = ["read_source_at_version", binding.writerToolName];
    if (!actorGrants.includes("initiative_evidence_write") || !actorGrants.includes("backlog_read")
      || !tokenGrants.includes("initiative_evidence_write") || !tokenGrants.includes("backlog_read")
      || !requestGrants.includes("initiative_evidence_write") || !requestGrants.includes("backlog_read")
      || requiredTools.some(name => !isToolAllowedByGrants(name, reviewerGrants))
      || (parsed.authorityScope ?? []).some(scope => !scope.startsWith("tool:") && !scope.startsWith("backlog-item:")
        && (!tokenGrants.includes(scope) || !requestGrants.includes(scope)))) refuse();
    if (!room || room.archivedAt || ![proof.subjectRowId, binding.itemId].includes(room.backlogItemId ?? "")
      || room.repositoryFullName !== binding.workroomRef.repositoryFullName || room.headBranch !== binding.workroomRef.branchName
      || room.headSha !== binding.workroomRef.headSha) refuse("reassessment-source-changed");
    const parentAccess = await resolveAgentWorkroomAccess({ userId: token.userId, agentId: requestAuthority.actingAgentId,
      workroomId: room.id, requested: "action" }, tx);
    if (parentAccess.decision.level !== "action") refuse("reassessment-room-access-required");
    const authorityRooms = await tx.workroom.findMany({ where: { backlogItemId: { in: [proof.authorizationRowId, proof.authorizationItemId] }, archivedAt: null },
      orderBy: { id: "asc" }, take: 21, select: { id: true } });
    if (!authorityRooms.length || authorityRooms.length > 20) refuse("reassessment-room-access-required");
    let mayReadPolicy = false;
    for (const owner of authorityRooms) {
      const access = await resolveAgentWorkroomAccess({ userId: token.userId, agentId: requestAuthority.actingAgentId,
        workroomId: owner.id, requested: "content" }, tx);
      if (["action", "content"].includes(access.decision.level)) mayReadPolicy = true;
    }
    if (!mayReadPolicy) refuse("reassessment-room-access-required");
    // A writer can commit before its ToolExecution acknowledgement. Inspect
    // canonical activities directly under the existing subject/task locks.
    const receipts = await tx.backlogItemActivity.findMany({ where: { backlogItemId: proof.subjectRowId,
      kind: "initiative_gate_receipt", gateKey: binding.gate.replaceAll("-", "_") as never }, take: 251,
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }], select: { id: true, payload: true } });
    if (receipts.length > 250) refuse("reassessment-lineage-unproven");
    for (const row of receipts) {
      const payload = object(row.payload);
      if (!equal(payload.artifactRef, binding.artifactRef)) continue;
      if (!validInitiativeGateReceipt(payload, { receiptId: row.id, gate: binding.gate, subject: { kind: "backlog-item", id: binding.itemId } })
        || typeof payload.authorityDecisionId !== "string") refuse("reassessment-existing-effect-unproven");
      const taskId = await readBoundReviewAuthorityTask(tx, payload.authorityDecisionId, { actionKey: binding.writerToolName }, undefined, object(payload.authoritySnapshot));
      if (!taskId) refuse("reassessment-existing-effect-unproven");
      refuse("reassessment-requirement-already-has-receipt", row.id);
    }
    let snapshot = context.snapshot;
    if (root && !snapshot) {
      // Q/E and canonical commit callbacks already own their transaction and
      // required locks. Reuse the bounded read-only collector; acquiring more
      // TaskRun locks here would invert the writer's established lock order.
      try {
        const subject = await tx.backlogItem.findUnique({ where: { itemId: binding.itemId }, select: { id: true, organizationId: true } });
        if (!subject || subject.id !== proof.subjectRowId) refuse("reassessment-lineage-unproven");
        snapshot = await collectReassessmentLineage(tx, { binding, organizationId: subject.organizationId,
          originals: context.originals.map(row => ({ taskRunId: row.taskRunId, requestDigest: row.requestDigest })) });
      } catch { refuse("reassessment-lineage-unproven"); }
      const present = snapshot.rows.filter(row => row.binding.presentReassessment);
      const own = present.filter(row => row.taskRunId === root.taskRunId);
      if (own.length !== 1 || own[0]!.userId !== root.userId || own[0]!.currentAgentId !== root.agentId
        || own[0]!.requestDigest !== root.requestDigest || !equal(own[0]!.binding, binding)) refuse("reassessment-lineage-unproven");
      if (present.length > 2 || present.filter(row => row.binding.gate === binding.gate && equal(row.binding.artifactRef, binding.artifactRef)).length > 1) {
        refuse("reassessment-allocation-limit-exhausted");
      }
    }
    for (const row of snapshot?.rows ?? []) {
      if (!row.binding.presentReassessment && knownWriterLimitExhausted(row.progressPayload, row.binding.writerToolName)) {
        refuse("reassessment-recorded-limit-exhausted");
      }
    }
    const currentBudget = await readReassessmentBudgetConfiguration(input.budgetConfiguration.agentId, undefined, tx);
    if (currentBudget.configurationDigest !== input.budgetConfiguration.configurationDigest
      || root && root.budgetConfiguration.configurationDigest !== currentBudget.configurationDigest) refuse("reassessment-budget-configuration-changed");
    await checkReassessmentBudget(currentBudget, tx);
  };
}
