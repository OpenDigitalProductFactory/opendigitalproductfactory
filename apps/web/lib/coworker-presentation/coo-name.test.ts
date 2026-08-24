import { describe, expect, it } from "vitest";
import {
  COO_NAME_SUGGESTION_GROUPS,
  resolveCooPresentationName,
  resolveCooPresentationIdentity,
  validateCooConversationalName,
} from "./coo-name";

describe("COO conversational-name policy", () => {
  it("treats blank, skip, and the canonical role as the role-only default", () => {
    expect(validateCooConversationalName("")).toEqual({ ok: true, value: null });
    expect(validateCooConversationalName("   ")).toEqual({ ok: true, value: null });
    expect(validateCooConversationalName("coo")).toEqual({ ok: true, value: null });
  });

  it("normalizes a custom name without changing its human-facing casing", () => {
    expect(validateCooConversationalName("  First   Officer  ")).toEqual({
      ok: true,
      value: "First Officer",
    });
  });

  it("offers optional role, mission, and relaxed suggestions", () => {
    expect(COO_NAME_SUGGESTION_GROUPS.map((group) => group.label)).toEqual([
      "Role-like",
      "Mission-inspired",
      "Relaxed",
    ]);
    expect(COO_NAME_SUGGESTION_GROUPS.flatMap((group) => group.names)).toEqual(
      expect.arrayContaining(["First Officer", "Number Two", "General", "Navigator", "Alex", "Sam"]),
    );
  });

  it.each([
    ["AGT-ORCH-000", "internal coworker identifier"],
    ["system", "internal system identity"],
    ["Onboarding COO", "distinct setup coworker"],
    ["CEO", "accountable owner role"],
    ["Owner", "accountable owner role"],
  ])("rejects deceptive or internal name %s", (name, errorFragment) => {
    const result = validateCooConversationalName(name);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(errorFragment);
  });

  it("rejects control characters, overlong values, and values without a letter or number", () => {
    expect(validateCooConversationalName("Good\u0000Name").ok).toBe(false);
    expect(validateCooConversationalName("a".repeat(41)).ok).toBe(false);
    expect(validateCooConversationalName("---").ok).toBe(false);
  });

  it("rejects a real employee display-name collision case-insensitively", () => {
    const result = validateCooConversationalName("  mArK ", { employeeDisplayNames: ["Mark"] });
    expect(result).toEqual({
      ok: false,
      error: "Choose a name that is not already used by a person in your organization.",
    });
  });

  it("layers the friendly label only over the standing COO presentation", () => {
    expect(resolveCooPresentationName({
      agentId: "AGT-ORCH-000",
      canonicalName: "COO",
      conversationalName: "Number Two",
    })).toBe("Number Two · AI COO");
    expect(resolveCooPresentationName({
      agentId: "coo",
      canonicalName: "COO",
      conversationalName: "General",
    })).toBe("General · AI COO");
    expect(resolveCooPresentationName({
      agentId: "AGT-902",
      canonicalName: "Data Protection Officer",
      conversationalName: "General",
    })).toBe("Data Protection Officer");
    expect(resolveCooPresentationName({
      agentId: "AGT-ORCH-000",
      canonicalName: "COO",
      conversationalName: null,
    })).toBe("COO");
  });

  it("separates a standing COO's conversational name from the role", () => {
    expect(resolveCooPresentationIdentity({
      agentId: "AGT-ORCH-000",
      canonicalName: "COO",
      conversationalName: "Coolio",
    })).toEqual({ primaryName: "Coolio", roleName: "AI COO" });
  });
});
