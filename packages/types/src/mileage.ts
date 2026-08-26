// Mileage capture wire types (EP-MILEAGE-ABSORB).
//
// Shared by the mobile app, the API client and the server route so the three
// cannot drift. Distances travel in METRES and money in minor-unit-agnostic
// decimals as strings-free numbers; the client formats, the server prices.

export type MileageClassification = "unclassified" | "business" | "personal" | "commute";

export type MileageCaptureKind = "automatic" | "manual" | "imported";

/** One captured drive as the driver sees it. */
export interface MileageTripSummary {
  tripId: string;
  startedAt: string;
  endedAt: string;
  distanceMetres: number;
  classification: MileageClassification;
  /** Who decided the classification — a rule must never overwrite a person. */
  classifiedBy: "driver" | "rule" | "admin" | null;
  startPlaceLabel: string | null;
  endPlaceLabel: string | null;
  /** Null until a rate has priced it. Never render null as zero. */
  reimbursableAmount: number | null;
  currency: string;
  /** True once the drive is on an expense claim; it must not be reclassified. */
  claimed: boolean;
}

export interface RecordTripRequest {
  startedAt: string;
  endedAt: string;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  startPlaceLabel?: string | null;
  endPlaceLabel?: string | null;
  distanceMetres: number;
  captureKind: MileageCaptureKind;
  vehicleId?: string | null;
  /**
   * ISO 3166-1 alpha-2 the DEVICE derived from its own location — the app
   * reverse-geocodes, the driver never picks. Omit when the device could not
   * resolve one; the server then prices on the driver's country of record.
   */
  countryCode?: string | null;
}

export interface ClassifyTripRequest {
  classification: Exclude<MileageClassification, "unclassified">;
}

/** The driver's own consent state, as the app must see it before capturing. */
export interface MileageConsentState {
  consentStatus: "pending" | "granted" | "revoked" | "expired";
  policyVersion: string | null;
  retentionDays: number | null;
  grantedAt: string | null;
}

export interface GrantMileageConsentRequest {
  policyVersion: string;
}
