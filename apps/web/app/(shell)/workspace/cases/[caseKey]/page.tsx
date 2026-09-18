import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

import { RoomWorkforcePanel } from "@/components/workspace/workroom/RoomWorkforcePanel";
import { WorkCaseDetailView } from "@/components/workspace/WorkCaseDetailView";
import { auth } from "@/lib/auth";
import { getGrantedCapabilities } from "@/lib/permissions";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { loadPrismaWorkroomParticipants } from "@/lib/work-management/room-participation-prisma.server";
import { loadWorkroomPostureContext } from "@/lib/work-management/room-posture.server";
import { resolveWorkroomStructureForCase } from "@/lib/work-management/room-structure.server";
import { decodeWorkCaseKey } from "@/lib/work-management/case-key";
import { canonicalWorkCaseHref, resolveCanonicalWorkCaseKey } from "@/lib/work-management/canonical-case-key";
import { loadRoomWorkforce } from "@/lib/work-management/room-workforce.server";
import { loadWorkspaceWorkCaseDetail } from "@/lib/work-management/workspace-case-loader";
import { loadWorkroomOnlyCaseDetail } from "@/lib/work-management/workroom-only-case-projection";

type Props = {
  params: Promise<{ caseKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WorkspaceCaseDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const effectiveAuth = await loadEffectiveAuthContext({
    user: session.user,
    grantedCapabilities: getGrantedCapabilities({
      platformRole: session.user.platformRole,
      isSuperuser: session.user.isSuperuser,
    }),
    authentication: { source: "session" },
  });

  const { caseKey } = await params;

  // A room addressed by capsule id is the same case as the WorkItem it anchors
  // to, not a second one. Send it to the canonical key so every surface that
  // links a room by capsule id lands on the one case (BI-EBEB77E2).
  const canonicalKey = await resolveCanonicalWorkCaseKey(prisma, caseKey);
  if (canonicalKey) redirect(canonicalWorkCaseHref(canonicalKey, await searchParams));

  const detail = await loadWorkspaceWorkCaseDetail({
    prismaClient: prisma,
    caseKey,
    userId: session.user.id,
    authContext: {
      principalId: effectiveAuth.principalId,
      sensitivityClearance: effectiveAuth.sensitivityClearance,
      isSuperuser: effectiveAuth.isSuperuser,
    },
    participantLoader: loadPrismaWorkroomParticipants,
    structureLoader: resolveWorkroomStructureForCase,
    postureContextLoader: loadWorkroomPostureContext,
  });
  // A room that anchors no WorkItem has no WorkItem case to resolve to, and the
  // loader keys on WorkItem source types — so 62% of the rooms on this install
  // 404'd when opened from the activity tree (BI-2C31C399). Such a room is its
  // own unit of work, so it is its own case. Composed here rather than inside
  // the loader, which is at its module-size ceiling and should not grow.
  const detailOrRoom =
    detail ??
    (await loadRoomOnlyCase(caseKey));
  if (!detailOrRoom) notFound();

  // The room's accountable human and its named workers, loaded here rather than
  // inside the detail loader so the panel stays independent of that projection.
  // A case is addressed either by its capsule id — how the portfolio activity
  // tree links a room — or through the WorkItem it anchors to. Resolve both,
  // capsule first, so a room reached from the tree finds its own row.
  const ref = decodeWorkCaseKey(caseKey);
  const anchoredRoom =
    ref?.sourceType === "work-capsule"
      ? await prisma.workroom.findFirst({
          where: { capsuleId: ref.sourceId },
          select: { id: true },
        })
      : detailOrRoom.workItemId
        ? await prisma.workroom.findFirst({
            where: { workItemId: detailOrRoom.workItemId },
            select: { id: true },
            orderBy: { createdAt: "asc" },
          })
        : null;
  const workforce = anchoredRoom
    ? await loadRoomWorkforce(prisma as never, { workroomId: anchoredRoom.id })
    : null;

  return (
    <>
      <WorkCaseDetailView detail={detailOrRoom} />
      {workforce ? (
        <div className="mt-4">
          <RoomWorkforcePanel
            accountability={workforce.accountability}
            accountableDisplayName={workforce.accountableDisplayName}
            groups={workforce.groups}
            matched={workforce.matched}
            partial={workforce.partial}
          />
        </div>
      ) : null}
    </>
  );
}

/** The case for a Workroom addressed by capsule id that anchors no WorkItem. */
async function loadRoomOnlyCase(caseKey: string) {
  const ref = decodeWorkCaseKey(caseKey);
  if (ref?.sourceType !== "work-capsule") return null;
  return loadWorkroomOnlyCaseDetail({
    prismaClient: prisma as never,
    sourceId: ref.sourceId,
    caseKey,
    now: new Date(),
  });
}
