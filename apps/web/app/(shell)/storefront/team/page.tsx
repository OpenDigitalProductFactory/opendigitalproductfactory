import Link from "next/link";
import { prisma } from "@dpf/db";
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
        No storefront configured.{" "}
        <Link href="/storefront/setup" style={{ color: "var(--dpf-accent)" }}>
          Set one up
        </Link>
        .
      </div>
    );
  }

  const providers = config.providers.map((provider) => ({
    ...provider,
    createdAt: undefined,
    updatedAt: undefined,
    availability: provider.availability.map((availability) => ({
      id: availability.id,
      days: availability.days,
      startTime: availability.startTime,
      endTime: availability.endTime,
      date: availability.date ? availability.date.toISOString() : null,
      isBlocked: availability.isBlocked,
      reason: availability.reason,
    })),
  }));

  return <TeamManager providers={providers} storefrontId={config.id} items={config.items} />;
}
