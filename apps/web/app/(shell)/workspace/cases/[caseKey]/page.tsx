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
import { resolveCanonicalWorkCaseKey } from "@/lib/work-management/canonical-case-key";
import { loadRoomWorkforce } from "@/lib/work-management/room-workforce.server";
import { loadWorkspaceWorkCaseDetail } from "@/lib/work-management/workspace-case-loader";

type Props = {
  params: Promise<{ caseKey: string }>;
};

export default async function WorkspaceCaseDetailPage({ params }: Props) {
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
  if (canonicalKey) redirect(`/workspace/cases/${canonicalKey}`);

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
  if (!detail) notFound();

  // The room's accountable human and its named workers. Loaded here rather than
  // inside the detail loader so the panel stays independent of that projection,
  // and skipped entirely for a case that anchors no Workroom.
  // A case is addressed either by its capsule id — which is how the portfolio
  // activity tree links a room — or through the WorkItem it anchors to. Resolve
  // both, capsule first, so a room reached from the tree finds its own row.
  const ref = decodeWorkCaseKey(caseKey);
  const anchoredRoom =
    ref?.sourceType === "work-capsule"
      ? await prisma.workroom.findFirst({
          where: { capsuleId: ref.sourceId },
          select: { id: true },
        })
      : detail.workItemId
        ? await prisma.workroom.findFirst({
            where: { workItemId: detail.workItemId },
            select: { id: true },
            orderBy: { createdAt: "asc" },
          })
        : null;
  const workforce = anchoredRoom
    ? await loadRoomWorkforce(prisma as never, { workroomId: anchoredRoom.id })
    : null;

  return (
    <>
      <WorkCaseDetailView detail={detail} />
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
