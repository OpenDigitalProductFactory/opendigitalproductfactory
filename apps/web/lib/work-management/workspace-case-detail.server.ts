import { loadWorkroomFailedHandoffRecovery } from "@/lib/work-capsules/workroom-failed-handoff-recovery.server";
import { prisma } from "@dpf/db";
import type { DpfSession } from "@/lib/govern/auth";
import { getGrantedCapabilities } from "@/lib/permissions";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { loadPrismaWorkroomParticipants } from "./room-participation-prisma.server";
import { loadWorkroomPostureContext } from "./room-posture.server";
import { resolveWorkroomStructureForCase } from "./room-structure.server";
import { decodeWorkCaseKey } from "./case-key";
import { loadWorkspaceWorkCaseDetail, type WorkspaceCasePrismaClient } from "./workspace-case-loader";
import { resolveHumanWorkroomAccess } from "./workroom-agent-access.server";
import { loadWorkroomOnlyCaseDetail } from "./workroom-only-case-projection";
import { loadWorkroomFlowMap } from "./workroom-flow-map.server";
import { projectRoomShape } from "./shape-projection";
import { createWorkroomProcessSnapshot, normalizeProcessCaseKey, type WorkroomRefreshTarget } from "./workroom-process-snapshot";

export type AuthorizedCaseInput = { caseKey: string; selectedWorkroomId?: string; user: DpfSession["user"] };
type DetailOptions = Parameters<typeof loadWorkspaceWorkCaseDetail>[0];
type Dependencies = Pick<DetailOptions, "prismaClient" | "participantLoader" | "structureLoader" | "postureContextLoader">;
const defaults: Dependencies = { prismaClient: prisma, participantLoader: loadPrismaWorkroomParticipants,
  structureLoader: resolveWorkroomStructureForCase, postureContextLoader: loadWorkroomPostureContext };

/** Page and manual JSON reads share identity, content policy and selected-room resolution. */
export async function loadAuthorizedWorkspaceCase(input: AuthorizedCaseInput, dependencies: Dependencies = defaults) {
  const caseKey = normalizeProcessCaseKey(input.caseKey);
  if (!caseKey || input.selectedWorkroomId === "") return null;
  const ref = decodeWorkCaseKey(caseKey)!;
  if (ref.sourceType === "work-capsule" && input.selectedWorkroomId && ref.sourceId !== input.selectedWorkroomId) return null;
  const effectiveAuth = await loadEffectiveAuthContext({ user: input.user,
    grantedCapabilities: getGrantedCapabilities({ platformRole: input.user.platformRole, isSuperuser: input.user.isSuperuser }),
    authentication: { source: "session" } });
  const authContext = { principalId: effectiveAuth.principalId, sensitivityClearance: effectiveAuth.sensitivityClearance,
    isSuperuser: effectiveAuth.isSuperuser };
  // A case assignment grants no access to a room's separate recorded explanation.
  // Keep this session-bound canonical decision available to other room content readers.
  const canReadWorkroomContent = async (workroomRowId: string) =>
    (await resolveHumanWorkroomAccess({ userId: input.user.id, workroomId: workroomRowId,
      requested: "content" }, dependencies.prismaClient as never)).decision.level === "content";
  const handoffRecoveryLoader = async (workroomRowId: string, now: Date) => {
    const recovery = await loadWorkroomFailedHandoffRecovery({ userId: input.user.id, workroomRowId, context: undefined, now }, dependencies.prismaClient as never);
    return recovery ? { ...recovery, action: null } : null;
  };
  const detail = await loadWorkspaceWorkCaseDetail({ ...dependencies, caseKey, selectedWorkroomId: input.selectedWorkroomId,
    userId: input.user.id, authContext, canReadWorkroomContent, handoffRecoveryLoader }) ?? (ref.sourceType === "work-capsule" ? await loadWorkroomOnlyCaseDetail({
      prismaClient: dependencies.prismaClient as never, sourceId: ref.sourceId, caseKey, now: new Date(), authContext, canReadWorkroomContent, handoffRecoveryLoader,
    }) : null);
  if (!detail) return null;
  // Canonical identity is disclosed only after the addressed case passed content authorization.
  const canonicalCaseKey = normalizeProcessCaseKey(encodeURIComponent(detail.summary.caseId));
  if (!canonicalCaseKey) return null;
  return { detail, caseKey, canonicalCaseKey };
}

/** The expected row is a consistency check, never an independent lookup authority. */
export async function loadAuthorizedWorkroomProcess(input: AuthorizedCaseInput & { workroomRowId: string | null }) {
  const resolved = await loadAuthorizedWorkspaceCase(input);
  if (!resolved) return { status: "not-found" as const };
  const { detail, caseKey, canonicalCaseKey } = resolved;
  if (canonicalCaseKey !== caseKey || !detail.room || (detail.workroomRowId ?? null) !== input.workroomRowId)
    return { status: "changed" as const };
  let failed = false;
  const map = detail.workroomRowId ? await loadWorkroomFlowMap(prisma as never, { roomRowId: detail.workroomRowId }).catch(() => { failed = true; return null; }) : null;
  const target: WorkroomRefreshTarget = { caseKey, workroomRowId: detail.workroomRowId ?? null, workroom: input.selectedWorkroomId ?? null };
  return { status: "ok" as const, snapshot: createWorkroomProcessSnapshot(target, projectRoomShape(detail.room),
    { definition: detail.room.identity.definition, mode: detail.room.mode, activeCycle: Boolean(detail.room.currentCycle) }, map, failed) };
}
