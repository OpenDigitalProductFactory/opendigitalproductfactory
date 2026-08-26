// apps/web/lib/finance/tax-remittance-core.ts
//
// Pure (no prisma / auth / Next.js) domain helpers for tax remittance: id
// generation, date/number/string utilities, and the managed-issue-type set.
// Extracted verbatim from lib/actions/tax-remittance.ts (BI-OPT-FAT-ACTIONS,
// Slice A) so the domain logic lives in the finance domain layer and is
// unit-testable on its own. Behavior-preserving relocation — identical bodies.

import { createHash } from "crypto";
import { newId } from "@/lib/shared/new-id";
import {
  summariseComponents,
  type TaxPeriodComponentKind,
} from "@/lib/finance/tax-period-components";

export const MANAGED_TAX_ISSUE_TYPES = new Set([
  "tax_setup_mode_unknown",
  "tax_home_jurisdiction_missing",
  "tax_footprint_missing",
  "tax_registration_research_needed",
  "tax_registration_number_missing",
  "tax_registration_live_verification_needed",
  "tax_external_handoff_missing",
  "tax_dpf_filing_not_available",
]);

export function nullableString(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function appendNote(existing: string | null, incoming?: string | null) {
  const next = nullableString(incoming);
  if (!next) return existing;
  const current = nullableString(existing);
  if (!current) return next;
  if (current.includes(next)) return current;
  return `${current}\n${next}`;
}

export function registrationPublicId() {
  return `TAX-REG-${newId(8).toUpperCase()}`;
}

export function issuePublicId() {
  return `TAX-ISS-${newId(8).toUpperCase()}`;
}

export function periodPublicId() {
  return `TAX-PER-${newId(8).toUpperCase()}`;
}

export function taxMonitorTaskId() {
  return `tax-monitor-${newId(8).toLowerCase()}`;
}

export function credentialPublicId() {
  return `TAX-CRED-${newId(8).toUpperCase()}`;
}

export function remittanceRunPublicId() {
  return `TAX-RUN-${newId(8).toUpperCase()}`;
}

export function taxExecutionTaskId() {
  return `tax-run-${newId(8).toLowerCase()}`;
}

export function stableTaxEntityId(prefix: string, ...parts: Array<string | number | Date | null | undefined>) {
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

export function issueKey(issueType: string, registrationId?: string | null, periodId?: string | null) {
  return [issueType, registrationId ?? "profile", periodId ?? "none"].join(":");
}

export function decimalValue(value: unknown) {
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

export function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

export function taxableBaseFromLine(lineTotal: unknown, taxAmount: number) {
  return roundCurrency(Math.max(decimalValue(lineTotal) - taxAmount, 0));
}

// ---------------------------------------------------------------------------
// BI-OPT-FAT-ACTIONS (tax-remittance remainder): additional pure domain logic
// relocated verbatim from lib/actions/tax-remittance.ts - structural record
// shapes, liability-draft builders, period/date math, filing-packet notes, and
// the managed-issue / coworker-guide projections. No prisma / auth / Next.js.
// Behavior byte-for-byte preserved; orchestration stays in the action file.
// ---------------------------------------------------------------------------

// Structural profile shape carrying only the fields the managed-issue and
// coworker-guide projections read. The action passes its full
// OrganizationTaxProfile record (a structural supertype) unchanged.
type TaxProfileRecord = {
  setupMode: string;
  homeCountryCode: string | null;
  footprintSummary: string | null;
  handoffMode: string;
  externalSystem: string | null;
  filingOwner: string;
};

export type TaxRegistrationRecord = {
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

export type ManagedTaxIssueDraft = {
  issueType: string;
  severity: string;
  title: string;
  details: string;
  registrationId?: string | null;
  periodId?: string | null;
};

export type LiabilityDraft = {
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

export function buildInvoiceLiabilityDrafts(
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

export function buildBillLiabilityDrafts(
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

export function computeNextCronRun(cronExpr: string, from: Date) {
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

export function periodMonthsForFrequency(filingFrequency: string) {
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

export function buildFilingPacketNotes(period: {
  periodStart: Date;
  periodEnd: Date;
  /**
   * Optional: a caller that forgot the `components` include should produce a
   * packet with no component lines, not a crash on a filing path.
   */
  components?: readonly { componentKind: TaxPeriodComponentKind; amount: unknown }[];
  netTaxAmount: unknown;
  registration: {
    taxType: string;
    registrationNumber: string | null;
    jurisdictionReference: {
      authorityName: string;
    };
  };
}) {
  const totals = summariseComponents(
    (period.components ?? []).map((c) => ({
      componentKind: c.componentKind,
      amount: roundCurrency(decimalValue(c.amount)),
    })),
  );
  const netTaxAmount = roundCurrency(decimalValue(period.netTaxAmount));

  // Only the lines this period actually has. A payroll packet listing "Sales
  // tax captured: 0.00" reads as a filing that charged no sales tax, rather
  // than one that was never about sales tax at all.
  const componentLines: string[] = [];
  if (totals.sales_output !== 0) componentLines.push(`Sales tax captured: ${totals.sales_output.toFixed(2)}`);
  if (totals.sales_input !== 0) componentLines.push(`Input tax captured: ${totals.sales_input.toFixed(2)}`);
  if (totals.employee_withheld !== 0) {
    componentLines.push(`Employee withheld: ${totals.employee_withheld.toFixed(2)}`);
  }
  if (totals.employer_contribution !== 0) {
    componentLines.push(`Employer contribution: ${totals.employer_contribution.toFixed(2)}`);
  }

  return [
    `${period.registration.jurisdictionReference.authorityName} ${period.registration.taxType} filing packet`,
    `Period: ${period.periodStart.toISOString().slice(0, 10)} to ${period.periodEnd.toISOString().slice(0, 10)}`,
    `Registration: ${period.registration.registrationNumber ?? "pending"}`,
    ...componentLines,
    `Net tax due: ${netTaxAmount.toFixed(2)}`,
  ].join("\n");
}

export function buildManagedTaxIssues(
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

export function buildCoworkerGuide(
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
