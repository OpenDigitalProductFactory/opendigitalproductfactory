import { describe, expect, it } from "vitest";
import { resolveInvoiceDefaultTaxRate } from "./invoice-default-tax";

describe("resolveInvoiceDefaultTaxRate", () => {
  // ─── The bug: "No VAT" org must default to 0, not 20 ───────────────────────
  it("returns 0 when the org's tax model is 'none' (operator chose No VAT)", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: "none",
        profileVatRegistered: true, // even if the bootstrap profile was VAT-y
        profileDefaultTaxRate: 20,
      }),
    ).toBe(0);
  });

  it("returns the profile rate when the org's tax model is 'vat'", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: "vat",
        profileVatRegistered: true,
        profileDefaultTaxRate: 20,
      }),
    ).toBe(20);
  });

  it("honours a VAT-registered industry with a 0% rate (e.g. healthcare)", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: "vat",
        profileVatRegistered: true,
        profileDefaultTaxRate: 0,
      }),
    ).toBe(0);
  });

  // ─── No tax profile row yet → bootstrap from the applied profile ──────────
  it("falls back to the bootstrap profile vatRegistered=false → 0", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: null,
        profileVatRegistered: false,
        profileDefaultTaxRate: 0,
      }),
    ).toBe(0);
  });

  it("falls back to the bootstrap profile vatRegistered=true → profile rate", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: undefined,
        profileVatRegistered: true,
        profileDefaultTaxRate: 20,
      }),
    ).toBe(20);
  });

  // ─── Non-VAT tax models all default to 0 ──────────────────────────────────
  it.each(["hybrid", "simple_manual", "externally_calculated", "sales_tax", "unknown"])(
    "returns 0 for non-VAT tax model %s",
    (taxModel) => {
      expect(
        resolveInvoiceDefaultTaxRate({
          taxModel,
          profileVatRegistered: true,
          profileDefaultTaxRate: 20,
        }),
      ).toBe(0);
    },
  );

  // ─── Defensive: missing/invalid rate never leaks a guess ──────────────────
  it("returns 0 when VAT-registered but the profile rate is missing", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: "vat",
        profileVatRegistered: true,
        profileDefaultTaxRate: null,
      }),
    ).toBe(0);
  });

  it("returns 0 when there is no tax profile and no applied profile at all", () => {
    expect(
      resolveInvoiceDefaultTaxRate({
        taxModel: null,
        profileVatRegistered: null,
        profileDefaultTaxRate: null,
      }),
    ).toBe(0);
  });
});
