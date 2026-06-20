import { describe, it, expect } from "vitest";
import { suggestDisposition, mayShareToPublicHive, privateDispositionBlockMessage } from "./disposition";

describe("suggestDisposition", () => {
  it("suggests private when the outbound diff is empty (all private-path)", () => {
    const s = suggestDisposition({ outboundEmpty: true, reusabilityScope: "already_generic" });
    expect(s.suggested).toBe("private");
  });

  it("suggests private when org-specific content is present (overrides reusability)", () => {
    const s = suggestDisposition({ orgSpecificHits: 2, reusabilityScope: "already_generic" });
    expect(s.suggested).toBe("private");
    expect(s.reason).toMatch(/business-specific/i);
  });

  it("suggests private for one_off changes", () => {
    expect(suggestDisposition({ reusabilityScope: "one_off" }).suggested).toBe("private");
  });

  it("suggests shareable for already_generic + clean", () => {
    expect(suggestDisposition({ reusabilityScope: "already_generic", orgSpecificHits: 0 }).suggested).toBe("shareable");
  });

  it("suggests shareable for parameterizable + clean", () => {
    expect(suggestDisposition({ reusabilityScope: "parameterizable", orgSpecificHits: 0 }).suggested).toBe("shareable");
  });

  it("fail-closed: unknown reusability + clean defaults to private", () => {
    expect(suggestDisposition({}).suggested).toBe("private");
    expect(suggestDisposition({ reusabilityScope: null }).suggested).toBe("private");
  });
});

describe("mayShareToPublicHive", () => {
  it("only true for explicit shareable", () => {
    expect(mayShareToPublicHive("shareable")).toBe(true);
    expect(mayShareToPublicHive("private")).toBe(false);
    expect(mayShareToPublicHive(null)).toBe(false);
    expect(mayShareToPublicHive(undefined)).toBe(false);
    expect(mayShareToPublicHive("anything-else")).toBe(false);
  });
});

describe("privateDispositionBlockMessage", () => {
  it("includes the suggestion reason when provided", () => {
    expect(privateDispositionBlockMessage("because X")).toMatch(/because X/);
    expect(privateDispositionBlockMessage()).toMatch(/stay on your system/i);
  });
});
