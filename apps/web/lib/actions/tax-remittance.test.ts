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
      create: vi.fn(),
      update: vi.fn(),
    },
    taxJurisdictionReference: {
      findMany: vi.fn(),
    },
    taxObligationPeriod: {
      findMany: vi.fn(),
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
    mockPrisma.taxRegistration.findMany.mockResolvedValue([{ id: "reg-1", registrationId: "TAX-REG-1" }]);
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([{ id: "jur-1", jurisdictionRefId: "TAX-JUR-US-WA" }]);
    mockPrisma.taxObligationPeriod.findMany.mockResolvedValue([{ id: "period-1", periodId: "TAX-PER-1" }]);

    const result = await getTaxRemittanceWorkspace();

    expect(result.profile).toEqual(profile);
    expect(result.registrations).toHaveLength(1);
    expect(result.periods).toHaveLength(1);
    expect(result.jurisdictionOptions).toHaveLength(1);
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
