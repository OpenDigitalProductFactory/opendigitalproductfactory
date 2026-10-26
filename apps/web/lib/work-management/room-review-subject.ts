import { createHash } from "node:crypto";
import { getCanonicalWorkCaseSourceEntry } from "./source-registry";

export const REVIEW_SUBJECT_COMPOSITION_LIMIT = 32;
const MAX_SUBJECT_BYTES = 128 * 1024;
export type ReviewSubjectUnknownReason = "source-missing" | "source-unsupported" | "source-denied"
  | "source-unavailable" | "scope-conflict" | "composition-incomplete" | "source-inactive" | "reader-unavailable";
type Revision = Date | string;
export type ReviewSubjectArchetypeRow = {
  id: string; archetypeId: string; category: string; isActive: boolean; updatedAt: Revision;
};
export type ReviewSubjectBookingRow = {
  bookingRef: string; organizationId: string; storefrontId: string; updatedAt: Revision;
  storefront: {
    id: string; organizationId: string; archetypeId: string; updatedAt: Revision;
    archetype: ReviewSubjectArchetypeRow;
    archetypeCompositions: Array<{
      id: string; storefrontId: string; archetypeId: string; productLineId: string | null;
      role: string; removedAt: Revision | null; updatedAt: Revision; archetype: ReviewSubjectArchetypeRow;
    }>;
  };
};
type ArchetypeIdentity = { ref: string; slug: string; category: string; revision: string };
export type RoomReviewSubject = { status: "unknown"; reason: ReviewSubjectUnknownReason } | {
  status: "resolved"; organizationId: string; storefrontId: string; storefrontRevision: string;
  source: { sourceKey: "booking"; sourceId: string; revision: string };
  primary: ArchetypeIdentity;
  compositions: Array<{ ref: string; role: "primary" | "secondary"; productLineId: string | null;
    revision: string; removedAt: string | null; archetype: ArchetypeIdentity;
    applicability: "unknown" | "excluded"; reason: "removed" | "inactive" | "declaration-unverified" | "product-line-unverified" }>;
  fingerprint: string;
};
export type RoomReviewSubjectLoader = (input: { sourceType: string; sourceId: string }) => Promise<RoomReviewSubject>;
export const unknownRoomReviewSubject = (reason: ReviewSubjectUnknownReason): RoomReviewSubject => ({ status: "unknown", reason });
const revision = (value: Revision) => new Date(value).toISOString();
const archetypeIdentity = (row: ReviewSubjectArchetypeRow): ArchetypeIdentity =>
  ({ ref: row.id, slug: row.archetypeId, category: row.category, revision: revision(row.updatedAt) });

/** Canonical subject facts, never a declaration that its business obligations apply.
 * Reader authority is checked by the server before this pure projection. No funding,
 * installation default, free text, or representative layer can supply subject identity. */
export function projectRoomReviewSubject(input: {
  sourceType: string; sourceId: string; booking: ReviewSubjectBookingRow | null;
}): RoomReviewSubject {
  if (getCanonicalWorkCaseSourceEntry(input.sourceType)?.sourceKey !== "booking")
    return unknownRoomReviewSubject("source-unsupported");
  const booking = input.booking;
  if (!input.sourceId || !booking) return unknownRoomReviewSubject("source-missing");
  const storefront = booking.storefront;
  if (booking.bookingRef !== input.sourceId || !booking.organizationId || !storefront
    || booking.storefrontId !== storefront.id || booking.organizationId !== storefront.organizationId
    || storefront.archetypeId !== storefront.archetype?.id)
    return unknownRoomReviewSubject("scope-conflict");
  if (!storefront.archetype.isActive) return unknownRoomReviewSubject("source-inactive");
  const rows = storefront.archetypeCompositions;
  if (rows.length > REVIEW_SUBJECT_COMPOSITION_LIMIT) return unknownRoomReviewSubject("composition-incomplete");
  if (new Set(rows.map(row => row.id)).size !== rows.length
    || new Set(rows.map(row => row.archetypeId)).size !== rows.length
    || rows.some(row => row.storefrontId !== storefront.id || row.archetypeId !== row.archetype.id
      || !["primary", "secondary"].includes(row.role)
      || (!row.removedAt && row.role === "primary" && row.archetypeId !== storefront.archetypeId)))
    return unknownRoomReviewSubject("scope-conflict");
  try {
    const compositions = [...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(row => ({
      ref: row.id, role: row.role as "primary" | "secondary", productLineId: row.productLineId,
      revision: revision(row.updatedAt), removedAt: row.removedAt ? revision(row.removedAt) : null,
      archetype: archetypeIdentity(row.archetype),
      applicability: row.removedAt || !row.archetype.isActive ? "excluded" as const : "unknown" as const,
      reason: row.removedAt ? "removed" as const : !row.archetype.isActive ? "inactive" as const
        : row.productLineId ? "product-line-unverified" as const : "declaration-unverified" as const,
    }));
    const identity = { organizationId: booking.organizationId, storefrontId: storefront.id,
      storefrontRevision: revision(storefront.updatedAt),
      source: { sourceKey: "booking" as const, sourceId: booking.bookingRef, revision: revision(booking.updatedAt) },
      primary: archetypeIdentity(storefront.archetype), compositions };
    const encoded = JSON.stringify(identity);
    if (Buffer.byteLength(encoded, "utf8") > MAX_SUBJECT_BYTES) return unknownRoomReviewSubject("composition-incomplete");
    return { status: "resolved", ...identity, fingerprint: createHash("sha256").update(encoded).digest("hex") };
  } catch {
    return unknownRoomReviewSubject("source-unavailable");
  }
}
