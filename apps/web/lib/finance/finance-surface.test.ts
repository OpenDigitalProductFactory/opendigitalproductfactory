import { describe, expect, it } from "vitest";
import {
  isFinanceInvoiceContext,
  isOwnerFirstFinanceCategory,
  resolveFinanceInvoiceCopy,
  resolveFinanceSurface,
} from "./finance-surface";

// Accounting internals that must NOT lead the surface for a restaurant owner.
// They are allowed only inside the deferred advanced sections.
const INTERNAL_ROUTES = [
  "/finance/reports/vat-summary",
  "/finance/settings/tax",
  "/finance/reports/general-ledger",
  "/finance/settings/dunning",
  "/finance/payment-runs",
  "/finance/banking/rules",
  "/finance/spend/ai",
];

describe("resolveFinanceSurface — food-hospitality (owner-first)", () => {
  const surface = resolveFinanceSurface("food-hospitality");

  it("runs in owner-first mode and leads with the money question", () => {
    expect(surface.mode).toBe("owner-first");
    expect(surface.headline.toLowerCase()).toContain("attention today");
  });

  it("foregrounds the Restaurant money jobs", () => {
    const ids = surface.moneyJobs.map((job) => job.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "deposits-balances", // booking deposits + event/catering balances
        "order-ticket-payments", // ticket/order payments
        "supplier-bills", // supplier bills
        "payouts-reconciliation", // payouts/reconciliation
        "no-show-cancellation-fees", // no-show/cancellation fees
      ]),
    );
  });

  it("names booking deposits, catering/event balances, and no-show fees in owner-first language", () => {
    const text = surface.moneyJobs
      .map((job) => `${job.label} ${job.question}`)
      .join(" ")
      .toLowerCase();
    expect(text).toContain("deposit");
    expect(text).toContain("catering");
    expect(text).toContain("supplier");
    expect(text).toContain("no-show");
    expect(text).toContain("reconcil");
  });

  it("does NOT lead with accountant/internal routes as money jobs", () => {
    const jobRoutes = surface.moneyJobs.map((job) => job.href);
    for (const route of INTERNAL_ROUTES) {
      expect(jobRoutes).not.toContain(route);
    }
  });

  it("defers VAT, dunning, payment runs, GL, bank rules, and AI spend into advanced sections", () => {
    const advancedRoutes = surface.advancedSections.flatMap((section) =>
      section.links.map((link) => link.href),
    );
    for (const route of INTERNAL_ROUTES) {
      expect(advancedRoutes).toContain(route);
    }
  });

  it("offers booking/order/catering/private-event invoice entry points", () => {
    const ids = surface.invoiceEntryPoints.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining(["booking", "order", "catering", "private-event"]),
    );
    // Each Restaurant context entry point carries its context, not just a blank form.
    const bookingEntry = surface.invoiceEntryPoints.find((e) => e.id === "booking");
    expect(bookingEntry?.href).toContain("from=booking");
  });
});

describe("resolveFinanceSurface — non-food-hospitality (standard)", () => {
  it.each(["professional-services", "retail-goods", "healthcare-wellness"])(
    "keeps %s in standard mode with no owner-first money jobs",
    (category) => {
      const surface = resolveFinanceSurface(category);
      expect(surface.mode).toBe("standard");
      expect(surface.moneyJobs).toHaveLength(0);
      expect(surface.invoiceEntryPoints).toHaveLength(0);
      expect(surface.advancedSections).toHaveLength(0);
    },
  );

  it("falls back to standard mode for unknown/null categories", () => {
    expect(resolveFinanceSurface(null).mode).toBe("standard");
    expect(resolveFinanceSurface(undefined).mode).toBe("standard");
    expect(resolveFinanceSurface("").mode).toBe("standard");
  });
});

describe("isOwnerFirstFinanceCategory", () => {
  it("is true only for food-hospitality", () => {
    expect(isOwnerFirstFinanceCategory("food-hospitality")).toBe(true);
    expect(isOwnerFirstFinanceCategory("professional-services")).toBe(false);
    expect(isOwnerFirstFinanceCategory(null)).toBe(false);
  });
});

describe("resolveFinanceInvoiceCopy", () => {
  it("uses Restaurant-appropriate language for food-hospitality", () => {
    const copy = resolveFinanceInvoiceCopy("food-hospitality");
    expect(copy.newInvoiceSubhead.toLowerCase()).toContain("booking");
    expect(copy.customerLabel.toLowerCase()).toContain("guest");
    // Replaces the professional-services engagement-letter framing.
    expect(copy.signatureHint.toLowerCase()).not.toContain("engagement letter");
    expect(copy.contexts.catering.description.toLowerCase()).toContain("catering");
  });

  it("keeps professional-services copy as the default", () => {
    const copy = resolveFinanceInvoiceCopy("professional-services");
    expect(copy.customerLabel).toBe("Customer");
    expect(copy.signatureHint.toLowerCase()).toContain("engagement letter");
  });
});

describe("isFinanceInvoiceContext", () => {
  it("accepts the known Restaurant contexts", () => {
    for (const ctx of ["booking", "order", "catering", "private-event", "no-show"]) {
      expect(isFinanceInvoiceContext(ctx)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    expect(isFinanceInvoiceContext("customer")).toBe(false);
    expect(isFinanceInvoiceContext(null)).toBe(false);
    expect(isFinanceInvoiceContext(undefined)).toBe(false);
  });
});
