import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { TeamManager } from "@/components/storefront-admin/TeamManager";

export default async function TeamPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      providers: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          services: {
            include: {
              item: { select: { id: true, name: true, ctaType: true } },
            },
          },
          availability: { orderBy: { createdAt: "asc" } },
        },
      },
      items: {
        where: { isActive: true },
        select: { id: true, name: true, ctaType: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!config) {
    return (
      <div style={{ color: "var(--dpf-muted)", fontSize: 14 }}>
        No storefront configured. <a href="/admin/storefront/setup" style={{ color: "var(--dpf-accent)" }}>Set one up</a>.
      </div>
    );
  }

  // Serialize dates for client components
  const providers = config.providers.map((p) => ({
    ...p,
    createdAt: undefined,
    updatedAt: undefined,
    availability: p.availability.map((a) => ({
      id: a.id,
      days: a.days,
      startTime: a.startTime,
      endTime: a.endTime,
      date: a.date ? a.date.toISOString() : null,
      isBlocked: a.isBlocked,
      reason: a.reason,
    })),
  }));

  return (
    <TeamManager
      providers={providers}
      storefrontId={config.id}
      items={config.items}
    />
  );
}
