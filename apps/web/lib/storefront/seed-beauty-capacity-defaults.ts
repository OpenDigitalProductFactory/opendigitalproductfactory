import { newId } from "@/lib/shared/new-id";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

type ItemRow = { id: string; name: string };
type ResourceRow = { id: string };

interface BeautySeedDb {
  storefrontItem: {
    findMany(args: unknown): Promise<ItemRow[]>;
  };
  beautyResource: {
    count(args: unknown): Promise<number>;
    upsert(args: unknown): Promise<ResourceRow>;
  };
  beautyResourceService: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
  beautyResourceAvailability: {
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<unknown>;
  };
}
interface ResourceSeed {
  resourceId: string;
  kind: "chair" | "station" | "room";
  label: string;
  capacityUnit: string;
  serviceNames?: string[];
}

const BEAUTY_RESOURCE_SEEDS: Record<string, ResourceSeed[]> = {
  "hair-salon": Array.from({ length: 4 }, (_, index) => ({
    resourceId: `chair-${index + 1}`,
    kind: "chair",
    label: `Chair ${index + 1}`,
    capacityUnit: "appointments",
  })),
  "barber-shop": Array.from({ length: 3 }, (_, index) => ({
    resourceId: `barber-chair-${index + 1}`,
    kind: "chair",
    label: `Barber Chair ${index + 1}`,
    capacityUnit: "appointments",
  })),
  "nail-salon": [
    ...Array.from({ length: 3 }, (_, index) => ({
      resourceId: `nail-station-${index + 1}`,
      kind: "station" as const,
      label: `Nail Station ${index + 1}`,
      capacityUnit: "appointments",
      serviceNames: ["Manicure", "Gel Nails", "Nail Art", "Acrylic Nails", "Nail Removal"],
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      resourceId: `pedicure-station-${index + 1}`,
      kind: "station" as const,
      label: `Pedicure Station ${index + 1}`,
      capacityUnit: "appointments",
      serviceNames: ["Pedicure"],
    })),
  ],
  "beauty-spa": Array.from({ length: 3 }, (_, index) => ({
    resourceId: `treatment-room-${index + 1}`,
    kind: "room",
    label: `Treatment Room ${index + 1}`,
    capacityUnit: "appointments",
  })),
};

/**
 * Prime a fixed-premises beauty business with a small, editable resource set.
 * Existing resources and their availability are preserved; reset/setup merely
 * relinks the current service records to the stable resource identities.
 */
export async function seedBeautyCapacityDefaults(
  dbClient: unknown,
  input: { organizationId: string; storefrontId: string; archetypeId: string },
): Promise<boolean> {
  const db = dbClient as BeautySeedDb;
  const seeds = BEAUTY_RESOURCE_SEEDS[input.archetypeId];
  if (!seeds) return false;

  const archetype = ALL_ARCHETYPES.find((item) => item.archetypeId === input.archetypeId);
  if (!archetype) return false;
  const items = await db.storefrontItem.findMany({
    where: { storefrontId: input.storefrontId, ctaType: "booking", isActive: true },
    select: { id: true, name: true },
  });
  const defaults = archetype.schedulingDefaults;

  for (const seed of seeds) {
    const resource = await db.beautyResource.upsert({
      where: {
        storefrontId_resourceId: {
          storefrontId: input.storefrontId,
          resourceId: seed.resourceId,
        },
      },
      create: {
        id: `beauty_${newId(12)}`,
        resourceId: seed.resourceId,
        organizationId: input.organizationId,
        storefrontId: input.storefrontId,
        kind: seed.kind,
        label: seed.label,
        capacity: 1,
        capacityUnit: seed.capacityUnit,
        status: "active",
      },
      update: {},
      select: { id: true },
    });
    const eligible = seed.serviceNames
      ? items.filter((item) => seed.serviceNames?.includes(item.name))
      : items;
    if (eligible.length > 0) {
      await db.beautyResourceService.createMany({
        data: eligible.map((item) => ({
          storefrontId: input.storefrontId,
          resourceId: resource.id,
          itemId: item.id,
        })),
        skipDuplicates: true,
      });
    }

    const availabilityCount = await db.beautyResourceAvailability.count({
      where: { resourceId: resource.id },
    });
    if (availabilityCount === 0 && defaults) {
      const grouped = new Map<string, number[]>();
      for (const hours of defaults.defaultOperatingHours) {
        const key = `${hours.start}-${hours.end}`;
        const days = grouped.get(key) ?? [];
        days.push(hours.day);
        grouped.set(key, days);
      }
      for (const [key, days] of grouped) {
        const [startTime = "09:00", endTime = "17:00"] = key.split("-");
        await db.beautyResourceAvailability.create({
          data: {
            availabilityId: `BRA-${newId(12).toUpperCase()}`,
            organizationId: input.organizationId,
            resourceId: resource.id,
            kind: "available",
            days,
            startTime,
            endTime,
          },
        });
      }
    }
  }

  return true;
}
