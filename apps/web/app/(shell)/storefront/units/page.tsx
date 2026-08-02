import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { UnitsManager } from "@/components/storefront-admin/UnitsManager";
import { listOwnerMedia } from "@/lib/media";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";
import {
  parseRentalPhysicalProfile,
  readRentalPoolCapacity,
} from "@/lib/storefront/rental-physical-profile";
import { resolveRentalStorefront } from "@/lib/storefront/rental-scope.server";

export default async function UnitsPage() {
  const scope = await resolveRentalStorefront();
  if (!scope) redirect("/storefront/setup");
  const config = await prisma.storefrontConfig.findUnique({
    where: { id: scope.id },
    select: { id: true, archetype: { select: { archetypeId: true, category: true, customVocabulary: true } } },
  });
  if (!config) redirect("/storefront/setup");

  // A capacity archetype (Restaurant FLOOR) manages its bookable resources as
  // tables, not rental classes. Send it to Tables & Capacity so a restaurant
  // owner never meets cross-archetype rental vocabulary (BI-7C95A586).
  const resourceVocab = resolveResourceVocabulary({
    archetypeId: config.archetype?.archetypeId,
    teamLabel: getVocabulary(config.archetype?.category, config.archetype?.customVocabulary as Record<string, string> | null).teamLabel,
  });
  if (resourceVocab.hasCapacityResources) redirect("/storefront/tables");

  const classes = await prisma.storefrontItem.findMany({
    where: { storefrontId: config.id, ctaType: "rental", isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, bookingConfig: true },
  });
  const rentalClasses = classes.map((item) => ({
    id: item.id,
    name: item.name,
    poolCapacity: readRentalPoolCapacity(item.bookingConfig),
  }));

  const units = await prisma.rentableUnit.findMany({
    where: { storefrontId: config.id },
    orderBy: [{ storefrontItemId: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      unitId: true,
      storefrontItemId: true,
      label: true,
      unitRef: true,
      status: true,
      attributes: true,
    },
  });

  const withMedia = await Promise.all(
    units.map(async (u) => ({
      ...u,
      physicalProfile: parseRentalPhysicalProfile(u.attributes),
      media: await listOwnerMedia("RentableUnit", u.id, "equipment"),
    })),
  );

  return <UnitsManager archetypeId={scope.archetypeId} classes={rentalClasses} units={withMedia} />;
}
