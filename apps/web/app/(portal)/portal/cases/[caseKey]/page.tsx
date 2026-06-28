import { prisma } from "@dpf/db";
import { notFound, redirect } from "next/navigation";

import { PortalWorkCaseDetail } from "@/components/portal/PortalWorkCaseDetail";
import { auth } from "@/lib/auth";
import {
  loadPortalWorkCaseDetail,
  type PortalCasePrismaClient,
} from "@/lib/work-management/portal-case-loader";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ caseKey: string }>;
};

export default async function PortalCaseDetailPage({ params }: Props) {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/customer-login");
  if (!session.user.accountId) redirect("/portal/account");

  const { caseKey } = await params;
  const view = await loadPortalWorkCaseDetail({
    prismaClient: prisma as unknown as PortalCasePrismaClient,
    customerAccountId: session.user.accountId,
    caseKey,
  });
  if (!view) notFound();

  return <PortalWorkCaseDetail view={view} />;
}
