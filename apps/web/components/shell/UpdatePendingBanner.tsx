import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import Link from "next/link";

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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 16px",
        background: "rgba(124, 140, 248, 0.15)",
        borderBottom: "1px solid rgba(124, 140, 248, 0.3)",
        fontSize: 12,
        color: "#b0b8ff",
      }}
    >
      <span>
        Platform update v{config.pendingVersion} is ready. Your customisations are preserved.{" "}
        <Link
          href="/admin/platform-development"
          style={{ color: "#b0b8ff", textDecoration: "underline" }}
        >
          Review in Admin &rarr; Platform Development
        </Link>
      </span>
    </div>
  );
}
