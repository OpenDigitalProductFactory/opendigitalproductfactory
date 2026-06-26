// apps/web/lib/finance/tax-remittance-core.ts
//
// Pure (no prisma / auth / Next.js) domain helpers for tax remittance: id
// generation, date/number/string utilities, and the managed-issue-type set.
// Extracted verbatim from lib/actions/tax-remittance.ts (BI-OPT-FAT-ACTIONS,
// Slice A) so the domain logic lives in the finance domain layer and is
// unit-testable on its own. Behavior-preserving relocation — identical bodies.

import { createHash } from "crypto";
import { nanoid } from "nanoid";

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
  return `TAX-REG-${nanoid(8).toUpperCase()}`;
}

export function issuePublicId() {
  return `TAX-ISS-${nanoid(8).toUpperCase()}`;
}

export function periodPublicId() {
  return `TAX-PER-${nanoid(8).toUpperCase()}`;
}

export function taxMonitorTaskId() {
  return `tax-monitor-${nanoid(8).toLowerCase()}`;
}

export function credentialPublicId() {
  return `TAX-CRED-${nanoid(8).toUpperCase()}`;
}

export function remittanceRunPublicId() {
  return `TAX-RUN-${nanoid(8).toUpperCase()}`;
}

export function taxExecutionTaskId() {
  return `tax-run-${nanoid(8).toLowerCase()}`;
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
