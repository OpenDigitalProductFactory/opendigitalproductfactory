// The business's offer positioning: its value proposition and the customer
// segments it serves (BI-C1E83871).
//
// Both live on BusinessContext and feed marketing — strategy bootstrap seeds
// target segments from customerSegments, and the marketing fit check reads the
// value proposition as part of what the business itself sells. Nothing let an
// owner set either after setup: the business-context route did not accept them.
// This is the one validation both the route and the editor share.
//
// Pure: safe to import from client and server code.

import { err, ok, type ActionResult } from "@/lib/shared/action-result";

export const VALUE_PROPOSITION_MAX = 600;
export const CUSTOMER_SEGMENT_MAX = 120;
export const CUSTOMER_SEGMENTS_MAX = 8;

export type OfferPositioningPatch = {
  valueProposition?: string | null;
  customerSegments?: string[];
};

/**
 * Validate an offer-positioning edit. Absent fields are left out (no change);
 * an emptied value proposition clears it; segments are trimmed, de-duplicated
 * case-insensitively and capped, never silently truncated mid-word.
 */
export function sanitizeOfferPositioning(input: {
  valueProposition?: unknown;
  customerSegments?: unknown;
}): ActionResult<OfferPositioningPatch> {
  const patch: OfferPositioningPatch = {};

  if (input.valueProposition !== undefined) {
    if (input.valueProposition !== null && typeof input.valueProposition !== "string") {
      return err("valueProposition must be text.");
    }
    const value = (input.valueProposition ?? "").trim();
    if (value.length > VALUE_PROPOSITION_MAX) {
      return err(`The value proposition is limited to ${VALUE_PROPOSITION_MAX} characters.`);
    }
    patch.valueProposition = value.length > 0 ? value : null;
  }

  if (input.customerSegments !== undefined) {
    if (!Array.isArray(input.customerSegments) || input.customerSegments.some((s) => typeof s !== "string")) {
      return err("customerSegments must be a list of text.");
    }
    const seen = new Set<string>();
    const segments: string[] = [];
    for (const raw of input.customerSegments as string[]) {
      const segment = raw.trim();
      if (!segment || seen.has(segment.toLowerCase())) continue;
      if (segment.length > CUSTOMER_SEGMENT_MAX) {
        return err(`Each customer group is limited to ${CUSTOMER_SEGMENT_MAX} characters.`);
      }
      seen.add(segment.toLowerCase());
      segments.push(segment);
    }
    if (segments.length > CUSTOMER_SEGMENTS_MAX) {
      return err(`List at most ${CUSTOMER_SEGMENTS_MAX} customer groups.`);
    }
    patch.customerSegments = segments;
  }

  return ok(patch);
}
