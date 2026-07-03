import { describe, it, expect } from "vitest";
import { DELIVERABLE_TYPES, isDeliverableType } from "./compliance-types";

describe("deliverable types (Phase 3)", () => {
  it("recognizes the canonical output forms", () => {
    expect(isDeliverableType("board-declaration")).toBe(true);
    expect(isDeliverableType("regulatory-filing")).toBe(true);
    expect(isDeliverableType("attestation")).toBe(true);
    expect(isDeliverableType("evidence-pack")).toBe(true);
    expect(isDeliverableType("policy-acknowledgement")).toBe(true);
    expect(isDeliverableType("none")).toBe(true);
  });

  it("rejects unknown / empty values", () => {
    expect(isDeliverableType("spreadsheet")).toBe(false);
    expect(isDeliverableType(null)).toBe(false);
    expect(isDeliverableType(undefined)).toBe(false);
  });

  it("exposes exactly the documented set", () => {
    expect([...DELIVERABLE_TYPES]).toEqual([
      "board-declaration",
      "regulatory-filing",
      "attestation",
      "evidence-pack",
      "policy-acknowledgement",
      "none",
    ]);
  });
});
