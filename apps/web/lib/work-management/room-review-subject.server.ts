import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";
import { getCanonicalWorkCaseSourceEntry } from "./source-registry";
import { projectRoomReviewSubject, unknownRoomReviewSubject, REVIEW_SUBJECT_COMPOSITION_LIMIT,
  type ReviewSubjectBookingRow, type RoomReviewSubject } from "./room-review-subject";

export type ReviewSubjectClient = { storefrontBooking: {
  findUnique(args: unknown): Promise<ReviewSubjectBookingRow | null>;
} };
const archetypeSelect = { id: true, archetypeId: true, category: true, isActive: true, updatedAt: true } as const;

/** Called only after exact room-content admission. The existing storefront read
 * capability additionally guards source facts; room membership alone cannot grant it. */
export async function loadRoomReviewSubject(
  db: ReviewSubjectClient,
  input: { sourceType: string; sourceId: string },
  auth: Pick<EffectiveAuthContext, "population" | "grantedCapabilities">,
): Promise<RoomReviewSubject> {
  if (getCanonicalWorkCaseSourceEntry(input.sourceType)?.sourceKey !== "booking")
    return unknownRoomReviewSubject("source-unsupported");
  if (auth.population !== "workforce" || !auth.grantedCapabilities.includes("view_storefront"))
    return unknownRoomReviewSubject("source-denied");
  if (!input.sourceId) return unknownRoomReviewSubject("source-missing");
  try {
    const booking = await db.storefrontBooking.findUnique({
      where: { bookingRef: input.sourceId },
      select: { bookingRef: true, organizationId: true, storefrontId: true, updatedAt: true,
        storefront: { select: { id: true, organizationId: true, archetypeId: true, updatedAt: true,
          archetype: { select: archetypeSelect },
          archetypeCompositions: { orderBy: { id: "asc" }, take: REVIEW_SUBJECT_COMPOSITION_LIMIT + 1,
            select: { id: true, storefrontId: true, archetypeId: true, productLineId: true,
              role: true, removedAt: true, updatedAt: true, archetype: { select: archetypeSelect } } },
        } },
      },
    });
    return projectRoomReviewSubject({ ...input, booking });
  } catch {
    return unknownRoomReviewSubject("source-unavailable");
  }
}
