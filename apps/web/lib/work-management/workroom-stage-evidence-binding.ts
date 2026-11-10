import { isRecord } from "@/lib/shared/coerce";
import { resolveWorkShapeClaim } from "./workroom-shape-claim";
import type { ReceiptEnvelope } from "./receipt-envelope";

type Room = { capsuleId: string; repositoryFullName?: string | null; headSha?: string | null; scopeClaims?: unknown };
type Evidence = { kind: string; stageKey?: string };
const SHA = /^[a-f0-9]{40}$/i;

/** Server-owned write context, not proof of the evidence's contents or outcome. */
export function buildStageEvidenceBinding(room: Room, evidence: Evidence) {
  const definition = resolveWorkShapeClaim(room.scopeClaims);
  const stage = definition?.stages.find(candidate => candidate.key === evidence.stageKey);
  if (!room.repositoryFullName || !room.headSha || !SHA.test(room.headSha)
    || !definition || !stage || !stage.evidence.some(kind => kind === evidence.kind)) return null;
  return { version: 1 as const, capsuleId: room.capsuleId,
    repositoryFullName: room.repositoryFullName, headSha: room.headSha,
    definitionRef: `${definition.key}@${definition.version}`, stageKey: stage.key, evidenceKind: evidence.kind };
}

/** Legacy and stale rows stay observed; a matching binding confers no verdict. */
export function readStageEvidenceBinding(payload: unknown, room?: Room): ReceiptEnvelope["processEvidence"] {
  if (!room || !isRecord(payload) || !isRecord(payload.sourceBinding)
    || typeof payload.kind !== "string" || typeof payload.stageKey !== "string") return undefined;
  const expected = buildStageEvidenceBinding(room, { kind: payload.kind, stageKey: payload.stageKey });
  const saved = payload.sourceBinding;
  if (!expected || saved.version !== 1 || saved.capsuleId !== expected.capsuleId
    || typeof saved.repositoryFullName !== "string"
    || saved.repositoryFullName.toLowerCase() !== expected.repositoryFullName.toLowerCase()
    || typeof saved.headSha !== "string" || saved.headSha.toLowerCase() !== expected.headSha.toLowerCase()
    || saved.definitionRef !== expected.definitionRef || saved.stageKey !== expected.stageKey
    || saved.evidenceKind !== expected.evidenceKind) return undefined;
  return { definitionRef: expected.definitionRef, stageKey: expected.stageKey,
    evidenceKind: expected.evidenceKind, relationship: "required-evidence" };
}
