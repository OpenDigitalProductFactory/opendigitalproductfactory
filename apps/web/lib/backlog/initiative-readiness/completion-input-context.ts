import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { isRecord } from "@/lib/shared/coerce";
import { normalizeCompletionEvidenceManifest, type CompletionEvidenceManifest } from "@/lib/backlog/completion-evidence-policy";

/** Private inputs, never an allowed verdict or a client-supplied review packet. */
export type CompletionInputContext = {
  schemaVersion: 1;
  bindingDigest: string;
  manifest: CompletionEvidenceManifest;
};
const MAX_CONTEXT_BYTES = 32_768;
type ContextDb = { backlogItemActivity: { findMany(args: unknown): Promise<Array<{ payload: unknown }>> } };

/** Completion inputs remain server-side; the public audit still shows its verdict. */
export function publicCompletionActivityPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !("completionInputContext" in payload)) return payload;
  const { completionInputContext: _privateInput, ...publicPayload } = payload;
  return publicPayload;
}

/** One projection keeps the public audit fields together with input redaction. */
export function publicCompletionActivity(activity: {
  id: string; kind: string; summary: string; recordedAt: Date; payload: unknown;
}) {
  return { id: activity.id, kind: activity.kind, summary: activity.summary,
    recordedAt: activity.recordedAt.toISOString(),
    payload: publicCompletionActivityPayload(activity.payload) };
}

/** Bind only the existing medium, retained-body acceptance lane. */
export function completionInputBinding(args: {
  item: { id: string; itemId: string; status: string; body?: string | null; title?: string | null;
    workType: string | null; type: string | null; source: string | null; scopeKind: string | null;
    organizationId: string | null; digitalProductId: string | null; epicId: string | null;
    archetypeCategories: string[]; archetypeIds: string[]; lifecycleTags?: string[] | null;
    claimedAt: Date | null; createdAt: Date };
  shape: string | null;
  baseline: unknown;
  room: { capsuleId: string; repositoryFullName: string | null; headBranch: string | null;
    baseSha: string | null; headSha: string | null } | null;
  editPaths: string[];
}): string | null {
  const { item, room, baseline } = args;
  if (item.status !== "awaiting-acceptance" || args.shape !== "delivery-medium@1.0.0"
    || !isRecord(baseline) || baseline.origin !== "item-body"
    || !isRecord(baseline.artifactRef) || baseline.artifactRef.kind !== "document-version"
    || !room?.capsuleId || !room.repositoryFullName || !room.headBranch
    || !/^[a-f0-9]{40}$/i.test(room.baseSha ?? "") || !/^[a-f0-9]{40}$/i.test(room.headSha ?? "")) return null;
  // Scope/content changes, a new source attempt, or a new baseline require a
  // fresh authorized submission. Evidence and authority are rechecked elsewhere.
  const value = { item: {
    id: item.id, itemId: item.itemId, status: item.status, body: item.body ?? null, title: item.title ?? null,
    workType: item.workType, type: item.type, source: item.source, scopeKind: item.scopeKind,
    organizationId: item.organizationId, digitalProductId: item.digitalProductId, epicId: item.epicId,
    archetypeCategories: item.archetypeCategories, archetypeIds: item.archetypeIds,
    lifecycleTags: item.lifecycleTags ?? [], claimedAt: item.claimedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  }, shape: args.shape, baseline, source: {
    capsuleId: room.capsuleId, repositoryFullName: room.repositoryFullName,
    headBranch: room.headBranch, baseSha: room.baseSha, headSha: room.headSha,
  }, editPaths: [...args.editPaths].sort() };
  return "sha256:" + createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function retainCompletionInput(bindingDigest: string | null, manifest: unknown): CompletionInputContext | null {
  const normalized = normalizeCompletionEvidenceManifest(manifest);
  if (!bindingDigest || !normalized) return null;
  const context: CompletionInputContext = { schemaVersion: 1, bindingDigest, manifest: normalized };
  return Buffer.byteLength(JSON.stringify(context), "utf8") <= MAX_CONTEXT_BYTES ? context : null;
}

/** One latest attempt, never scan backwards for a convenient old pass. */
export async function readCompletionInput(db: ContextDb, item: { id: string; itemId: string },
  bindingDigest: string | null): Promise<CompletionEvidenceManifest | undefined> {
  if (!bindingDigest) return undefined;
  const rows = await db.backlogItemActivity.findMany({
    where: { backlogItemId: item.id, kind: "initiative_readiness_decision" },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }], take: 1, select: { payload: true },
  });
  const row = rows[0]?.payload;
  if (!isRecord(row) || row.schemaVersion !== 1 || row.enforcementState !== "enforced"
    || row.target !== "completion" || !isRecord(row.subject)
    || row.subject.kind !== "backlog-item" || row.subject.id !== item.itemId
    || !isRecord(row.authoritySnapshot) || row.authoritySnapshot.decision !== "allow"
    || !["update_backlog_item_status", "complete_backlog_item"].includes(String(row.authoritySnapshot.actionKey))
    || !isRecord(row.completionInputContext) || row.completionInputContext.schemaVersion !== 1
    || row.completionInputContext.bindingDigest !== bindingDigest) return undefined;
  const retained = retainCompletionInput(bindingDigest, row.completionInputContext.manifest);
  // Reject lossy normalization of malformed persisted context.
  return retained && canonicalJson(retained) === canonicalJson(row.completionInputContext)
    ? retained.manifest : undefined;
}
