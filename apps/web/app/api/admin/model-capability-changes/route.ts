import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const providerId = searchParams.get("providerId");
  const rawLimit = parseInt(searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Number.isNaN(rawLimit) ? 50 : rawLimit, 200);

  const changes = await prisma.modelCapabilityChangeLog.findMany({
    where: providerId ? { providerId } : undefined,
    orderBy: { changedAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ changes });
}
