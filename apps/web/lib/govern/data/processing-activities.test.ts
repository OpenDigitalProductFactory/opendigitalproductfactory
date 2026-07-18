// apps/web/lib/govern/data/processing-activities.test.ts
import { describe, expect, it } from "vitest";
import {
  PURPOSE_CAPABILITY_TEMPLATES,
  getPurposeCapability,
  minimizedCategoriesFor,
  purposeCoversCategory,
} from "./processing-activities";

describe("processing-purpose capability templates", () => {
  it("defines a template for every purpose exactly once", () => {
    const purposes = PURPOSE_CAPABILITY_TEMPLATES.map((t) => t.purpose);
    expect(new Set(purposes).size).toBe(purposes.length);
  });

  it("reports category coverage as a capability, not authorization", () => {
    expect(purposeCoversCategory("billing-and-payments", "financial")).toBe(true);
    expect(purposeCoversCategory("product-analytics", "financial")).toBe(false);
  });

  it("keeps mustMinimize a subset of appliesToCategories", () => {
    for (const t of PURPOSE_CAPABILITY_TEMPLATES) {
      for (const c of t.mustMinimize ?? []) {
        expect(t.appliesToCategories, `${t.purpose} minimizes ${c} it does not cover`)
          .toContain(c);
      }
    }
  });

  it("exposes minimized categories per purpose", () => {
    expect(minimizedCategoriesFor("coworker-assistance")).toContain("credential-secret");
    expect(getPurposeCapability("service-delivery")?.mustMinimize ?? []).toEqual([]);
  });
});
