import { describe, it, expect } from "vitest";
import {
  ALL_ARCHETYPES,
  deriveDemoBusiness,
  deriveTwinProfile,
  deriveTwinValueStreamBinding,
} from "@dpf/storefront-templates";

import { demoBusinessToTwinSnapshot, demoGalleryCard } from "./demo-business-snapshot";

describe("demoBusinessToTwinSnapshot", () => {
  it("renders a non-degenerate TwinSnapshot for every archetype", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const demo = deriveDemoBusiness(archetype);
      const profile = deriveTwinProfile(archetype);
      const snap = demoBusinessToTwinSnapshot(demo, profile);

      // Zones keyed to the profile, every zone has units (mirrors the delight oracle).
      expect(snap.zones.map((z) => z.key)).toEqual(profile.zones.map((z) => z.key));
      expect(snap.zones.every((z) => z.units.length > 0)).toBe(true);

      // Queues keyed to the profile; the primary queue has demand with wait strings.
      expect(snap.queues.map((q) => q.key)).toEqual(profile.queues.map((q) => q.key));
      const primary = snap.queues[0];
      expect(primary.items.length).toBeGreaterThan(0);
      expect(primary.items.every((i) => /^\d+m$/.test(i.waiting ?? ""))).toBe(true);
      // The cog's move is surfaced inline on the first queued item.
      expect(primary.items[0].suggestion).toBe(demo.cogProposal);

      // Cog, presence (humans + AI), capacity chips, and finance utility all present.
      expect(snap.cog?.proposal).toBe(demo.cogProposal);
      expect(snap.presence.some((p) => p.kind === "human")).toBe(true);
      expect(snap.presence.some((p) => p.kind === "ai")).toBe(true);
      expect(snap.capacityChips.length).toBeGreaterThan(0);
      expect(snap.utility.some((u) => u.key === "revenue")).toBe(true);
      expect(snap.utility.some((u) => u.key === "bills")).toBe(true);
    }
  });

  it("overlays the value-stream flow lane when a binding is supplied (workstream C)", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const demo = deriveDemoBusiness(archetype);
      const profile = deriveTwinProfile(archetype);
      const binding = deriveTwinValueStreamBinding(archetype);

      // Without a binding, no stageFlow (fixtures stay simple).
      expect(demoBusinessToTwinSnapshot(demo, profile).stageFlow).toBeUndefined();

      // With a binding, the flow lane mirrors the archetype's stages and totals
      // reconcile with the demand.
      const snap = demoBusinessToTwinSnapshot(demo, profile, binding);
      expect(snap.stageFlow).toBeDefined();
      expect(snap.stageFlow!.map((s) => s.stageKey)).toEqual(binding.stages.map((s) => s.stageKey));
      const totalInFlow = snap.stageFlow!.reduce((n, s) => n + s.count, 0);
      expect(totalInFlow).toBe(demo.demand.length);
      // All demand lands on real stages, so the flow is non-empty.
      expect(snap.stageFlow!.some((s) => s.count > 0)).toBe(true);
    }
  });

  it("owns resource units by their worker when the resource is a person", () => {
    // A booking archetype (BOOK) has person-resources (providers).
    const dentist = ALL_ARCHETYPES.find((a) => a.archetypeId === "dental-practice")!;
    const demo = deriveDemoBusiness(dentist);
    const profile = deriveTwinProfile(dentist);
    const snap = demoBusinessToTwinSnapshot(demo, profile);
    const owned = snap.zones.flatMap((z) => z.units).filter((u) => u.owner);
    expect(owned.length).toBeGreaterThan(0);
    expect(owned.every((u) => typeof u.owner!.name === "string")).toBe(true);
  });
});

describe("demoGalleryCard", () => {
  it("summarizes each archetype for the scannable grid", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const demo = deriveDemoBusiness(archetype);
      const profile = deriveTwinProfile(archetype);
      const card = demoGalleryCard(demo, profile);
      expect(card.archetypeId).toBe(archetype.archetypeId);
      expect(card.companyName.length).toBeGreaterThan(0);
      expect(card.template).toBe(profile.template);
      expect(card.aiCoworkers).toBeGreaterThanOrEqual(1);
      expect(card.workforce).toBeGreaterThan(card.aiCoworkers);
      expect(card.staffedZones).toMatch(/^\d+ \/ \d+ zones staffed$/);
      expect(card.cogProposal.length).toBeGreaterThan(0);
    }
  });
});
