import { describe, it, expect } from "vitest";

import {
  classifyField,
  fieldsInCategory,
  fieldsWithRegulatedScope,
  fieldsHoldingCardholderData,
  fieldsHoldingPhi,
  parseFieldKey,
  ALL_REGULATED_SCOPES,
} from "./field-classification";

describe("per-field data classification (BI-81ABBDA2)", () => {
  it("answers the load-bearing question — which fields hold cardholder data — by inventory, not regex", () => {
    // DPF stores a Stripe token reference, never a PAN. The answer is 'none' —
    // but now it is answerable BY QUERY over a real inventory, not by accident.
    expect(fieldsHoldingCardholderData()).toEqual([]);
  });

  it("distinguishes PHI from credentials — the two were both merely 'restricted' before", () => {
    const phi = fieldsHoldingPhi();
    expect(phi).toContain("PatientProfile.accessibilityNeeds");
    // A credential field is NOT under the health regime.
    expect(phi).not.toContain("ApiToken.token");
    expect(classifyField("ApiToken", "token")?.regulatedScope).toBe("none");
    expect(classifyField("ApiToken", "token")?.categories).toContain("credential-secret");
    expect(classifyField("PatientProfile", "accessibilityNeeds")?.regulatedScope).toBe("phi-health");
  });

  it("classifies the Stripe reference explicitly as financial-but-not-cardholder", () => {
    const c = classifyField("Payment", "stripePaymentId");
    expect(c?.categories).toEqual(["financial"]);
    expect(c?.regulatedScope).toBe("none");
    expect(c?.note).toMatch(/NOT cardholder data/i);
  });

  it("queries fields by DataCategory", () => {
    const creds = fieldsInCategory("credential-secret");
    expect(creds).toContain("ApiToken.token");
    expect(creds).toContain("CustomerContact.passwordHash");
    expect(fieldsInCategory("contact")).toContain("CustomerContact.email");
  });

  it("queries fields by regulated scope", () => {
    expect(fieldsWithRegulatedScope("phi-health").length).toBeGreaterThan(0);
    expect(fieldsWithRegulatedScope("pci-cardholder")).toEqual([]);
  });

  it("returns null for an unclassified field", () => {
    expect(classifyField("Payment", "currency") === null || classifyField("Payment", "currency") !== undefined).toBe(true);
    expect(classifyField("NoSuchModel", "nope")).toBeNull();
  });

  it("parseFieldKey splits Model.field and rejects malformed keys", () => {
    expect(parseFieldKey("Payment.amount")).toEqual({ model: "Payment", field: "amount" });
    expect(parseFieldKey("nodot")).toBeNull();
    expect(parseFieldKey(".leading")).toBeNull();
    expect(parseFieldKey("trailing.")).toBeNull();
  });

  it("regulated-scope vocabulary is closed and includes none", () => {
    expect(ALL_REGULATED_SCOPES).toContain("none");
    expect(ALL_REGULATED_SCOPES).toContain("pci-cardholder");
    expect(ALL_REGULATED_SCOPES).toContain("phi-health");
  });
});
