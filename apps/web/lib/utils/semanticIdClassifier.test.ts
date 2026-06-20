import { describe, it, expect } from "vitest";
import { classifySemanticId } from "./semanticIdClassifier";

describe("classifySemanticId", () => {
  it("should classify recognized prefixes correctly", () => {
    expect(classifySemanticId("BI-1A2B3C4D")).toBe("backlog-item");
    expect(classifySemanticId("EP-abc123")).toBe("epic");
    expect(classifySemanticId("FB-69231490")).toBe("feature-build");
    expect(classifySemanticId("DP-xyz789")).toBe("digital-product");
    expect(classifySemanticId("WC-6E04A4F5")).toBe("work-capsule");
  });

  it("should return null for unrecognized prefix", () => {
    expect(classifySemanticId("ZZ-1234")).toBeNull();
  });

  it("should handle lowercase and surrounding whitespace", () => {
    expect(classifySemanticId("  bi-1a2b3c4d  ")).toBe("backlog-item");
  });

  it("should return null for empty string", () => {
    expect(classifySemanticId("")).toBeNull();
  });

  it("should return null for malformed input", () => {
    expect(classifySemanticId("BI-")).toBeNull();
  });
});
