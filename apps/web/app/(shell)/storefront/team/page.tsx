import Link from "next/link";
import { prisma } from "@dpf/db";
import { TeamManager } from "@/components/storefront-admin/TeamManager";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";

export default async function TeamPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      archetype: { select: { archetypeId: true, category: true, customVocabulary: true } },
      providers: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          services: {
            include: {
              item: { select: { id: true, name: true, ctaType: true } },
            },
          },
          availability: { orderBy: { createdAt: "asc" } },
          hospitalityResource: { select: { id: true } },
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

  const vocabulary = getVocabulary(
    config.archetype.category,
    config.archetype.customVocabulary as Record<string, string> | null,
  );
  const resourceVocab = resolveResourceVocabulary({
    archetypeId: config.archetype.archetypeId,
    teamLabel: vocabulary.teamLabel,
  });

  // For a capacity archetype (Restaurant FLOOR), physical tables are managed on
  // the dedicated Tables & Capacity surface — the Team page is people only, so
  // tables never appear here under "Staff" as "providers" (BI-7C95A586).
  const staff = resourceVocab.hasCapacityResources
    ? providers.filter((provider) => provider.hospitalityResource == null)
    : providers;

  return (
    <div>
      {resourceVocab.hasCapacityResources && (
        <p className="text-[var(--dpf-muted)]" style={{ fontSize: 13, marginBottom: 12 }}>
          People who work here. Manage {resourceVocab.resourcePlural} on the{" "}
          <Link href="/storefront/tables" style={{ color: "var(--dpf-accent)" }}>
            {resourceVocab.resourceLabel}
          </Link>{" "}
          page.
        </p>
      )}
      <TeamManager
        providers={staff}
        storefrontId={config.id}
        items={config.items}
        teamLabel={resourceVocab.staffLabel}
      />
    </div>
  );
}
