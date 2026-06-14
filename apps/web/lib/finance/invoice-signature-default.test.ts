import { describe, expect, it } from "vitest";
import { defaultSignatureRequiredForArchetype } from "./invoice-signature-default";

describe("defaultSignatureRequiredForArchetype", () => {
  it("defaults ON for legal practices", () => {
    expect(defaultSignatureRequiredForArchetype("legal-services")).toBe(true);
  });

  it("defaults ON for accounting practices", () => {
    expect(defaultSignatureRequiredForArchetype("accounting")).toBe(true);
  });

  it.each([
    "it-managed-services",
    "consulting",
    "marketing-agency",
    "healthcare-wellness",
    "retail-goods",
    "field-inspection",
  ])("defaults OFF for %s", (slug) => {
    expect(defaultSignatureRequiredForArchetype(slug)).toBe(false);
  });

  it("defaults OFF when the archetype is unknown/null", () => {
    expect(defaultSignatureRequiredForArchetype(null)).toBe(false);
    expect(defaultSignatureRequiredForArchetype(undefined)).toBe(false);
    expect(defaultSignatureRequiredForArchetype("")).toBe(false);
  });
});
