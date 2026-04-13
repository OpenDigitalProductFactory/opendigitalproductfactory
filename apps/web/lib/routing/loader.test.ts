import { describe, it, expect } from "vitest";
import { resolveToolUse } from "./loader";

const baseProfile = {
  profileSource: "seed",
  capabilityOverrides: null,
  capabilities: {},
  supportsToolUse: null,
  provider: { supportsToolUse: true },
};

describe("resolveToolUse", () => {
  it("admin override wins over everything", () => {
    const profile = { ...baseProfile, profileSource: "admin", capabilityOverrides: { toolUse: false }, capabilities: { toolUse: true }, supportsToolUse: true };
    expect(resolveToolUse(profile as any)).toBe(false);
  });

  it("discovery capability value used for discovery-owned profiles", () => {
    const profile = { ...baseProfile, profileSource: "auto-discover", capabilities: { toolUse: true } };
    expect(resolveToolUse(profile as any)).toBe(true);
  });

  it("discovery capability false is respected (not overridden by provider)", () => {
    const profile = { ...baseProfile, profileSource: "auto-discover", capabilities: { toolUse: false } };
    expect(resolveToolUse(profile as any)).toBe(false);
  });

  it("catalog capability value used for catalog-owned profiles", () => {
    const profile = { ...baseProfile, profileSource: "catalog", capabilities: { toolUse: true } };
    expect(resolveToolUse(profile as any)).toBe(true);
  });

  it("falls through to profile.supportsToolUse when capabilities has no toolUse", () => {
    const profile = { ...baseProfile, profileSource: "seed", capabilities: {}, supportsToolUse: true };
    expect(resolveToolUse(profile as any)).toBe(true);
  });

  it("falls through to provider supportsToolUse as floor", () => {
    const profile = { ...baseProfile, profileSource: "seed", capabilities: {}, supportsToolUse: null, provider: { supportsToolUse: true } };
    expect(resolveToolUse(profile as any)).toBe(true);
  });

  it("returns null when everything unknown", () => {
    const profile = { ...baseProfile, profileSource: "seed", capabilities: {}, supportsToolUse: null, provider: { supportsToolUse: null } };
    expect(resolveToolUse(profile as any)).toBeNull();
  });
});
