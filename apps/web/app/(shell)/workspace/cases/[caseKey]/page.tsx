import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

import { WorkCaseDetailView } from "@/components/workspace/WorkCaseDetailView";
import { auth } from "@/lib/auth";
import { getGrantedCapabilities } from "@/lib/permissions";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { loadPrismaWorkRoomParticipants } from "@/lib/work-management/room-participation-prisma.server";
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
  const detail = await loadWorkspaceWorkCaseDetail({
    prismaClient: prisma,
    caseKey,
    userId: session.user.id,
    authContext: {
      principalId: effectiveAuth.principalId,
      sensitivityClearance: effectiveAuth.sensitivityClearance,
      isSuperuser: effectiveAuth.isSuperuser,
    },
    participantLoader: loadPrismaWorkRoomParticipants,
  });
  if (!detail) notFound();

  return <WorkCaseDetailView detail={detail} />;
}
