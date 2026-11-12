import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isPrincipalSensitivity } from "@dpf/db/principal-sensitivity";
import { objectRecord, originalToolParameters, envelopeIdFromExecutionResult } from "@/lib/attention/coworker-envelope-decision";
import { fingerprintCoworkerApprovalBinding, fingerprintCoworkerInput,
  type CoworkerApprovalBinding } from "@/lib/govern/authority/coworker-authority-decision";
import { parseScopeReleaseRequest, type ScopeReleaseRequest, type ScopeReleaseTarget } from "@/lib/work-capsules/scope-release-targets";
import { canTransition } from "./envelope-state-machine";

export const SCOPE_RELEASE_ALIASES = ["release_workroom_scope", "release_capsule_scope"];
export const SCOPE_PARKED_PROOF_LIMIT = 25;
export type ScopeProposalRow = { id: string; manifestActionId: string; status: string; resolvedAt: Date | null;
  taskRunId: string | null; delegatingUserId: string; coworkerAgentId: string; authorityDecisionId: string | null;
  argsJson: unknown; inputFingerprint: string | null; approvalBindingFingerprint: string | null; createdAt: Date };
export type ParkedScopeCall = { id: string; envelopeId: string | null; toolName: string; userId: string;
  agentId: string | null; taskRunId: string | null; success: boolean; parameters: unknown; result: unknown };
export type UnusedScopeProposal = { request: ScopeReleaseRequest; binding: CoworkerApprovalBinding; parkedExecutionIds: string[] };

/** A strict authentic-creator subset, never an approved-null history guess. */
export function parseUnusedScopeProposal(row: ScopeProposalRow, calls: ParkedScopeCall[]): UnusedScopeProposal | null {
  if (row.status !== "proposed" || row.resolvedAt !== null || row.taskRunId !== null
    || !canTransition("proposed", "cancelled") || !SCOPE_RELEASE_ALIASES.includes(row.manifestActionId)
    || !row.delegatingUserId.trim() || !row.coworkerAgentId.trim() || !row.authorityDecisionId?.trim()
    || !row.inputFingerprint || !row.approvalBindingFingerprint || !calls.length || calls.length > SCOPE_PARKED_PROOF_LIMIT) return null;
  const value = objectRecord(objectRecord(row.argsJson)?.approvalBinding);
  const subject = objectRecord(value?.subject);
  if (!value || value.actingHumanUserId !== row.delegatingUserId || value.actingAgentId !== row.coworkerAgentId
    || value.toolName !== row.manifestActionId || value.taskRunId !== null || value.chainId !== null
    || value.authorResearchBinding !== undefined || value.inputFingerprint !== row.inputFingerprint
    || subject?.kind !== "platform" || subject.id !== "dpf"
    || (value.routeContext !== null && typeof value.routeContext !== "string")
    || typeof value.decisionVersionFingerprint !== "string" || !value.decisionVersionFingerprint.trim()
    || typeof value.sensitivity !== "string" || !isPrincipalSensitivity(value.sensitivity)) return null;
  const binding = value as CoworkerApprovalBinding;
  if (fingerprintCoworkerApprovalBinding(binding) !== row.approvalBindingFingerprint) return null;
  let request: ScopeReleaseRequest | null = null;
  const executionIds = new Set<string>();
  for (const call of calls) {
    const result = objectRecord(call.result), params = originalToolParameters(call.parameters);
    if (!call.id || executionIds.has(call.id) || (call.envelopeId !== null && call.envelopeId !== row.id)
      || envelopeIdFromExecutionResult(result) !== row.id || call.toolName !== row.manifestActionId
      || call.userId !== row.delegatingUserId || call.agentId !== row.coworkerAgentId || call.taskRunId !== null
      || call.success !== false || result?.success !== false || result.error !== "approval_required" || !params
      || fingerprintCoworkerInput(params) !== row.inputFingerprint) return null;
    const parsed = parseScopeReleaseRequest(params);
    // A proof budget can defer a whole proposal; it never truncates release intent.
    if (!parsed || parsed.claims.length > SCOPE_PARKED_PROOF_LIMIT
      || (request && canonicalJson(parsed) !== canonicalJson(request))) return null;
    request = parsed; executionIds.add(call.id);
  }
  return request ? { request, binding, parkedExecutionIds: [...executionIds].sort() } : null;
}

/** The real server creator link supplies provenance; a hash alone cannot. */
export function scopeProposalCreatorMatches(value: unknown, row: ScopeProposalRow, proof: UnusedScopeProposal): boolean {
  const decision = objectRecord(value), reason = objectRecord(decision?.rationale);
  return !!decision && decision.decisionId === row.authorityDecisionId && decision.actorType === "ai-coworker"
    && decision.actorRef === row.coworkerAgentId && decision.agentContextRef === row.coworkerAgentId
    && decision.humanContextRef === row.delegatingUserId && decision.actionKey === row.manifestActionId
    && decision.organizationId === null && decision.objectRef === "platform:dpf" && decision.decision === "require-approval"
    && decision.routeContext === proof.binding.routeContext && reason?.chainId === null && reason.taskRunId === null
    && reason.subjectKind === "platform" && (reason.authorityOrganizationScope === null || reason.authorityOrganizationScope === "platform");
}

/** One authentic added event, not refreshed-only, copied, duplicate or capped history. */
export function authenticScopeIssuance(value: unknown[], row: ScopeProposalRow, roomId: string, target: ScopeReleaseTarget): string | null {
  if (value.length !== 1) return null;
  const event = objectRecord(value[0]), payload = objectRecord(event?.payload);
  if (!event || typeof event.id !== "string" || !event.id || event.workCapsuleId !== roomId
    || event.kind !== "scope-claimed" || event.recordedById !== row.delegatingUserId
    || event.recordedByAgentId !== row.coworkerAgentId || !Array.isArray(payload?.added)) return null;
  const matching = payload.added.filter(entry => objectRecord(entry)?.releaseEpoch === target.releaseEpoch);
  if (matching.length !== 1) return null;
  const original = objectRecord(matching[0]);
  if (!original || typeof original.recordedAt !== "string" || !Number.isFinite(Date.parse(original.recordedAt))) return null;
  const parsed = parseScopeReleaseRequest({ capsuleId: "issuance", expectedRoomId: roomId, claims: [original] });
  return parsed && canonicalJson(parsed.claims[0]) === canonicalJson(target) ? event.id : null;
}
