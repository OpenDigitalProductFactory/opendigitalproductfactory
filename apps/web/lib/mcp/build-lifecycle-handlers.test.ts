import { describe, expect, it } from "vitest";
import { formatUpdateFeatureBriefError } from "./update-feature-brief-error";

describe("formatUpdateFeatureBriefError (BI-PIR-309fb74b / BI-PIR-f8c1640b)", () => {
  it("claims past-ideate only when the underlying error is the phase gate", () => {
    const r = formatUpdateFeatureBriefError(
      new Error("Brief can only be updated during Ideate phase"),
    );
    expect(r.message).toMatch(/past that phase/i);
    expect(r.message).toMatch(/Ideate phase/i);
  });

  it("does NOT claim past-ideate for validation failures (fixContext-only was misreported this way)", () => {
    const r = formatUpdateFeatureBriefError(new Error("title is required, description is required"));
    expect(r.message).not.toMatch(/past that phase/i);
    expect(r.message).toContain("title is required");
  });

  it("does NOT claim past-ideate for Forbidden", () => {
    const r = formatUpdateFeatureBriefError(new Error("Forbidden"));
    expect(r.message).not.toMatch(/past that phase/i);
    expect(r.message).toContain("Forbidden");
  });
});
