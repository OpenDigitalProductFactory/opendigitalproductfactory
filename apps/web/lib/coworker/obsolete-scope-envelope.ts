import "server-only";
import type { PrismaClient, Prisma } from "@dpf/db";
import { commandAuthorityScopeKey, commandPayloadBinding, withLockedCommandAbsence, type ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { classifyOriginalScopeReleaseTargets } from "@/lib/work-capsules/scope-release-targets";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/permissions";
import { coerceDataSensitivity } from "@dpf/db/principal-sensitivity";
import { isRecognizedCoworkerGovernancePolicy } from "@/lib/coworker-service-catalog/authority-projection-sources";
import { parseUnusedScopeProposal, scopeProposalCreatorMatches, authenticScopeIssuance,
  SCOPE_RELEASE_ALIASES, SCOPE_PARKED_PROOF_LIMIT, type ScopeProposalRow, type ParkedScopeCall,
  type UnusedScopeProposal } from "./obsolete-scope-envelope-proof";

export type ObsoleteScopeSummary = { scanned: number; cancelled: number; skipped: number; inconclusive: number;
  hasMore: boolean; nextCursor: string | null; settled: Array<{ envelopeId: string; roomId: string }> };
export type ObsoleteScopeDb = Pick<PrismaClient, "coworkerActionEnvelope" | "toolExecution" | "$transaction">;
const PAGE_SIZE = 200;
type Tx = Prisma.TransactionClient;
const PROPOSAL_SELECT = { id: true, manifestActionId: true, status: true, resolvedAt: true, taskRunId: true,
  delegatingUserId: true, coworkerAgentId: true, authorityDecisionId: true, argsJson: true,
  inputFingerprint: true, approvalBindingFingerprint: true, createdAt: true } as const;

function readParkedCalls(db: Pick<Tx, "toolExecution">, id: string): Promise<ParkedScopeCall[]> {
  return db.toolExecution.findMany({ where: { OR: [{ envelopeId: id }, { result: { path: ["data", "envelopeId"], equals: id } }] },
    orderBy: { id: "asc" }, take: SCOPE_PARKED_PROOF_LIMIT + 1,
    select: { id: true, envelopeId: true, toolName: true, userId: true, agentId: true, taskRunId: true,
      success: true, parameters: true, result: true } });
}

async function currentProofOwners(tx: Tx, row: ScopeProposalRow, proof: UnusedScopeProposal): Promise<Set<string> | null> {
  // Lock the original subjects, never substitute the concierge's profile.
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${row.delegatingUserId} FOR SHARE`;
  await tx.$queryRaw`SELECT "id" FROM "Agent" WHERE "agentId" = ${row.coworkerAgentId} FOR SHARE`;
  await tx.$queryRaw`SELECT p."id" FROM "AgentGovernanceProfile" p JOIN "Agent" a ON a."id" = p."agentId" WHERE a."agentId" = ${row.coworkerAgentId} FOR SHARE OF p`;
  const human = await currentUserContext(row.delegatingUserId, tx);
  const agent = await tx.agent.findUnique({ where: { agentId: row.coworkerAgentId },
    select: { agentId: true, status: true, archived: true, sensitivity: true, governanceProfile: { select: { hitlPolicy: true } } } });
  const policy = agent?.governanceProfile?.hitlPolicy.trim().toLowerCase();
  if (!human || !can(human, "manage_backlog") || !agent || agent.archived || agent.status !== "active"
    || !isRecognizedCoworkerGovernancePolicy(policy) || policy === "always") return null;
  const aliases = await tx.principalAlias.findMany({ where: { issuer: "", OR: [
    { aliasType: "user", aliasValue: row.delegatingUserId }, { aliasType: "agent", aliasValue: row.coworkerAgentId }] },
    take: 3, select: { aliasType: true, aliasValue: true, issuer: true, principalId: true,
      principal: { select: { id: true, kind: true, status: true, sensitivityClearance: true } } } });
  if (aliases.length !== 2) return null;
  const user = aliases.find(alias => alias.aliasType === "user" && alias.aliasValue === row.delegatingUserId);
  const coworker = aliases.find(alias => alias.aliasType === "agent" && alias.aliasValue === row.coworkerAgentId);
  if (!user || !coworker || user.issuer !== "" || coworker.issuer !== ""
    || user.principal.id !== user.principalId || coworker.principal.id !== coworker.principalId
    || user.principal.kind !== "human" || coworker.principal.kind !== "agent"
    || user.principal.status !== "active" || coworker.principal.status !== "active"
    || !user.principal.sensitivityClearance.includes(proof.binding.sensitivity)
    || !user.principal.sensitivityClearance.includes(coerceDataSensitivity(agent.sensitivity))
    || !coworker.principal.sensitivityClearance.includes(proof.binding.sensitivity)) return null;
  return new Set([user.principal.id, coworker.principal.id]);
}

async function settleLocked(tx: Tx, snapshot: ScopeProposalRow, original: UnusedScopeProposal, now: Date) {
  // The command helper already owns command→room. Unkeyed callers lock room first.
  await tx.$queryRaw`SELECT "id" FROM "CoworkerActionEnvelope" WHERE "id" = ${snapshot.id} FOR UPDATE`;
  const row = await tx.coworkerActionEnvelope.findUnique({ where: { id: snapshot.id }, select: PROPOSAL_SELECT });
  const proof = row ? parseUnusedScopeProposal(row, await readParkedCalls(tx, row.id)) : null;
  if (!row || row.id !== snapshot.id || !proof || row.inputFingerprint !== snapshot.inputFingerprint
    || row.approvalBindingFingerprint !== snapshot.approvalBindingFingerprint
    || commandPayloadBinding(row.argsJson).digest !== commandPayloadBinding(snapshot.argsJson).digest
    || commandPayloadBinding(proof.request).digest !== commandPayloadBinding(original.request).digest) return "inconclusive";
  const room = await tx.workroom.findUnique({ where: { capsuleId: proof.request.capsuleId }, select: { id: true, scopeClaims: true } });
  if (!room || room.id !== proof.request.expectedRoomId) return "inconclusive";
  const owners = await currentProofOwners(tx, row, proof);
  if (!owners || proof.request.claims.some(target => !owners.has(target.recordedByPrincipalId))) return "inconclusive";
  const creator = await tx.authorizationDecisionLog.findUnique({ where: { decisionId: row.authorityDecisionId! }, select: {
    decisionId: true, actorType: true, actorRef: true, humanContextRef: true, agentContextRef: true,
    actionKey: true, organizationId: true, objectRef: true, decision: true, routeContext: true, rationale: true } });
  if (!scopeProposalCreatorMatches(creator, row, proof)) return "inconclusive";
  const issueIds: string[] = [];
  for (const target of proof.request.claims) {
    const events = await tx.workroomActivity.findMany({ where: { workCapsuleId: room.id, kind: "scope-claimed",
      payload: { path: ["added"], array_contains: [{ releaseEpoch: target.releaseEpoch }] } },
      orderBy: { id: "asc" }, take: SCOPE_PARKED_PROOF_LIMIT + 1,
      select: { id: true, workCapsuleId: true, kind: true, payload: true, recordedById: true, recordedByAgentId: true } });
    const issueId = authenticScopeIssuance(events, row, room.id, target);
    if (!issueId) return "inconclusive";
    issueIds.push(issueId);
  }
  const state = classifyOriginalScopeReleaseTargets(room, proof.request.expectedRoomId, proof.request.claims);
  if (state !== "obsolete") return state === "current" ? "skipped" : "inconclusive";
  const changed = await tx.coworkerActionEnvelope.updateMany({ where: { id: row.id, status: "proposed", resolvedAt: null,
    taskRunId: null, manifestActionId: row.manifestActionId, delegatingUserId: row.delegatingUserId,
    coworkerAgentId: row.coworkerAgentId, authorityDecisionId: row.authorityDecisionId,
    inputFingerprint: row.inputFingerprint, approvalBindingFingerprint: row.approvalBindingFingerprint,
    argsJson: { equals: row.argsJson as Prisma.InputJsonValue } }, data: { status: "cancelled", resolvedAt: now } });
  if (changed.count !== 1) return "skipped";
  await tx.workroomActivity.create({ data: { workCapsuleId: room.id, kind: "action",
    summary: "Withdrew an unused scope-release proposal after its original target became obsolete.",
    payload: { action: "obsolete-scope-proposal-withdrawn", envelopeId: row.id,
      authorityDecisionId: row.authorityDecisionId, issuanceActivityIds: [...new Set(issueIds)].sort(),
      parkedExecutionIds: proof.parkedExecutionIds, originalBindingDigest: commandPayloadBinding(proof.request).digest,
      source: "concierge-sweep" },
    // Server maintenance is not a new decision by the original human/assistant.
    recordedById: null, recordedByAgentId: null } });
  return "cancelled";
}

/** Lifecycle withdrawal only; never invokes the original release action. */
export async function settleObsoleteScopeReleaseEnvelopes(
  db: ObsoleteScopeDb, now: Date, afterId?: string | null,
): Promise<ObsoleteScopeSummary> {
  const deadline = Date.now() + 20_000;
  const rows = await db.coworkerActionEnvelope.findMany({ where: { manifestActionId: { in: SCOPE_RELEASE_ALIASES },
    status: "proposed", resolvedAt: null, taskRunId: null, ...(afterId ? { id: { gt: afterId } } : {}) },
    orderBy: { id: "asc" }, take: PAGE_SIZE + 1, select: PROPOSAL_SELECT });
  const page = rows.slice(0, PAGE_SIZE);
  const summary: ObsoleteScopeSummary = { scanned: 0, cancelled: 0, skipped: 0, inconclusive: 0,
    hasMore: rows.length > page.length, nextCursor: null, settled: [] };
  for (const row of page) {
    // Finish at most the current bounded transaction, then yield the cadence.
    if (summary.scanned > 0 && Date.now() >= deadline) { summary.hasMore = true; break; }
    summary.scanned++; summary.nextCursor = row.id;
    try {
      const proof = parseUnusedScopeProposal(row, await readParkedCalls(db, row.id));
      if (!proof) { summary.inconclusive++; continue; }
      const { commandId, ...payload } = proof.request;
      const outcome = commandId ? await withLockedCommandAbsence({ db: db as unknown as ReceiptDb,
        authorityScopeKey: commandAuthorityScopeKey({ userId: row.delegatingUserId, agentId: row.coworkerAgentId }),
        commandId, commandType: "release-scope", target: { kind: "workroom", id: proof.request.capsuleId },
        expectedRoomRowId: proof.request.expectedRoomId, payloadBinding: commandPayloadBinding(payload) },
      tx => settleLocked(tx as unknown as Tx, row, proof, now)).then(recorded =>
        recorded.kind === "recorded" ? "inconclusive" : recorded.result)
        : await db.$transaction(async tx => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', '10000ms', true), set_config('statement_timeout', '30000ms', true)`;
          await tx.$queryRaw`SELECT "id" FROM "WorkCapsule" WHERE "id" = ${proof.request.expectedRoomId} FOR UPDATE`;
          return settleLocked(tx, row, proof, now);
        }, { timeout: 30_000, maxWait: 10_000 });
      if (outcome === "cancelled") { summary.cancelled++; summary.settled.push({ envelopeId: row.id, roomId: proof.request.expectedRoomId }); }
      else if (outcome === "skipped") summary.skipped++;
      else summary.inconclusive++;
    } catch { summary.inconclusive++; }
  }
  if (!summary.hasMore) summary.nextCursor = null;
  return summary;
}
