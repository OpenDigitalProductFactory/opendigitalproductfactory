// Per-field data classification (BI-81ABBDA2).
//
// THE GAP THIS FILLS
// The platform could classify a whole MODEL by confidentiality
// (packages/db/src/table-classification.ts: public|internal|confidential|
// restricted) but had NO per-FIELD classification and NO data-TYPE axis. So
// PatientProfile and ApiToken were both merely "restricted" — PHI and secrets
// indistinguishable — and the question "which fields hold payment-card data?"
// could not be answered by query at all: BusinessContext.handlesCardPayments is
// one org-level boolean with no join to any column, and the build path detects
// cardholder scope by REGEX over free-text descriptions. The factual answer
// today is "no field holds cardholder data" (DPF stores a Stripe token
// reference, never a PAN) — but that was true BY ACCIDENT, not by inventory.
//
// THE DESIGN (reconcile, do not invent)
// The category vocabulary is the EXISTING DataCategory in ./taxonomy.ts — NOT a
// new parallel enum. A field's `categories` are DataCategory values (identity,
// contact, personal-attribute cover PII; financial; credential-secret; …). The
// two things DataCategory cannot express are the regulated SCOPES that carry
// specific legal regimes — payment-card (PCI-DSS) and health (PHI/HIPAA) — so a
// small orthogonal `RegulatedScope` axis is added rather than bloating
// DataCategory (which has many exhaustive consumers). Confidentiality
// (DataSensitivity) stays a third, orthogonal axis on table-classification.ts.
//
// This registry is code (queryable in-process, drift-guarded by
// field-classification.schema.test.ts, which fails if any keyed Model.field is
// not a real column) rather than a flat doc. It is an EXTENSIBLE SEED INVENTORY,
// not exhaustive coverage of every field — coverage grows the same way the
// stewardship-scope baseline (BI-C34E09B0) does. What it guarantees today is
// that regulated fields are declarable and the load-bearing questions
// ("which fields hold cardholder data / PHI / credentials?") are answerable by
// query instead of by regex or assumption. Blocks BI-0B4B16CA (condition→role),
// which needs a computable data class, not a regex over prose.

import type { DataCategory } from "./taxonomy";

/**
 * Regulated data scope — a legal regime that attaches to specific data, ORTHOGONAL
 * to both confidentiality and DataCategory. `none` means no special regime beyond
 * the field's categories. This is the axis that makes "which fields hold
 * cardholder data?" a query.
 */
export type RegulatedScope = "none" | "pci-cardholder" | "phi-health";

export const ALL_REGULATED_SCOPES: readonly RegulatedScope[] = [
  "none",
  "pci-cardholder",
  "phi-health",
] as const;

export interface FieldClassification {
  /** DataCategory values (from ./taxonomy.ts) this field carries. */
  categories: DataCategory[];
  /** Regulated legal regime, if any. */
  regulatedScope: RegulatedScope;
  /** Why this classification — especially load-bearing for the PCI answer. */
  note?: string;
}

/**
 * Per-field classification, keyed by "Model.field" (PascalCase model, exact
 * column name). Guarded against schema drift by field-classification.schema.test.ts.
 *
 * SEED INVENTORY of the clearest regulated fields — credentials, PII, financial,
 * PHI. Extend as coverage grows; every entry must name a real column.
 */
export const FIELD_DATA_CLASSIFICATION: Readonly<Record<string, FieldClassification>> = Object.freeze({
  // ── Credentials / secrets (credential-secret) ─────────────────────────────
  "CredentialEntry.clientSecret": { categories: ["credential-secret"], regulatedScope: "none" },
  "CredentialEntry.cachedToken": { categories: ["credential-secret"], regulatedScope: "none" },
  "CredentialEntry.refreshToken": { categories: ["credential-secret"], regulatedScope: "none" },
  "ApiToken.token": { categories: ["credential-secret"], regulatedScope: "none" },
  "CustomerContact.passwordHash": { categories: ["credential-secret"], regulatedScope: "none" },

  // ── PII — identity / contact ──────────────────────────────────────────────
  "CustomerContact.email": { categories: ["contact"], regulatedScope: "none" },
  "CustomerContact.phone": { categories: ["contact"], regulatedScope: "none" },
  "CustomerContact.firstName": { categories: ["identity"], regulatedScope: "none" },
  "CustomerContact.lastName": { categories: ["identity"], regulatedScope: "none" },

  // ── Financial — the load-bearing PCI answer ───────────────────────────────
  // DPF stores a Stripe token REFERENCE, never a primary account number. This is
  // the field a naive audit would assume holds cardholder data; classifying it
  // explicitly is what lets the platform ANSWER "no field holds cardholder data"
  // by inventory rather than by accident.
  "Payment.stripePaymentId": {
    categories: ["financial"],
    regulatedScope: "none",
    note: "Stripe payment-intent token reference, NOT cardholder data (no PAN/CVV/expiry stored). This is why fieldsHoldingCardholderData() is empty by inventory.",
  },
  "Payment.amount": { categories: ["financial"], regulatedScope: "none" },
  "Payment.reference": { categories: ["financial"], regulatedScope: "none" },

  // ── PHI — health regime ───────────────────────────────────────────────────
  // PatientProfile is inherently health-scoped; these fields carry PHI.
  "PatientProfile.accessibilityNeeds": {
    categories: ["personal-attribute"],
    regulatedScope: "phi-health",
  },
  "PatientProfile.communicationPreferences": {
    categories: ["personal-attribute"],
    regulatedScope: "phi-health",
  },
});

/** Keys are "Model.field"; split helper for the drift guard + reporting. */
export function parseFieldKey(key: string): { model: string; field: string } | null {
  const dot = key.indexOf(".");
  if (dot <= 0 || dot === key.length - 1) return null;
  return { model: key.slice(0, dot), field: key.slice(dot + 1) };
}

/** Classification for a specific "Model.field", or null if unclassified. */
export function classifyField(model: string, field: string): FieldClassification | null {
  return FIELD_DATA_CLASSIFICATION[`${model}.${field}`] ?? null;
}

/** Every "Model.field" carrying a given DataCategory. */
export function fieldsInCategory(category: DataCategory): string[] {
  return Object.entries(FIELD_DATA_CLASSIFICATION)
    .filter(([, c]) => c.categories.includes(category))
    .map(([k]) => k);
}

/** Every "Model.field" under a given regulated scope. */
export function fieldsWithRegulatedScope(scope: RegulatedScope): string[] {
  return Object.entries(FIELD_DATA_CLASSIFICATION)
    .filter(([, c]) => c.regulatedScope === scope)
    .map(([k]) => k);
}

/**
 * THE load-bearing query the BI names: which fields hold payment-card data?
 * Returns the inventory, not a regex guess. Empty today — by inventory, because
 * DPF stores Stripe token references, not cardholder data.
 */
export function fieldsHoldingCardholderData(): string[] {
  return fieldsWithRegulatedScope("pci-cardholder");
}

/** Which fields hold PHI (health regime). */
export function fieldsHoldingPhi(): string[] {
  return fieldsWithRegulatedScope("phi-health");
}
