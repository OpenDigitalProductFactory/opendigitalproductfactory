import type { prisma } from "@dpf/db";

import type { AttentionItem } from "../types";

type Db = typeof prisma;

type BlockedResource = {
  id: string;
  resourceId: string;
  label: string;
  blockedReason: string | null;
  updatedAt: Date;
};

type CapacityAllocation = {
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  lifecycle: string;
};

type CapacityPool = {
  id: string;
  poolId: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  intervalMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
  allocations: CapacityAllocation[];
};

type QuarantinedAllocation = {
  id: string;
  allocationId: string;
  demandType: string;
  demandRef: string;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  createdAt: Date;
  resource: { label: string } | null;
  pool: { label: string } | null;
};

export interface HospitalityCapacityAttentionInput {
  archetypeCategory: string | null;
  blockedResources: BlockedResource[];
  quarantinedAllocations: QuarantinedAllocation[];
  pools: CapacityPool[];
}

function common(input: {
  id: string;
  title: string;
  context: string;
  riskClass: AttentionItem["riskClass"];
  timeToAct: AttentionItem["triage"]["timeToAct"];
  residueReason: AttentionItem["triage"]["residueReason"];
  blastRadius: string;
  createdAt: Date;
  deepLink: string;
}): AttentionItem {
  return {
    id: input.id,
    source: "hospitality-capacity",
    title: input.title,
    context: input.context,
    decisionClass: { scorability: "unscorable" },
    riskClass: input.riskClass,
    triage: {
      timeToAct: input.timeToAct,
      residueReason: input.residueReason,
      blastRadius: input.blastRadius,
      decideEffort: input.riskClass === "read" ? "review" : "judgment",
      irreversible: false,
    },
    createdAtIso: input.createdAt.toISOString(),
    portfolio: "products-and-services-sold",
    actions: [
      {
        kind: "open-in-context",
        label: "Review capacity",
        href: input.deepLink,
      },
    ],
    deepLink: input.deepLink,
    audience: { operator: true },
    technical: { ownershipDomain: "food-hospitality-capacity" },
  };
}

function peakConcurrentQuantity(
  allocations: CapacityAllocation[],
  horizonStart: Date,
  horizonEnd: Date,
): number {
  const live = allocations.filter(
    (allocation) =>
      (allocation.lifecycle === "reserved" ||
        allocation.lifecycle === "active") &&
      allocation.startsAt < horizonEnd &&
      allocation.endsAt > horizonStart,
  );
  const events = live.flatMap((allocation) => [
    { at: allocation.startsAt.getTime(), delta: allocation.quantity },
    { at: allocation.endsAt.getTime(), delta: -allocation.quantity },
  ]);
  events.sort((left, right) => left.at - right.at || left.delta - right.delta);

  let concurrent = 0;
  let peak = 0;
  for (const event of events) {
    concurrent += event.delta;
    peak = Math.max(peak, concurrent);
  }
  return peak;
}

export function projectHospitalityCapacityAttention(
  input: HospitalityCapacityAttentionInput,
  now: Date,
): AttentionItem[] {
  if (input.archetypeCategory !== "food-hospitality") return [];

  const horizonEnd = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  const blocked = input.blockedResources.map((resource) =>
    common({
      id: `hospitality-capacity:blocked:${resource.resourceId}`,
      title: `${resource.label} is blocked`,
      context:
        resource.blockedReason ??
        "This operating resource is unavailable without a recorded reason.",
      riskClass: "bounded-write",
      timeToAct: "none",
      residueReason: "input-required",
      blastRadius: `${resource.label} cannot accept demand`,
      createdAt: resource.updatedAt,
      deepLink: "/storefront/tables",
    }),
  );
  const quarantined = input.quarantinedAllocations.map((allocation) => {
    const capacityLabel =
      allocation.resource?.label ?? allocation.pool?.label ?? "Capacity";
    return common({
      id: `hospitality-capacity:quarantined:${allocation.allocationId}`,
      title: `Resolve capacity conflict: ${capacityLabel}`,
      context: `${allocation.demandType} ${allocation.demandRef} was quarantined instead of overwriting another commitment.`,
      riskClass: "high-risk",
      timeToAct: "due-today",
      residueReason: "principle-conflict",
      blastRadius: `${allocation.demandType} ${allocation.demandRef}`,
      createdAt: allocation.createdAt,
      deepLink: "/storefront/inbox",
    });
  });
  const pools = input.pools.flatMap((pool) => {
    const peak = peakConcurrentQuantity(pool.allocations, now, horizonEnd);
    if (peak > pool.capacity) {
      return [
        common({
          id: `hospitality-capacity:over-capacity:${pool.poolId}`,
          title: `${pool.label} is over capacity`,
          context: `${peak} of ${pool.capacity} ${pool.capacityUnit} are committed at once in the next 24 hours.`,
          riskClass: "high-risk",
          timeToAct: "due-today",
          residueReason: "principle-conflict",
          blastRadius: `${peak - pool.capacity} ${pool.capacityUnit} exceed available capacity`,
          createdAt: pool.updatedAt,
          deepLink: "/workspace",
        }),
      ];
    }
    if (peak === 0) {
      return [
        common({
          id: `hospitality-capacity:idle:${pool.poolId}`,
          title: `${pool.label} has idle capacity`,
          context: `${pool.capacity} ${pool.capacityUnit} are uncommitted for the next 24 hours.`,
          riskClass: "read",
          timeToAct: "none",
          residueReason: "input-required",
          blastRadius: `${pool.label} demand and staffing plan`,
          createdAt: pool.updatedAt,
          deepLink: "/workspace",
        }),
      ];
    }
    return [];
  });
  return [...quarantined, ...blocked, ...pools];
}

/** Read-only adapter over the Food & Hospitality capacity truth. */
export async function loadHospitalityCapacityAttentionItems(
  db: Db,
): Promise<AttentionItem[]> {
  const config = await db.storefrontConfig.findFirst({
    select: {
      id: true,
      archetype: { select: { category: true } },
    },
  });
  if (!config || config.archetype.category !== "food-hospitality") return [];

  const now = new Date();
  const horizonEnd = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
  const [blockedResources, quarantinedAllocations, pools] = await Promise.all([
    db.hospitalityResource.findMany({
      where: { storefrontId: config.id, status: "blocked" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        resourceId: true,
        label: true,
        blockedReason: true,
        updatedAt: true,
      },
    }),
    db.hospitalityCapacityAllocation.findMany({
      where: {
        storefrontId: config.id,
        OR: [
          { lifecycle: "quarantined" },
          { conflictQuarantinedAt: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        allocationId: true,
        demandType: true,
        demandRef: true,
        startsAt: true,
        endsAt: true,
        quantity: true,
        createdAt: true,
        resource: { select: { label: true } },
        pool: { select: { label: true } },
      },
    }),
    db.hospitalityCapacityPool.findMany({
      where: { storefrontId: config.id, status: "active" },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        poolId: true,
        label: true,
        capacity: true,
        capacityUnit: true,
        intervalMinutes: true,
        createdAt: true,
        updatedAt: true,
        allocations: {
          where: {
            lifecycle: { in: ["reserved", "active"] },
            startsAt: { lt: horizonEnd },
            endsAt: { gt: now },
          },
          select: {
            startsAt: true,
            endsAt: true,
            quantity: true,
            lifecycle: true,
          },
        },
      },
    }),
  ]);

  return projectHospitalityCapacityAttention(
    {
      archetypeCategory: config.archetype.category,
      blockedResources,
      quarantinedAllocations,
      pools,
    },
    now,
  );
}
