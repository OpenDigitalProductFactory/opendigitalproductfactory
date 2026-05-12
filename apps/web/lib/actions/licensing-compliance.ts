"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";

type ComplianceActionResult = { ok: boolean; message: string; id?: string };

export type UpdateOrganizationLicenseProfileInput = {
  setupStatus: string;
  investigationMode: string;
  homeCountryCode?: string;
  primaryRegionCode?: string;
  operatingFootprintSummary?: string;
  legalActivityConfidence: string;
  researchCoverageStatus: string;
  notes?: string;
};

export type CreateOrganizationLicenseRecordInput = {
  requirementReferenceId?: string;
  licenseKind: string;
  status: string;
  licenseNumber?: string;
  issuedAt?: string;
  effectiveFrom?: string;
  expiresAt?: string;
  renewalCadence?: string;
  renewalFeeAmount?: string;
  renewalFeeCurrency?: string;
  displayRequirementStatus: string;
  officialSourceUrl?: string;
  verificationNotes?: string;
  displayType?: string;
  displayLocation?: string;
  displayRequirementLevel?: string;
  feeType?: string;
  feeAmount?: string;
  feeCurrency?: string;
  feeDueDate?: string;
  financeHandoffMode?: string;
  feeNotes?: string;
};

export type CreatePersonLicenseRecordInput = {
  principalAliasId: string;
  requirementReferenceId?: string;
  credentialType: string;
  status: string;
  credentialNumber?: string;
  issuingAuthority?: string;
  issuedAt?: string;
  expiresAt?: string;
  renewalCadence?: string;
  supervisoryOrDisplayRole?: string;
  officialSourceUrl?: string;
  displayType?: string;
  displayLocation?: string;
  displayRequirementLevel?: string;
  feeType?: string;
  feeAmount?: string;
  feeCurrency?: string;
  feeDueDate?: string;
  financeHandoffMode?: string;
  feeNotes?: string;
};

async function requireViewCompliance() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_compliance")) {
    throw new Error("Unauthorized");
  }
  return user;
}

async function requireManageCompliance() {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_compliance")) {
    throw new Error("Unauthorized");
  }
  return user;
}

async function requireOrganization() {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!organization) {
    throw new Error("No organization configured");
  }

  return organization;
}

async function getSessionEmployeeId() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });
  return profile?.id ?? null;
}

async function getOrCreateLicenseProfile(organizationId: string) {
  const existing = await prisma.organizationLicenseProfile.findFirst({
    where: { organizationId },
  });

  if (existing) return existing;

  return prisma.organizationLicenseProfile.create({
    data: {
      organizationId,
      setupStatus: "draft",
      investigationMode: "unknown",
      legalActivityConfidence: "medium",
      researchCoverageStatus: "draft",
    },
  });
}

function nullableString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function nullableDate(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? new Date(trimmed) : null;
}

function numberValue(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function organizationLicenseRecordId() {
  return `LIC-ORG-${nanoid(8).toUpperCase()}`;
}

function personLicenseRecordId() {
  return `LIC-PER-${nanoid(8).toUpperCase()}`;
}

function displayObligationId() {
  return `LIC-DIS-${nanoid(8).toUpperCase()}`;
}

function feeScheduleId() {
  return `LIC-FEE-${nanoid(8).toUpperCase()}`;
}

function revalidateLicensingRoutes() {
  revalidatePath("/compliance");
  revalidatePath("/compliance/licensing");
}

export async function getLicensingWorkspace() {
  await requireViewCompliance();
  const organization = await requireOrganization();
  const profile = await getOrCreateLicenseProfile(organization.id);

  const [requirementOptions, organizationLicenses, personCredentials, openIssues, holderOptions] =
    await Promise.all([
      prisma.licenseRequirementReference.findMany({
        orderBy: [
          { countryCode: "asc" },
          { stateProvinceCode: "asc" },
          { authorityName: "asc" },
        ],
        select: {
          id: true,
          requirementRefId: true,
          jurisdictionLabel: true,
          authorityName: true,
          requirementType: true,
          scopeLevel: true,
        },
      }),
      prisma.organizationLicenseRecord.findMany({
        where: { organizationLicenseProfileId: profile.id },
        include: {
          requirementReference: {
            select: {
              authorityName: true,
              jurisdictionLabel: true,
              requirementType: true,
            },
          },
          displayObligations: true,
          feeSchedules: true,
        },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
      }),
      prisma.personLicenseRecord.findMany({
        where: { organizationId: organization.id },
        include: {
          principalAlias: {
            select: {
              aliasValue: true,
              principal: { select: { displayName: true } },
            },
          },
          requirementReference: {
            select: {
              authorityName: true,
              jurisdictionLabel: true,
              requirementType: true,
            },
          },
          displayObligations: true,
          feeSchedules: true,
        },
        orderBy: [{ expiresAt: "asc" }, { createdAt: "desc" }],
      }),
      prisma.licenseReadinessIssue.findMany({
        where: { organizationLicenseProfileId: profile.id },
        orderBy: [{ severity: "desc" }, { openedAt: "desc" }],
      }),
      prisma.principalAlias.findMany({
        orderBy: [{ principal: { displayName: "asc" } }, { aliasValue: "asc" }],
        select: {
          id: true,
          aliasType: true,
          aliasValue: true,
          principal: { select: { displayName: true } },
        },
      }),
    ]);

  const displayObligations = [
    ...organizationLicenses.flatMap((record) =>
      (record.displayObligations ?? []).map((obligation) => ({
        ...obligation,
        sourceLabel: record.requirementReference?.authorityName ?? record.licenseKind,
        holderLabel: organization.name,
      })),
    ),
    ...personCredentials.flatMap((record) =>
      (record.displayObligations ?? []).map((obligation) => ({
        ...obligation,
        sourceLabel: record.requirementReference?.authorityName ?? record.credentialType,
        holderLabel: record.principalAlias.principal.displayName,
      })),
    ),
  ];

  const feeSchedules = [
    ...organizationLicenses.flatMap((record) =>
      (record.feeSchedules ?? []).map((fee) => ({
        ...fee,
        sourceLabel: record.requirementReference?.authorityName ?? record.licenseKind,
        holderLabel: organization.name,
      })),
    ),
    ...personCredentials.flatMap((record) =>
      (record.feeSchedules ?? []).map((fee) => ({
        ...fee,
        sourceLabel: record.requirementReference?.authorityName ?? record.credentialType,
        holderLabel: record.principalAlias.principal.displayName,
      })),
    ),
  ];

  return {
    organization,
    profile,
    requirementOptions,
    holderOptions: holderOptions.map((holder) => ({
      id: holder.id,
      aliasType: holder.aliasType,
      aliasValue: holder.aliasValue,
      displayName: holder.principal.displayName,
    })),
    organizationLicenses,
    personCredentials,
    displayObligations,
    feeSchedules,
    openIssues,
    summary: {
      organizationLicenseCount: organizationLicenses.length,
      personCredentialCount: personCredentials.length,
      unsatisfiedDisplayCount: displayObligations.filter((item) => !item.isSatisfied).length,
      pendingFeeCount: feeSchedules.filter((item) => item.paymentStatus !== "paid" && item.paymentStatus !== "waived").length,
      openIssueCount: openIssues.filter((item) => item.status !== "resolved").length,
    },
  };
}

export async function updateOrganizationLicenseProfile(
  input: UpdateOrganizationLicenseProfileInput,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const organization = await requireOrganization();
  const profile = await getOrCreateLicenseProfile(organization.id);

  await prisma.organizationLicenseProfile.update({
    where: { id: profile.id },
    data: {
      setupStatus: input.setupStatus,
      investigationMode: input.investigationMode,
      homeCountryCode: nullableString(input.homeCountryCode)?.toUpperCase() ?? null,
      primaryRegionCode: nullableString(input.primaryRegionCode)?.toUpperCase() ?? null,
      operatingFootprintSummary: nullableString(input.operatingFootprintSummary),
      legalActivityConfidence: input.legalActivityConfidence,
      researchCoverageStatus: input.researchCoverageStatus,
      notes: nullableString(input.notes),
    },
  });

  revalidateLicensingRoutes();
  return { ok: true, message: "Licensing posture saved." };
}

export async function createOrganizationLicenseRecord(
  input: CreateOrganizationLicenseRecordInput,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const organization = await requireOrganization();
  const profile = await getOrCreateLicenseProfile(organization.id);
  const employeeId = await getSessionEmployeeId();

  if (!nullableString(input.licenseKind)) {
    return { ok: false, message: "License kind is required." };
  }

  if (!nullableString(input.status)) {
    return { ok: false, message: "Status is required." };
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.organizationLicenseRecord.create({
      data: {
        licenseRecordId: organizationLicenseRecordId(),
        organizationLicenseProfileId: profile.id,
        requirementReferenceId: nullableString(input.requirementReferenceId),
        licenseKind: input.licenseKind.trim(),
        status: input.status.trim(),
        licenseNumber: nullableString(input.licenseNumber),
        issuedAt: nullableDate(input.issuedAt),
        effectiveFrom: nullableDate(input.effectiveFrom),
        expiresAt: nullableDate(input.expiresAt),
        renewalCadence: nullableString(input.renewalCadence),
        renewalFeeAmount: numberValue(input.renewalFeeAmount),
        renewalFeeCurrency: nullableString(input.renewalFeeCurrency)?.toUpperCase() ?? null,
        displayRequirementStatus: input.displayRequirementStatus.trim(),
        officialSourceUrl: nullableString(input.officialSourceUrl),
        verificationNotes: nullableString(input.verificationNotes),
      },
    });

    if (nullableString(input.displayType)) {
      await tx.licenseDisplayObligation.createMany({
        data: [
          {
            displayObligationId: displayObligationId(),
            organizationLicenseRecordId: record.id,
            displayType: input.displayType!.trim(),
            displayLocation: nullableString(input.displayLocation),
            requirementLevel: nullableString(input.displayRequirementLevel) ?? "required",
            isSatisfied: false,
          },
        ],
      });
    }

    if (numberValue(input.feeAmount) !== null && nullableString(input.feeType)) {
      await tx.licenseFeeSchedule.createMany({
        data: [
          {
            feeScheduleId: feeScheduleId(),
            organizationLicenseRecordId: record.id,
            feeType: input.feeType!.trim(),
            amount: numberValue(input.feeAmount)!,
            currency: nullableString(input.feeCurrency)?.toUpperCase() ?? "USD",
            dueDate: nullableDate(input.feeDueDate),
            financeHandoffMode: nullableString(input.financeHandoffMode) ?? "track_only",
            notes: nullableString(input.feeNotes),
          },
        ],
      });
    }

    await tx.complianceAuditLog.create({
      data: {
        entityType: "licensing-organization-record",
        entityId: record.id,
        action: "created",
        performedByEmployeeId: employeeId,
        agentId: null,
        notes: `Created ${input.licenseKind.trim()} licensing record`,
      },
    });

    return record;
  });

  revalidateLicensingRoutes();
  return { ok: true, message: "Organization license saved.", id: created.id };
}

export async function createPersonLicenseRecord(
  input: CreatePersonLicenseRecordInput,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const organization = await requireOrganization();
  await getOrCreateLicenseProfile(organization.id);
  const employeeId = await getSessionEmployeeId();

  if (!nullableString(input.principalAliasId)) {
    return { ok: false, message: "License holder is required." };
  }

  if (!nullableString(input.credentialType)) {
    return { ok: false, message: "Credential type is required." };
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.personLicenseRecord.create({
      data: {
        personLicenseRecordId: personLicenseRecordId(),
        principalAliasId: input.principalAliasId,
        organizationId: organization.id,
        requirementReferenceId: nullableString(input.requirementReferenceId),
        credentialType: input.credentialType.trim(),
        status: input.status.trim(),
        credentialNumber: nullableString(input.credentialNumber),
        issuingAuthority: nullableString(input.issuingAuthority),
        issuedAt: nullableDate(input.issuedAt),
        expiresAt: nullableDate(input.expiresAt),
        renewalCadence: nullableString(input.renewalCadence),
        supervisoryOrDisplayRole: nullableString(input.supervisoryOrDisplayRole),
        officialSourceUrl: nullableString(input.officialSourceUrl),
      },
    });

    if (nullableString(input.displayType)) {
      await tx.licenseDisplayObligation.createMany({
        data: [
          {
            displayObligationId: displayObligationId(),
            personLicenseRecordId: record.id,
            displayType: input.displayType!.trim(),
            displayLocation: nullableString(input.displayLocation),
            requirementLevel: nullableString(input.displayRequirementLevel) ?? "required",
            isSatisfied: false,
          },
        ],
      });
    }

    if (numberValue(input.feeAmount) !== null && nullableString(input.feeType)) {
      await tx.licenseFeeSchedule.createMany({
        data: [
          {
            feeScheduleId: feeScheduleId(),
            personLicenseRecordId: record.id,
            feeType: input.feeType!.trim(),
            amount: numberValue(input.feeAmount)!,
            currency: nullableString(input.feeCurrency)?.toUpperCase() ?? "USD",
            dueDate: nullableDate(input.feeDueDate),
            financeHandoffMode: nullableString(input.financeHandoffMode) ?? "track_only",
            notes: nullableString(input.feeNotes),
          },
        ],
      });
    }

    await tx.complianceAuditLog.create({
      data: {
        entityType: "licensing-person-record",
        entityId: record.id,
        action: "created",
        performedByEmployeeId: employeeId,
        agentId: null,
        notes: `Created ${input.credentialType.trim()} credential record`,
      },
    });

    return record;
  });

  revalidateLicensingRoutes();
  return { ok: true, message: "Person-held credential saved.", id: created.id };
}
