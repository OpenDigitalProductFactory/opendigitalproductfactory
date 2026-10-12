import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { getGrantedCapabilities } from "@/lib/permissions";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { resolveInitiativeArtifact, type InitiativeArtifactResolverDb } from "@/lib/backlog/initiative-readiness/artifact-resolver";
import { describeResearchAttestation, designDocEvidencesResearch } from "./ideate-research-receipt";
import { digestBuildArtifactValue } from "./build-artifact-provenance";
import { coerceDataSensitivity } from "@dpf/db/principal-sensitivity";
import { deriveRoomTurnAuthority, roomAuthorizesTool } from "@/lib/work-management/room-turn-authority";
import { getWorkShape, readDeclaredWorkShapeKey } from "@/lib/work-management/work-shapes";

/** Canonical author fact, not approval to start work or an independent verdict. */
export type AuthorResearchPolicyBinding = {
  itemId: string; buildId: string; revisionId: string;
  valueDigest: string; contentDigest: string;
  authorUserId: string; authorPrincipalId: string; authorAgentId: string | null;
  workroomId: string; reason: string;
  authorityVersion: string | null;
  roomPolicyDigest: string;
};

export function isExactAuthorResearchParams(params: Record<string, unknown>): boolean {
  const ref = params.artifactRef;
  return params.gate === "research" && params.decision === "pass"
    && typeof params.itemId === "string" && typeof params.reason === "string"
    && Array.isArray(params.findings) && params.findings.length === 0
    && Array.isArray(params.resolvedFindingRefs) && params.resolvedFindingRefs.length === 0
    && Object.keys(params).every((key) => ["itemId", "gate", "decision", "artifactRef", "reason", "findings", "resolvedFindingRefs"].includes(key))
    && !!ref && typeof ref === "object" && !Array.isArray(ref)
    && (ref as Record<string, unknown>).kind === "feature-build-revision"
    && typeof (ref as Record<string, unknown>).revisionId === "string"
    && Object.keys(ref).every((key) => ["kind", "revisionId"].includes(key));
}

/** Resolve afresh at judgment and publication; unreadable authority proves nothing. */
export async function resolveAuthorResearchPolicyBinding(args: {
  toolName: string; params: Record<string, unknown>; userId: string; agentId: string;
  itemId: string; routeContext: string | null;
}, db: Prisma.TransactionClient = prisma): Promise<AuthorResearchPolicyBinding | null> {
  if (args.toolName !== "record_initiative_evidence" || !isExactAuthorResearchParams(args.params)
    || args.params.itemId !== args.itemId) return null;
  const match = /^\/build\/work\/(WC-[A-Z0-9]+)$/.exec(args.routeContext ?? "");
  if (!match) return null;
  try {
    const revisionId = (args.params.artifactRef as { revisionId: string }).revisionId;
    const revision = await db.buildArtifactRevision.findUnique({ where: { id: revisionId }, select: {
      id: true, value: true, valueDigest: true, savedByUserId: true,
      build: { select: { buildId: true, createdById: true } },
    } });
    if (!revision || revision.savedByUserId !== args.userId || revision.build.createdById !== args.userId
      || !designDocEvidencesResearch(revision.value)
      || args.params.reason !== describeResearchAttestation(revision.value)) return null;
    const valueDigest = `sha256:${digestBuildArtifactValue(revision.value)}`;
    if (valueDigest !== (revision.valueDigest.startsWith("sha256:") ? revision.valueDigest : `sha256:${revision.valueDigest}`)) return null;
    const room = await db.workroom.findUnique({ where: { capsuleId: match[1] }, select: {
      id: true, capsuleId: true, executorKind: true, executorRef: true, status: true,
      scopeClaims: true, participants: { where: { lifecycle: "active" }, select: { principalId: true, roles: true } },
    } });
    if (!room || room.executorKind !== "build-studio" || room.executorRef !== revision.build.buildId
      || !["working", "verifying"].includes(room.status)) return null;
    const latestRoom = await db.workroom.findFirst({ where: { executorKind: "build-studio", executorRef: revision.build.buildId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    if (latestRoom?.id !== room.id) return null;
    const human = await currentUserContext(args.userId, db);
    if (!human || !getGrantedCapabilities(human).includes("manage_backlog")) return null;
    const agent = await db.agent.findFirst({ where: { agentId: args.agentId, status: "active", archived: false },
      include: { toolGrants: true, toolGrantRevocations: true, governanceProfile: true } });
    if (!agent || coerceDataSensitivity(agent.sensitivity) !== "internal"
      || agent.governanceProfile?.hitlPolicy.trim().toLowerCase() === "always"
      || !isToolAllowedByGrants(args.toolName, agent.toolGrants
      .filter((grant) => !agent.toolGrantRevocations.some((revoked) => revoked.grantKey === grant.grantKey))
      .map((grant) => grant.grantKey))) return null;
    const access = await resolveAgentWorkroomAccess({ userId: args.userId, agentId: args.agentId,
      workroomId: room.id, requested: "action" }, db);
    if (access.decision.level !== "action") return null;
    const alias = await db.principalAlias.findFirst({ where: { aliasType: "agent", aliasValue: args.agentId, issuer: "" }, select: { principalId: true } });
    const workShapeKey = readDeclaredWorkShapeKey(room.scopeClaims);
    const surface = deriveRoomTurnAuthority({ agentGrants: agent.toolGrants
      .filter((grant) => !agent.toolGrantRevocations.some((revoked) => revoked.grantKey === grant.grantKey)).map((grant) => grant.grantKey),
      platformDefaultActionBoundary: null, room: { workroomId: room.capsuleId, collaborationShape: null,
        workShapeKey, workShapeGrants: workShapeKey ? getWorkShape(workShapeKey)?.grants ?? [] : null,
        declaredActionBoundary: null, declaredPriority: null, shapeActionBoundary: null,
        participants: room.participants.length ? room.participants : null, agentPrincipalId: alias?.principalId ?? null } });
    if (!roomAuthorizesTool(args.toolName, surface.authorizedGrants)) return null;
    const artifact = await resolveInitiativeArtifact({ locator: { kind: "feature-build-revision", revisionId },
      subject: { kind: "backlog-item", id: args.itemId }, db: db as unknown as InitiativeArtifactResolverDb,
      allowHumanResearchAuthor: true });
    if (!artifact.ok || !artifact.artifact.authorPrincipalId || artifact.artifact.digest !== valueDigest) return null;
    return { itemId: args.itemId, buildId: revision.build.buildId, revisionId, valueDigest,
      contentDigest: `sha256:${createHash("sha256").update(artifact.artifact.bytes).digest("hex")}`,
      authorUserId: args.userId, authorPrincipalId: artifact.artifact.authorPrincipalId,
      authorAgentId: artifact.artifact.authorAgentId, workroomId: room.capsuleId, reason: args.params.reason as string,
      authorityVersion: `sha256:${digestBuildArtifactValue({ sensitivity: agent.sensitivity, hitlTierDefault: agent.hitlTierDefault,
        policy: agent.governanceProfile?.hitlPolicy ?? null, updatedAt: agent.governanceProfile?.updatedAt.toISOString() ?? null })}`,
      roomPolicyDigest: `sha256:${digestBuildArtifactValue(room.scopeClaims)}` };
  } catch { return null; }
}
