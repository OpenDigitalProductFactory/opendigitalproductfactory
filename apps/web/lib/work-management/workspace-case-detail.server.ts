import { prisma } from "@dpf/db";
import type { DpfSession } from "@/lib/govern/auth";
import { getGrantedCapabilities } from "@/lib/permissions";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { loadPrismaWorkroomParticipants } from "./room-participation-prisma.server";
import { loadWorkroomPostureContext } from "./room-posture.server";
import { resolveWorkroomStructureForCase } from "./room-structure.server";
import { decodeWorkCaseKey } from "./case-key";
import { loadRoomReviewSubject, type ReviewSubjectClient } from "./room-review-subject.server";
import { loadWorkspaceWorkCaseDetail, type WorkspaceCasePrismaClient } from "./workspace-case-loader";
import { loadWorkroomOnlyCaseDetail } from "./workroom-only-case-projection";
import { loadWorkroomFlowMap } from "./workroom-flow-map.server";
import { projectRoomShape } from "./shape-projection";
import { createWorkroomProcessSnapshot, normalizeProcessCaseKey, type WorkroomRefreshTarget } from "./workroom-process-snapshot";

export type AuthorizedCaseInput = { caseKey: string; selectedWorkroomId?: string; user: DpfSession["user"] };
type DetailOptions = Parameters<typeof loadWorkspaceWorkCaseDetail>[0];
type Dependencies = Pick<DetailOptions, "prismaClient" | "participantLoader" | "structureLoader" | "postureContextLoader" | "reviewSubjectLoader">;
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
  const detail = await loadWorkspaceWorkCaseDetail({ ...dependencies, caseKey, selectedWorkroomId: input.selectedWorkroomId,
    userId: input.user.id, authContext,
    reviewSubjectLoader: dependencies.reviewSubjectLoader ?? (source =>
      loadRoomReviewSubject(dependencies.prismaClient as unknown as ReviewSubjectClient, source, effectiveAuth)),
  }) ?? (ref.sourceType === "work-capsule" ? await loadWorkroomOnlyCaseDetail({
      prismaClient: dependencies.prismaClient as never, sourceId: ref.sourceId, caseKey, now: new Date(), authContext,
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
