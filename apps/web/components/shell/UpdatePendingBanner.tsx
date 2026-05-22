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
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        padding: "6px 16px",
        background: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
        borderBottom: "1px solid color-mix(in srgb, var(--dpf-accent) 30%, transparent)",
        fontSize: 12,
        lineHeight: 1.4,
        color: "var(--dpf-accent)",
        overflowWrap: "anywhere",
      }}
    >
      <span style={{ minWidth: 0 }}>
        Platform update v{config.pendingVersion} is ready. Your customisations are preserved.{" "}
        <Link
          href="/admin/platform-development"
          style={{ color: "var(--dpf-accent)", textDecoration: "underline", overflowWrap: "anywhere" }}
        >
          Review in Admin &rarr; Platform Development
        </Link>
      </span>
    </div>
  );
}
