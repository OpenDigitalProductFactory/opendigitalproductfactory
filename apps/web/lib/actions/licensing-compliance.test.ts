import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: vi.fn(),
    },
    organizationLicenseProfile: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    licenseRequirementReference: {
      findMany: vi.fn(),
    },
    organizationLicenseRecord: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    personLicenseRecord: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    licenseDisplayObligation: {
      createMany: vi.fn(),
    },
    licenseFeeSchedule: {
      createMany: vi.fn(),
    },
    licenseReadinessIssue: {
      findMany: vi.fn(),
    },
    principalAlias: {
      findMany: vi.fn(),
    },
    employeeProfile: {
      findUnique: vi.fn(),
    },
    complianceAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  createOrganizationLicenseRecord,
  getLicensingWorkspace,
} from "./licensing-compliance";

const mockSession = {
  user: {
    id: "user-1",
    email: "admin@test.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.organization.findFirst).mockResolvedValue({
    id: "org-1",
    name: "Acme Services",
    slug: "acme-services",
  } as never);
  vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({ id: "emp-1" } as never);
});

describe("getLicensingWorkspace", () => {
  it("returns licensing workspace sections with computed summary counts", async () => {
    vi.mocked(prisma.organizationLicenseProfile.findFirst).mockResolvedValue({
      id: "profile-1",
      organizationId: "org-1",
      setupStatus: "investigating",
      investigationMode: "existing",
      homeCountryCode: "US",
      primaryRegionCode: "NV",
      operatingFootprintSummary: "Nevada and Arizona service operations",
      legalActivityConfidence: "medium",
      researchCoverageStatus: "draft",
      notes: null,
      lastVerifiedAt: null,
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-05-01T00:00:00Z"),
    } as never);
    vi.mocked(prisma.licenseRequirementReference.findMany).mockResolvedValue([
      {
        id: "req-1",
        requirementRefId: "LIC-US-NV-CONTRACTOR",
        jurisdictionLabel: "Nevada",
        authorityName: "Nevada State Contractors Board",
        requirementType: "license",
        scopeLevel: "organization",
      },
    ] as never);
    vi.mocked(prisma.organizationLicenseRecord.findMany).mockResolvedValue([
      {
        id: "org-license-1",
        status: "active",
        expiresAt: new Date("2026-05-20T00:00:00Z"),
        displayObligations: [{ id: "display-1", isSatisfied: false }],
        feeSchedules: [{ id: "fee-1", paymentStatus: "pending", dueDate: new Date("2026-05-18T00:00:00Z") }],
      },
    ] as never);
    vi.mocked(prisma.personLicenseRecord.findMany).mockResolvedValue([
      {
        id: "person-license-1",
        status: "active",
        expiresAt: new Date("2026-05-25T00:00:00Z"),
        displayObligations: [],
        feeSchedules: [],
        principalAlias: { aliasValue: "plumber-lic-1", principal: { displayName: "Jamie Rivera" } },
      },
    ] as never);
    vi.mocked(prisma.licenseReadinessIssue.findMany).mockResolvedValue([
      { id: "issue-1", severity: "high", status: "open" },
    ] as never);
    vi.mocked(prisma.principalAlias.findMany).mockResolvedValue([
      { id: "alias-1", aliasValue: "plumber-lic-1", principal: { displayName: "Jamie Rivera" } },
    ] as never);

    const workspace = await getLicensingWorkspace();

    expect(workspace.organization.name).toBe("Acme Services");
    expect(workspace.summary.organizationLicenseCount).toBe(1);
    expect(workspace.summary.personCredentialCount).toBe(1);
    expect(workspace.summary.unsatisfiedDisplayCount).toBe(1);
    expect(workspace.summary.pendingFeeCount).toBe(1);
    expect(workspace.summary.openIssueCount).toBe(1);
    expect(workspace.requirementOptions[0]?.authorityName).toBe("Nevada State Contractors Board");
    expect(workspace.holderOptions[0]?.displayName).toBe("Jamie Rivera");
  });
});

describe("createOrganizationLicenseRecord", () => {
  it("creates linked display and fee records when the input includes them", async () => {
    vi.mocked(prisma.organizationLicenseProfile.findFirst).mockResolvedValue({
      id: "profile-1",
      organizationId: "org-1",
    } as never);
    vi.mocked(prisma.organizationLicenseRecord.create).mockResolvedValue({
      id: "org-license-1",
      licenseRecordId: "LIC-ORG-1",
    } as never);

    const transaction = {
      organizationLicenseRecord: {
        create: vi.fn().mockResolvedValue({
          id: "org-license-1",
          licenseRecordId: "LIC-ORG-1",
        }),
      },
      licenseDisplayObligation: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      licenseFeeSchedule: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      complianceAuditLog: {
        create: vi.fn().mockResolvedValue({}),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation(
      (async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)) as never,
    );

    const result = await createOrganizationLicenseRecord({
      requirementReferenceId: "req-1",
      licenseKind: "contractor_license",
      status: "active",
      licenseNumber: "NV-12345",
      effectiveFrom: "2026-05-01",
      expiresAt: "2027-05-01",
      displayRequirementStatus: "required",
      displayType: "wall_certificate",
      displayLocation: "front_desk",
      displayRequirementLevel: "required",
      feeType: "renewal",
      feeAmount: "250.00",
      feeCurrency: "USD",
      feeDueDate: "2027-04-15",
      financeHandoffMode: "finance_review",
    });

    expect(result.ok).toBe(true);
    expect(transaction.organizationLicenseRecord.create).toHaveBeenCalledOnce();
    expect(transaction.licenseDisplayObligation.createMany).toHaveBeenCalledOnce();
    expect(transaction.licenseFeeSchedule.createMany).toHaveBeenCalledOnce();
  });
});
