import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";
import { resetStorefrontArchetype } from "@/lib/storefront/archetype-reset";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user as { type?: string }).type !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { targetArchetypeId } = (await req.json()) as {
    targetArchetypeId?: string;
  };

  if (!targetArchetypeId) {
    return NextResponse.json({ error: "targetArchetypeId is required" }, { status: 400 });
  }

  const organization = await prisma.organization.findFirst({
    select: { id: true },
  });

  if (!organization) {
    return NextResponse.json({ error: "Organization not found" }, { status: 400 });
  }

  try {
    const result = await resetStorefrontArchetype({
      organizationId: organization.id,
      targetArchetypeId,
      mode: "replace-seeded-content",
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Archetype reset failed" },
      { status: 400 },
    );
  }
}
