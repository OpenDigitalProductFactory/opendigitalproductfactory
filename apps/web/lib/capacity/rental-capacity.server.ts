import { prisma } from "@dpf/db";
import {
  ALL_ARCHETYPES,
  deriveResourceCapacityProfile,
} from "@dpf/storefront-templates";
import { CapacityAdapterRegistry, projectCapacitySnapshot } from "./adapter-registry";
import { createRentalCapacityAdapter, type RentalCapacityDb } from "./rental-adapter";

const DAY_MS = 24 * 60 * 60 * 1_000;

export async function getRentalCapacitySnapshot(input: {
  organizationId: string;
  startAt?: Date;
  horizonDays?: number;
}) {
  const config = await prisma.storefrontConfig.findUnique({
    where: { organizationId: input.organizationId },
    select: { archetype: { select: { archetypeId: true } } },
  });
  const definition = config?.archetype
    ? ALL_ARCHETYPES.find((item) => item.archetypeId === config.archetype.archetypeId)
    : undefined;
  if (!definition) return null;

  const startAt = input.startAt ?? new Date();
  const horizonDays = Math.min(90, Math.max(1, Math.round(input.horizonDays ?? 14)));
  return projectCapacitySnapshot({
    profile: deriveResourceCapacityProfile(definition),
    organizationId: input.organizationId,
    window: {
      startAt: startAt.toISOString(),
      endAt: new Date(startAt.getTime() + horizonDays * DAY_MS).toISOString(),
    },
    registry: new CapacityAdapterRegistry([
      createRentalCapacityAdapter(prisma as unknown as RentalCapacityDb),
    ]),
  });
}
