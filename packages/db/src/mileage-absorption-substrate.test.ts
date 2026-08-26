import { describe, expect, it } from "vitest";
import type {
  DriverLocationConsent,
  MileageRate,
  MileageRatePlan,
  Trip,
  TripClassificationRule,
  Vehicle,
} from "../generated/client/client";

// Mileage absorption substrate (EP-MILEAGE-ABSORB: BI-6D98AD8A, BI-E17E0034).
//
// These are shape tests, not persistence tests — they fail at compile time if a
// field the absorption contract depends on is renamed or dropped. The contract
// worth protecting is narrow but load-bearing:
//   • a trip must be able to say WHO classified it and under WHICH rule,
//   • a trip must carry the rate that priced it, not just the resulting money,
//   • capture must be gated on a consent record that pins a policy version.

describe("mileage absorption substrate shape", () => {
  it("models a vehicle that can be company-owned and bound to a fixed asset", () => {
    const vehicle: Vehicle = {
      id: "cuid_vehicle",
      vehicleId: "VEH-0001",
      organizationId: "cuid_org",
      employeeProfileId: "cuid_employee",
      // A company vehicle points at its FixedAsset row so depreciation and
      // mileage share one asset identity rather than duplicating it.
      fixedAssetId: "cuid_asset",
      label: "Transit 250 — van 3",
      ownership: "company",
      registrationRef: "ABC-1234",
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(vehicle.ownership).toBe("company");
    expect(vehicle.fixedAssetId).not.toBeNull();
  });

  it("models a personal vehicle with no fixed asset", () => {
    const vehicle: Vehicle = {
      id: "cuid_vehicle_personal",
      vehicleId: "VEH-0002",
      organizationId: "cuid_org",
      employeeProfileId: "cuid_employee",
      fixedAssetId: null,
      label: "Own car",
      ownership: "personal",
      registrationRef: null,
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(vehicle.ownership).toBe("personal");
    expect(vehicle.fixedAssetId).toBeNull();
  });

  it("captures an automatic drive that is not yet classified", () => {
    const trip: Trip = {
      id: "cuid_trip",
      tripId: "TRIP-0001",
      organizationId: "cuid_org",
      employeeProfileId: "cuid_employee",
      vehicleId: "cuid_vehicle",
      startedAt: new Date("2026-08-22T13:00:00.000Z"),
      endedAt: new Date("2026-08-22T13:32:00.000Z"),
      startLatitude: "37.7749000" as unknown as Trip["startLatitude"],
      startLongitude: "-122.4194000" as unknown as Trip["startLongitude"],
      endLatitude: "37.8044000" as unknown as Trip["endLatitude"],
      endLongitude: "-122.2712000" as unknown as Trip["endLongitude"],
      startPlaceLabel: null,
      endPlaceLabel: null,
      // Derived by the device, so an automatic capture that could not resolve
      // a country records null rather than a guess.
      countryCode: null,
      distanceMeters: 21400,
      captureKind: "automatic",
      classification: "unclassified",
      classifiedByKind: null,
      classifiedAt: null,
      classificationRuleId: null,
      customerAccountId: null,
      mileageRateId: null,
      reimbursableAmount: null,
      currency: "USD",
      expenseItemId: null,
      notes: null,
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // A freshly captured drive carries no money and no classifier — it is
    // evidence of travel, nothing more, until a driver or a rule acts on it.
    expect(trip.classification).toBe("unclassified");
    expect(trip.classifiedByKind).toBeNull();
    expect(trip.reimbursableAmount).toBeNull();
    expect(trip.expenseItemId).toBeNull();
  });

  it("records which rule classified a trip and which rate priced it", () => {
    const rule: TripClassificationRule = {
      id: "cuid_rule",
      tripClassificationRuleId: "MRULE-0001",
      organizationId: "cuid_org",
      employeeProfileId: null,
      ruleKind: "commute_exclusion",
      scopeKind: "organization",
      resultClassification: "commute",
      predicate: { homeRadiusMeters: 250, firstLegOfDay: true },
      priority: 10,
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Rule-driven classification must be attributable: the trip names the rule,
    // so a retired rule can still explain a historical classification.
    expect(rule.ruleKind).toBe("commute_exclusion");
    expect(rule.resultClassification).toBe("commute");
    expect(rule.scopeKind).toBe("organization");
  });

  it("prices mileage from an effective-dated rate rather than a live constant", () => {
    const plan: MileageRatePlan = {
      id: "cuid_plan",
      mileageRatePlanId: "MRP-0001",
      organizationId: "cuid_org",
      jurisdictionRefId: null,
      name: "US statutory",
      isOrgOverride: false,
      lifecycle: "active",
      lifecycleAt: null,
      lifecycleReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const rate: MileageRate = {
      id: "cuid_rate",
      mileageRateId: "MR-0001",
      planId: plan.id,
      purposeKind: "business",
      amountPerMile: "0.7250" as unknown as MileageRate["amountPerMile"],
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      // An open rate has no end date; a rate change closes this row and opens a
      // new one, so a trip always prices at the rate in force on its own date.
      effectiveTo: null,
      sourceUrl: "https://www.irs.gov/tax-professionals/standard-mileage-rates",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(rate.planId).toBe(plan.id);
    expect(rate.effectiveTo).toBeNull();
    expect(plan.isOrgOverride).toBe(false);
  });

  it("gates capture on a consent record that pins the policy version", () => {
    const consent: DriverLocationConsent = {
      id: "cuid_consent",
      driverLocationConsentId: "DLC-0001",
      organizationId: "cuid_org",
      employeeProfileId: "cuid_employee",
      consentStatus: "granted",
      grantedAt: new Date("2026-08-01T00:00:00.000Z"),
      revokedAt: null,
      retentionDays: 365,
      // Pinning the version means a changed disclosure requires fresh consent
      // rather than silently inheriting the old grant.
      policyVersion: "2026-08-01",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(consent.consentStatus).toBe("granted");
    expect(consent.revokedAt).toBeNull();
    expect(consent.retentionDays).toBeGreaterThan(0);
  });

  it("retains a revoked consent rather than deleting it", () => {
    const revoked: DriverLocationConsent = {
      id: "cuid_consent_revoked",
      driverLocationConsentId: "DLC-0002",
      organizationId: "cuid_org",
      employeeProfileId: "cuid_employee",
      consentStatus: "revoked",
      grantedAt: new Date("2026-06-01T00:00:00.000Z"),
      revokedAt: new Date("2026-08-20T00:00:00.000Z"),
      retentionDays: 365,
      policyVersion: "2026-06-01",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Revocation stops capture; it does not erase that consent once existed.
    expect(revoked.consentStatus).toBe("revoked");
    expect(revoked.grantedAt).not.toBeNull();
    expect(revoked.revokedAt).not.toBeNull();
  });
});
