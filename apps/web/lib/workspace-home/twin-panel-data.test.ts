import { describe, it, expect } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import { resolveWorkspaceTwinPresentation } from "./twin-panel-data";

const SAMPLE = ALL_ARCHETYPES[0];

describe("resolveWorkspaceTwinPresentation", () => {
  it("resolves a profile + snapshot for a real archetype slug", () => {
    const result = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    expect(result).not.toBeNull();
    expect(result?.archetypeId).toBe(SAMPLE.archetypeId);
    expect(result?.archetypeName).toBe(SAMPLE.name);
    expect(result?.profile.template).toBeTruthy();
    expect(result?.snapshot.capacityChips.length).toBeGreaterThan(0);
    expect(result?.demo).toBe(true);
  });

  it("condenses for the home mount — no rival attention surface (cockpit owns it)", () => {
    // The workspace home renders OperatorCockpit as the single attention surface
    // (BI-8C3EB52C); the twin's own cog + needs-you quests must be suppressed.
    const result = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    expect(result?.snapshot.cog).toBeUndefined();
    expect(result?.snapshot.quests).toEqual([]);
    // The operational body still renders.
    expect(result?.snapshot.zones.length).toBeGreaterThan(0);
    expect(result?.snapshot.queues.length).toBeGreaterThan(0);
  });

  it("prefers the supplied display name but falls back to the definition name", () => {
    expect(resolveWorkspaceTwinPresentation(SAMPLE.archetypeId, "Acme Co")?.archetypeName).toBe(
      "Acme Co",
    );
    expect(resolveWorkspaceTwinPresentation(SAMPLE.archetypeId, "  ")?.archetypeName).toBe(
      SAMPLE.name,
    );
  });

  it("returns null for an unconfigured or unknown archetype (never throws)", () => {
    expect(resolveWorkspaceTwinPresentation(null)).toBeNull();
    expect(resolveWorkspaceTwinPresentation(undefined)).toBeNull();
    expect(resolveWorkspaceTwinPresentation("")).toBeNull();
    expect(resolveWorkspaceTwinPresentation("not-a-real-archetype-slug")).toBeNull();
  });

  it("is deterministic — same slug yields the same snapshot", () => {
    const a = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    const b = resolveWorkspaceTwinPresentation(SAMPLE.archetypeId);
    expect(a?.snapshot).toEqual(b?.snapshot);
  });

  it("derives for every archetype without throwing", () => {
    for (const arch of ALL_ARCHETYPES) {
      const result = resolveWorkspaceTwinPresentation(arch.archetypeId);
      expect(result, arch.archetypeId).not.toBeNull();
    }
  });
});
