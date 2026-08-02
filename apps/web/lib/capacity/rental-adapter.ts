import type { Prisma } from "@dpf/db";
import {
  parseRentalPhysicalProfile,
  readRentalPoolCapacity,
  rentalLocationLabel,
  type RentalPhysicalProfile,
} from "@/lib/storefront/rental-physical-profile";
import type { CapacityAdapterLoadInput, CapacityAdapterLoadResult } from "./adapter-types";
import type { CapacityAdapter } from "./adapter-registry";
import type {
  CapacityAllocation,
  CapacityAllocationLifecycle,
  CapacityAttentionSignal,
  CapacityResource,
  CapacityResourceRef,
} from "./contracts";

export interface RentalStorefrontRow {
  id: string;
  organizationId: string;
}

export interface RentalClassRow {
  id: string;
  storefrontId: string;
  name: string;
  bookingConfig: Prisma.JsonValue | null;
}

export interface RentalUnitRow {
  id: string;
  unitId: string;
  storefrontId: string;
  storefrontItemId: string;
  label: string;
  status: string;
  attributes: Prisma.JsonValue | null;
  updatedAt: Date;
}

export interface RentalAgreementRow {
  id: string;
  agreementRef: string;
  storefrontId: string;
  storefrontItemId: string;
  rentableUnitId: string | null;
  customerName: string;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  verificationStatus: string;
  depositAmount: Prisma.Decimal | number | null;
  returnConditionId: string | null;
  overlapQuarantinedAt: Date | null;
  updatedAt: Date;
}

export interface RentalCapacityDb {
  storefrontConfig: {
    findMany(args: unknown): Promise<RentalStorefrontRow[]>;
  };
  storefrontItem: {
    findMany(args: unknown): Promise<RentalClassRow[]>;
  };
  rentableUnit: {
    findMany(args: unknown): Promise<RentalUnitRow[]>;
  };
  rentalAgreement: {
    findMany(args: unknown): Promise<RentalAgreementRow[]>;
  };
}

interface RentalAdapterOptions {
  now?: () => Date;
}

function overlaps(startAt: string, endAt: string, windowStart: string, windowEnd: string): boolean {
  return Date.parse(startAt) < Date.parse(windowEnd) && Date.parse(windowStart) < Date.parse(endAt);
}

function allocationLifecycle(status: string): CapacityAllocationLifecycle {
  switch (status) {
    case "reserved":
    case "verified":
      return "confirmed";
    case "active":
      return "active";
    case "cancelled":
      return "cancelled";
    default:
      return "released";
  }
}

function resourceType(profile: RentalPhysicalProfile): string {
  if (profile.kind === "self-storage") return "storage-unit";
  if (profile.kind === "production-kit") return "production-kit";
  return "equipment-unit";
}

function unitRef(unit: RentalUnitRow, profile: RentalPhysicalProfile): CapacityResourceRef {
  return { authority: "rental", resourceType: resourceType(profile), resourceId: unit.id };
}

function poolRef(item: RentalClassRow): CapacityResourceRef {
  return { authority: "rental", resourceType: "asset-pool", resourceId: item.id };
}

function unitStatus(
  unit: RentalUnitRow,
  profile: RentalPhysicalProfile,
  agreements: readonly RentalAgreementRow[],
  at: Date,
): CapacityResource["status"] {
  if (unit.status === "retired") return "offline";
  if (unit.status === "maintenance" || profile.readiness === "blocked") return "blocked";
  if (profile.maintenanceHold?.severity === "hard" &&
      Date.parse(profile.maintenanceHold.startAt) <= at.getTime() &&
      at.getTime() < Date.parse(profile.maintenanceHold.endAt)) return "blocked";
  if (unit.status === "reserved" || unit.status === "out" ||
      agreements.some((agreement) =>
        agreement.rentableUnitId === unit.id &&
        ["reserved", "verified", "active"].includes(agreement.status) &&
        agreement.periodStart <= at && at < agreement.periodEnd)) return "busy";
  if (unit.status === "returned" || profile.readiness !== "ready") return "blocked";
  return unit.status === "available" ? "available" : "unknown";
}

function signal(
  kind: CapacityAttentionSignal["kind"],
  id: string,
  detail: string,
  refs: Pick<CapacityAttentionSignal, "resourceRef" | "demandRef"> = {},
): CapacityAttentionSignal {
  return { signalId: `rental:${kind}:${id}`, kind, authority: "rental", detail, ...refs };
}

function unitAttention(
  unit: RentalUnitRow,
  profile: RentalPhysicalProfile,
): CapacityAttentionSignal[] {
  const ref = unitRef(unit, profile);
  const signals: CapacityAttentionSignal[] = [];
  if (profile.maintenanceHold || unit.status === "maintenance") {
    signals.push(signal(
      "maintenance-hold",
      unit.id,
      profile.maintenanceHold?.reason ?? `${unit.label} is held for maintenance.`,
      { resourceRef: ref },
    ));
  }
  if (profile.kind === "production-kit" && profile.readyItemCount < profile.requiredItemCount) {
    signals.push(signal(
      "kit-incomplete",
      unit.id,
      `${unit.label} has ${profile.readyItemCount} of ${profile.requiredItemCount} required kit items ready.`,
      { resourceRef: ref },
    ));
  }
  if (unit.status === "returned" || profile.readiness !== "ready") {
    signals.push(signal(
      "repool-not-ready",
      unit.id,
      `${unit.label} is not ready to return to the rental pool (${profile.readiness}).`,
      { resourceRef: ref },
    ));
  }
  if (profile.kind === "self-storage") {
    if (profile.occupancy === "vacant" && profile.waitlistCount > 0) {
      signals.push(signal(
        "occupancy-opportunity",
        unit.id,
        `${unit.label} is vacant while ${profile.waitlistCount} prospect(s) are waiting.`,
        { resourceRef: ref },
      ));
    }
    if (profile.waitlistCount > 0) {
      signals.push(signal(
        "waitlist-demand",
        unit.id,
        `${profile.waitlistCount} prospect(s) are waiting for ${profile.sizeLabel ?? unit.label}.`,
        { resourceRef: ref },
      ));
    }
    if (profile.accessState !== "ready") {
      signals.push(signal(
        "access-not-ready",
        unit.id,
        `${unit.label} access is ${profile.accessState}.`,
        { resourceRef: ref },
      ));
    }
  }
  return signals;
}

function agreementAttention(
  agreement: RentalAgreementRow,
  now: Date,
): CapacityAttentionSignal[] {
  const signals: CapacityAttentionSignal[] = [];
  const refs = { demandRef: agreement.agreementRef };
  if (agreement.status === "active" && agreement.periodEnd < now) {
    signals.push(signal(
      "overdue-return",
      agreement.id,
      `${agreement.agreementRef} for ${agreement.customerName} is overdue for return.`,
      refs,
    ));
  }
  if ((agreement.status === "active" && agreement.periodEnd <= now) || agreement.status === "returned") {
    if (!agreement.returnConditionId) {
      signals.push(signal(
        "return-inspection",
        agreement.id,
        `${agreement.agreementRef} needs a return inspection before re-pooling.`,
        refs,
      ));
    }
  }
  if (["reserved", "verified"].includes(agreement.status) && agreement.verificationStatus !== "verified") {
    signals.push(signal(
      "verification-gap",
      agreement.id,
      `${agreement.agreementRef} cannot check out until customer verification is complete.`,
      refs,
    ));
  }
  return signals;
}

function maxUpdatedAt(units: readonly RentalUnitRow[], agreements: readonly RentalAgreementRow[]): string | undefined {
  const timestamps = [...units.map((row) => row.updatedAt), ...agreements.map((row) => row.updatedAt)]
    .map((value) => value.getTime())
    .filter(Number.isFinite);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : undefined;
}

async function loadRentalCapacity(
  db: RentalCapacityDb,
  input: CapacityAdapterLoadInput,
  now: Date,
): Promise<CapacityAdapterLoadResult> {
  if (!input.profile.patterns.includes("rental") || !input.profile.authorities.includes("rental")) {
    return {
      authority: "rental",
      state: "unsupported",
      diagnostic: `Archetype ${input.profile.archetypeId} does not declare rental capacity`,
      resources: [], allocations: [], availability: [],
    };
  }

  const storefronts = await db.storefrontConfig.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, organizationId: true },
  });
  const storefrontIds = storefronts.map((row) => row.id);
  if (storefrontIds.length === 0) {
    return {
      authority: "rental", state: "ok", resources: [], allocations: [], availability: [],
      watermark: { source: "rental", observedAt: now.toISOString() },
    };
  }

  const [classes, units, agreements] = await Promise.all([
    db.storefrontItem.findMany({
      where: { storefrontId: { in: storefrontIds }, ctaType: "rental", isActive: true },
      select: { id: true, storefrontId: true, name: true, bookingConfig: true },
    }),
    db.rentableUnit.findMany({
      where: { storefrontId: { in: storefrontIds } },
      select: {
        id: true, unitId: true, storefrontId: true, storefrontItemId: true,
        label: true, status: true, attributes: true, updatedAt: true,
      },
    }),
    db.rentalAgreement.findMany({
      where: {
        storefrontId: { in: storefrontIds },
        overlapQuarantinedAt: null,
        OR: [
          { periodStart: { lt: new Date(input.window.endAt) }, periodEnd: { gt: new Date(input.window.startAt) } },
          { status: "active" },
          { status: "returned", returnConditionId: null },
        ],
      },
      select: {
        id: true, agreementRef: true, storefrontId: true, storefrontItemId: true,
        rentableUnitId: true, customerName: true, periodStart: true, periodEnd: true,
        status: true, verificationStatus: true, depositAmount: true,
        returnConditionId: true, overlapQuarantinedAt: true, updatedAt: true,
      },
    }),
  ]);

  const profiles = new Map(units.map((unit) => [unit.id, parseRentalPhysicalProfile(unit.attributes)]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const classesById = new Map(classes.map((item) => [item.id, item]));
  const agreementsByUnit = new Map<string, RentalAgreementRow[]>();
  for (const agreement of agreements) {
    if (!agreement.rentableUnitId) continue;
    const current = agreementsByUnit.get(agreement.rentableUnitId) ?? [];
    current.push(agreement);
    agreementsByUnit.set(agreement.rentableUnitId, current);
  }
  const unitsByClass = new Map<string, number>();
  for (const unit of units) unitsByClass.set(unit.storefrontItemId, (unitsByClass.get(unit.storefrontItemId) ?? 0) + 1);

  const unitResources: CapacityResource[] = units.map((unit) => {
    const physical = profiles.get(unit.id)!;
    return {
      ref: unitRef(unit, physical),
      organizationId: input.organizationId,
      label: unit.label,
      capacity: 1,
      capacityUnit: physical.kind === "self-storage" ? "storage unit" : "rental unit",
      status: unitStatus(unit, physical, agreementsByUnit.get(unit.id) ?? [], now),
      locationRef: rentalLocationLabel(physical.location),
      capabilityKeys: [
        `rental-kind:${physical.kind}`,
        `rental-class:${unit.storefrontItemId}`,
        ...physical.capabilityKeys,
      ],
      sourceVersion: unit.updatedAt.toISOString(),
    };
  });

  const poolResources: CapacityResource[] = classes
    .filter((item) => !unitsByClass.has(item.id) && readRentalPoolCapacity(item.bookingConfig) > 0)
    .map((item) => ({
      ref: poolRef(item),
      organizationId: input.organizationId,
      label: item.name,
      capacity: readRentalPoolCapacity(item.bookingConfig),
      capacityUnit: "rental units",
      status: "available",
      capabilityKeys: [`rental-kind:pool`, `rental-class:${item.id}`],
    }));

  const allocations: CapacityAllocation[] = agreements.map((agreement) => {
    const unit = agreement.rentableUnitId ? unitsById.get(agreement.rentableUnitId) : undefined;
    const physical = unit ? profiles.get(unit.id)! : undefined;
    const item = classesById.get(agreement.storefrontItemId);
    const ref = unit && physical ? unitRef(unit, physical) : poolRef(item ?? {
      id: agreement.storefrontItemId,
      storefrontId: agreement.storefrontId,
      name: agreement.storefrontItemId,
      bookingConfig: null,
    });
    return {
      allocationId: agreement.id,
      resourceRef: ref,
      demandRef: agreement.agreementRef,
      interval: {
        startAt: agreement.periodStart.toISOString(),
        endAt: agreement.periodEnd.toISOString(),
        preparationMinutes: physical && "pickupWindowMinutes" in physical ? physical.pickupWindowMinutes : 0,
        cleanupMinutes: physical && "returnWindowMinutes" in physical ? physical.returnWindowMinutes : 0,
        travelBeforeMinutes: 0,
        travelAfterMinutes: 0,
      },
      quantity: 1,
      lifecycle: allocationLifecycle(agreement.status),
    };
  });

  const availability = units.flatMap((unit) => {
    const physical = profiles.get(unit.id)!;
    const ref = unitRef(unit, physical);
    const maintenance = physical.maintenanceHold;
    const result: CapacityAdapterLoadResult["availability"] = [];
    if (unitStatus(unit, physical, agreementsByUnit.get(unit.id) ?? [], now) === "available") {
      result.push({ ...input.window, resourceRef: ref, kind: "available" });
    }
    if (maintenance?.severity === "hard" &&
        overlaps(maintenance.startAt, maintenance.endAt, input.window.startAt, input.window.endAt)) {
      result.push({
        resourceRef: ref,
        startAt: maintenance.startAt,
        endAt: maintenance.endAt,
        kind: "unavailable",
        reason: maintenance.reason,
      });
    }
    return result;
  });

  const allocatedResourceIds = new Set(allocations
    .filter((allocation) => ["held", "confirmed", "active"].includes(allocation.lifecycle))
    .map((allocation) => allocation.resourceRef.resourceId));

  return {
    authority: "rental",
    state: "ok",
    resources: [...unitResources, ...poolResources],
    allocations,
    availability,
    attentionSignals: [
      ...units.flatMap((unit) => unitAttention(unit, profiles.get(unit.id)!)),
      ...agreements.flatMap((agreement) => agreementAttention(agreement, now)),
      ...unitResources
        .filter((resource) => resource.status === "available" &&
          !allocatedResourceIds.has(resource.ref.resourceId))
        .map((resource) => signal(
          "idle-capacity",
          resource.ref.resourceId,
          `${resource.label} is ready but has no demand in the selected window.`,
          { resourceRef: resource.ref },
        )),
    ],
    watermark: {
      source: "rental",
      observedAt: now.toISOString(),
      sourceVersion: maxUpdatedAt(units, agreements),
    },
  };
}

export function createRentalCapacityAdapter(
  db: RentalCapacityDb,
  options: RentalAdapterOptions = {},
): CapacityAdapter {
  return {
    authority: "rental",
    async load(input) {
      try {
        return await loadRentalCapacity(db, input, options.now?.() ?? new Date());
      } catch (error) {
        return {
          authority: "rental",
          state: "degraded",
          diagnostic: error instanceof Error ? error.message : "Rental capacity source failed",
          resources: [], allocations: [], availability: [],
        };
      }
    },
  };
}
