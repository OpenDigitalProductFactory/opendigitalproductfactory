import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

import { WorkCaseDetailView } from "@/components/workspace/WorkCaseDetailView";
import { auth } from "@/lib/auth";
import { loadWorkspaceWorkCaseDetail } from "@/lib/work-management/workspace-case-loader";

type Props = {
  params: Promise<{ caseKey: string }>;
};

export default async function WorkspaceCaseDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { caseKey } = await params;
  const detail = await loadWorkspaceWorkCaseDetail({
    prismaClient: prisma,
    caseKey,
    userId: session.user.id,
  });
  if (!detail) notFound();

  return <WorkCaseDetailView detail={detail} />;
}
