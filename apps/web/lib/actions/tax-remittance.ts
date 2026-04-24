"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import {
  createTaxRegistrationSchema,
  updateOrganizationTaxProfileSchema,
  type CreateTaxRegistrationInput,
  type UpdateOrganizationTaxProfileInput,
} from "@/lib/finance/tax-remittance-validation";

async function requireManageFinance(): Promise<void> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")
  ) {
    throw new Error("Unauthorized");
  }
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

async function getOrCreateTaxProfile(organizationId: string) {
  const existing = await prisma.organizationTaxProfile.findFirst({
    where: { organizationId },
  });

  if (existing) return existing;

  return prisma.organizationTaxProfile.create({
    data: {
      organizationId,
      setupMode: "unknown",
      setupStatus: "draft",
      taxModel: "hybrid",
    },
  });
}

function nullableString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function registrationPublicId() {
  return `TAX-REG-${nanoid(8).toUpperCase()}`;
}

function revalidateTaxRoutes() {
  revalidatePath("/finance/settings");
  revalidatePath("/finance/settings/tax");
  revalidatePath("/finance/configuration");
}

export async function getTaxRemittanceWorkspace() {
  await requireManageFinance();

  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);

  const [registrations, periods, jurisdictionOptions] = await Promise.all([
    prisma.taxRegistration.findMany({
      where: { organizationTaxProfileId: profile.id },
      include: {
        jurisdictionReference: {
          select: {
            id: true,
            jurisdictionRefId: true,
            authorityName: true,
            countryCode: true,
            stateProvinceCode: true,
            authorityType: true,
            taxTypes: true,
          },
        },
      },
      orderBy: [
        { registrationStatus: "asc" },
        { createdAt: "asc" },
      ],
    }),
    prisma.taxObligationPeriod.findMany({
      where: {
        registration: {
          organizationTaxProfileId: profile.id,
        },
      },
      include: {
        registration: {
          include: {
            jurisdictionReference: {
              select: {
                authorityName: true,
                jurisdictionRefId: true,
                countryCode: true,
                stateProvinceCode: true,
              },
            },
          },
        },
      },
      orderBy: [
        { dueDate: "asc" },
        { createdAt: "desc" },
      ],
      take: 12,
    }),
    prisma.taxJurisdictionReference.findMany({
      orderBy: [
        { countryCode: "asc" },
        { stateProvinceCode: "asc" },
        { authorityName: "asc" },
      ],
      take: 200,
      select: {
        id: true,
        jurisdictionRefId: true,
        authorityName: true,
        countryCode: true,
        stateProvinceCode: true,
        authorityType: true,
        taxTypes: true,
      },
    }),
  ]);

  return {
    organization,
    profile,
    registrations,
    periods,
    jurisdictionOptions,
  };
}

export async function updateOrganizationTaxProfile(input: UpdateOrganizationTaxProfileInput) {
  await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const parsed = updateOrganizationTaxProfileSchema.parse(input);

  const updated = await prisma.organizationTaxProfile.update({
    where: { id: profile.id },
    data: {
      setupMode: parsed.setupMode,
      setupStatus: parsed.setupStatus,
      homeCountryCode: nullableString(parsed.homeCountryCode),
      primaryRegionCode: nullableString(parsed.primaryRegionCode),
      taxModel: parsed.taxModel,
      externalSystem: nullableString(parsed.externalSystem),
      footprintSummary: nullableString(parsed.footprintSummary),
      notes: nullableString(parsed.notes),
    },
  });

  revalidateTaxRoutes();
  return updated;
}

export async function createTaxRegistration(input: CreateTaxRegistrationInput) {
  await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const parsed = createTaxRegistrationSchema.parse(input);

  const created = await prisma.taxRegistration.create({
    data: {
      registrationId: registrationPublicId(),
      organizationTaxProfileId: profile.id,
      jurisdictionReferenceId: parsed.jurisdictionReferenceId,
      taxType: parsed.taxType,
      registrationNumber: nullableString(parsed.registrationNumber),
      registrationStatus: parsed.registrationStatus,
      filingFrequency: parsed.filingFrequency,
      filingBasis: nullableString(parsed.filingBasis),
      remitterRole: parsed.remitterRole,
      effectiveFrom: new Date(parsed.effectiveFrom),
      firstPeriodStart: new Date(parsed.effectiveFrom),
      portalAccountNotes: nullableString(parsed.portalAccountNotes),
      confidence: "medium",
    },
  });

  revalidateTaxRoutes();
  return created;
}
