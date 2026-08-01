import type {
  ResourceCapacityAuthority,
  ResourceCapacityProfile,
} from "@dpf/storefront-templates";
import type { OperationalSourceWatermark } from "@/lib/operations/source-health";

export const CAPACITY_RESOURCE_STATUSES = [
  "available",
  "busy",
  "blocked",
  "offline",
  "unknown",
] as const;

export type CapacityResourceStatus = (typeof CAPACITY_RESOURCE_STATUSES)[number];

export const CAPACITY_ALLOCATION_LIFECYCLES = [
  "held",
  "confirmed",
  "active",
  "released",
  "cancelled",
] as const;

export type CapacityAllocationLifecycle = (typeof CAPACITY_ALLOCATION_LIFECYCLES)[number];

export const CAPACITY_CONFLICT_KINDS = [
  "time-overlap",
  "capacity-exceeded",
  "unavailable",
  "capability-mismatch",
  "travel-window",
  "source-degraded",
] as const;

export type CapacityConflictKind = (typeof CAPACITY_CONFLICT_KINDS)[number];

export interface CapacityResourceRef {
  authority: ResourceCapacityAuthority;
  resourceType: string;
  resourceId: string;
}

export interface CapacityResource {
  ref: CapacityResourceRef;
  organizationId: string;
  label: string;
  capacity: number;
  capacityUnit: string;
  status: CapacityResourceStatus;
  locationRef?: string;
  capabilityKeys: string[];
  sourceVersion?: string;
}

export interface CapacityWindow {
  startAt: string;
  endAt: string;
}

export interface CapacityInterval extends CapacityWindow {
  preparationMinutes: number;
  cleanupMinutes: number;
  travelBeforeMinutes: number;
  travelAfterMinutes: number;
}

export interface CapacityAllocation {
  allocationId: string;
  resourceRef: CapacityResourceRef;
  demandRef: string;
  interval: CapacityInterval;
  quantity: number;
  lifecycle: CapacityAllocationLifecycle;
}

export interface CapacityAvailability extends CapacityWindow {
  resourceRef: CapacityResourceRef;
  kind: "available" | "unavailable";
  reason?: string;
}

export interface CapacityDemand {
  demandRef: string;
  resourceRef: CapacityResourceRef;
  interval: CapacityInterval;
  quantity: number;
  requiredCapabilityKeys: string[];
  availableTravelMinutes?: number;
}

export interface CapacityConflict {
  kind: CapacityConflictKind;
  resourceRef: CapacityResourceRef;
  demandRef: string;
  conflictingAllocationIds: string[];
  detail: string;
}

export type CapacityAttentionKind =
  | CapacityConflictKind
  | "idle-capacity"
  | "blocked-resource"
  | "unassigned-demand"
  | "provider-overlap"
  | "late-demand"
  | "no-show-risk"
  | "group-incomplete";

export interface CapacityAttentionSignal {
  signalId: string;
  kind: CapacityAttentionKind;
  authority: ResourceCapacityAuthority;
  resourceRef?: CapacityResourceRef;
  demandRef?: string;
  detail: string;
}

export interface CapacitySourceWatermark extends OperationalSourceWatermark {
  source: ResourceCapacityAuthority;
}

export interface CapacitySourceState {
  authority: ResourceCapacityAuthority;
  state: "ok" | "unsupported" | "degraded";
  diagnostic?: string;
  watermark?: CapacitySourceWatermark;
}

export interface CapacitySnapshot {
  profile: ResourceCapacityProfile;
  organizationId: string;
  window: CapacityWindow;
  resources: CapacityResource[];
  allocations: CapacityAllocation[];
  availability: CapacityAvailability[];
  sourceStates: CapacitySourceState[];
  attentionSignals: CapacityAttentionSignal[];
}

export function capacityResourceRefKey(ref: CapacityResourceRef): string {
  return `${ref.authority}:${ref.resourceType}:${ref.resourceId}`;
}
