"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import {
  addTaxFilingArtifactSchema,
  createTaxRegistrationSchema,
  prepareTaxFilingPacketSchema,
  updateOrganizationTaxProfileSchema,
  verifyTaxRegistrationSchema,
  type AddTaxFilingArtifactInput,
  type CreateTaxRegistrationInput,
  type PrepareTaxFilingPacketInput,
  type UpdateOrganizationTaxProfileInput,
  type VerifyTaxRegistrationInput,
} from "@/lib/finance/tax-remittance-validation";

type TaxProfileRecord = Awaited<ReturnType<typeof getOrCreateTaxProfile>>;
type TaxRegistrationRecord = {
  id: string;
  registrationId: string;
  taxType: string;
  registrationNumber: string | null;
  registrationStatus: string;
  filingFrequency: string;
  filingBasis: string | null;
  remitterRole: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  firstPeriodStart: Date | null;
  portalAccountNotes: string | null;
  verifiedFromSourceUrl: string | null;
  lastVerifiedAt: Date | null;
  confidence: string;
  jurisdictionReferenceId: string;
  organizationTaxProfileId: string;
  createdAt: Date;
  updatedAt: Date;
  jurisdictionReference: {
    id: string;
    jurisdictionRefId: string;
    authorityName: string;
    countryCode: string;
    stateProvinceCode: string | null;
    authorityType: string;
    taxTypes: string[];
  };
};

type ManagedTaxIssueDraft = {
  issueType: string;
  severity: string;
  title: string;
  details: string;
  registrationId?: string | null;
  periodId?: string | null;
};

const MANAGED_TAX_ISSUE_TYPES = new Set([
  "tax_setup_mode_unknown",
  "tax_home_jurisdiction_missing",
  "tax_footprint_missing",
  "tax_registration_research_needed",
  "tax_registration_number_missing",
  "tax_registration_live_verification_needed",
]);

async function requireManageFinance() {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_finance")
  ) {
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

function appendNote(existing: string | null, incoming?: string | null) {
  const next = nullableString(incoming);
  if (!next) return existing;
  const current = nullableString(existing);
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current}\n${next}`;
}

function registrationPublicId() {
  return `TAX-REG-${nanoid(8).toUpperCase()}`;
}

function issuePublicId() {
  return `TAX-ISS-${nanoid(8).toUpperCase()}`;
}

function periodPublicId() {
  return `TAX-PER-${nanoid(8).toUpperCase()}`;
}

function issueKey(issueType: string, registrationId?: string | null, periodId?: string | null) {
  return [issueType, registrationId ?? "profile", periodId ?? "none"].join(":");
}

function revalidateTaxRoutes() {
  revalidatePath("/finance");
  revalidatePath("/finance/settings");
  revalidatePath("/finance/settings/tax");
  revalidatePath("/finance/configuration");
}

function decimalValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (value && typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return Number(value.toString()) || 0;
  }
  return 0;
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function periodMonthsForFrequency(filingFrequency: string) {
  switch (filingFrequency) {
    case "monthly":
      return 1;
    case "bi_monthly":
      return 2;
    case "quarterly":
      return 3;
    case "half_yearly":
      return 6;
    case "annual":
      return 12;
    default:
      return null;
  }
}

function buildFilingPacketNotes(period: {
  periodStart: Date;
  periodEnd: Date;
  salesTaxAmount: unknown;
  inputTaxAmount: unknown;
  netTaxAmount: unknown;
  registration: {
    taxType: string;
    registrationNumber: string | null;
    jurisdictionReference: {
      authorityName: string;
    };
  };
}) {
  const salesTaxAmount = roundCurrency(decimalValue(period.salesTaxAmount));
  const inputTaxAmount = roundCurrency(decimalValue(period.inputTaxAmount));
  const netTaxAmount = roundCurrency(decimalValue(period.netTaxAmount));

  return [
    `${period.registration.jurisdictionReference.authorityName} ${period.registration.taxType} filing packet`,
    `Period: ${period.periodStart.toISOString().slice(0, 10)} to ${period.periodEnd.toISOString().slice(0, 10)}`,
    `Registration: ${period.registration.registrationNumber ?? "pending"}`,
    `Sales tax captured: ${salesTaxAmount.toFixed(2)}`,
    `Input tax captured: ${inputTaxAmount.toFixed(2)}`,
    `Net tax due: ${netTaxAmount.toFixed(2)}`,
  ].join("\n");
}

function buildManagedTaxIssues(
  profile: TaxProfileRecord,
  registrations: TaxRegistrationRecord[],
): ManagedTaxIssueDraft[] {
  const issues: ManagedTaxIssueDraft[] = [];

  if (profile.setupMode === "unknown") {
    issues.push({
      issueType: "tax_setup_mode_unknown",
      severity: "medium",
      title: "Tax setup mode still needs classification",
      details:
        "Confirm whether the business is already filing indirect taxes, partially configured, or setting up for the first time.",
    });
  }

  if (!nullableString(profile.homeCountryCode)) {
    issues.push({
      issueType: "tax_home_jurisdiction_missing",
      severity: "high",
      title: "Home jurisdiction is missing",
      details:
        "Capture the primary country so the finance coworker can suggest the first authorities and remittance obligations.",
    });
  }

  if (!nullableString(profile.footprintSummary)) {
    issues.push({
      issueType: "tax_footprint_missing",
      severity: "high",
      title: "Operating footprint is not documented",
      details:
        "Record where the business is registered, operates, and delivers taxable services before tax setup is treated as ready.",
    });
  }

  if (registrations.length === 0) {
    issues.push({
      issueType: "tax_registration_research_needed",
      severity: "high",
      title: "Tax authority research is still needed",
      details:
        profile.setupMode === "existing"
          ? "List the authorities the business already files with and verify each official filing portal."
          : "Research likely authorities from the business footprint and add the first registrations to move setup forward.",
    });
  }

  for (const registration of registrations) {
    if (registration.registrationStatus === "active" && !nullableString(registration.registrationNumber)) {
      issues.push({
        issueType: "tax_registration_number_missing",
        severity: "medium",
        title: "Registration number is missing",
        details: `Add the registration number for ${registration.jurisdictionReference.authorityName} or record why the authority is still pending.`,
        registrationId: registration.id,
      });
    }

    if (!registration.lastVerifiedAt) {
      issues.push({
        issueType: "tax_registration_live_verification_needed",
        severity: "high",
        title: "Live verification is still required",
        details: `Verify ${registration.jurisdictionReference.authorityName} against the official portal and record the source URL before relying on this registration.`,
        registrationId: registration.id,
      });
    }
  }

  return issues;
}

async function reconcileTaxIssues(
  profile: TaxProfileRecord,
  registrations: TaxRegistrationRecord[],
) {
  const desiredIssues = buildManagedTaxIssues(profile, registrations);
  const existingIssues = await prisma.taxIssue.findMany({
    where: { organizationTaxProfileId: profile.id },
    orderBy: [{ severity: "desc" }, { openedAt: "asc" }],
  });

  const existingByKey = new Map(
    existingIssues
      .filter((issue) => MANAGED_TAX_ISSUE_TYPES.has(issue.issueType))
      .map((issue) => [issueKey(issue.issueType, issue.registrationId, issue.periodId), issue]),
  );

  const activeIssues: Array<(typeof existingIssues)[number]> = [];
  const seenKeys = new Set<string>();

  for (const desired of desiredIssues) {
    const key = issueKey(desired.issueType, desired.registrationId, desired.periodId);
    seenKeys.add(key);
    const existing = existingByKey.get(key);

    if (existing) {
      const updated = existing.status === "open"
        && existing.title === desired.title
        && existing.details === desired.details
        && existing.severity === desired.severity
        ? existing
        : await prisma.taxIssue.update({
            where: { id: existing.id },
            data: {
              title: desired.title,
              details: desired.details,
              severity: desired.severity,
              status: "open",
              resolvedAt: null,
            },
          });
      activeIssues.push(updated);
      continue;
    }

    const created = await prisma.taxIssue.create({
      data: {
        issueId: issuePublicId(),
        organizationTaxProfileId: profile.id,
        registrationId: desired.registrationId ?? null,
        periodId: desired.periodId ?? null,
        issueType: desired.issueType,
        severity: desired.severity,
        status: "open",
        title: desired.title,
        details: desired.details,
      },
    });
    activeIssues.push(created);
  }

  for (const existing of existingIssues) {
    if (!MANAGED_TAX_ISSUE_TYPES.has(existing.issueType)) continue;
    const key = issueKey(existing.issueType, existing.registrationId, existing.periodId);
    if (seenKeys.has(key) || existing.status === "resolved") continue;
    await prisma.taxIssue.update({
      where: { id: existing.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
      },
    });
  }

  return activeIssues.sort((left, right) => {
    if (left.severity === right.severity) {
      return left.title.localeCompare(right.title);
    }
    return left.severity.localeCompare(right.severity);
  });
}

function buildCoworkerGuide(
  profile: TaxProfileRecord,
  registrations: TaxRegistrationRecord[],
  openIssues: Array<{
    id: string;
    issueType: string;
    title: string;
    severity: string;
    registrationId: string | null;
  }>,
) {
  const verificationQueue = registrations
    .filter((registration) => !registration.lastVerifiedAt)
    .map((registration) => ({
      registrationId: registration.id,
      authorityName: registration.jurisdictionReference.authorityName,
      jurisdictionRefId: registration.jurisdictionReference.jurisdictionRefId,
      registrationNumber: registration.registrationNumber,
    }));

  if (profile.setupMode === "existing") {
    return {
      summary:
        "This business appears to be already configured, so the finance coworker should normalize existing registrations before suggesting new authorities.",
      nextQuestions: [
        "Which authorities do you already file with today?",
        "Do you already have registration numbers and portal access for each authority?",
        "Which filings are handled internally versus by an accountant or tax system?",
      ],
      recommendedActions: [
        "Add each known authority registration.",
        "Mark the official filing portal live-verified for every active registration.",
        "Resolve setup gaps before treating remittance as active automation.",
      ],
      verificationQueue,
      openIssueCount: openIssues.length,
    };
  }

  if (profile.setupMode === "new_business") {
    return {
      summary:
        "This looks like a first-time setup, so the finance coworker should start from footprint and registration research rather than assuming filing history exists.",
      nextQuestions: [
        "Where is the business legally registered and where are services delivered?",
        "Are there any jurisdictions the owner already knows they must register in?",
        "Should DPF prepare handoff for an accountant or keep setup directly in the platform?",
      ],
      recommendedActions: [
        "Confirm the home jurisdiction and service footprint.",
        "Research likely authorities from the seeded jurisdiction registry.",
        "Record the first verified registrations before scheduling remittance periods.",
      ],
      verificationQueue,
      openIssueCount: openIssues.length,
    };
  }

  return {
    summary:
      "The finance coworker still needs to classify whether this business is already configured or starting from scratch before tax setup should progress.",
    nextQuestions: [
      "Are you already filing sales tax, VAT, or GST anywhere today?",
      "If yes, which authorities do you file with and how often?",
      "If no, where is the business registered, operating, and delivering taxable services?",
    ],
    recommendedActions: [
      "Classify the setup mode first.",
      "Capture the home jurisdiction and footprint.",
      "Add the first known or likely authority registrations.",
    ],
    verificationQueue,
    openIssueCount: openIssues.length,
  };
}

async function loadTaxWorkspaceState(profile: TaxProfileRecord) {
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
      orderBy: [{ registrationStatus: "asc" }, { createdAt: "asc" }],
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
        artifacts: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 12,
    }),
    prisma.taxJurisdictionReference.findMany({
      orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }, { authorityName: "asc" }],
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

  const openIssues = await reconcileTaxIssues(profile, registrations);
  const coworkerGuide = buildCoworkerGuide(profile, registrations, openIssues);

  return {
    registrations,
    periods,
    jurisdictionOptions,
    openIssues,
    coworkerGuide,
  };
}

export async function getTaxRemittanceWorkspace() {
  await requireManageFinance();

  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const workspaceState = await loadTaxWorkspaceState(profile);

  return {
    organization,
    profile,
    ...workspaceState,
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

  const registrations = await prisma.taxRegistration.findMany({
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
  });
  await reconcileTaxIssues(updated, registrations);

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

  const registrations = await prisma.taxRegistration.findMany({
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
  });
  await reconcileTaxIssues(profile, registrations);

  revalidateTaxRoutes();
  return created;
}

export async function verifyTaxRegistration(input: VerifyTaxRegistrationInput) {
  await requireManageFinance();
  const parsed = verifyTaxRegistrationSchema.parse(input);

  const registration = await prisma.taxRegistration.findFirst({
    where: { id: parsed.registrationId },
  });

  if (!registration) {
    throw new Error("Tax registration not found.");
  }

  const updated = await prisma.taxRegistration.update({
    where: { id: registration.id },
    data: {
      verifiedFromSourceUrl: parsed.verifiedFromSourceUrl,
      lastVerifiedAt: new Date(),
      confidence: parsed.confidence,
      portalAccountNotes: appendNote(registration.portalAccountNotes, parsed.portalAccountNotes),
    },
  });

  const profile = await prisma.organizationTaxProfile.findFirst({
    where: { id: registration.organizationTaxProfileId },
  });

  if (profile) {
    const registrations = await prisma.taxRegistration.findMany({
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
    });
    await reconcileTaxIssues(profile, registrations);
  } else {
    const matchingIssues = await prisma.taxIssue.findMany({
      where: {
        registrationId: registration.id,
        issueType: "tax_registration_live_verification_needed",
      },
    });
    for (const issue of matchingIssues) {
      if (issue.status === "resolved") continue;
      await prisma.taxIssue.update({
        where: { id: issue.id },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
        },
      });
    }
  }

  revalidateTaxRoutes();
  return updated;
}

export async function generateTaxObligationPeriods() {
  await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const registrations = await prisma.taxRegistration.findMany({
    where: {
      organizationTaxProfileId: profile.id,
      registrationStatus: "active",
      lastVerifiedAt: {
        not: null,
      },
    },
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
    orderBy: { effectiveFrom: "asc" },
  });

  const generatedPeriods: Array<{ id: string; periodId: string }> = [];
  const canSummarizeOrgTax = registrations.length === 1;
  const generationBoundary = new Date();

  for (const registration of registrations) {
    const monthsPerPeriod = periodMonthsForFrequency(registration.filingFrequency);
    if (!monthsPerPeriod) continue;

    let periodStart = registration.firstPeriodStart ?? registration.effectiveFrom;
    let iterationCount = 0;

    while (periodStart <= generationBoundary && iterationCount < 6) {
      const nextStart = addMonths(periodStart, monthsPerPeriod);
      const periodEnd = addDays(nextStart, -1);
      const dueDate = addDays(periodEnd, 30);

      const existing = await prisma.taxObligationPeriod.findFirst({
        where: {
          registrationId: registration.id,
          periodStart,
          periodEnd,
        },
      });

      let salesTaxAmount = 0;
      let inputTaxAmount = 0;

      if (canSummarizeOrgTax) {
        const [invoiceTotals, billTotals] = await Promise.all([
          prisma.invoice.aggregate({
            _sum: { taxAmount: true },
            where: {
              status: {
                notIn: ["draft", "void"],
              },
              issueDate: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
          }),
          prisma.bill.aggregate({
            _sum: { taxAmount: true },
            where: {
              status: {
                notIn: ["draft", "void"],
              },
              issueDate: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
          }),
        ]);

        salesTaxAmount = roundCurrency(decimalValue(invoiceTotals._sum.taxAmount));
        inputTaxAmount = roundCurrency(decimalValue(billTotals._sum.taxAmount));
      }

      const manualAdjustmentAmount = existing ? roundCurrency(decimalValue(existing.manualAdjustmentAmount)) : 0;
      const netTaxAmount = roundCurrency(salesTaxAmount - inputTaxAmount + manualAdjustmentAmount);

      if (existing) {
        await prisma.taxObligationPeriod.update({
          where: { id: existing.id },
          data: {
            dueDate,
            salesTaxAmount,
            inputTaxAmount,
            netTaxAmount,
          },
        });
        generatedPeriods.push({ id: existing.id, periodId: existing.periodId });
      } else {
        const created = await prisma.taxObligationPeriod.create({
          data: {
            periodId: periodPublicId(),
            registrationId: registration.id,
            periodStart,
            periodEnd,
            dueDate,
            status: "draft",
            salesTaxAmount,
            inputTaxAmount,
            netTaxAmount,
            manualAdjustmentAmount,
            exportStatus: "not_started",
          },
        });
        generatedPeriods.push({ id: created.id, periodId: created.periodId });
      }

      periodStart = nextStart;
      iterationCount += 1;
      if (registration.effectiveTo && periodStart > registration.effectiveTo) {
        break;
      }
    }
  }

  revalidateTaxRoutes();
  return generatedPeriods;
}

export async function prepareTaxFilingPacket(input: PrepareTaxFilingPacketInput) {
  const user = await requireManageFinance();
  const parsed = prepareTaxFilingPacketSchema.parse(input);

  const period = await prisma.taxObligationPeriod.findFirst({
    where: { id: parsed.periodId },
    include: {
      registration: {
        include: {
          jurisdictionReference: {
            select: {
              authorityName: true,
            },
          },
        },
      },
    },
  });

  if (!period) {
    throw new Error("Tax obligation period not found.");
  }

  const artifact = await prisma.taxFilingArtifact.create({
    data: {
      periodId: period.id,
      artifactType: "workpaper",
      notes: buildFilingPacketNotes(period),
      createdByUserId: user.id,
    },
  });

  await prisma.taxObligationPeriod.update({
    where: { id: period.id },
    data: {
      status: "ready",
      exportStatus: "prepared",
    },
  });

  revalidateTaxRoutes();
  return artifact;
}

export async function addTaxFilingArtifact(input: AddTaxFilingArtifactInput) {
  const user = await requireManageFinance();
  const parsed = addTaxFilingArtifactSchema.parse(input);

  const period = await prisma.taxObligationPeriod.findFirst({
    where: { id: parsed.periodId },
  });

  if (!period) {
    throw new Error("Tax obligation period not found.");
  }

  const artifact = await prisma.taxFilingArtifact.create({
    data: {
      periodId: period.id,
      artifactType: parsed.artifactType,
      storageKey: nullableString(parsed.storageKey),
      externalRef: nullableString(parsed.externalRef),
      sourceUrl: nullableString(parsed.sourceUrl),
      notes: nullableString(parsed.notes),
      createdByUserId: user.id,
    },
  });

  revalidateTaxRoutes();
  return artifact;
}
