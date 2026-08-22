import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { completeSetupStepFromEvidence } from "@/lib/onboarding/setup-progress-service.server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, isPublished } = (await req.json()) as { id: string; isPublished: boolean };
  const storefront = await prisma.storefrontConfig.update({
    where: { id },
    data: { isPublished },
    select: { organizationId: true },
  });
  if (isPublished) {
    await completeSetupStepFromEvidence(storefront.organizationId, "storefront");
  }
  return NextResponse.json({ success: true });
}
