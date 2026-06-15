// Resolve the default line-item tax rate (%) for a NEW customer invoice.
//
// The bug this closes (Runs 6 & 7 audit): every invoice form hardcoded a 20%
// tax default, so a "No VAT" org still saw 20% on every line. The runtime
// truth for whether the org charges VAT is OrganizationTaxProfile.taxModel
// (the setup wizard writes "vat" | "none"); the per-industry rate comes from
// the applied archetype finance profile (defaultTaxRate). Bills already do the
// equivalent thing with a fixed 0% — see app/(shell)/finance/bills/new/page.tsx.
//
// This file is intentionally dependency-free (no prisma, no @dpf/db) so it is
// safe to unit-test in isolation and never drags a server-only module into a
// client bundle. The server page resolves the DB inputs and calls this.

export interface InvoiceDefaultTaxInput {
  /** OrganizationTaxProfile.taxModel — "vat" | "none" | "hybrid" | … or null when no profile row exists yet. */
  taxModel: string | null | undefined;
  /** vatRegistered from the applied archetype finance profile, used only as a bootstrap hint when no tax profile row exists. */
  profileVatRegistered: boolean | null | undefined;
  /** defaultTaxRate (%) from the applied archetype finance profile. */
  profileDefaultTaxRate: number | null | undefined;
}

/**
 * Pure resolver. Returns the tax rate (%) a new invoice line should default to.
 *
 * Rules:
 *  - No tax profile row yet → fall back to the bootstrap profile's vatRegistered
 *    flag (UK professional-services bootstrap is VAT-registered; US retail is not).
 *  - A tax profile exists → only an explicit "vat" model defaults to a VAT rate.
 *    Every other model ("none", "hybrid", US sales-tax modes, …) defaults to 0;
 *    those operators set tax per line.
 *  - When VAT-registered, use the profile's per-industry defaultTaxRate (which is
 *    correctly 0 for VAT-exempt industries like healthcare). Falls back to 0 if
 *    the rate is missing/invalid rather than guessing a country standard rate.
 */
export function resolveInvoiceDefaultTaxRate(input: InvoiceDefaultTaxInput): number {
  const vatRegistered =
    input.taxModel == null
      ? Boolean(input.profileVatRegistered)
      : input.taxModel === "vat";

  if (!vatRegistered) return 0;

  const rate = input.profileDefaultTaxRate;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : 0;
}
