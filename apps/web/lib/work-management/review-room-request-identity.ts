import type { PrismaClient } from "@dpf/db";
import { isSemanticReviewRequestRoleBinding } from "@/lib/change-review/semantic-review-request";
import { CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION, LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION } from "@/lib/change-review/semantic-change-review";
import { parseInitiativeReviewBinding, immutableArtifactIdentity } from "@/lib/mcp-task-review-contract";
import { INITIATIVE_READINESS_LANES } from "@/lib/tak/initiative-readiness-tool-grants";
import type { ReviewerRoomCandidate } from "./review-room-candidates";

export type RequestIdentity = {
  rowId: string; capsuleId: string; sourceHeadSha: string | null; currentHeadSha: string | null;
  requesterAgentId?: string | null;
  issuedAt: string | null; requestBound: boolean;
  receiptId?: string | null; receiptDecision?: string | null; receiptSummary?: string | null;
  receiptCreatedAt?: Date | null;
};
type RequestIdentityRow = RequestIdentity & {
  requestSchemaVersion: unknown; requestArtifactType: unknown;
  identityArtifactType: unknown; identityArtifactTypePresent: boolean;
};

/** Project small identity fields, never the potentially multi-megabyte review prompt. */
export async function loadRequestIdentities(db: Partial<Pick<PrismaClient, "$queryRaw">>, rows: Array<{ id: string }>): Promise<RequestIdentity[]> {
  if (!rows.length || !db.$queryRaw) return [];
  const identities = await db.$queryRaw<RequestIdentityRow[]>`
    SELECT t.id AS "rowId", w."capsuleId", w."headSha" AS "currentHeadSha",
      CASE WHEN length(a.parts #>> '{0,data,actor,agentId}') BETWEEN 1 AND 256
        THEN a.parts #>> '{0,data,actor,agentId}' END AS "requesterAgentId",
      e.id AS "receiptId", e.details #>> '{result,decision}' AS "receiptDecision",
      e."createdAt" AS "receiptCreatedAt",
      LEFT(e.details #>> '{result,summary}', 1200) AS "receiptSummary",
      a.parts #>> '{0,data,input,identity,sourceHeadSha}' AS "sourceHeadSha",
      a.parts #>> '{0,data,issuedAt}' AS "issuedAt",
      CASE WHEN jsonb_typeof(a.parts #> '{0,data,schemaVersion}') = 'number'
        AND length(a.parts #>> '{0,data,schemaVersion}') <= 3
        THEN a.parts #> '{0,data,schemaVersion}' END AS "requestSchemaVersion",
      LEFT(a.parts #>> '{0,data,input,artifactType}', 257) AS "requestArtifactType",
      CASE WHEN jsonb_typeof(a.parts #> '{0,data,input,identity,artifactType}') = 'string'
        THEN LEFT(a.parts #>> '{0,data,input,identity,artifactType}', 257) END AS "identityArtifactType",
      COALESCE((a.parts #> '{0,data,input,identity}') ? 'artifactType', false) AS "identityArtifactTypePresent",
      COALESCE(a.parts #>> '{0,data,actor,userId}' = t."userId"
        AND lower(a.parts #>> '{0,data,repository}') = lower(w."repositoryFullName")
        AND a.parts #>> '{0,data,input,identity,capsuleId}' = w."capsuleId"
        AND a.parts #>> '{0,data,gateKey}' = t."a2aMetadata"->>'gateKey'
        AND a.parts #>> '{0,data,digest}' = t."progressPayload" #>> '{semanticReview,requestDigest}', false) AS "requestBound"
    FROM "TaskRun" t
    LEFT JOIN "WorkCapsule" w ON w."capsuleId" = t."a2aMetadata"->>'capsuleId'
    LEFT JOIN "TaskArtifact" a ON a."taskRunId" = t.id
      AND a."artifactId" = 'semantic-review-request:' || t."taskRunId"
    LEFT JOIN "ExternalEvidenceRecord" e ON e.id = t."progressPayload"->>'evidenceRecordId'
      AND e."taskRunId" = t."taskRunId" AND e."workCapsuleId" = w.id AND e."actorUserId" = t."userId"
      AND e."operationType" = 'semantic-change-review.receipt'
      AND ((e.details->>'schemaVersion' = ${LEGACY_CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION}
          AND NOT (e.details ? 'artifactType') AND NOT ((a.parts #> '{0,data,input,identity}') ? 'artifactType'))
        OR (e.details->>'schemaVersion' = ${CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION}
          AND e.details->>'artifactType' = a.parts #>> '{0,data,input,identity,artifactType}'))
      AND e.details->>'sourceHeadSha' = a.parts #>> '{0,data,input,identity,sourceHeadSha}'
      AND e.details->>'headTreeHash' = a.parts #>> '{0,data,input,identity,headTreeHash}'
      AND e.details->>'diffDigest' = a.parts #>> '{0,data,input,identity,diffDigest}'
      AND e.details->>'policyVersion' = a.parts #>> '{0,data,input,identity,policyVersion}'
      AND e.details->>'reviewerVersion' = a.parts #>> '{0,data,input,identity,reviewerVersion}'
    WHERE t.id = ANY(${rows.map(row => row.id)}::text[])
  `.catch(() => []);
  return identities.map(identity => ({ ...identity, requestBound: identity.requestBound
    && isSemanticReviewRequestRoleBinding(identity.requestSchemaVersion, identity.requestArtifactType,
      identity.identityArtifactTypePresent ? identity.identityArtifactType : undefined) }));
}


/** Qualify room metadata only. Full original results still enforce requester and content access. */
export function initiativeRoomIdentity(row: ReviewerRoomCandidate, now: Date) {
  const binding = parseInitiativeReviewBinding(row.initiativeBinding);
  const room = binding?.workroomRef;
  const lane = binding ? INITIATIVE_READINESS_LANES[binding.writerToolName] : null;
  const artifact = binding ? immutableArtifactIdentity(binding.artifactRef) : null;
  const qualified = !!binding && !!room && !!lane?.independent
    && lane.gates.some(gate => gate === binding.gate)
    && !row.ambiguousReviewKind && !row.bindingTruncated
    && row.metadataTrigger === "external-mcp" && !!row.userId && !!row.requesterAgentId
    && /^[a-f0-9]{64}$/i.test(row.requestDigest ?? "")
    && room.workroomId === row.capsuleId && binding.itemId === row.roomBacklogItemId
    && room.repositoryFullName.toLowerCase() === row.roomRepositoryFullName?.toLowerCase()
    && room.branchName === row.roomHeadBranch
    && /^[a-f0-9]{40}$/i.test(room.headSha) && /^[a-f0-9]{40}$/i.test(row.roomHeadSha ?? "")
    && Number.isFinite(row.createdAt.getTime()) && row.createdAt.getTime() <= now.getTime()
    && !!artifact && artifact.version.length <= 256 && artifact.expectedBlobId.length <= 256
    && (binding.artifactRef.kind !== "repo-blob-at-commit"
      || /^[a-f0-9]{40}$/i.test(binding.artifactRef.commitSha));
  return {
    rowId: row.id, capsuleId: row.capsuleId, requestBound: qualified,
    sourceHeadSha: qualified ? room!.headSha : null, currentHeadSha: row.roomHeadSha,
    issuedAt: qualified ? row.createdAt.toISOString() : null,
    requesterAgentId: qualified ? row.requesterAgentId : null,
    reviewGate: qualified ? binding!.gate : null,
    artifactVersion: qualified ? artifact!.version : null,
    requestDigest: qualified ? row.requestDigest : null,
  };
}
