import type { PrismaClient } from "@dpf/db";

export type ReviewRoomCandidateClient = Partial<Pick<PrismaClient, "$queryRaw">>;
export type ReviewerRoomCandidate = {
  id: string; taskRunId: string; userId: string | null; status: string;
  createdAt: Date; updatedAt: Date; lastHeartbeatAt: Date | null;
  capsuleId: string; reviewKind: "semantic-review" | "initiative-review";
  ambiguousReviewKind: boolean; progressPayload: unknown; progressTruncated: boolean;
  user: { employeeProfile: { displayName: string } | null } | null;
  nodes: Array<{ id: string; taskNodeId: string; title: string; status: string; updatedAt: Date;
    requestContract: { agentId: string | null } }>;
  nodesTruncated: boolean; initiativeBinding: unknown; bindingTruncated: boolean;
  requestDigest: string | null; requesterAgentId: string | null; metadataTrigger: string | null;
  roomRepositoryFullName: string | null; roomHeadBranch: string | null;
  roomHeadSha: string | null; roomBacklogItemId: string | null;
};
type CandidateRow = Omit<ReviewerRoomCandidate, "nodes" | "nodesTruncated"> & {
  candidatePosition: number | bigint; roomMissing: boolean; scalarTruncated: boolean; nodeFieldsTruncated: boolean;
  nodes: Array<Omit<ReviewerRoomCandidate["nodes"][number], "updatedAt"> & { updatedAt: string }> | null;
};

/**
 * Discover existing review runs for already-authorized rooms. This is not identity
 * qualification, a verdict, or recovery authority. A lane's 21st row proves the
 * displayed history is incomplete; one busy room cannot consume another's bound.
 */
export async function loadReviewRoomCandidates(db: ReviewRoomCandidateClient, capsuleIds: string[]) {
  const partialRooms = new Set<string>();
  const uniqueRooms = [...new Set(capsuleIds)];
  const rooms: string[] = [];
  for (const room of uniqueRooms) {
    if (rooms.length < 100 && Buffer.byteLength(room, "utf8") <= 256 && room.length > 0) rooms.push(room);
    else partialRooms.add(room);
  }
  const result = (rows: ReviewerRoomCandidate[]) => ({ rows, partial: partialRooms.size > 0,
    partialCapsuleIds: [...partialRooms] });
  if (!rooms.length) return result([]);
  if (!db.$queryRaw) { for (const room of rooms) partialRooms.add(room); return result([]); }

  const candidates = await db.$queryRaw<CandidateRow[]>`
    WITH rooms AS (SELECT unnest(${rooms}::text[]) AS "capsuleId"),
    candidates AS MATERIALIZED (
      SELECT r."capsuleId", 'semantic-review'::text AS "reviewKind", t.id, t."createdAt"
      FROM rooms r CROSS JOIN LATERAL (
        SELECT t.id, t."createdAt" FROM "TaskRun" t
        WHERE t."archivedAt" IS NULL AND t."a2aMetadata"->>'gateKind' = 'semantic-review'
          AND jsonb_typeof(t."a2aMetadata"->'capsuleId') = 'string'
          AND octet_length(t."a2aMetadata"->>'capsuleId') <= 256
          AND t."a2aMetadata"->>'capsuleId' = r."capsuleId"
        ORDER BY t."createdAt" DESC, t.id DESC LIMIT 21
      ) t
      UNION ALL
      SELECT r."capsuleId", 'initiative-review'::text AS "reviewKind", t.id, t."createdAt"
      FROM rooms r CROSS JOIN LATERAL (
        SELECT t.id, t."createdAt" FROM "TaskRun" t
        WHERE t."archivedAt" IS NULL
          AND jsonb_typeof(t."a2aMetadata" #> '{initiativeReviewBinding,workroomRef,workroomId}') = 'string'
          AND octet_length(t."a2aMetadata" #>> '{initiativeReviewBinding,workroomRef,workroomId}') <= 256
          AND t."a2aMetadata" #>> '{initiativeReviewBinding,workroomRef,workroomId}' = r."capsuleId"
        ORDER BY t."createdAt" DESC, t.id DESC LIMIT 21
      ) t
    ), ranked AS (
      SELECT c.*, row_number() OVER (PARTITION BY c."capsuleId", c."reviewKind"
        ORDER BY c."createdAt" DESC, c.id DESC) AS "candidatePosition" FROM candidates c
    )
    SELECT t.id, t."taskRunId", t."userId", t.status, t."createdAt", t."updatedAt", t."lastHeartbeatAt",
      c."capsuleId", c."reviewKind", c."candidatePosition", w.id IS NULL AS "roomMissing",
      COALESCE(t."a2aMetadata"->>'gateKind' = 'semantic-review'
        AND t."a2aMetadata" #> '{initiativeReviewBinding,workroomRef,workroomId}' IS NOT NULL, false) AS "ambiguousReviewKind",
      CASE WHEN octet_length((t."a2aMetadata"->'initiativeReviewBinding')::text) <= 32768
        THEN t."a2aMetadata"->'initiativeReviewBinding' END AS "initiativeBinding",
      COALESCE(octet_length((t."a2aMetadata"->'initiativeReviewBinding')::text) > 32768, false) AS "bindingTruncated",
      CASE WHEN jsonb_typeof(t."a2aMetadata"->'requestDigest') = 'string'
        AND octet_length(t."a2aMetadata"->>'requestDigest') <= 256 THEN t."a2aMetadata"->>'requestDigest' END AS "requestDigest",
      CASE WHEN jsonb_typeof(t."a2aMetadata"->'trigger') = 'string'
        AND octet_length(t."a2aMetadata"->>'trigger') <= 128 THEN t."a2aMetadata"->>'trigger' END AS "metadataTrigger",
      CASE WHEN octet_length(original_token."agentId") <= 256 THEN original_token."agentId" END AS "requesterAgentId",
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('employeeProfile', jsonb_build_object('displayName', LEFT(p."displayName", 256))) END AS "user",
      CASE WHEN octet_length(w."repositoryFullName") <= 512 THEN w."repositoryFullName" END AS "roomRepositoryFullName",
      CASE WHEN octet_length(w."headBranch") <= 512 THEN w."headBranch" END AS "roomHeadBranch",
      CASE WHEN octet_length(w."headSha") <= 64 THEN w."headSha" END AS "roomHeadSha",
      COALESCE(octet_length(w."repositoryFullName") > 512 OR octet_length(w."headBranch") > 512
        OR octet_length(w."headSha") > 64, false) AS "scalarTruncated",
      COALESCE(b_semantic."itemId", b_row."itemId") AS "roomBacklogItemId",
      jsonb_build_object(
        'semanticReview', CASE WHEN octet_length((t."progressPayload"->'semanticReview')::text) <= 16384
          THEN t."progressPayload"->'semanticReview'
          WHEN t."progressPayload"->'semanticReview' IS NOT NULL THEN '{"projectionTruncated":true}'::jsonb END,
        'executionUncertainty', CASE WHEN t."progressPayload"->'executionUncertainty' IS NOT NULL
          AND t."progressPayload"->'executionUncertainty' <> 'null'::jsonb THEN '{}'::jsonb END,
        'terminalWriterWait', CASE WHEN octet_length((t."progressPayload"->'terminalWriterWait')::text) <= 4096
          THEN t."progressPayload"->'terminalWriterWait'
          WHEN t."progressPayload"->'terminalWriterWait' IS NOT NULL THEN '{"projectionTruncated":true}'::jsonb END,
        'terminalWriterDispatchFailure', CASE WHEN octet_length((t."progressPayload"->'terminalWriterDispatchFailure')::text) <= 4096
          THEN t."progressPayload"->'terminalWriterDispatchFailure'
          WHEN t."progressPayload"->'terminalWriterDispatchFailure' IS NOT NULL THEN '{"projectionTruncated":true}'::jsonb END,
        'terminalWriterEscalation', CASE WHEN octet_length((t."progressPayload"->'terminalWriterEscalation')::text) <= 4096
          THEN t."progressPayload"->'terminalWriterEscalation'
          WHEN t."progressPayload"->'terminalWriterEscalation' IS NOT NULL THEN '{"projectionTruncated":true}'::jsonb END,
        'resourceWait', CASE WHEN octet_length((t."progressPayload"->'resourceWait')::text) <= 4096
          THEN t."progressPayload"->'resourceWait'
          WHEN t."progressPayload"->'resourceWait' IS NOT NULL THEN '{"projectionTruncated":true}'::jsonb END,
        'approvalEnvelopeId', CASE WHEN jsonb_typeof(t."progressPayload"->'approvalEnvelopeId') = 'string'
          AND octet_length(t."progressPayload"->>'approvalEnvelopeId') <= 256 THEN t."progressPayload"->'approvalEnvelopeId' END,
        'requiresApproval', CASE WHEN jsonb_typeof(t."progressPayload"->'requiresApproval') = 'boolean'
          THEN t."progressPayload"->'requiresApproval' END
      ) AS "progressPayload",
      COALESCE(octet_length((t."progressPayload"->'semanticReview')::text) > 16384
        OR octet_length((t."progressPayload"->'terminalWriterWait')::text) > 4096
        OR octet_length((t."progressPayload"->'terminalWriterDispatchFailure')::text) > 4096
        OR octet_length((t."progressPayload"->'terminalWriterEscalation')::text) > 4096
        OR octet_length((t."progressPayload"->'resourceWait')::text) > 4096, false) AS "progressTruncated",
      node_snapshot.nodes, COALESCE(node_snapshot.truncated, false) AS "nodeFieldsTruncated"
    FROM ranked c JOIN "TaskRun" t ON t.id = c.id
    LEFT JOIN "WorkCapsule" w ON w."capsuleId" = c."capsuleId"
    LEFT JOIN "BacklogItem" b_semantic ON b_semantic."itemId" = w."backlogItemId"
    LEFT JOIN "BacklogItem" b_row ON b_row.id = w."backlogItemId"
    LEFT JOIN "EmployeeProfile" p ON p."userId" = t."userId"
    LEFT JOIN "McpApiToken" original_token ON original_token.id = t."a2aMetadata"->>'apiTokenId'
      AND original_token."userId" = t."userId"
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'taskNodeId', n."taskNodeId", 'title', n.title,
        'status', n.status, 'updatedAt', n."updatedAt", 'requestContract', jsonb_build_object('agentId', n."agentId"))
        ORDER BY n."updatedAt" DESC, n.id DESC) AS nodes, bool_or(n.truncated) AS truncated
      FROM (
        SELECT n.id, n."taskNodeId", LEFT(n.title, 512) AS title, n.status, n."updatedAt",
          CASE WHEN jsonb_typeof(n."requestContract"->'agentId') = 'string'
            AND octet_length(n."requestContract"->>'agentId') <= 256 THEN n."requestContract"->>'agentId' END AS "agentId",
          length(n.title) > 512 OR COALESCE(octet_length(n."requestContract"->>'agentId') > 256, false) AS truncated
        FROM "TaskNode" n WHERE n."taskRunId" = t.id
        ORDER BY n."updatedAt" DESC, n.id DESC LIMIT 13
      ) n
    ) node_snapshot ON true
    ORDER BY c."capsuleId", c."reviewKind", c."candidatePosition"
  `.catch(() => null);
  if (!candidates) { for (const room of rooms) partialRooms.add(room); return result([]); }
  const rows: ReviewerRoomCandidate[] = [];
  for (const candidate of candidates) {
    if (Number(candidate.candidatePosition) > 20) { partialRooms.add(candidate.capsuleId); continue; }
    const { candidatePosition: _position, roomMissing, scalarTruncated, nodeFieldsTruncated, ...row } = candidate;
    const nodes = row.nodes ?? [];
    const nodesTruncated = nodeFieldsTruncated || nodes.length > 12;
    if (roomMissing || scalarTruncated || row.bindingTruncated || row.progressTruncated || row.ambiguousReviewKind || nodesTruncated) partialRooms.add(row.capsuleId);
    rows.push({ ...row, nodesTruncated, nodes: nodes.map(node => ({ ...node, updatedAt: new Date(node.updatedAt) })) });
  }
  return result(rows);
}
