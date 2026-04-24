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
    },
    taxIssue: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  createTaxRegistration,
  getTaxRemittanceWorkspace,
  updateOrganizationTaxProfile,
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
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([{ id: "period-1", periodId: "TAX-PER-1" }]);

    const result = await getTaxRemittanceWorkspace();

    expect(result.profile).toEqual(profile);
    expect(result.registrations).toHaveLength(1);
    expect(result.periods).toHaveLength(1);
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
