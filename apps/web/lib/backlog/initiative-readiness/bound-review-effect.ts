import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { Prisma } from "@dpf/db";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import type { InitiativeArtifactRef, InitiativeGateKey, InitiativeGateReceipt } from "./receipt-schema";
import { validInitiativeGateReceipt } from "./receipt-validation";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

/** Internal context only: never accepted from tool arguments. This identifies an
 * effect; it does not settle a provider execution or authorize its replay. */
export type BoundReviewTask = { taskRunId: string; requestDigest: string };
export type BoundReviewScope = {
  boundReviewTask?: BoundReviewTask;
  actionKey: string;
  itemId: string;
  gate: InitiativeGateKey;
  artifactRef: InitiativeArtifactRef;
  workroomRef?: InitiativeReviewBinding["workroomRef"];
  expectedCurrentBaselineId?: string | null;
  reviewerUserId: string;
  reviewerAgentId: string | null;
  authorityDecisionId: string | null;
};
type Refusal = { ok: false; code: string; error: string };
const refuse = (error: string): Refusal => ({ ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error });
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

function sameArtifact(packet: Record<string, unknown>, artifact: InitiativeArtifactRef): boolean {
  if (packet.kind !== artifact.kind) return false;
  if (artifact.kind === "document-version") return packet.versionId === artifact.versionId;
  if (artifact.kind === "feature-build-revision") return packet.revisionId === artifact.revisionId;
  return equal(packet, artifact);
}

/** Read the durable task link from both supported authorization carriers. An
 * absent or conflicting link is ambiguous, never evidence of another task. */
async function authorityTask(tx: Prisma.TransactionClient, decisionId: string, scope: BoundReviewScope,
  organizationId: string | null, snapshot?: Record<string, unknown>): Promise<string | null> {
  const authority = await tx.authorizationDecisionLog.findUnique({ where: { decisionId }, select: {
    decisionId: true, decision: true, actionKey: true, organizationId: true, rationale: true, policyVersion: true,
  } });
  if (!authority || authority.decision !== "allow" || authority.actionKey !== scope.actionKey
    || authority.organizationId !== organizationId
    || (snapshot && (snapshot.actionKey !== authority.actionKey
      || snapshot.policyVersion !== (authority.policyVersion ?? "coworker-authority.v1")
      || snapshot.organizationId !== (authority.organizationId ?? "platform")))) return null;
  const direct = object(authority.rationale).taskRunId;
  const envelopes = await tx.coworkerActionEnvelope.findMany({ where: { authorityDecisionId: decisionId },
    select: { taskRunId: true } });
  const links = new Set([
    ...(typeof direct === "string" && direct ? [direct] : []),
    ...envelopes.flatMap((row) => row.taskRunId ? [row.taskRunId] : []),
  ]);
  return links.size === 1 ? [...links][0]! : null;
}

/** Lock before the subject row, so cancellation and task identity mutations
 * serialize with both canonical writers. This is not a generation fence. */
export async function lockBoundReviewEffect(tx: Prisma.TransactionClient, scope: BoundReviewScope,
  organizationId: string | null): Promise<Refusal | null> {
  const bound = scope.boundReviewTask;
  if (!bound) return null;
  if (!bound.taskRunId || !/^[a-f0-9]{64}$/.test(bound.requestDigest)) {
    return refuse("The authenticated review task has no valid request digest.");
  }
  await tx.$queryRaw`SELECT "id" FROM "TaskRun" WHERE "taskRunId" = ${bound.taskRunId} FOR SHARE`;
  const task = await tx.taskRun.findUnique({ where: { taskRunId: bound.taskRunId }, select: {
    userId: true, currentAgentId: true, status: true, a2aMetadata: true,
  } });
  const metadata = object(task?.a2aMetadata);
  const binding = object(metadata.initiativeReviewBinding);
  if (!task || task.userId !== scope.reviewerUserId || task.currentAgentId !== scope.reviewerAgentId
    || ["canceled", "cancelled", "rejected", "archived"].includes(task.status)
    || metadata.trigger !== "external-mcp" || metadata.requestDigest !== bound.requestDigest
    || binding.writerToolName !== scope.actionKey || binding.itemId !== scope.itemId || binding.gate !== scope.gate
    || !sameArtifact(object(binding.artifactRef), scope.artifactRef)
    || !equal(binding.workroomRef, scope.workroomRef)
    || !equal(binding.expectedCurrentBaselineId, scope.expectedCurrentBaselineId)) {
    return refuse("The accepted review task, actor, artifact or cancellation state changed before publication.");
  }
  if (!scope.authorityDecisionId
    || await authorityTask(tx, scope.authorityDecisionId, scope, organizationId) !== bound.taskRunId) {
    return { ok: false, code: "AUTHORIZATION_DENIED", error: "The writer allow decision does not identify this exact review task." };
  }
  return null;
}

export function boundReviewReceiptId(scope: BoundReviewScope, artifactDigest: string): string | null {
  if (!scope.boundReviewTask) return null;
  const key = { ...scope.boundReviewTask, writerToolName: scope.actionKey, gate: scope.gate, artifactDigest };
  return `initiative-review-v1-${createHash("sha256").update(canonicalJson(key)).digest("hex")}`;
}

/** Called under the subject lock by both writers. Also recognizes legacy UUID
 * receipts, but only through their independently persisted authority/task link. */
export async function findBoundReviewWinner(tx: Prisma.TransactionClient, scope: BoundReviewScope,
  artifact: { digest: string; authorPrincipalId: string | null; authorAgentId: string | null },
  subjectRowId: string, organizationId: string | null, reviewerPrincipalId: string,
): Promise<(ActionSuccess & { receipt: InitiativeGateReceipt | null }) | Refusal> {
  const stableId = boundReviewReceiptId(scope, artifact.digest);
  if (!stableId) return { ...ok(), receipt: null };
  const select = { id: true, backlogItemId: true, kind: true, gateKey: true, payload: true } as const;
  const stable = await tx.backlogItemActivity.findUnique({ where: { id: stableId }, select });
  const rows = await tx.backlogItemActivity.findMany({ where: { backlogItemId: subjectRowId,
    kind: "initiative_gate_receipt", gateKey: scope.gate.replaceAll("-", "_") as never }, select });
  const candidates = new Map(rows.map((row) => [row.id, row]));
  if (stable) candidates.set(stable.id, stable);
  const winners: InitiativeGateReceipt[] = [];
  for (const row of candidates.values()) {
    const payload = object(row.payload);
    if (row.id !== stableId && payload.artifactDigest !== artifact.digest) continue;
    const taskId = typeof payload.authorityDecisionId === "string"
      ? await authorityTask(tx, payload.authorityDecisionId, scope, organizationId, object(payload.authoritySnapshot)) : null;
    if (row.id !== stableId && taskId && taskId !== scope.boundReviewTask!.taskRunId) continue;
    if (taskId !== scope.boundReviewTask!.taskRunId
      || row.backlogItemId !== subjectRowId || row.kind !== "initiative_gate_receipt"
      || row.gateKey !== scope.gate.replaceAll("-", "_")
      || !validInitiativeGateReceipt(payload, { receiptId: row.id, gate: scope.gate,
        subject: { kind: "backlog-item", id: scope.itemId } })
      || payload.artifactDigest !== artifact.digest || !sameArtifact(object(payload.artifactRef), scope.artifactRef)
      || payload.artifactAuthorRef !== `principal:${artifact.authorPrincipalId}|agent:${artifact.authorAgentId}`
      || payload.reviewerPrincipalId !== reviewerPrincipalId || payload.reviewerAgentId !== scope.reviewerAgentId
      || object(payload.authoritySnapshot).actionKey !== scope.actionKey
      || object(payload.authoritySnapshot).organizationId !== (organizationId ?? "platform")
      || reviewerPrincipalId === artifact.authorPrincipalId || scope.reviewerAgentId === artifact.authorAgentId) {
      return refuse("An existing review effect cannot be reconciled to this exact task and artifact. No replacement verdict was appended.");
    }
    winners.push(payload as unknown as InitiativeGateReceipt);
  }
  if (winners.length > 1) return refuse("Multiple canonical verdicts already identify this review effect; reconcile them before continuing.");
  return { ...ok(), receipt: winners[0] ?? null };
}

/** A serialization/unique-key loser gets one fresh winner read, never another
 * append. Do not turn this into a generic write retry or inference retry. */
export async function publishBoundReviewEffect<T>(bound: boolean, publish: (winnerOnly: boolean) => Promise<T>): Promise<T> {
  try { return await publish(false); }
  catch (error) {
    const code = object(error).code;
    if (!bound || (code !== "P2034" && code !== "P2002")) throw error;
    return publish(true);
  }
}
