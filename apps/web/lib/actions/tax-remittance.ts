"use server";

import { createHash } from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { encryptSecret } from "@/lib/govern/credential-crypto";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import {
  addTaxFilingArtifactSchema,
  createTaxRegistrationSchema,
  prepareTaxFilingPacketSchema,
  prepareTaxRemittanceRunSchema,
  saveTaxAuthorityCredentialSchema,
  updateOrganizationTaxProfileSchema,
  updateTaxRemittanceRunStatusSchema,
  verifyTaxRegistrationSchema,
  type AddTaxFilingArtifactInput,
  type CreateTaxRegistrationInput,
  type PrepareTaxFilingPacketInput,
  type PrepareTaxRemittanceRunInput,
  type SaveTaxAuthorityCredentialInput,
  type UpdateOrganizationTaxProfileInput,
  type UpdateTaxRemittanceRunStatusInput,
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
  "tax_external_handoff_missing",
  "tax_dpf_filing_not_available",
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

function taxMonitorTaskId() {
  return `tax-monitor-${nanoid(8).toLowerCase()}`;
}

function credentialPublicId() {
  return `TAX-CRED-${nanoid(8).toUpperCase()}`;
}

function remittanceRunPublicId() {
  return `TAX-RUN-${nanoid(8).toUpperCase()}`;
}

function taxExecutionTaskId() {
  return `tax-run-${nanoid(8).toLowerCase()}`;
}

function stableTaxEntityId(prefix: string, ...parts: Array<string | number | Date | null | undefined>) {
  const digest = createHash("sha1")
    .update(
      parts
        .map((part) => {
          if (part instanceof Date) return part.toISOString();
          return part == null ? "" : String(part);
        })
        .join("|"),
    )
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  return `${prefix}-${digest}`;
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

async function createTaxNotification(userId: string, title: string, body: string) {
  await prisma.notification.create({
    data: {
      userId,
      type: "tax-remittance",
      title,
      body,
      deepLink: "/finance/settings/tax",
      read: false,
    },
  });
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

type LiabilityDraft = {
  snapshotId?: string;
  entryId: string;
  sourceType: string;
  sourceId: string;
  sourceLineItemId?: string | null;
  direction: "output" | "input" | "adjustment";
  taxType: string;
  taxCode?: string | null;
  taxableAmount: number;
  taxRate?: number | null;
  taxAmount: number;
  currency: string;
  occurredAt: Date;
  evidence?: Record<string, unknown>;
  notes?: string | null;
};

function taxableBaseFromLine(lineTotal: unknown, taxAmount: number) {
  return roundCurrency(Math.max(decimalValue(lineTotal) - taxAmount, 0));
}

function buildInvoiceLiabilityDrafts(
  registration: TaxRegistrationRecord,
  invoices: Array<{
    id: string;
    invoiceRef?: string | null;
    type?: string | null;
    currency?: string | null;
    issueDate: Date;
    lineItems: Array<{
      id: string;
      description?: string | null;
      lineTotal: unknown;
      taxRate: unknown;
      taxAmount: unknown;
    }>;
  }>,
): LiabilityDraft[] {
  const drafts: LiabilityDraft[] = [];

  for (const invoice of invoices) {
    for (const lineItem of invoice.lineItems) {
      const rawTaxAmount = roundCurrency(decimalValue(lineItem.taxAmount));
      if (!rawTaxAmount) continue;

      const isCredit = invoice.type === "credit_note";
      const signedTaxAmount = isCredit ? -Math.abs(rawTaxAmount) : rawTaxAmount;
      const taxRate = roundCurrency(decimalValue(lineItem.taxRate));

      drafts.push({
        snapshotId: stableTaxEntityId(
          "TAX-SNAP",
          registration.id,
          invoice.id,
          lineItem.id,
          invoice.issueDate,
          invoice.type ?? "standard",
        ),
        entryId: stableTaxEntityId(
          "TAX-LIAB",
          registration.id,
          invoice.id,
          lineItem.id,
          invoice.issueDate,
          invoice.type ?? "standard",
        ),
        sourceType: isCredit ? "credit_note" : "invoice_tax",
        sourceId: invoice.id,
        sourceLineItemId: lineItem.id,
        direction: "output",
        taxType: registration.taxType,
        taxCode: isCredit ? "credit_note" : "standard",
        taxableAmount: taxableBaseFromLine(lineItem.lineTotal, Math.abs(rawTaxAmount)),
        taxRate,
        taxAmount: signedTaxAmount,
        currency: invoice.currency ?? "GBP",
        occurredAt: invoice.issueDate,
        evidence: {
          invoiceRef: invoice.invoiceRef ?? null,
          description: lineItem.description ?? null,
        },
      });
    }
  }

  return drafts;
}

function buildBillLiabilityDrafts(
  registration: TaxRegistrationRecord,
  bills: Array<{
    id: string;
    billRef?: string | null;
    currency?: string | null;
    issueDate: Date;
    lineItems: Array<{
      id: string;
      description?: string | null;
      lineTotal: unknown;
      taxRate: unknown;
      taxAmount: unknown;
    }>;
  }>,
): LiabilityDraft[] {
  const drafts: LiabilityDraft[] = [];

  for (const bill of bills) {
    for (const lineItem of bill.lineItems) {
      const taxAmount = roundCurrency(decimalValue(lineItem.taxAmount));
      if (!taxAmount) continue;

      drafts.push({
        snapshotId: stableTaxEntityId("TAX-SNAP", registration.id, bill.id, lineItem.id, bill.issueDate, "bill"),
        entryId: stableTaxEntityId("TAX-LIAB", registration.id, bill.id, lineItem.id, bill.issueDate, "bill"),
        sourceType: "bill_tax",
        sourceId: bill.id,
        sourceLineItemId: lineItem.id,
        direction: "input",
        taxType: registration.taxType,
        taxCode: "standard",
        taxableAmount: taxableBaseFromLine(lineItem.lineTotal, taxAmount),
        taxRate: roundCurrency(decimalValue(lineItem.taxRate)),
        taxAmount,
        currency: bill.currency ?? "GBP",
        occurredAt: bill.issueDate,
        evidence: {
          billRef: bill.billRef ?? null,
          description: lineItem.description ?? null,
        },
      });
    }
  }

  return drafts;
}

async function upsertOperationalTaxIssue(input: {
  profileId: string;
  issueType: string;
  title: string;
  details: string;
  severity?: string;
  registrationId?: string | null;
  periodId?: string | null;
}) {
  const existing = await prisma.taxIssue.findMany({
    where: {
      organizationTaxProfileId: input.profileId,
      issueType: input.issueType,
      registrationId: input.registrationId ?? null,
      periodId: input.periodId ?? null,
      status: "open",
    },
  });

  const openIssue = existing[0];
  if (openIssue) {
    return prisma.taxIssue.update({
      where: { id: openIssue.id },
      data: {
        severity: input.severity ?? "high",
        title: input.title,
        details: input.details,
      },
    });
  }

  return prisma.taxIssue.create({
    data: {
      issueId: issuePublicId(),
      organizationTaxProfileId: input.profileId,
      registrationId: input.registrationId ?? null,
      periodId: input.periodId ?? null,
      issueType: input.issueType,
      severity: input.severity ?? "high",
      title: input.title,
      details: input.details,
      status: "open",
    },
  });
}

async function resolveOperationalTaxIssue(
  issueType: string,
  registrationId?: string | null,
  periodId?: string | null,
) {
  const issues = await prisma.taxIssue.findMany({
    where: {
      issueType,
      registrationId: registrationId ?? null,
      periodId: periodId ?? null,
      status: "open",
    },
  });

  for (const issue of issues) {
    await prisma.taxIssue.update({
      where: { id: issue.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
      },
    });
  }
}

async function persistLiabilityDrafts(
  profileId: string,
  registrationId: string,
  periodId: string,
  drafts: LiabilityDraft[],
) {
  await prisma.taxLiabilityEntry.deleteMany({
    where: { periodId },
  });

  for (const draft of drafts) {
    let decisionSnapshotId: string | null = null;

    if (draft.snapshotId) {
      const snapshot = await prisma.taxDecisionSnapshot.upsert({
        where: { snapshotId: draft.snapshotId },
        update: {
          sourceType: draft.sourceType,
          sourceId: draft.sourceId,
          sourceLineItemId: draft.sourceLineItemId ?? null,
          taxType: draft.taxType,
          taxCode: draft.taxCode ?? null,
          direction: draft.direction,
          taxableAmount: draft.taxableAmount,
          taxRate: draft.taxRate ?? null,
          taxAmount: draft.taxAmount,
          occurredAt: draft.occurredAt,
          evidence: (draft.evidence ?? {}) as import("@dpf/db").Prisma.InputJsonValue,
        },
        create: {
          snapshotId: draft.snapshotId,
          organizationTaxProfileId: profileId,
          registrationId,
          sourceType: draft.sourceType,
          sourceId: draft.sourceId,
          sourceLineItemId: draft.sourceLineItemId ?? null,
          taxType: draft.taxType,
          taxCode: draft.taxCode ?? null,
          direction: draft.direction,
          taxableAmount: draft.taxableAmount,
          taxRate: draft.taxRate ?? null,
          taxAmount: draft.taxAmount,
          jurisdictionRefId: null,
          occurredAt: draft.occurredAt,
          evidence: (draft.evidence ?? {}) as import("@dpf/db").Prisma.InputJsonValue,
        },
      });
      decisionSnapshotId = snapshot.id;
    }

    await prisma.taxLiabilityEntry.upsert({
      where: { entryId: draft.entryId },
      update: {
        periodId,
        decisionSnapshotId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        sourceLineItemId: draft.sourceLineItemId ?? null,
        direction: draft.direction,
        taxableAmount: draft.taxableAmount,
        taxAmount: draft.taxAmount,
        currency: draft.currency,
        notes: draft.notes ?? null,
        occurredAt: draft.occurredAt,
      },
      create: {
        entryId: draft.entryId,
        organizationTaxProfileId: profileId,
        registrationId,
        periodId,
        decisionSnapshotId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        sourceLineItemId: draft.sourceLineItemId ?? null,
        direction: draft.direction,
        taxableAmount: draft.taxableAmount,
        taxAmount: draft.taxAmount,
        currency: draft.currency,
        notes: draft.notes ?? null,
        occurredAt: draft.occurredAt,
      },
    });
  }
}

function computeNextCronRun(cronExpr: string, from: Date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return addDays(from, 1);

  const [minPart, hourPart, , , dowPart] = parts;
  const minute = minPart === "*" ? 0 : parseInt(minPart!, 10);
  const hour = hourPart === "*" ? from.getHours() : parseInt(hourPart!, 10);

  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  next.setHours(hour);

  if (next <= from) {
    next.setDate(next.getDate() + 1);
  }

  if (dowPart && dowPart !== "*") {
    const targetDays = dowPart.split(",").map((value) => parseInt(value, 10));
    let safety = 0;
    while (!targetDays.includes(next.getDay()) && safety < 8) {
      next.setDate(next.getDate() + 1);
      safety += 1;
    }
  }

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

  if (profile.handoffMode !== "dpf_readiness_only" && !nullableString(profile.externalSystem)) {
    issues.push({
      issueType: "tax_external_handoff_missing",
      severity: "high",
      title: "External filing handoff is not configured",
      details:
        "Record the accountant, filing partner, or external tax system that owns final filing and payment before treating this remittance workflow as operational.",
    });
  }

  if (profile.filingOwner === "dpf_coworker" && profile.handoffMode !== "dpf_readiness_only") {
    issues.push({
      issueType: "tax_dpf_filing_not_available",
      severity: "medium",
      title: "Direct DPF filing remains future-scope automation",
      details:
        "DPF can prepare registrations, periods, workpapers, and evidence today, but final statutory submission and payment still need an external handoff boundary.",
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

async function loadTaxWorkspaceState(profile: TaxProfileRecord, ownerUserId: string) {
  const [registrations, periods, jurisdictionOptions, monitoringTask, rawAuthorityCredentials] = await Promise.all([
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
        liabilityEntries: {
          orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
        },
        remittanceRuns: {
          orderBy: [{ createdAt: "desc" }],
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
    prisma.scheduledAgentTask.findFirst({
      where: {
        ownerUserId,
        routeContext: "/finance/settings/tax",
        title: "Tax Remittance Monitor",
      },
      select: {
        taskId: true,
        title: true,
        schedule: true,
        isActive: true,
        nextRunAt: true,
        lastRunAt: true,
        lastStatus: true,
      },
    }),
    prisma.taxAuthorityCredential.findMany({
      where: { organizationTaxProfileId: profile.id },
      select: {
        id: true,
        credentialId: true,
        registrationId: true,
        authorityName: true,
        portalBaseUrl: true,
        credentialOwnerMode: true,
        status: true,
        authMode: true,
        secretRef: true,
        mfaMode: true,
        lastVerifiedAt: true,
        lastFailureAt: true,
        lastFailureReason: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
  ]);

  const authorityCredentials = rawAuthorityCredentials.map(({ secretRef, ...credential }) => ({
    ...credential,
    hasSecret: Boolean(secretRef),
  }));

  const openIssues = await reconcileTaxIssues(profile, registrations);
  const coworkerGuide = buildCoworkerGuide(profile, registrations, openIssues);
  const now = new Date();
  const dueSoonCount = periods.filter((period) => {
    if (["filed", "paid"].includes(period.status)) return false;
    const dueDate = new Date(period.dueDate);
    return dueDate >= now && dueDate <= addDays(now, 14);
  }).length;
  const overdueCount = periods.filter((period) => {
    if (["filed", "paid"].includes(period.status)) return false;
    return new Date(period.dueDate) < now;
  }).length;

  return {
    registrations,
    periods,
    jurisdictionOptions,
    openIssues,
    authorityCredentials,
    coworkerGuide,
    monitoring: {
      dueSoonCount,
      overdueCount,
      monitoringTask,
    },
  };
}

export async function getTaxRemittanceWorkspace() {
  const user = await requireManageFinance();

  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const workspaceState = await loadTaxWorkspaceState(profile, user.id);

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
      filingOwner: parsed.filingOwner,
      handoffMode: parsed.handoffMode,
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

      const manualAdjustmentAmount = existing ? roundCurrency(decimalValue(existing.manualAdjustmentAmount)) : 0;
      const liabilityDrafts: LiabilityDraft[] = [];

      if (canSummarizeOrgTax) {
        const [invoices, bills] = await Promise.all([
          prisma.invoice.findMany({
            where: {
              status: {
                notIn: ["draft", "void"],
              },
              issueDate: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
            select: {
              id: true,
              invoiceRef: true,
              type: true,
              currency: true,
              issueDate: true,
              lineItems: {
                select: {
                  id: true,
                  description: true,
                  lineTotal: true,
                  taxRate: true,
                  taxAmount: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
          }),
          prisma.bill.findMany({
            where: {
              status: {
                notIn: ["draft", "void"],
              },
              issueDate: {
                gte: periodStart,
                lte: periodEnd,
              },
            },
            select: {
              id: true,
              billRef: true,
              currency: true,
              issueDate: true,
              lineItems: {
                select: {
                  id: true,
                  description: true,
                  lineTotal: true,
                  taxRate: true,
                  taxAmount: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
          }),
        ]);

        liabilityDrafts.push(...buildInvoiceLiabilityDrafts(registration, invoices));
        liabilityDrafts.push(...buildBillLiabilityDrafts(registration, bills));
      }

      if (manualAdjustmentAmount !== 0) {
        liabilityDrafts.push({
          entryId: stableTaxEntityId("TAX-LIAB", registration.id, "manual_adjustment", periodStart, periodEnd),
          sourceType: "manual_adjustment",
          sourceId: existing?.id ?? stableTaxEntityId("TAX-PERIOD", registration.id, periodStart, periodEnd),
          sourceLineItemId: null,
          direction: "adjustment",
          taxType: registration.taxType,
          taxCode: "manual_adjustment",
          taxableAmount: 0,
          taxRate: null,
          taxAmount: manualAdjustmentAmount,
          currency: "GBP",
          occurredAt: dueDate,
          notes: "Manual period adjustment carried on the obligation period.",
        });
      }

      const salesTaxAmount = roundCurrency(
        liabilityDrafts
          .filter((draft) => draft.direction === "output")
          .reduce((sum, draft) => sum + draft.taxAmount, 0),
      );
      const inputTaxAmount = roundCurrency(
        liabilityDrafts
          .filter((draft) => draft.direction === "input")
          .reduce((sum, draft) => sum + draft.taxAmount, 0),
      );
      const adjustmentAmount = roundCurrency(
        liabilityDrafts
          .filter((draft) => draft.direction === "adjustment")
          .reduce((sum, draft) => sum + draft.taxAmount, 0),
      );
      const netTaxAmount = roundCurrency(salesTaxAmount - inputTaxAmount + adjustmentAmount);

      let periodRecordId: string;
      if (existing) {
        const updated = await prisma.taxObligationPeriod.update({
          where: { id: existing.id },
          data: {
            dueDate,
            salesTaxAmount,
            inputTaxAmount,
            manualAdjustmentAmount,
            netTaxAmount,
          },
        });
        periodRecordId = updated.id;
        generatedPeriods.push({ id: updated.id, periodId: existing.periodId });
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
            dueSoonNotifiedAt: null,
            overdueNotifiedAt: null,
          },
        });
        periodRecordId = created.id;
        generatedPeriods.push({ id: created.id, periodId: created.periodId });
      }

      await persistLiabilityDrafts(profile.id, registration.id, periodRecordId, liabilityDrafts);

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

export async function reviewTaxDeadlineNotifications() {
  const user = await requireManageFinance();
  const organization = await requireOrganization();
  const profile = await getOrCreateTaxProfile(organization.id);
  const now = new Date();
  const dueSoonBoundary = addDays(now, 14);

  const periods = await prisma.taxObligationPeriod.findMany({
    where: {
      registration: {
        organizationTaxProfileId: profile.id,
      },
      status: {
        notIn: ["filed", "paid"],
      },
      dueDate: {
        lte: dueSoonBoundary,
      },
    },
    include: {
      registration: {
        include: {
          jurisdictionReference: {
            select: {
              authorityName: true,
              countryCode: true,
              stateProvinceCode: true,
            },
          },
        },
      },
    },
    orderBy: { dueDate: "asc" },
  });

  let notificationsCreated = 0;

  for (const period of periods) {
    const dueDate = new Date(period.dueDate);
    const authorityName = period.registration.jurisdictionReference.authorityName;

    if (dueDate < now && !period.overdueNotifiedAt) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "tax-remittance",
          title: `Overdue tax remittance: ${authorityName}`,
          body: `${period.periodId} is overdue for filing or payment. Review the tax remittance workspace and resolve the blocked period immediately.`,
          deepLink: "/finance/settings/tax",
          read: false,
        },
      });
      await prisma.taxObligationPeriod.update({
        where: { id: period.id },
        data: { overdueNotifiedAt: now },
      });
      notificationsCreated += 1;
      continue;
    }

    if (dueDate >= now && !period.dueSoonNotifiedAt) {
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: "tax-remittance",
          title: `Upcoming tax remittance: ${authorityName}`,
          body: `${period.periodId} is due on ${dueDate.toISOString().slice(0, 10)}. Review the filing packet, evidence, and handoff status now.`,
          deepLink: "/finance/settings/tax",
          read: false,
        },
      });
      await prisma.taxObligationPeriod.update({
        where: { id: period.id },
        data: { dueSoonNotifiedAt: now },
      });
      notificationsCreated += 1;
    }
  }

  revalidateTaxRoutes();
  return { notificationsCreated };
}

export async function ensureTaxDeadlineMonitoringTask() {
  const user = await requireManageFinance();

  const existing = await prisma.scheduledAgentTask.findFirst({
    where: {
      ownerUserId: user.id,
      routeContext: "/finance/settings/tax",
      title: "Tax Remittance Monitor",
    },
    select: {
      taskId: true,
      title: true,
      schedule: true,
      isActive: true,
      nextRunAt: true,
      lastRunAt: true,
      lastStatus: true,
    },
  });

  if (existing) {
    return { created: false, task: existing };
  }

  const schedule = "0 8 * * *";
  const nextRunAt = computeNextCronRun(schedule, new Date());
  const taskId = taxMonitorTaskId();

  const task = await prisma.scheduledAgentTask.create({
    data: {
      taskId,
      agentId: "finance-agent",
      title: "Tax Remittance Monitor",
      prompt:
        "Review tax remittance periods due in the next 14 days or already overdue. Highlight blocked filings, missing evidence, and missing external handoff details, then summarize what needs attention.",
      routeContext: "/finance/settings/tax",
      schedule,
      timezone: "America/Chicago",
      ownerUserId: user.id,
      nextRunAt,
    },
    select: {
      taskId: true,
      title: true,
      schedule: true,
      isActive: true,
      nextRunAt: true,
      lastRunAt: true,
      lastStatus: true,
    },
  });

  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: {
      jobId: taskId,
      name: "Agent: Tax Remittance Monitor",
      schedule,
      nextRunAt,
    },
    update: {
      name: "Agent: Tax Remittance Monitor",
      schedule,
      nextRunAt,
    },
  });

  revalidateTaxRoutes();
  return { created: true, task };
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

export async function saveTaxAuthorityCredential(input: SaveTaxAuthorityCredentialInput) {
  await requireManageFinance();
  const parsed = saveTaxAuthorityCredentialSchema.parse(input);

  const registration = await prisma.taxRegistration.findFirst({
    where: { id: parsed.registrationId },
    include: {
      jurisdictionReference: {
        select: {
          authorityName: true,
        },
      },
    },
  });

  if (!registration) {
    throw new Error("Tax registration not found.");
  }

  const encryptedSecret = parsed.secretRef ? encryptSecret(parsed.secretRef) : undefined;
  const existing = await prisma.taxAuthorityCredential.findFirst({
    where: { registrationId: registration.id },
  });

  const payload = {
    authorityName: registration.jurisdictionReference.authorityName,
    portalBaseUrl: nullableString(parsed.portalBaseUrl),
    credentialOwnerMode: parsed.credentialOwnerMode,
    status: parsed.status,
    authMode: parsed.authMode,
    ...(encryptedSecret !== undefined ? { secretRef: encryptedSecret } : {}),
    mfaMode: parsed.mfaMode,
    notes: nullableString(parsed.notes),
    lastVerifiedAt: parsed.status === "active" ? new Date() : null,
    ...(parsed.status === "blocked"
      ? { lastFailureAt: new Date(), lastFailureReason: "Credential blocked during finance setup." }
      : {}),
  };

  const credential = existing
    ? await prisma.taxAuthorityCredential.update({
        where: { id: existing.id },
        data: payload,
      })
    : await prisma.taxAuthorityCredential.create({
        data: {
          credentialId: credentialPublicId(),
          organizationTaxProfileId: registration.organizationTaxProfileId,
          registrationId: registration.id,
          ...payload,
        },
      });

  if (parsed.status === "active") {
    await resolveOperationalTaxIssue("tax_execution_credential_missing", registration.id, null);
  } else if (parsed.status === "blocked") {
    await upsertOperationalTaxIssue({
      profileId: registration.organizationTaxProfileId,
      issueType: "tax_execution_credential_missing",
      registrationId: registration.id,
      title: `${registration.jurisdictionReference.authorityName} credential needs attention`,
      details: "Execution cannot proceed until a valid authority credential is available.",
      severity: "high",
    });
  }

  revalidateTaxRoutes();
  return credential;
}

export async function prepareTaxRemittanceRun(input: PrepareTaxRemittanceRunInput) {
  const user = await requireManageFinance();
  const parsed = prepareTaxRemittanceRunSchema.parse(input);

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

  const credential = await prisma.taxAuthorityCredential.findFirst({
    where: {
      registrationId: period.registrationId,
      status: "active",
    },
  });

  const scheduledFor = parsed.scheduleFor ? new Date(parsed.scheduleFor) : null;
  const missingCredential = parsed.executionMode === "scheduled_coworker" && !credential;

  const run = await prisma.taxRemittanceRun.create({
    data: {
      runId: remittanceRunPublicId(),
      periodId: period.id,
      credentialId: credential?.id ?? null,
      status: missingCredential ? "blocked" : parsed.executionMode === "scheduled_coworker" ? "scheduled" : "draft",
      executionMode: parsed.executionMode,
      scheduledFor,
      createdByAgentId: parsed.executionMode === "scheduled_coworker" ? "finance-agent" : null,
      createdByUserId: user.id,
      failureCode: missingCredential ? "missing_credential" : null,
      failureDetails: missingCredential
        ? `Execution is blocked because ${period.registration.jurisdictionReference.authorityName} has no active authority credential.`
        : null,
    },
  });

  if (missingCredential) {
    await upsertOperationalTaxIssue({
      profileId: period.registration.organizationTaxProfileId,
      issueType: "tax_execution_credential_missing",
      registrationId: period.registrationId,
      periodId: period.id,
      title: `${period.registration.jurisdictionReference.authorityName} execution is blocked`,
      details: "A valid authority credential is required before the coworker can file or pay this period.",
      severity: "high",
    });
    await createTaxNotification(
      user.id,
      `Tax execution blocked: ${period.registration.jurisdictionReference.authorityName}`,
      `${period.periodId} cannot be scheduled for coworker execution because no active authority credential is recorded.`,
    );
    revalidateTaxRoutes();
    return run;
  }

  if (parsed.executionMode === "scheduled_coworker" && scheduledFor) {
    const taskId = taxExecutionTaskId();
    const schedule = `${scheduledFor.getUTCMinutes()} ${scheduledFor.getUTCHours()} ${scheduledFor.getUTCDate()} ${scheduledFor.getUTCMonth() + 1} *`;

    await prisma.scheduledAgentTask.create({
      data: {
        taskId,
        agentId: "finance-agent",
        title: `Tax remittance execution ${period.periodId}`,
        prompt: `Review tax remittance run ${run.runId} for ${period.periodId}. If credentials and evidence remain valid, submit the filing package and record the outcome. If anything is blocked, update the run with the failure reason and raise the appropriate issue.`,
        routeContext: "/finance/settings/tax",
        schedule,
        timezone: "America/Chicago",
        ownerUserId: user.id,
        nextRunAt: scheduledFor,
      },
    });

    await prisma.scheduledJob.upsert({
      where: { jobId: taskId },
      create: {
        jobId: taskId,
        name: `Agent: Tax remittance execution ${period.periodId}`,
        schedule,
        nextRunAt: scheduledFor,
      },
      update: {
        name: `Agent: Tax remittance execution ${period.periodId}`,
        schedule,
        nextRunAt: scheduledFor,
      },
    });
  }

  await resolveOperationalTaxIssue("tax_execution_credential_missing", period.registrationId, period.id);
  revalidateTaxRoutes();
  return run;
}

export async function updateTaxRemittanceRunStatus(input: UpdateTaxRemittanceRunStatusInput) {
  const user = await requireManageFinance();
  const parsed = updateTaxRemittanceRunStatusSchema.parse(input);

  const run = await prisma.taxRemittanceRun.findFirst({
    where: { id: parsed.runId },
    include: {
      period: {
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
      },
    },
  });

  if (!run) {
    throw new Error("Tax remittance run not found.");
  }

  const now = new Date();
  const updateData: Record<string, unknown> = {
    status: parsed.status,
    confirmationRef: nullableString(parsed.confirmationRef),
    failureCode: nullableString(parsed.failureCode),
    failureDetails: nullableString(parsed.failureDetails),
  };

  if (parsed.status === "submitted") {
    updateData.submittedAt = now;
  }
  if (parsed.status === "paid") {
    updateData.paidAt = now;
    updateData.completedAt = now;
  }
  if (parsed.status === "failed" || parsed.status === "blocked") {
    updateData.completedAt = now;
  }

  const updated = await prisma.taxRemittanceRun.update({
    where: { id: run.id },
    data: updateData,
  });

  if (parsed.status === "submitted") {
    await prisma.taxObligationPeriod.update({
      where: { id: run.periodId },
      data: {
        status: "filed",
        filedAt: now,
        confirmationRef: nullableString(parsed.confirmationRef),
      },
    });
    await resolveOperationalTaxIssue("tax_execution_failed", run.period.registrationId, run.periodId);
    await createTaxNotification(
      user.id,
      `Tax remittance submitted: ${run.period.registration.jurisdictionReference.authorityName}`,
      `${run.period.periodId} was marked submitted${parsed.confirmationRef ? ` with confirmation ${parsed.confirmationRef}` : ""}.`,
    );
  }

  if (parsed.status === "paid") {
    await prisma.taxObligationPeriod.update({
      where: { id: run.periodId },
      data: {
        status: "paid",
        paidAt: now,
        confirmationRef: nullableString(parsed.confirmationRef),
      },
    });
    await resolveOperationalTaxIssue("tax_execution_failed", run.period.registrationId, run.periodId);
    await createTaxNotification(
      user.id,
      `Tax remittance paid: ${run.period.registration.jurisdictionReference.authorityName}`,
      `${run.period.periodId} was marked paid${parsed.confirmationRef ? ` with confirmation ${parsed.confirmationRef}` : ""}.`,
    );
  }

  if (parsed.status === "failed" || parsed.status === "blocked") {
    await upsertOperationalTaxIssue({
      profileId: run.period.registration.organizationTaxProfileId,
      issueType: "tax_execution_failed",
      registrationId: run.period.registrationId,
      periodId: run.periodId,
      title: `${run.period.registration.jurisdictionReference.authorityName} execution failed`,
      details:
        nullableString(parsed.failureDetails) ??
        "The remittance run failed and needs human follow-up before filing can continue.",
      severity: "high",
    });
    await createTaxNotification(
      user.id,
      `Tax remittance failed: ${run.period.registration.jurisdictionReference.authorityName}`,
      `${run.period.periodId} failed${parsed.failureDetails ? `: ${parsed.failureDetails}` : "."}`,
    );
  }

  revalidateTaxRoutes();
  return updated;
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
