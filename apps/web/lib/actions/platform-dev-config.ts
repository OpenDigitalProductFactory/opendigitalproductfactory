"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireManagePlatform(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const VALID_MODES = ["fork_only", "selective", "contribute_all"] as const;
type ContributionMode = (typeof VALID_MODES)[number];

export async function savePlatformDevConfig(mode: ContributionMode) {
  const userId = await requireManagePlatform();

  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid contribution mode: ${mode}`);
  }

  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: {
      contributionMode: mode,
      configuredAt: new Date(),
      configuredById: userId,
    },
    create: {
      id: "singleton",
      contributionMode: mode,
      configuredAt: new Date(),
      configuredById: userId,
    },
  });

  revalidatePath("/admin/platform-development");
}

export async function getPlatformDevConfig() {
  return prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    include: { configuredBy: { select: { email: true } } },
  });
}
