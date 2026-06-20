/**
 * Customer-visit wire types — shared by the portal producer
 * (apps/web/app/api/v1/customer/visits) and the mobile customer surface
 * (apps/mobile/src/features/customer-visits). Projection of StorefrontBooking
 * for the signed-in customer's "My visits" tab.
 */

export type CustomerVisitStatus =
  | "pending"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

/** A single appointment / service visit for the signed-in customer. */
export interface CustomerVisit {
  id: string;
  bookingRef: string;
  /** ISO date-time string. */
  scheduledAt: string;
  durationMinutes: number;
  status: CustomerVisitStatus;
  /** Display name for the service offering on this visit. */
  itemName?: string;
  /** Service provider (e.g. tech name) if assigned, else null. */
  providerName: string | null;
  notes: string | null;
  cancellationReason: string | null;
  createdAt: string;
}
