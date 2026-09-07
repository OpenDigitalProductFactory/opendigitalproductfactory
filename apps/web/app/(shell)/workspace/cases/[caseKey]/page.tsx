import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

import { WorkCaseDetailView } from "@/components/workspace/WorkCaseDetailView";
import { auth } from "@/lib/auth";
import { getGrantedCapabilities } from "@/lib/permissions";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { loadPrismaWorkroomParticipants } from "@/lib/work-management/room-participation-prisma.server";
import { loadWorkroomPostureContext } from "@/lib/work-management/room-posture.server";
import { resolveWorkroomStructureForCase } from "@/lib/work-management/room-structure.server";
import { resolveCanonicalWorkCaseKey } from "@/lib/work-management/canonical-case-key";
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

  return <WorkCaseDetailView detail={detail} />;
}
