import { describe, expect, it } from "vitest";
import { Prisma } from "../generated/client/client";
import type {
  OrganizationTaxProfile,
  TaxFilingArtifact,
  TaxIssue,
  TaxJurisdictionReference,
  TaxObligationPeriod,
  TaxRegistration,
} from "../generated/client/client";

describe("tax remittance foundation model shape", () => {
  it("exposes the jurisdiction reference fields", () => {
    const mock: TaxJurisdictionReference = {
      id: "cuid_jurisdiction",
      jurisdictionRefId: "TAX-JUR-US-WA",
      countryCode: "US",
      stateProvinceCode: "WA",
      authorityName: "Washington State Department of Revenue",
      authorityType: "state",
      parentJurisdictionRefId: null,
      taxTypes: ["sales_tax"],
      localityModel: "state_only",
      officialWebsiteUrl: "https://dor.wa.gov/",
      registrationUrl: "https://dor.wa.gov/open-business",
      filingUrl: "https://dor.wa.gov/file-pay-taxes",
      paymentUrl: "https://dor.wa.gov/file-pay-taxes",
      helpUrl: "https://dor.wa.gov/contact",
      cadenceHints: ["monthly", "quarterly", "annual"],
      filingNotes: "Frequency is assigned by the authority.",
      automationHints: { mode: "portal" },
      sourceUrls: ["https://dor.wa.gov/file-pay-taxes"],
      sourceKind: "official",
      lastResearchedAt: new Date("2026-04-23T00:00:00.000Z"),
      lastVerifiedAt: null,
      confidence: "medium",
      staleAfterDays: 180,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(mock.jurisdictionRefId).toBe("TAX-JUR-US-WA");
    expect(mock.taxTypes).toContain("sales_tax");
  });

  it("exposes the organization tax profile and registration fields", () => {
    const profile: OrganizationTaxProfile = {
      id: "cuid_profile",
      organizationId: "org_cuid",
      setupMode: "unknown",
      setupStatus: "draft",
      homeCountryCode: "US",
      primaryRegionCode: "WA",
      taxModel: "hybrid",
      filingOwner: "accountant",
      handoffMode: "external_filing",
      externalSystem: "quickbooks",
      footprintSummary: "Operates from Washington and sells managed services in multiple states.",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const registration: TaxRegistration = {
      id: "cuid_registration",
      registrationId: "TAX-REG-001",
      organizationTaxProfileId: profile.id,
      jurisdictionReferenceId: "cuid_jurisdiction",
      taxType: "sales_tax",
      registrationNumber: "WA-12345",
      registrationStatus: "active",
      filingFrequency: "quarterly",
      filingBasis: "accrual",
      remitterRole: "business",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      firstPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      portalAccountNotes: null,
      verifiedFromSourceUrl: "https://dor.wa.gov/file-pay-taxes",
      lastVerifiedAt: new Date("2026-04-23T00:00:00.000Z"),
      confidence: "high",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(profile.homeCountryCode).toBe("US");
    expect(registration.registrationStatus).toBe("active");
  });

  it("exposes obligation periods, filing artifacts, and issues", () => {
    const period: TaxObligationPeriod = {
      id: "cuid_period",
      periodId: "TAX-PER-001",
      registrationId: "cuid_registration",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-31T23:59:59.999Z"),
      dueDate: new Date("2026-04-30T00:00:00.000Z"),
      status: "draft",
      salesTaxAmount: new Prisma.Decimal("1250.00"),
      inputTaxAmount: new Prisma.Decimal("0.00"),
      netTaxAmount: new Prisma.Decimal("1250.00"),
      manualAdjustmentAmount: new Prisma.Decimal("0.00"),
      exportStatus: "not_started",
      filedAt: null,
      paidAt: null,
      confirmationRef: null,
      dueSoonNotifiedAt: null,
      overdueNotifiedAt: null,
      preparedByAgentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const artifact: TaxFilingArtifact = {
      id: "cuid_artifact",
      periodId: period.id,
      artifactType: "workpaper",
      storageKey: "tax/workpapers/2026-q1.csv",
      externalRef: null,
      sourceUrl: "https://dor.wa.gov/file-pay-taxes",
      notes: null,
      createdByAgentId: null,
      createdByUserId: null,
      createdAt: new Date(),
    };

    const issue: TaxIssue = {
      id: "cuid_issue",
      issueId: "TAX-ISSUE-001",
      organizationTaxProfileId: "cuid_profile",
      registrationId: "cuid_registration",
      periodId: period.id,
      issueType: "missing_confirmation",
      severity: "medium",
      status: "open",
      title: "Missing filing confirmation",
      details: "The filing packet was prepared but no confirmation number was recorded.",
      openedAt: new Date(),
      resolvedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    expect(period.status).toBe("draft");
    expect(artifact.artifactType).toBe("workpaper");
    expect(issue.issueType).toBe("missing_confirmation");
  });

  it("accepts create inputs for the new models", () => {
    const createProfile: Prisma.OrganizationTaxProfileCreateInput = {
      organization: {
        connect: { id: "org_cuid" },
      },
      setupMode: "existing",
      setupStatus: "draft",
      homeCountryCode: "GB",
      taxModel: "hybrid",
      filingOwner: "business_team",
      handoffMode: "dpf_readiness_only",
    };

    const createRegistration: Prisma.TaxRegistrationCreateInput = {
      registrationId: "TAX-REG-002",
      taxType: "vat",
      registrationStatus: "active",
      filingFrequency: "quarterly",
      filingBasis: "accrual",
      remitterRole: "business",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      confidence: "high",
      organizationTaxProfile: { connect: { id: "cuid_profile" } },
      jurisdictionReference: { connect: { id: "cuid_jurisdiction" } },
    };

    expect(createProfile.setupMode).toBe("existing");
    expect(createRegistration.taxType).toBe("vat");
  });
});
