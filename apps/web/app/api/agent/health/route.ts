import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: { in: ["active", "degraded"] },
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: "llm",
      },
    },
    select: {
      providerId: true,
    },
  });

  const usableProviderIds = [...new Set(profiles.map((profile) => profile.providerId))];
  const cloudProviderIds = usableProviderIds.filter((providerId) => providerId !== "local" && providerId !== "ollama");
  const localProviderCount = usableProviderIds.filter((providerId) => providerId === "local" || providerId === "ollama").length;

  return NextResponse.json({
    usableProviderCount: usableProviderIds.length,
    cloudProviderCount: cloudProviderIds.length,
    localProviderCount,
  });
}
