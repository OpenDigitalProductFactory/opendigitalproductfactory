import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

// EP-WORK-POSTURE Slice D (BI-4F468192) — regression guard for a defect found
// only by looking at live data.
//
// `StorefrontConfig.archetypeId` is a foreign key to `StorefrontArchetype.id`
// (a cuid). The archetype SLUG — what `ALL_ARCHETYPES` is keyed by — lives on
// `StorefrontArchetype.archetypeId`. Reading the config column and matching it
// against the slug registry compiles, typechecks, runs without error, and
// silently never matches: the archetype half of every room's posture would
// resolve to nothing while every layer looked healthy.
//
// Verified against the live install 2026-08-22: StorefrontConfig held
// "cmq5kqdyb09lr5nr074qch160" for the archetype whose slug is
// "software-platform".

describe("archetype slug vs row id", () => {
  it("no archetype slug is shaped like a cuid", () => {
    // If a slug ever looked like a cuid, the mismatch would stop being visible
    // and this guard would stop protecting anything.
    for (const archetype of ALL_ARCHETYPES) {
      expect(
        /^c[a-z0-9]{24,}$/.test(archetype.archetypeId),
        `archetype slug "${archetype.archetypeId}" looks like a cuid`,
      ).toBe(false);
    }
  });

  it("a cuid never resolves against the slug registry", () => {
    const liveRowId = "cmq5kqdyb09lr5nr074qch160";
    expect(ALL_ARCHETYPES.find((a) => a.archetypeId === liveRowId)).toBeUndefined();
  });

  it("the live install's slug does resolve", () => {
    expect(ALL_ARCHETYPES.find((a) => a.archetypeId === "software-platform")).toBeDefined();
  });
});
