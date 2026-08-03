// Typed, versioned view over RentableUnit.attributes. The JSON column remains
// extensible for integrations, while every DPF consumer goes through this
// parser instead of trusting a raw cast.
import { isRecord } from "@/lib/shared/coerce";

export const RENTAL_PHYSICAL_KINDS = [
  "equipment",
  "production-kit",
  "self-storage",
] as const;
export type RentalPhysicalKind = (typeof RENTAL_PHYSICAL_KINDS)[number];

export const RENTAL_READINESS_STATES = [
  "ready",
  "inspection-due",
  "cleaning",
  "charging",
  "incomplete",
  "blocked",
  "unknown",
] as const;
export type RentalReadiness = (typeof RENTAL_READINESS_STATES)[number];

export const RENTAL_MAINTENANCE_SEVERITIES = ["soft", "hard"] as const;
export type RentalMaintenanceSeverity = (typeof RENTAL_MAINTENANCE_SEVERITIES)[number];

export const STORAGE_OCCUPANCY_STATES = [
  "vacant",
  "reserved",
  "occupied",
  "move-out",
  "unknown",
] as const;
export type StorageOccupancy = (typeof STORAGE_OCCUPANCY_STATES)[number];

export const STORAGE_ACCESS_STATES = [
  "ready",
  "pending",
  "overlocked",
  "disabled",
  "unknown",
] as const;
export type StorageAccessState = (typeof STORAGE_ACCESS_STATES)[number];

export interface RentalPhysicalLocation {
  site?: string;
  zone?: string;
  position?: string;
}

export interface RentalMaintenanceHold {
  severity: RentalMaintenanceSeverity;
  reason: string;
  startAt: string;
  endAt: string;
}

interface RentalPhysicalBase {
  version: 1;
  kind: RentalPhysicalKind;
  location?: RentalPhysicalLocation;
  readiness: RentalReadiness;
  capabilityKeys: string[];
  maintenanceHold?: RentalMaintenanceHold;
}

export interface EquipmentPhysicalProfile extends RentalPhysicalBase {
  kind: "equipment";
  pickupWindowMinutes: number;
  returnWindowMinutes: number;
}

export interface ProductionKitPhysicalProfile extends RentalPhysicalBase {
  kind: "production-kit";
  requiredItemCount: number;
  readyItemCount: number;
  pickupWindowMinutes: number;
  returnWindowMinutes: number;
}

export interface SelfStoragePhysicalProfile extends RentalPhysicalBase {
  kind: "self-storage";
  sizeLabel?: string;
  occupancy: StorageOccupancy;
  accessState: StorageAccessState;
  waitlistCount: number;
  moveInAt?: string;
  moveOutAt?: string;
}

export type RentalPhysicalProfile =
  | EquipmentPhysicalProfile
  | ProductionKitPhysicalProfile
  | SelfStoragePhysicalProfile;

function trimmed(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim();
  return result || undefined;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? value as T[number]
    : fallback;
}

function isoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function parseLocation(value: unknown): RentalPhysicalLocation | undefined {
  if (!isRecord(value)) return undefined;
  const location = {
    site: trimmed(value.site),
    zone: trimmed(value.zone),
    position: trimmed(value.position),
  };
  if (!location.site && !location.zone && !location.position) return undefined;
  return Object.fromEntries(
    Object.entries(location).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function parseCapabilityKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(trimmed).filter((item): item is string => Boolean(item)))];
}

function parseMaintenanceHold(value: unknown): RentalMaintenanceHold | undefined {
  if (!isRecord(value)) return undefined;
  const startAt = isoTimestamp(value.startAt);
  const endAt = isoTimestamp(value.endAt);
  const reason = trimmed(value.reason);
  if (!startAt || !endAt || !reason || Date.parse(endAt) <= Date.parse(startAt)) return undefined;
  return {
    severity: oneOf(value.severity, RENTAL_MAINTENANCE_SEVERITIES, "hard"),
    reason,
    startAt,
    endAt,
  };
}

function common(value: Record<string, unknown>) {
  return {
    version: 1 as const,
    location: parseLocation(value.location),
    readiness: oneOf(value.readiness, RENTAL_READINESS_STATES, "unknown"),
    capabilityKeys: parseCapabilityKeys(value.capabilityKeys),
    maintenanceHold: parseMaintenanceHold(value.maintenanceHold),
  };
}

export function parseRentalPhysicalProfile(attributes: unknown): RentalPhysicalProfile {
  const root = isRecord(attributes) ? attributes : {};
  const raw = isRecord(root.rentalPhysical) ? root.rentalPhysical : {};
  const kind = oneOf(raw.kind, RENTAL_PHYSICAL_KINDS, "equipment");
  const base = common(raw);

  if (kind === "self-storage") {
    return {
      ...base,
      kind,
      sizeLabel: trimmed(raw.sizeLabel),
      occupancy: oneOf(raw.occupancy, STORAGE_OCCUPANCY_STATES, "unknown"),
      accessState: oneOf(raw.accessState, STORAGE_ACCESS_STATES, "unknown"),
      waitlistCount: nonNegativeInteger(raw.waitlistCount),
      moveInAt: isoTimestamp(raw.moveInAt),
      moveOutAt: isoTimestamp(raw.moveOutAt),
    };
  }

  if (kind === "production-kit") {
    const requiredItemCount = nonNegativeInteger(raw.requiredItemCount);
    return {
      ...base,
      kind,
      requiredItemCount,
      readyItemCount: Math.min(requiredItemCount, nonNegativeInteger(raw.readyItemCount)),
      pickupWindowMinutes: nonNegativeInteger(raw.pickupWindowMinutes),
      returnWindowMinutes: nonNegativeInteger(raw.returnWindowMinutes),
    };
  }

  return {
    ...base,
    kind,
    pickupWindowMinutes: nonNegativeInteger(raw.pickupWindowMinutes),
    returnWindowMinutes: nonNegativeInteger(raw.returnWindowMinutes),
  };
}

function definedEntries(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

/** Merge known fields into the envelope without erasing integration-owned keys. */
export function serializeRentalPhysicalProfile(
  attributes: unknown,
  profile: RentalPhysicalProfile,
): Record<string, unknown> {
  const root = isRecord(attributes) ? attributes : {};
  const existing = isRecord(root.rentalPhysical) ? root.rentalPhysical : {};
  return {
    ...root,
    rentalPhysical: definedEntries({
      ...existing,
      ...definedEntries(profile as unknown as Record<string, unknown>),
      ...(profile.location ? { location: definedEntries(profile.location) } : { location: undefined }),
      ...(profile.maintenanceHold
        ? { maintenanceHold: definedEntries(profile.maintenanceHold) }
        : { maintenanceHold: undefined }),
    }),
  };
}

export function rentalLocationLabel(location?: RentalPhysicalLocation): string | undefined {
  const parts = [location?.site, location?.zone, location?.position].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}

export function readRentalPoolCapacity(bookingConfig: unknown): number {
  if (!isRecord(bookingConfig)) return 0;
  return nonNegativeInteger(bookingConfig.rentalStockQuantity);
}

export function serializeRentalPoolCapacity(
  bookingConfig: unknown,
  capacity: number,
): Record<string, unknown> {
  return {
    ...(isRecord(bookingConfig) ? bookingConfig : {}),
    rentalStockQuantity: nonNegativeInteger(capacity),
  };
}
