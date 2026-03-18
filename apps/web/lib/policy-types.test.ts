import { describe, expect, it } from "vitest";
import {
  generatePolicyId, generateRequirementId, generateCompletionId,
  validatePolicyInput, validateRequirementInput,
  POLICY_CATEGORIES, POLICY_LIFECYCLE_STATUSES, REQUIREMENT_TYPES,
  REQUIREMENT_FREQUENCIES, COMPLETION_METHODS, TRAINING_DELIVERY_METHODS,
  isValidTransition,
} from "./policy-types";

describe("ID generators", () => {
  it("generates policy IDs with POL- prefix", () => {
    expect(generatePolicyId()).toMatch(/^POL-[A-Z0-9]{8}$/);
  });
  it("generates requirement IDs with PREQ- prefix", () => {
    expect(generateRequirementId()).toMatch(/^PREQ-[A-Z0-9]{8}$/);
  });
  it("generates completion IDs with COMP- prefix", () => {
    expect(generateCompletionId()).toMatch(/^COMP-[A-Z0-9]{8}$/);
  });
  it("generates unique IDs", () => {
    const ids = Array.from({ length: 20 }, () => generatePolicyId());
    expect(new Set(ids).size).toBe(20);
  });
});

describe("validatePolicyInput", () => {
  it("returns null for valid input", () => {
    expect(validatePolicyInput({ title: "Test Policy", category: "security" })).toBeNull();
  });
  it("rejects empty title", () => {
    expect(validatePolicyInput({ title: "", category: "security" })).toBe("Title is required.");
  });
  it("rejects whitespace-only title", () => {
    expect(validatePolicyInput({ title: "   ", category: "security" })).toBe("Title is required.");
  });
  it("rejects invalid category", () => {
    expect(validatePolicyInput({ title: "Test", category: "bogus" })).toMatch(/Category must be one of/);
  });
  it("accepts all valid categories", () => {
    for (const cat of POLICY_CATEGORIES) {
      expect(validatePolicyInput({ title: "Test", category: cat })).toBeNull();
    }
  });
});

describe("validateRequirementInput", () => {
  it("returns null for valid input", () => {
    expect(validateRequirementInput({ title: "Read policy", requirementType: "acknowledgment" })).toBeNull();
  });
  it("rejects empty title", () => {
    expect(validateRequirementInput({ title: "", requirementType: "training" })).toBe("Title is required.");
  });
  it("rejects invalid type", () => {
    expect(validateRequirementInput({ title: "Test", requirementType: "bogus" })).toMatch(/Requirement type must be one of/);
  });
  it("accepts all valid types", () => {
    for (const t of REQUIREMENT_TYPES) {
      expect(validateRequirementInput({ title: "Test", requirementType: t })).toBeNull();
    }
  });
});

describe("isValidTransition", () => {
  it("allows draft → in-review", () => expect(isValidTransition("draft", "in-review")).toBe(true));
  it("allows in-review → approved", () => expect(isValidTransition("in-review", "approved")).toBe(true));
  it("allows in-review → draft (sent back)", () => expect(isValidTransition("in-review", "draft")).toBe(true));
  it("allows approved → published", () => expect(isValidTransition("approved", "published")).toBe(true));
  it("allows published → retired", () => expect(isValidTransition("published", "retired")).toBe(true));
  it("allows retired → draft (re-activate)", () => expect(isValidTransition("retired", "draft")).toBe(true));
  it("rejects draft → published (skip)", () => expect(isValidTransition("draft", "published")).toBe(false));
  it("rejects published → approved (backwards)", () => expect(isValidTransition("published", "approved")).toBe(false));
  it("rejects retired → published (must go through draft)", () => expect(isValidTransition("retired", "published")).toBe(false));
  it("rejects unknown status", () => expect(isValidTransition("bogus", "draft")).toBe(false));
});

describe("constants", () => {
  it("exports expected policy categories", () => {
    expect(POLICY_CATEGORIES).toContain("security");
    expect(POLICY_CATEGORIES).toContain("ethics");
    expect(POLICY_CATEGORIES).toContain("hr");
    expect(POLICY_CATEGORIES).toContain("other");
  });
  it("exports expected requirement types", () => {
    expect(REQUIREMENT_TYPES).toEqual(["acknowledgment", "training", "attestation", "action"]);
  });
  it("exports expected lifecycle statuses", () => {
    expect(POLICY_LIFECYCLE_STATUSES).toEqual(["draft", "in-review", "approved", "published", "retired"]);
  });
  it("exports requirement frequencies", () => {
    expect(REQUIREMENT_FREQUENCIES).toContain("annual");
    expect(REQUIREMENT_FREQUENCIES).toContain("once");
  });
  it("exports completion methods", () => {
    expect(COMPLETION_METHODS).toContain("digital-signature");
    expect(COMPLETION_METHODS).toContain("training-completion");
  });
  it("exports training delivery methods", () => {
    expect(TRAINING_DELIVERY_METHODS).toContain("online");
    expect(TRAINING_DELIVERY_METHODS).toContain("in-person");
  });
});
