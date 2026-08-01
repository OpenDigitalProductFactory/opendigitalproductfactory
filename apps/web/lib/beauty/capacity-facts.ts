import type { CapacityAdapterLoadInput } from "@/lib/capacity/adapter-types";

export interface BeautyResourceFact {
  id: string;
  organizationId: string;
  kind: "chair" | "station" | "room";
  label: string;
  status: string;
  capacity: number;
  capacityUnit: string;
  serviceArea?: string | null;
  blockedReason?: string | null;
  version: number;
  serviceItemIds: string[];
}

export interface BeautyAvailabilityFact {
  availabilityId: string;
  resourceId: string;
  kind: "available" | "unavailable";
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export interface BeautyAllocationFact {
  allocationId: string;
  resourceId: string;
  demandRef: string;
  startsAt: Date;
  endsAt: Date;
  quantity: number;
  lifecycle: "held" | "confirmed" | "active" | "released" | "cancelled";
  version: number;
}

export interface BeautyBookingFact {
  id: string;
  bookingRef: string;
  itemId: string;
  providerId?: string | null;
  providerName?: string | null;
  customerName: string;
  scheduledAt: Date;
  durationMinutes: number;
  preparationMinutes: number;
  cleanupMinutes: number;
  status: string;
  requiredResourceCount: number;
}

export interface BeautyCapacityFacts {
  resources: BeautyResourceFact[];
  availability: BeautyAvailabilityFact[];
  allocations: BeautyAllocationFact[];
  bookings: BeautyBookingFact[];
  observedAt: Date;
  sourceVersion?: string;
}

export type BeautyCapacityFactsLoader = (
  input: CapacityAdapterLoadInput,
) => Promise<BeautyCapacityFacts>;
