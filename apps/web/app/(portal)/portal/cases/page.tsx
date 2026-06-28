import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";

import { PortalWorkCases } from "@/components/portal/PortalWorkCases";
import { auth } from "@/lib/auth";
import {
  loadPortalWorkCaseList,
  type PortalCasePrismaClient,
} from "@/lib/work-management/portal-case-loader";

export const dynamic = "force-dynamic";

export default async function PortalCasesPage() {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/customer-login");
  if (!session.user.accountId) redirect("/portal/account");

  const view = await loadPortalWorkCaseList({
    prismaClient: prisma as unknown as PortalCasePrismaClient,
    customerAccountId: session.user.accountId,
  });

  return <PortalWorkCases view={view} />;
}
