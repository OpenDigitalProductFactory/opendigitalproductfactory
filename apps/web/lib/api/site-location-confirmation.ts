// Confirming a customer site's location from the phone at check-in
// (BI-C318C227 §2.2). Pure decision; the route loads the facts and writes.
// The staff member's position is used once, only to become the site's point,
// and is never stored anywhere else.

import {
  SITE_CONFIRM_FAR_M,
  SITE_CONFIRM_MAX_ACCURACY_M,
  haversineMeters,
  type GeoPoint,
  type SiteLocationConfirmationResult,
} from "@dpf/types";

import { locationProvenance } from "@/lib/geocoding/provenance";

export type SiteConfirmationFacts = {
  job: { assignedToCaller: boolean; status: string };
  /** The site belongs to the account the job resolves to. */
  siteOnJob: boolean;
  address: { exists: boolean; latitude: number | null; longitude: number | null; validationSource: string | null };
  fix: { latitude: number; longitude: number; accuracyMeters: number };
  confirmFar: boolean;
};

/** About 1 m: enough for a site, and no more precise than the fix deserves. */
export function roundSitePoint(point: GeoPoint): GeoPoint {
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return { latitude: round(point.latitude), longitude: round(point.longitude) };
}

function validFix(fix: SiteConfirmationFacts["fix"]): boolean {
  return (
    Number.isFinite(fix.latitude) && Number.isFinite(fix.longitude) &&
    Math.abs(fix.latitude) <= 90 && Math.abs(fix.longitude) <= 180 &&
    Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters >= 0
  );
}

export function decideSiteLocationConfirmation(facts: SiteConfirmationFacts): SiteLocationConfirmationResult {
  if (!validFix(facts.fix)) return { status: "refused", reason: "invalid-position" };
  if (!facts.job.assignedToCaller) return { status: "refused", reason: "not-assigned" };
  if (facts.job.status !== "in-progress") return { status: "refused", reason: "not-checked-in" };
  if (!facts.siteOnJob) return { status: "refused", reason: "site-not-on-job" };
  if (!facts.address.exists) return { status: "refused", reason: "no-address" };
  if (facts.fix.accuracyMeters > SITE_CONFIRM_MAX_ACCURACY_M) return { status: "refused", reason: "inaccurate" };

  const hasPoint = facts.address.latitude !== null && facts.address.longitude !== null;
  if (hasPoint && locationProvenance(facts.address.validationSource) !== "provider-derived") {
    return { status: "refused", reason: "already-confirmed" };
  }
  if (hasPoint && !facts.confirmFar) {
    const distanceMeters = haversineMeters(
      { latitude: facts.address.latitude!, longitude: facts.address.longitude! },
      facts.fix,
    );
    if (distanceMeters > SITE_CONFIRM_FAR_M) {
      return { status: "refused", reason: "far-from-address", distanceMeters: Math.round(distanceMeters) };
    }
  }
  return { status: "confirmed", ...roundSitePoint(facts.fix) };
}
