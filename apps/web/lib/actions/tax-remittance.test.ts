import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: vi.fn(),
    },
    organizationTaxProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    taxRegistration: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    taxJurisdictionReference: {
      findMany: vi.fn(),
    },
    taxObligationPeriod: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    taxObligationPeriodComponent: { deleteMany: vi.fn(), createMany: vi.fn() },
    taxDecisionSnapshot: {
      upsert: vi.fn(),
    },
    taxLiabilityEntry: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    taxAuthorityCredential: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    taxRemittanceRun: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    notification: {
      create: vi.fn(),
    },
    scheduledAgentTask: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    scheduledJob: {
      upsert: vi.fn(),
    },
    taxFilingArtifact: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    taxIssue: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    invoice: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    bill: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  addTaxFilingArtifact,
  createTaxRegistration,
  generateTaxObligationPeriods,
  getTaxRemittanceWorkspace,
  ensureTaxDeadlineMonitoringTask,
  prepareTaxFilingPacket,
  prepareTaxRemittanceRun,
  reviewTaxDeadlineNotifications,
  saveTaxAuthorityCredential,
  updateOrganizationTaxProfile,
  updateTaxRemittanceRunStatus,
  verifyTaxRegistration,
} from "./tax-remittance";

const mockAuth = vi.mocked(auth);
const mockCan = vi.mocked(can);
const mockPrisma = prisma as any;

const authorizedSession = {
  user: {
    id: "user-1",
    email: "admin@example.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

const bootstrapOrg = {
  id: "org-1",
  orgId: "ORG-000001",
  name: "DPF Test Org",
  slug: "dpf-test-org",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(authorizedSession as never);
  mockCan.mockReturnValue(true);
  mockPrisma.organization.findFirst.mockResolvedValue(bootstrapOrg);
  mockPrisma.taxIssue.findMany.mockResolvedValue([]);
  mockPrisma.taxIssue.create.mockImplementation(({ data }: any) => Promise.resolve({ id: data.issueId, ...data }));
  mockPrisma.taxIssue.update.mockImplementation(({ where, data }: any) =>
    Promise.resolve({ id: where.id, ...data }),
  );
  mockPrisma.taxFilingArtifact.findMany.mockResolvedValue([]);
  mockPrisma.taxDecisionSnapshot.upsert.mockImplementation(({ create, update }: any) =>
    Promise.resolve({ id: create?.snapshotId ?? update?.snapshotId ?? "snapshot-1", ...(create ?? update) }),
  );
  mockPrisma.taxLiabilityEntry.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.taxLiabilityEntry.upsert.mockImplementation(({ create, update }: any) =>
    Promise.resolve({ id: create?.entryId ?? update?.entryId ?? "entry-1", ...(create ?? update) }),
  );
  mockPrisma.taxLiabilityEntry.findMany.mockResolvedValue([]);
  mockPrisma.taxAuthorityCredential.findMany.mockResolvedValue([]);
  mockPrisma.taxAuthorityCredential.findFirst.mockResolvedValue(null);
  mockPrisma.taxAuthorityCredential.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: data.credentialId, ...data }),
  );
  mockPrisma.taxAuthorityCredential.update.mockImplementation(({ where, data }: any) =>
    Promise.resolve({ id: where.id, ...data }),
  );
  mockPrisma.taxRemittanceRun.findMany.mockResolvedValue([]);
  mockPrisma.taxRemittanceRun.findFirst.mockResolvedValue(null);
  mockPrisma.taxRemittanceRun.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: data.runId, ...data }),
  );
  mockPrisma.taxRemittanceRun.update.mockImplementation(({ where, data }: any) =>
    Promise.resolve({ id: where.id, ...data }),
  );
  mockPrisma.notification.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: `notif-${data.title}`, ...data }),
  );
  mockPrisma.scheduledAgentTask.findFirst.mockResolvedValue(null);
  mockPrisma.scheduledAgentTask.create.mockImplementation(({ data }: any) =>
    Promise.resolve({ id: data.taskId, ...data }),
  );
  mockPrisma.scheduledJob.upsert.mockResolvedValue(null);
});

describe("getTaxRemittanceWorkspace", () => {
  it("creates a draft organization tax profile when none exists", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(null);
    mockPrisma.organizationTaxProfile.create.mockResolvedValue({
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "unknown",
      setupStatus: "draft",
      homeCountryCode: null,
      primaryRegionCode: null,
      taxModel: "hybrid",
      externalSystem: null,
      footprintSummary: null,
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.taxRegistration.findMany.mockResolvedValue([]);
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([]);
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([]);

    const result = await getTaxRemittanceWorkspace();

    expect(mockPrisma.organizationTaxProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: bootstrapOrg.id,
        setupMode: "unknown",
        setupStatus: "draft",
        taxModel: "hybrid",
      }),
    });
    expect(result.profile.organizationId).toBe(bootstrapOrg.id);
  });

  it("returns existing profile, registrations, periods, and jurisdiction options", async () => {
    const profile = {
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "existing",
      setupStatus: "active",
      homeCountryCode: "US",
      primaryRegionCode: "WA",
      taxModel: "hybrid",
      externalSystem: "quickbooks",
      footprintSummary: "Washington plus remote service delivery.",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(profile);
    mockPrisma.taxRegistration.findMany.mockResolvedValue([
      {
        id: "reg-1",
        registrationId: "TAX-REG-1",
        taxType: "sales_tax",
        registrationNumber: "WA-1",
        registrationStatus: "active",
        filingFrequency: "quarterly",
        filingBasis: "accrual",
        remitterRole: "business",
        effectiveFrom: new Date(),
        effectiveTo: null,
        firstPeriodStart: new Date(),
        portalAccountNotes: null,
        verifiedFromSourceUrl: "https://dor.wa.gov/file-pay-taxes",
        lastVerifiedAt: new Date(),
        confidence: "high",
        jurisdictionReference: {
          authorityName: "Washington Department of Revenue",
          jurisdictionRefId: "TAX-JUR-US-WA",
          countryCode: "US",
          stateProvinceCode: "WA",
        },
      },
    ]);
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([{ id: "jur-1", jurisdictionRefId: "TAX-JUR-US-WA" }]);
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([
      {
        id: "period-1",
        periodId: "TAX-PER-1",
        liabilityEntries: [
          {
            id: "liability-1",
            entryId: "TAX-LIAB-1",
            sourceType: "invoice_tax",
            direction: "output",
            taxableAmount: 400,
            taxAmount: 33,
            occurredAt: new Date("2026-03-20T00:00:00.000Z"),
          },
        ],
        remittanceRuns: [
          {
            id: "run-1",
            runId: "TAX-RUN-1",
            status: "scheduled",
            executionMode: "scheduled_coworker",
            scheduledFor: new Date("2026-04-20T10:00:00.000Z"),
          },
        ],
      },
    ]);
    mockPrisma.taxAuthorityCredential.findMany.mockResolvedValue([
      {
        id: "cred-1",
        credentialId: "TAX-CRED-1",
        registrationId: "reg-1",
        authorityName: "Washington Department of Revenue",
        status: "active",
        authMode: "portal_username_password",
      },
    ]);

    const result = await getTaxRemittanceWorkspace();

    expect(result.profile).toEqual(profile);
    expect(result.registrations).toHaveLength(1);
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]?.liabilityEntries).toHaveLength(1);
    expect(result.periods[0]?.remittanceRuns).toHaveLength(1);
    expect(result.authorityCredentials).toHaveLength(1);
    expect(result.jurisdictionOptions).toHaveLength(1);
    expect(result.coworkerGuide.summary).toContain("already configured");
  });

  it("derives guided setup questions and creates open tax issues for incomplete setup", async () => {
    const profile = {
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "unknown",
      setupStatus: "draft",
      homeCountryCode: null,
      primaryRegionCode: null,
      taxModel: "hybrid",
      filingOwner: "business",
      handoffMode: "dpf_readiness_only",
      externalSystem: null,
      footprintSummary: null,
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(profile);
    mockPrisma.taxRegistration.findMany.mockResolvedValue([]);
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([]);
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([]);

    const result = await getTaxRemittanceWorkspace();

    expect(result.coworkerGuide.nextQuestions.length).toBeGreaterThan(0);
    expect(result.coworkerGuide.nextQuestions[0]).toContain("already filing");
    expect(result.openIssues.length).toBeGreaterThan(0);
    expect(mockPrisma.taxIssue.create).toHaveBeenCalled();
  });

  it("flags external filing handoff when no external system is recorded", async () => {
    const profile = {
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "existing",
      setupStatus: "active",
      homeCountryCode: "US",
      primaryRegionCode: "WA",
      taxModel: "hybrid",
      filingOwner: "accountant",
      handoffMode: "external_filing",
      externalSystem: null,
      footprintSummary: "Washington operations",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(profile);
    mockPrisma.taxRegistration.findMany.mockResolvedValue([]);
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([]);
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([]);

    const result = await getTaxRemittanceWorkspace();

    expect(result.openIssues.some((issue) => issue.issueType === "tax_external_handoff_missing")).toBe(true);
  });
});

describe("updateOrganizationTaxProfile", () => {
  it("throws when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    await expect(
      updateOrganizationTaxProfile({
        setupMode: "existing",
      setupStatus: "draft",
      homeCountryCode: "US",
      primaryRegionCode: "WA",
      taxModel: "hybrid",
      filingOwner: "business",
      handoffMode: "dpf_readiness_only",
      externalSystem: "quickbooks",
      footprintSummary: "WA operations",
      notes: "",
      }),
    ).rejects.toThrow("Unauthorized");
  });

  it("updates the existing organization tax profile", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      organizationId: bootstrapOrg.id,
    });
    mockPrisma.organizationTaxProfile.update.mockResolvedValue({
      id: "profile-1",
      setupMode: "existing",
    });
    mockPrisma.taxRegistration.findMany.mockResolvedValue([]);

    await updateOrganizationTaxProfile({
      setupMode: "existing",
      setupStatus: "active",
      homeCountryCode: "US",
      primaryRegionCode: "WA",
      taxModel: "hybrid",
      filingOwner: "accountant",
      handoffMode: "external_filing",
      externalSystem: "quickbooks",
      footprintSummary: "WA operations",
      notes: "",
    });

    expect(mockPrisma.organizationTaxProfile.update).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: expect.objectContaining({
        setupMode: "existing",
        setupStatus: "active",
        homeCountryCode: "US",
        primaryRegionCode: "WA",
        externalSystem: "quickbooks",
        filingOwner: "accountant",
        handoffMode: "external_filing",
      }),
    });
  });
});

describe("createTaxRegistration", () => {
  it("creates a registration tied to the current tax profile", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      organizationId: bootstrapOrg.id,
    });
    mockPrisma.taxRegistration.findMany.mockResolvedValue([]);
    mockPrisma.taxRegistration.create.mockResolvedValue({
      id: "reg-1",
      registrationId: "TAX-REG-NEW",
    });

    await createTaxRegistration({
      jurisdictionReferenceId: "jur-1",
      taxType: "sales_tax",
      registrationStatus: "active",
      registrationNumber: "WA-12345",
      filingFrequency: "quarterly",
      filingBasis: "accrual",
      remitterRole: "business",
      effectiveFrom: "2026-01-01",
      portalAccountNotes: "",
    });

    expect(mockPrisma.taxRegistration.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationTaxProfileId: "profile-1",
        jurisdictionReferenceId: "jur-1",
        taxType: "sales_tax",
        registrationStatus: "active",
        filingFrequency: "quarterly",
      }),
    });
  });
});

describe("verifyTaxRegistration", () => {
  it("updates verification fields and resolves matching verification issues", async () => {
    mockPrisma.taxRegistration.findFirst.mockResolvedValue({
      id: "reg-1",
      organizationTaxProfileId: "profile-1",
      portalAccountNotes: null,
    });
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "existing",
      setupStatus: "active",
      homeCountryCode: "US",
      primaryRegionCode: "WA",
      taxModel: "hybrid",
      externalSystem: null,
      footprintSummary: "Washington operations",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.taxRegistration.update.mockResolvedValue({
      id: "reg-1",
      verifiedFromSourceUrl: "https://dor.wa.gov/file-pay-taxes",
    });
    mockPrisma.taxRegistration.findMany.mockResolvedValue([
      {
        id: "reg-1",
        registrationId: "TAX-REG-1",
        taxType: "sales_tax",
        registrationNumber: "WA-12345",
        registrationStatus: "active",
        filingFrequency: "quarterly",
        filingBasis: "accrual",
        remitterRole: "business",
        effectiveFrom: new Date(),
        effectiveTo: null,
        firstPeriodStart: new Date(),
        portalAccountNotes: null,
        verifiedFromSourceUrl: "https://dor.wa.gov/file-pay-taxes",
        lastVerifiedAt: new Date(),
        confidence: "high",
        jurisdictionReference: {
          authorityName: "Washington Department of Revenue",
          jurisdictionRefId: "TAX-JUR-US-WA",
          countryCode: "US",
          stateProvinceCode: "WA",
        },
      },
    ]);
    mockPrisma.taxIssue.findMany.mockResolvedValue([
      {
        id: "issue-1",
        issueType: "tax_registration_live_verification_needed",
        registrationId: "reg-1",
        status: "open",
      },
    ]);

    await verifyTaxRegistration({
      registrationId: "reg-1",
      verifiedFromSourceUrl: "https://dor.wa.gov/file-pay-taxes",
      portalAccountNotes: "Verified filing portal and cadence on state site.",
      confidence: "high",
    });

    expect(mockPrisma.taxRegistration.update).toHaveBeenCalledWith({
      where: { id: "reg-1" },
      data: expect.objectContaining({
        verifiedFromSourceUrl: "https://dor.wa.gov/file-pay-taxes",
        confidence: "high",
      }),
    });
    expect(mockPrisma.taxIssue.update).toHaveBeenCalledWith({
      where: { id: "issue-1" },
      data: expect.objectContaining({
        status: "resolved",
      }),
    });
  });
});

describe("generateTaxObligationPeriods", () => {
  it("creates tracked periods for verified active registrations using liability lineage instead of raw aggregates", async () => {
    const activePeriodStart = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "existing",
      setupStatus: "active",
      homeCountryCode: "US",
      primaryRegionCode: "AL",
      taxModel: "hybrid",
      externalSystem: null,
      footprintSummary: "Alabama services",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.taxRegistration.findMany.mockResolvedValue([
      {
        id: "reg-1",
        registrationId: "TAX-REG-AL-1",
        organizationTaxProfileId: "profile-1",
        jurisdictionReferenceId: "jur-1",
        taxType: "sales_tax",
        registrationNumber: "AL-001",
        registrationStatus: "active",
        filingFrequency: "quarterly",
        filingBasis: "accrual",
        remitterRole: "business",
        effectiveFrom: activePeriodStart,
        effectiveTo: null,
        firstPeriodStart: activePeriodStart,
        portalAccountNotes: null,
        verifiedFromSourceUrl: "https://www.revenue.alabama.gov/sales-use/one-spot/",
        lastVerifiedAt: new Date("2026-01-15T00:00:00.000Z"),
        confidence: "high",
        createdAt: new Date(),
        updatedAt: new Date(),
        jurisdictionReference: {
          id: "jur-1",
          jurisdictionRefId: "TAX-JUR-US-AL",
          authorityName: "Alabama",
          countryCode: "US",
          stateProvinceCode: "AL",
          authorityType: "state",
          taxTypes: ["sales_tax"],
        },
      },
    ]);
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([]);
    mockPrisma.invoice.findMany.mockResolvedValue([
      {
        id: "invoice-1",
        invoiceRef: "INV-001",
        type: "standard",
        currency: "USD",
        issueDate: new Date("2026-02-15T00:00:00.000Z"),
        lineItems: [
          {
            id: "invoice-line-1",
            description: "Managed services",
            lineTotal: 500,
            taxRate: 8.25,
            taxAmount: 41.25,
          },
        ],
      },
      {
        id: "invoice-credit-1",
        invoiceRef: "CRN-001",
        type: "credit_note",
        currency: "USD",
        issueDate: new Date("2026-02-20T00:00:00.000Z"),
        lineItems: [
          {
            id: "invoice-credit-line-1",
            description: "Service credit",
            lineTotal: 100,
            taxRate: 8.25,
            taxAmount: 8.25,
          },
        ],
      },
    ]);
    mockPrisma.bill.findMany.mockResolvedValue([
      {
        id: "bill-1",
        billRef: "BILL-001",
        currency: "USD",
        issueDate: new Date("2026-02-18T00:00:00.000Z"),
        lineItems: [
          {
            id: "bill-line-1",
            description: "Taxable vendor input",
            lineTotal: 200,
            taxRate: 5,
            taxAmount: 10,
          },
        ],
      },
    ]);
    mockPrisma.taxObligationPeriod.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: `period-${data.periodId}`, ...data }),
    );

    await generateTaxObligationPeriods();

    expect(mockPrisma.taxLiabilityEntry.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.invoice.findMany).toHaveBeenCalled();
    expect(mockPrisma.bill.findMany).toHaveBeenCalled();
    expect(mockPrisma.taxDecisionSnapshot.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.taxLiabilityEntry.upsert).toHaveBeenCalledTimes(3);
    expect(mockPrisma.taxObligationPeriod.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        registrationId: "reg-1",
        manualAdjustmentAmount: 0,
        netTaxAmount: 23,
      }),
    });
    // Per-family figures moved to component rows; 33 - 10 = 23 net, unchanged.
    const written = mockPrisma.taxObligationPeriodComponent.createMany.mock.calls[0][0].data;
    expect(written.map((c: { componentKind: string; amount: number }) => [c.componentKind, c.amount])).toEqual([
      ["sales_output", 33],
      ["sales_input", 10],
    ]);
  });
});

describe("prepareTaxFilingPacket", () => {
  it("creates a workpaper artifact and moves the period into a ready export state", async () => {
    mockPrisma.taxObligationPeriod.findFirst.mockResolvedValue({
      id: "period-1",
      periodId: "TAX-PER-1",
      registrationId: "reg-1",
      periodStart: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-03-31T00:00:00.000Z"),
      dueDate: new Date("2026-04-30T00:00:00.000Z"),
      status: "draft",
      exportStatus: "not_started",
      salesTaxAmount: 125.5,
      inputTaxAmount: 20.25,
      netTaxAmount: 105.25,
      manualAdjustmentAmount: 0,
      registration: {
        taxType: "sales_tax",
        registrationNumber: "AL-001",
        jurisdictionReference: {
          authorityName: "Alabama",
        },
      },
    });
    mockPrisma.taxFilingArtifact.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "artifact-1", ...data }),
    );
    mockPrisma.taxObligationPeriod.update.mockImplementation(({ where, data }: any) =>
      Promise.resolve({ id: where.id, ...data }),
    );

    await prepareTaxFilingPacket({ periodId: "period-1" });

    expect(mockPrisma.taxFilingArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodId: "period-1",
        artifactType: "workpaper",
      }),
    });
    expect(mockPrisma.taxObligationPeriod.update).toHaveBeenCalledWith({
      where: { id: "period-1" },
      data: expect.objectContaining({
        status: "ready",
        exportStatus: "prepared",
      }),
    });
  });
});

describe("saveTaxAuthorityCredential", () => {
  it("stores authority credential custody metadata for a registration", async () => {
    mockPrisma.taxRegistration.findFirst.mockResolvedValue({
      id: "reg-1",
      organizationTaxProfileId: "profile-1",
      jurisdictionReference: {
        authorityName: "Alabama Department of Revenue",
      },
    });

    await saveTaxAuthorityCredential({
      registrationId: "reg-1",
      portalBaseUrl: "https://myalabamataxes.alabama.gov",
      credentialOwnerMode: "dpf_managed",
      status: "active",
      authMode: "portal_username_password",
      secretRef: "portal-user|super-secret",
      mfaMode: "totp_shared",
      notes: "Stored for coworker-run submissions.",
    });

    expect(mockPrisma.taxAuthorityCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        registrationId: "reg-1",
        organizationTaxProfileId: "profile-1",
        authorityName: "Alabama Department of Revenue",
        status: "active",
        credentialOwnerMode: "dpf_managed",
        authMode: "portal_username_password",
        mfaMode: "totp_shared",
        secretRef: expect.any(String),
      }),
    });
  });
});

describe("prepareTaxRemittanceRun", () => {
  it("creates a scheduled execution run for a ready period with an active credential", async () => {
    mockPrisma.taxObligationPeriod.findFirst.mockResolvedValue({
      id: "period-1",
      periodId: "TAX-PER-1",
      status: "ready",
      dueDate: new Date("2026-04-30T00:00:00.000Z"),
      registrationId: "reg-1",
      registration: {
        id: "reg-1",
        organizationTaxProfileId: "profile-1",
        filingFrequency: "monthly",
        jurisdictionReference: {
          authorityName: "Alabama Department of Revenue",
        },
      },
    });
    mockPrisma.taxAuthorityCredential.findFirst.mockResolvedValue({
      id: "cred-1",
      credentialId: "TAX-CRED-1",
      registrationId: "reg-1",
      status: "active",
      mfaMode: "totp_shared",
    });

    await prepareTaxRemittanceRun({
      periodId: "period-1",
      executionMode: "scheduled_coworker",
      scheduleFor: "2026-04-25T15:00:00.000Z",
    });

    expect(mockPrisma.taxRemittanceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodId: "period-1",
        credentialId: "cred-1",
        status: "scheduled",
        executionMode: "scheduled_coworker",
        scheduledFor: new Date("2026-04-25T15:00:00.000Z"),
      }),
    });
  });

  it("creates a blocked run and issue when execution is requested without an active credential", async () => {
    mockPrisma.taxObligationPeriod.findFirst.mockResolvedValue({
      id: "period-2",
      periodId: "TAX-PER-2",
      status: "ready",
      dueDate: new Date("2026-04-30T00:00:00.000Z"),
      registrationId: "reg-2",
      registration: {
        id: "reg-2",
        organizationTaxProfileId: "profile-1",
        jurisdictionReference: {
          authorityName: "Washington Department of Revenue",
        },
      },
    });
    mockPrisma.taxAuthorityCredential.findFirst.mockResolvedValue(null);

    await prepareTaxRemittanceRun({
      periodId: "period-2",
      executionMode: "scheduled_coworker",
      scheduleFor: "2026-04-26T15:00:00.000Z",
    });

    expect(mockPrisma.taxRemittanceRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodId: "period-2",
        status: "blocked",
        failureCode: "missing_credential",
      }),
    });
    expect(mockPrisma.taxIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueType: "tax_execution_credential_missing",
        periodId: "period-2",
        registrationId: "reg-2",
      }),
    });
  });
});

describe("updateTaxRemittanceRunStatus", () => {
  it("records a successful submission and creates an FYI notification", async () => {
    mockPrisma.taxRemittanceRun.findFirst.mockResolvedValue({
      id: "run-1",
      runId: "TAX-RUN-1",
      status: "scheduled",
      periodId: "period-1",
      period: {
        id: "period-1",
        periodId: "TAX-PER-1",
        registration: {
          jurisdictionReference: {
            authorityName: "Alabama Department of Revenue",
          },
        },
      },
    });

    await updateTaxRemittanceRunStatus({
      runId: "run-1",
      status: "submitted",
      confirmationRef: "AL-SUB-123",
    });

    expect(mockPrisma.taxRemittanceRun.update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "submitted",
        confirmationRef: "AL-SUB-123",
        submittedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: expect.stringContaining("submitted"),
      }),
    });
  });

  it("records a failed submission and raises an execution issue", async () => {
    mockPrisma.taxRemittanceRun.findFirst.mockResolvedValue({
      id: "run-2",
      runId: "TAX-RUN-2",
      status: "scheduled",
      periodId: "period-2",
      period: {
        id: "period-2",
        periodId: "TAX-PER-2",
        registrationId: "reg-2",
        registration: {
          organizationTaxProfileId: "profile-1",
          jurisdictionReference: {
            authorityName: "Washington Department of Revenue",
          },
        },
      },
    });

    await updateTaxRemittanceRunStatus({
      runId: "run-2",
      status: "failed",
      failureCode: "login_error",
      failureDetails: "Portal rejected the stored password.",
    });

    expect(mockPrisma.taxRemittanceRun.update).toHaveBeenCalledWith({
      where: { id: "run-2" },
      data: expect.objectContaining({
        status: "failed",
        failureCode: "login_error",
        failureDetails: "Portal rejected the stored password.",
        completedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.taxIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueType: "tax_execution_failed",
        periodId: "period-2",
        registrationId: "reg-2",
      }),
    });
    expect(mockPrisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: expect.stringContaining("failed"),
      }),
    });
  });
});

describe("reviewTaxDeadlineNotifications", () => {
  it("creates deduped due-soon and overdue notifications for open tax periods", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      id: "profile-1",
      organizationId: bootstrapOrg.id,
      setupMode: "existing",
      setupStatus: "active",
      homeCountryCode: "US",
      primaryRegionCode: "AL",
      taxModel: "hybrid",
      filingOwner: "business",
      handoffMode: "dpf_readiness_only",
      externalSystem: null,
      footprintSummary: "Alabama services",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([
      {
        id: "period-due-soon",
        periodId: "TAX-PER-DUE",
        status: "ready",
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        dueSoonNotifiedAt: null,
        overdueNotifiedAt: null,
        registration: {
          taxType: "sales_tax",
          jurisdictionReference: {
            authorityName: "Alabama",
            countryCode: "US",
            stateProvinceCode: "AL",
          },
        },
      },
      {
        id: "period-overdue",
        periodId: "TAX-PER-LATE",
        status: "ready",
        dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        dueSoonNotifiedAt: null,
        overdueNotifiedAt: null,
        registration: {
          taxType: "sales_tax",
          jurisdictionReference: {
            authorityName: "Washington",
            countryCode: "US",
            stateProvinceCode: "WA",
          },
        },
      },
      {
        id: "period-already-notified",
        periodId: "TAX-PER-SKIP",
        status: "ready",
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        dueSoonNotifiedAt: new Date(),
        overdueNotifiedAt: null,
        registration: {
          taxType: "sales_tax",
          jurisdictionReference: {
            authorityName: "Colorado",
            countryCode: "US",
            stateProvinceCode: "CO",
          },
        },
      },
    ]);

    const result = await reviewTaxDeadlineNotifications();

    expect(result.notificationsCreated).toBe(2);
    expect(mockPrisma.notification.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.taxObligationPeriod.update).toHaveBeenCalledWith({
      where: { id: "period-due-soon" },
      data: expect.objectContaining({
        dueSoonNotifiedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.taxObligationPeriod.update).toHaveBeenCalledWith({
      where: { id: "period-overdue" },
      data: expect.objectContaining({
        overdueNotifiedAt: expect.any(Date),
      }),
    });
  });
});

describe("ensureTaxDeadlineMonitoringTask", () => {
  it("creates a finance monitoring task when one does not already exist", async () => {
    const result = await ensureTaxDeadlineMonitoringTask();

    expect(result.created).toBe(true);
    expect(mockPrisma.scheduledAgentTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentId: "finance-agent",
        title: "Tax Remittance Monitor",
        routeContext: "/finance/settings/tax",
        ownerUserId: "user-1",
      }),
      select: expect.any(Object),
    });
    expect(mockPrisma.scheduledJob.upsert).toHaveBeenCalled();
  });
});

describe("addTaxFilingArtifact", () => {
  it("adds manual evidence to an obligation period", async () => {
    mockPrisma.taxObligationPeriod.findFirst.mockResolvedValue({
      id: "period-1",
      registrationId: "reg-1",
      exportStatus: "prepared",
    });
    mockPrisma.taxFilingArtifact.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "artifact-2", ...data }),
    );

    await addTaxFilingArtifact({
      periodId: "period-1",
      artifactType: "supporting_note",
      notes: "Uploaded accountant reconciliation note.",
      sourceUrl: "https://example.com/workpaper",
      externalRef: "ACC-42",
    });

    expect(mockPrisma.taxFilingArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodId: "period-1",
        artifactType: "supporting_note",
        notes: "Uploaded accountant reconciliation note.",
        sourceUrl: "https://example.com/workpaper",
        externalRef: "ACC-42",
      }),
    });
  });

  it("accepts blank optional evidence fields from the browser form", async () => {
    mockPrisma.taxObligationPeriod.findFirst.mockResolvedValue({
      id: "period-1",
      registrationId: "reg-1",
      exportStatus: "prepared",
    });
    mockPrisma.taxFilingArtifact.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: "artifact-3", ...data }),
    );

    await addTaxFilingArtifact({
      periodId: "period-1",
      artifactType: "supporting_note",
      notes: "Only a note was captured.",
      sourceUrl: "",
      externalRef: "",
      storageKey: "",
    });

    expect(mockPrisma.taxFilingArtifact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        periodId: "period-1",
        artifactType: "supporting_note",
        notes: "Only a note was captured.",
        sourceUrl: null,
        externalRef: null,
        storageKey: null,
      }),
    });
  });
});
