import { describe, expect, it } from "vitest";
import {
  isFinanceInvoiceContext,
  isOwnerFirstFinanceCategory,
  resolveFinanceInvoiceCopy,
  resolveFinanceSurface,
  resolveFoodHospitalitySubtype,
  type FoodHospitalitySubtype,
} from "./finance-surface";

const FOOD = "food-hospitality";

// Accounting internals that must NOT lead the surface for a food-hospitality
// owner. They are allowed only inside the deferred advanced sections.
const INTERNAL_ROUTES = [
  "/finance/reports/vat-summary",
  "/finance/settings/tax",
  "/finance/reports/general-ledger",
  "/finance/settings/dunning",
  "/finance/payment-runs",
  "/finance/banking/rules",
  "/finance/spend/ai",
];

const SUBTYPES: FoodHospitalitySubtype[] = ["restaurant", "catering", "bakery", "generic"];

describe("resolveFoodHospitalitySubtype", () => {
  it("recognises the three known subtypes", () => {
    expect(resolveFoodHospitalitySubtype("restaurant")).toBe("restaurant");
    expect(resolveFoodHospitalitySubtype("catering")).toBe("catering");
    expect(resolveFoodHospitalitySubtype("bakery")).toBe("bakery");
  });

  it("falls back to generic for unknown/absent archetype ids", () => {
    expect(resolveFoodHospitalitySubtype("cafe")).toBe("generic");
    expect(resolveFoodHospitalitySubtype(null)).toBe("generic");
    expect(resolveFoodHospitalitySubtype(undefined)).toBe("generic");
  });
});

describe("food-hospitality surface — invariants shared by every subtype", () => {
  it.each(SUBTYPES)("%s runs owner-first and leads with the money question", (subtype) => {
    const surface = resolveFinanceSurface(FOOD, subtype);
    expect(surface.mode).toBe("owner-first");
    expect(surface.subtype).toBe(subtype);
    expect(surface.headline.toLowerCase()).toContain("attention today");
  });

  it.each(SUBTYPES)("%s does NOT lead with accountant/internal routes", (subtype) => {
    const jobRoutes = resolveFinanceSurface(FOOD, subtype).moneyJobs.map((j) => j.href);
    for (const route of INTERNAL_ROUTES) {
      expect(jobRoutes).not.toContain(route);
    }
  });

  it.each(SUBTYPES)("%s defers VAT/dunning/payment-runs/GL/bank-rules/AI-spend", (subtype) => {
    const advancedRoutes = resolveFinanceSurface(FOOD, subtype).advancedSections.flatMap((s) =>
      s.links.map((l) => l.href),
    );
    for (const route of INTERNAL_ROUTES) {
      expect(advancedRoutes).toContain(route);
    }
  });

  // Honesty invariant: the surface re-frames a fixed set of real figures. If two
  // jobs claimed the same metric the owner would see one number under two names.
  it.each(SUBTYPES)("%s never shows the same live figure under two jobs", (subtype) => {
    const metrics = resolveFinanceSurface(FOOD, subtype)
      .moneyJobs.map((j) => j.metricKey)
      .filter((m): m is NonNullable<typeof m> => m != null);
    expect(new Set(metrics).size).toBe(metrics.length);
  });

  it.each(SUBTYPES)("%s offers a blank invoice escape hatch", (subtype) => {
    const ids = resolveFinanceSurface(FOOD, subtype).invoiceEntryPoints.map((e) => e.id);
    expect(ids).toContain("blank");
  });
});

describe("Restaurant subtype money jobs", () => {
  const surface = resolveFinanceSurface(FOOD, "restaurant");

  it("foregrounds booking deposits, order/ticket payments, supplier bills, payouts, no-show fees", () => {
    expect(surface.moneyJobs.map((j) => j.id)).toEqual(
      expect.arrayContaining([
        "deposits-balances",
        "order-ticket-payments",
        "supplier-bills",
        "payouts-reconciliation",
        "no-show-cancellation-fees",
      ]),
    );
  });

  it("uses Restaurant money language", () => {
    const text = surface.moneyJobs.map((j) => `${j.label} ${j.question}`).join(" ").toLowerCase();
    expect(text).toContain("deposit");
    expect(text).toContain("cover");
    expect(text).toContain("no-show");
    expect(text).toContain("supplier");
  });

  it("starts invoices from booking/order/catering/private-event context", () => {
    expect(surface.invoiceEntryPoints.map((e) => e.id)).toEqual(
      expect.arrayContaining(["booking", "order", "catering", "private-event"]),
    );
  });
});

describe("Catering subtype money jobs", () => {
  const surface = resolveFinanceSurface(FOOD, "catering");

  it("foregrounds quote, event deposits/balances, ingredient & staffing costs", () => {
    expect(surface.moneyJobs.map((j) => j.id)).toEqual(
      expect.arrayContaining([
        "event-deposits-balances",
        "event-payments",
        "ingredient-staffing-bills",
        "quote-catering-job",
      ]),
    );
  });

  it("uses Catering money language, not Restaurant covers/no-show language", () => {
    const text = surface.moneyJobs.map((j) => `${j.label} ${j.question}`).join(" ").toLowerCase();
    expect(text).toContain("quote");
    expect(text).toContain("deposit");
    expect(text).toContain("balance");
    expect(text).toContain("staffing");
    expect(text).not.toContain("no-show");
    expect(text).not.toContain("table order");
  });

  it("offers quote / event-deposit / event-balance entry points", () => {
    expect(surface.invoiceEntryPoints.map((e) => e.id)).toEqual(
      expect.arrayContaining(["quote", "event-deposit", "event-balance"]),
    );
  });

  it("makes clear a quote owes nothing yet", () => {
    const quote = surface.invoiceEntryPoints.find((e) => e.id === "quote");
    expect(quote?.description.toLowerCase()).toContain("nothing is owed");
  });
});

describe("Bakery subtype money jobs", () => {
  const surface = resolveFinanceSurface(FOOD, "bakery");

  it("foregrounds custom-order deposits/balances, counter takings, ingredient bills", () => {
    expect(surface.moneyJobs.map((j) => j.id)).toEqual(
      expect.arrayContaining([
        "custom-order-deposits-balances",
        "counter-order-takings",
        "ingredient-supplier-bills",
        "bill-custom-order",
      ]),
    );
  });

  it("distinguishes standard counter sales from custom cake deposit/balance", () => {
    const text = surface.moneyJobs.map((j) => `${j.label} ${j.question}`).join(" ").toLowerCase();
    expect(text).toContain("counter");
    expect(text).toContain("wedding");
    expect(text).toContain("deposit");
    expect(text).toContain("balance");
  });

  it("offers custom-order / counter-sale / pickup-delivery entry points", () => {
    expect(surface.invoiceEntryPoints.map((e) => e.id)).toEqual(
      expect.arrayContaining(["custom-order", "counter-sale", "delivery"]),
    );
  });
});

describe("subtypes are actually differentiated", () => {
  it("gives restaurant, catering, and bakery distinct money-job sets", () => {
    const ids = (s: FoodHospitalitySubtype) =>
      resolveFinanceSurface(FOOD, s).moneyJobs.map((j) => j.id).join("|");
    expect(ids("restaurant")).not.toBe(ids("catering"));
    expect(ids("catering")).not.toBe(ids("bakery"));
    expect(ids("restaurant")).not.toBe(ids("bakery"));
  });

  it("gives each subtype its own opening subhead", () => {
    const sub = (s: FoodHospitalitySubtype) => resolveFinanceSurface(FOOD, s).subhead;
    expect(sub("catering")).not.toBe(sub("restaurant"));
    expect(sub("bakery")).not.toBe(sub("restaurant"));
  });
});

describe("non-food-hospitality (standard)", () => {
  it.each(["professional-services", "retail-goods", "healthcare-wellness"])(
    "keeps %s in standard mode with no owner-first money jobs",
    (category) => {
      const surface = resolveFinanceSurface(category);
      expect(surface.mode).toBe("standard");
      expect(surface.subtype).toBeNull();
      expect(surface.moneyJobs).toHaveLength(0);
      expect(surface.invoiceEntryPoints).toHaveLength(0);
      expect(surface.advancedSections).toHaveLength(0);
    },
  );

  it("stays standard even when an archetype id is supplied", () => {
    expect(resolveFinanceSurface("professional-services", "restaurant").mode).toBe("standard");
  });

  it("falls back to standard mode for unknown/null categories", () => {
    expect(resolveFinanceSurface(null).mode).toBe("standard");
    expect(resolveFinanceSurface(undefined).mode).toBe("standard");
    expect(resolveFinanceSurface("").mode).toBe("standard");
  });
});

describe("pet-rescue finance surface", () => {
  const surface = resolveFinanceSurface("nonprofit-community", "pet-rescue");

  it("leads with mission funding and stewardship instead of revenue", () => {
    expect(surface.mode).toBe("owner-first");
    expect(surface.subtype).toBe("pet-rescue");
    expect(surface.headline).toBe("Funding & stewardship");
    const copy = [
      surface.headline,
      surface.subhead,
      ...surface.moneyJobs.flatMap((job) => [job.label, job.question]),
    ].join(" ");
    expect(copy).toMatch(/donation|grant/i);
    expect(copy).toMatch(/care|animal/i);
    expect(copy).not.toMatch(/customer|revenue|sales funnel/i);
  });

  it("offers contribution entry points and rescue-specific navigation labels", () => {
    expect(surface.invoiceEntryPoints.map((entry) => entry.id)).toEqual([
      "donation",
      "grant",
      "sponsorship",
      "blank",
    ]);
    expect(surface.primaryActionLabel).toBe("Record contribution");
    expect(surface.entryPointSectionLabel).toBe("Record funding");
    expect(surface.navigationLabels).toMatchObject({
      revenue: "Funding",
      spend: "Care spending",
      close: "Stewardship",
    });
  });

  it("does not make every nonprofit inherit pet-rescue claims", () => {
    expect(resolveFinanceSurface("nonprofit-community", "charity").mode).toBe("standard");
  });
});

describe("isOwnerFirstFinanceCategory", () => {
  it("is true only for food-hospitality", () => {
    expect(isOwnerFirstFinanceCategory(FOOD)).toBe(true);
    expect(isOwnerFirstFinanceCategory("professional-services")).toBe(false);
    expect(isOwnerFirstFinanceCategory(null)).toBe(false);
  });
});

describe("resolveFinanceInvoiceCopy", () => {
  it("uses Restaurant guest language", () => {
    const copy = resolveFinanceInvoiceCopy(FOOD, "restaurant");
    expect(copy.customerLabel.toLowerCase()).toContain("guest");
    expect(copy.newInvoiceSubhead.toLowerCase()).toContain("booking");
    expect(copy.signatureHint.toLowerCase()).not.toContain("engagement letter");
  });

  it("uses Catering client + quote/deposit/balance language", () => {
    const copy = resolveFinanceInvoiceCopy(FOOD, "catering");
    expect(copy.customerLabel).toBe("Client");
    expect(copy.newInvoiceSubhead.toLowerCase()).toContain("quote");
    expect(copy.contexts.quote?.description.toLowerCase()).toContain("nothing is owed");
    expect(copy.contexts["event-balance"]?.description.toLowerCase()).toContain("delivered");
  });

  it("uses Bakery custom-order language", () => {
    const copy = resolveFinanceInvoiceCopy(FOOD, "bakery");
    expect(copy.newInvoiceSubhead.toLowerCase()).toContain("custom order");
    expect(copy.contexts["custom-order"]?.description.toLowerCase()).toContain("deposit");
    expect(copy.contexts["counter-sale"]?.title.toLowerCase()).toContain("counter");
  });

  it("keeps professional-services copy as the default for other archetypes", () => {
    const copy = resolveFinanceInvoiceCopy("professional-services");
    expect(copy.customerLabel).toBe("Customer");
    expect(copy.signatureHint.toLowerCase()).toContain("engagement letter");
  });

  it("uses contribution and supporter language for pet rescue", () => {
    const copy = resolveFinanceInvoiceCopy("nonprofit-community", "pet-rescue");
    expect(copy.customerLabel).toBe("Supporter or funder");
    expect(copy.newInvoiceSubhead).toContain("contribution");
    expect(copy.contexts.donation?.title).toBe("Record a donation");
    expect(copy.signatureHint.toLowerCase()).not.toContain("engagement letter");
  });
});

describe("isFinanceInvoiceContext", () => {
  it.each([
    "booking",
    "order",
    "catering",
    "private-event",
    "no-show",
    "quote",
    "event-deposit",
    "event-balance",
    "custom-order",
    "counter-sale",
    "delivery",
    "donation",
    "grant",
    "sponsorship",
  ])("accepts %s", (ctx) => {
    expect(isFinanceInvoiceContext(ctx)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isFinanceInvoiceContext("customer")).toBe(false);
    expect(isFinanceInvoiceContext(null)).toBe(false);
    expect(isFinanceInvoiceContext(undefined)).toBe(false);
  });
});
