import { describe, expect, it } from "vitest";

import { evaluateMaterializability, isMaterializableValue } from "./no-fabrication";

describe("no-fabrication guard (AC4)", () => {
  it("REGRESSION: a masked email pattern must NOT be materialized", () => {
    // The worked example: only `g***@teamlogicit.com` was public. It must be
    // rejected and left blank — never synthesized into a real address.
    const verdict = evaluateMaterializability("email", "g***@teamlogicit.com");
    expect(verdict.materializable).toBe(false);
    expect(isMaterializableValue("email", "g***@teamlogicit.com")).toBe(false);
  });

  it("rejects other masked identity values", () => {
    expect(isMaterializableValue("phone", "(512) ***-1234")).toBe(false);
    expect(isMaterializableValue("phone", "512-xxx-1234")).toBe(false);
    expect(isMaterializableValue("firstName", "J•••")).toBe(false);
  });

  it("rejects placeholders and empties", () => {
    for (const v of ["", "  ", "N/A", "unknown", "not found", "redacted", "-", "todo", "greg@example.com"]) {
      expect(isMaterializableValue("jobTitle", v)).toBe(false);
    }
  });

  it("accepts complete, real values", () => {
    expect(isMaterializableValue("email", "greg@teamlogicit.com")).toBe(true);
    expect(isMaterializableValue("phone", "(512) 555-1234")).toBe(true);
    expect(isMaterializableValue("firstName", "Greg")).toBe(true);
    expect(isMaterializableValue("jobTitle", "Owner & President")).toBe(true);
    expect(isMaterializableValue("industry", "Managed IT Services")).toBe(true);
    expect(isMaterializableValue("linkedinUrl", "https://linkedin.com/in/greg-t")).toBe(true);
  });

  it("rejects an incomplete email even if unmasked", () => {
    expect(isMaterializableValue("email", "greg@teamlogicit")).toBe(false);
    expect(isMaterializableValue("email", "just-a-name")).toBe(false);
  });

  it("rejects a phone stub with too few real digits", () => {
    expect(isMaterializableValue("phone", "512")).toBe(false);
  });

  it("does NOT reject a bulleted notes value (bullet not adjacent to alnum)", () => {
    expect(isMaterializableValue("notes", "• MSP • north Austin metro")).toBe(true);
    expect(isMaterializableValue("industry", "IT · Managed Services")).toBe(true);
  });

  it("does NOT reject a real surname that collides with a placeholder token", () => {
    expect(isMaterializableValue("lastName", "Na")).toBe(true);
    expect(isMaterializableValue("lastName", "None")).toBe(true);
    // but a non-name field still rejects the placeholder token
    expect(isMaterializableValue("industry", "unknown")).toBe(false);
  });

  it("catches non-ASCII mask glyphs adjacent to text", () => {
    expect(isMaterializableValue("email", "greg●●●@teamlogicit.com")).toBe(false);
  });
});
