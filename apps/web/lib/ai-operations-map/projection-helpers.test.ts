import { describe, expect, it } from "vitest";

import { normalizeAgentId, providerFromEndpoint, titleize } from "./projection-helpers";

describe("titleize (EP-8DC217EB BET-10)", () => {
  it("splits on -, _, :, ., whitespace and title-cases each part", () => {
    expect(titleize("build-specialist")).toBe("Build Specialist");
    expect(titleize("coo_orchestrator")).toBe("Coo Orchestrator");
    expect(titleize("wsid:data.architect")).toBe("Wsid Data Architect");
  });

  it("falls back to Unknown for an empty/separator-only string", () => {
    expect(titleize("")).toBe("Unknown");
    expect(titleize("___")).toBe("Unknown");
  });
});

describe("normalizeAgentId (EP-8DC217EB BET-10)", () => {
  it("trims and returns a real id", () => {
    expect(normalizeAgentId("  AGT-123 ")).toBe("AGT-123");
  });

  it("treats empty or literal 'unknown' (any case) as no-agent", () => {
    expect(normalizeAgentId("")).toBe("");
    expect(normalizeAgentId("   ")).toBe("");
    expect(normalizeAgentId("unknown")).toBe("");
    expect(normalizeAgentId("UNKNOWN")).toBe("");
  });
});

describe("providerFromEndpoint (EP-8DC217EB BET-10)", () => {
  it("returns the segment before the first colon", () => {
    expect(providerFromEndpoint("anthropic:claude-opus-4-8", "unrouted")).toBe("anthropic");
  });

  it("returns the fallback when there is no provider segment", () => {
    expect(providerFromEndpoint("", "unrouted")).toBe("unrouted");
    expect(providerFromEndpoint(":model-only", "fallback")).toBe("fallback");
  });

  it("returns the whole string when there is no colon", () => {
    expect(providerFromEndpoint("local", "unrouted")).toBe("local");
  });
});
