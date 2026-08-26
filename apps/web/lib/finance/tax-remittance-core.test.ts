import { describe, expect, it } from "vitest";

import {
  buildBillLiabilityDrafts,
  buildCoworkerGuide,
  buildFilingPacketNotes,
  buildInvoiceLiabilityDrafts,
  buildManagedTaxIssues,
  computeNextCronRun,
  periodMonthsForFrequency,
  type TaxRegistrationRecord,
} from "./tax-remittance-core";

function makeRegistration(overrides: Partial<TaxRegistrationRecord> = {}): TaxRegistrationRecord {
  return {
    id: "reg-1",
    registrationId: "TAX-REG-AAAAAAAA",
    taxType: "vat",
    registrationNumber: "GB123",
    registrationStatus: "active",
    filingFrequency: "quarterly",
    filingBasis: "accrual",
    remitterRole: "principal",
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    firstPeriodStart: new Date("2026-01-01T00:00:00Z"),
    portalAccountNotes: null,
    verifiedFromSourceUrl: null,
    lastVerifiedAt: new Date("2026-02-01T00:00:00Z"),
    confidence: "medium",
    jurisdictionReferenceId: "jur-1",
    organizationTaxProfileId: "profile-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    jurisdictionReference: {
      id: "jur-1",
      jurisdictionRefId: "JUR-REF-1",
      authorityName: "HMRC",
      countryCode: "GB",
      stateProvinceCode: null,
      authorityType: "national",
      taxTypes: ["vat"],
    },
    ...overrides,
  };
}

const baseProfile = {
  setupMode: "existing",
  homeCountryCode: "GB",
  footprintSummary: "UK only",
  handoffMode: "external",
  externalSystem: "AcmeAccountants",
  filingOwner: "external_accountant",
};

describe("periodMonthsForFrequency", () => {
  it("maps known filing frequencies to month spans", () => {
    expect(periodMonthsForFrequency("monthly")).toBe(1);
    expect(periodMonthsForFrequency("bi_monthly")).toBe(2);
    expect(periodMonthsForFrequency("quarterly")).toBe(3);
    expect(periodMonthsForFrequency("half_yearly")).toBe(6);
    expect(periodMonthsForFrequency("annual")).toBe(12);
  });

  it("returns null for an unknown frequency", () => {
    expect(periodMonthsForFrequency("weekly")).toBeNull();
  });
});

describe("computeNextCronRun", () => {
  it("returns +1 day when the expression is not a 5-field cron", () => {
    const from = new Date("2026-03-10T09:15:00Z");
    const next = computeNextCronRun("bad expr", from);
    expect(next.getTime()).toBe(new Date("2026-03-11T09:15:00Z").getTime());
  });

  it("advances to the next day when the target time has already passed today", () => {
    const from = new Date("2026-03-10T12:00:00");
    const next = computeNextCronRun("0 8 * * *", from);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(11);
  });

  it("honors a target day-of-week list", () => {
    // 2026-03-10 is a Tuesday; ask for Friday (5).
    const from = new Date("2026-03-10T06:00:00");
    const next = computeNextCronRun("30 9 * * 5", from);
    expect(next.getDay()).toBe(5);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
  });
});

describe("buildInvoiceLiabilityDrafts", () => {
  it("skips zero-tax lines and produces stable output drafts", () => {
    const registration = makeRegistration();
    const drafts = buildInvoiceLiabilityDrafts(registration, [
      {
        id: "inv-1",
        invoiceRef: "INV-1",
        type: "standard",
        currency: "GBP",
        issueDate: new Date("2026-01-15T00:00:00Z"),
        lineItems: [
          { id: "li-1", description: "Consulting", lineTotal: 120, taxRate: 20, taxAmount: 20 },
          { id: "li-2", description: "Zero rated", lineTotal: 50, taxRate: 0, taxAmount: 0 },
        ],
      },
    ]);

    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft.direction).toBe("output");
    expect(draft.taxAmount).toBe(20);
    expect(draft.taxableAmount).toBe(100);
    expect(draft.taxCode).toBe("standard");
    expect(draft.sourceType).toBe("invoice_tax");
    // deterministic id keyed on registration + invoice + line + date + type
    const again = buildInvoiceLiabilityDrafts(registration, [
      {
        id: "inv-1",
        invoiceRef: "INV-1",
        type: "standard",
        currency: "GBP",
        issueDate: new Date("2026-01-15T00:00:00Z"),
        lineItems: [{ id: "li-1", description: "Consulting", lineTotal: 120, taxRate: 20, taxAmount: 20 }],
      },
    ]);
    expect(again[0]!.entryId).toBe(draft.entryId);
    expect(again[0]!.snapshotId).toBe(draft.snapshotId);
  });

  it("negates tax and tags credit notes", () => {
    const drafts = buildInvoiceLiabilityDrafts(makeRegistration(), [
      {
        id: "cn-1",
        invoiceRef: "CN-1",
        type: "credit_note",
        currency: "GBP",
        issueDate: new Date("2026-01-20T00:00:00Z"),
        lineItems: [{ id: "li-9", description: "Refund", lineTotal: 60, taxRate: 20, taxAmount: 10 }],
      },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.taxAmount).toBe(-10);
    expect(drafts[0]!.taxCode).toBe("credit_note");
    expect(drafts[0]!.sourceType).toBe("credit_note");
    // taxable base uses the absolute tax amount
    expect(drafts[0]!.taxableAmount).toBe(50);
  });
});

describe("buildBillLiabilityDrafts", () => {
  it("produces input-direction drafts and defaults currency to GBP", () => {
    const drafts = buildBillLiabilityDrafts(makeRegistration(), [
      {
        id: "bill-1",
        billRef: "BILL-1",
        currency: null,
        issueDate: new Date("2026-01-10T00:00:00Z"),
        lineItems: [
          { id: "bl-1", description: "Supplies", lineTotal: 240, taxRate: 20, taxAmount: 40 },
          { id: "bl-2", description: "No tax", lineTotal: 10, taxRate: 0, taxAmount: 0 },
        ],
      },
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.direction).toBe("input");
    expect(drafts[0]!.currency).toBe("GBP");
    expect(drafts[0]!.taxableAmount).toBe(200);
    expect(drafts[0]!.taxAmount).toBe(40);
  });
});

describe("buildFilingPacketNotes", () => {
  it("renders a formatted multi-line workpaper summary", () => {
    const notes = buildFilingPacketNotes({
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-03-31T00:00:00Z"),
      components: [
        { componentKind: "sales_output" as const, amount: 1000 },
        { componentKind: "sales_input" as const, amount: 250 },
      ],
      netTaxAmount: 750,
      registration: {
        taxType: "vat",
        registrationNumber: "GB123",
        jurisdictionReference: { authorityName: "HMRC" },
      },
    });
    expect(notes).toContain("HMRC vat filing packet");
    expect(notes).toContain("Period: 2026-01-01 to 2026-03-31");
    expect(notes).toContain("Registration: GB123");
    expect(notes).toContain("Sales tax captured: 1000.00");
    expect(notes).toContain("Net tax due: 750.00");
  });

  it("falls back to 'pending' when no registration number", () => {
    const notes = buildFilingPacketNotes({
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-03-31T00:00:00Z"),
      components: [],
      netTaxAmount: 0,
      registration: {
        taxType: "gst",
        registrationNumber: null,
        jurisdictionReference: { authorityName: "ATO" },
      },
    });
    expect(notes).toContain("Registration: pending");
  });

  it("lists payroll components and omits the sales lines entirely", () => {
    // A payroll packet reading "Sales tax captured: 0.00" would state a fact
    // about sales tax that the filing never concerned.
    const notes = buildFilingPacketNotes({
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-03-31T00:00:00Z"),
      components: [
        { componentKind: "employee_withheld" as const, amount: 4200 },
        { componentKind: "employer_contribution" as const, amount: 1800 },
      ],
      netTaxAmount: 6000,
      registration: {
        taxType: "federal_withholding",
        registrationNumber: "EIN-12",
        jurisdictionReference: { authorityName: "IRS" },
      },
    });
    expect(notes).toContain("Employee withheld: 4200.00");
    expect(notes).toContain("Employer contribution: 1800.00");
    expect(notes).toContain("Net tax due: 6000.00");
    expect(notes).not.toContain("Sales tax captured");
    expect(notes).not.toContain("Input tax captured");
  });
});

describe("buildManagedTaxIssues", () => {
  it("returns no managed issues for a fully-configured profile with a verified registration", () => {
    const issues = buildManagedTaxIssues(baseProfile, [makeRegistration()]);
    expect(issues).toHaveLength(0);
  });

  it("flags unknown setup mode, missing home jurisdiction and footprint", () => {
    const issues = buildManagedTaxIssues(
      {
        setupMode: "unknown",
        homeCountryCode: null,
        footprintSummary: "   ",
        handoffMode: "external",
        externalSystem: "Acme",
        filingOwner: "external_accountant",
      },
      [makeRegistration()],
    );
    const types = issues.map((i) => i.issueType);
    expect(types).toContain("tax_setup_mode_unknown");
    expect(types).toContain("tax_home_jurisdiction_missing");
    expect(types).toContain("tax_footprint_missing");
  });

  it("flags research needed when there are no registrations", () => {
    const issues = buildManagedTaxIssues(baseProfile, []);
    expect(issues.map((i) => i.issueType)).toContain("tax_registration_research_needed");
  });

  it("flags a missing registration number and unverified registrations", () => {
    const issues = buildManagedTaxIssues(baseProfile, [
      makeRegistration({ registrationNumber: null, lastVerifiedAt: null }),
    ]);
    const types = issues.map((i) => i.issueType);
    expect(types).toContain("tax_registration_number_missing");
    expect(types).toContain("tax_registration_live_verification_needed");
    expect(issues.every((i) => i.registrationId === "reg-1")).toBe(true);
  });

  it("flags DPF-filing and external-handoff gaps together", () => {
    const issues = buildManagedTaxIssues(
      {
        setupMode: "existing",
        homeCountryCode: "GB",
        footprintSummary: "UK",
        handoffMode: "dpf_coworker",
        externalSystem: null,
        filingOwner: "dpf_coworker",
      },
      [makeRegistration()],
    );
    const types = issues.map((i) => i.issueType);
    expect(types).toContain("tax_external_handoff_missing");
    expect(types).toContain("tax_dpf_filing_not_available");
  });
});

describe("buildCoworkerGuide", () => {
  it("returns the existing-business guide and a verification queue for unverified registrations", () => {
    const guide = buildCoworkerGuide(
      baseProfile,
      [makeRegistration({ id: "reg-9", lastVerifiedAt: null })],
      [{ id: "iss-1", issueType: "x", title: "t", severity: "high", registrationId: "reg-9" }],
    );
    expect(guide.summary).toContain("already configured");
    expect(guide.verificationQueue).toHaveLength(1);
    expect(guide.verificationQueue[0]!.registrationId).toBe("reg-9");
    expect(guide.openIssueCount).toBe(1);
  });

  it("returns the new-business guide", () => {
    const guide = buildCoworkerGuide({ ...baseProfile, setupMode: "new_business" }, [], []);
    expect(guide.summary).toContain("first-time setup");
    expect(guide.verificationQueue).toHaveLength(0);
  });

  it("returns the unclassified guide when the setup mode is unknown", () => {
    const guide = buildCoworkerGuide({ ...baseProfile, setupMode: "unknown" }, [], []);
    expect(guide.summary).toContain("classify");
  });
});
