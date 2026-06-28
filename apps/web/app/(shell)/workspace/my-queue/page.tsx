import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { WorkCaseAttentionLens } from "@/components/workspace/WorkCaseAttentionLens";
import { loadWorkspaceWorkCaseLens } from "@/lib/work-management/workspace-case-loader";

export default async function MyQueuePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const view = await loadWorkspaceWorkCaseLens({
    prismaClient: prisma,
    userId: session.user.id,
  });

  return <WorkCaseAttentionLens view={view} />;
}
