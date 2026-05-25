import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { UpdatePendingBannerClient } from "./UpdatePendingBannerClient";

export async function UpdatePendingBanner() {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  // Only show to users with manage_platform capability (HR-000)
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    return null;
  }

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { updatePending: true, pendingVersion: true },
  });

  if (!config?.updatePending || !config.pendingVersion) return null;

  return <UpdatePendingBannerClient pendingVersion={config.pendingVersion} />;
}
