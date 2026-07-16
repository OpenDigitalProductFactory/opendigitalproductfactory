import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import { deriveTwinProfile } from "./twin-profile";
import { deriveOperationalValueStream } from "./operational-value-stream";
import { deriveTwinValueStreamBinding } from "./twin-value-stream";

describe("deriveTwinValueStreamBinding", () => {
  it("binds every twin queue and zone to a stage the archetype actually has", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const binding = deriveTwinValueStreamBinding(archetype);
      const profile = deriveTwinProfile(archetype);
      const ovs = deriveOperationalValueStream(archetype);
      const stageKeys = new Set(ovs.stages.map((s) => s.key));

      // Every queue + zone resolves, and only to a real stage of THIS archetype.
      for (const q of profile.queues) {
        expect(binding.queueToStage[q.key]).toBeDefined();
        expect(stageKeys.has(binding.queueToStage[q.key])).toBe(true);
      }
      for (const z of profile.zones) {
        expect(binding.zoneToStage[z.key]).toBeDefined();
        expect(stageKeys.has(binding.zoneToStage[z.key])).toBe(true);
      }
      expect(stageKeys.has(binding.primaryStageKey)).toBe(true);
    }
  });

  it("stages are ordered and partition the queues/zones consistently", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const binding = deriveTwinValueStreamBinding(archetype);
      const profile = deriveTwinProfile(archetype);

      // Ordered by the OVS order.
      const orders = binding.stages.map((s) => s.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));

      // The per-stage queueKeys are a partition of the profile's queues.
      const boundQueues = binding.stages.flatMap((s) => s.queueKeys).sort();
      expect(boundQueues).toEqual(profile.queues.map((q) => q.key).sort());
      const boundZones = binding.stages.flatMap((s) => s.zoneKeys).sort();
      expect(boundZones).toEqual(profile.zones.map((z) => z.key).sort());

      // Each stage's queueKeys agree with queueToStage.
      for (const s of binding.stages) {
        for (const qk of s.queueKeys) expect(binding.queueToStage[qk]).toBe(s.stageKey);
      }
    }
  });

  it("is deterministic", () => {
    for (const archetype of ALL_ARCHETYPES) {
      expect(deriveTwinValueStreamBinding(archetype)).toEqual(deriveTwinValueStreamBinding(archetype));
    }
  });

  it("maps retain-style queues to Retain and dispatch/booking demand to its captured stage", () => {
    // A SaaS/board archetype has renewals / at-risk queues → retain.
    const saas = ALL_ARCHETYPES.find((a) => a.category === "software-platform");
    if (saas) {
      const b = deriveTwinValueStreamBinding(saas);
      const p = deriveTwinProfile(saas);
      const renewal = p.queues.find((q) => /renew|risk|cta/i.test(q.key));
      if (renewal) expect(["retain"]).toContain(b.queueToStage[renewal.key]);
    }

    // A field-service archetype's dispatch queue → qualify.
    const trades = ALL_ARCHETYPES.find((a) => a.category === "trades-maintenance");
    if (trades) {
      const b = deriveTwinValueStreamBinding(trades);
      const p = deriveTwinProfile(trades);
      const dispatch = p.queues.find((q) => /dispatch/i.test(q.key));
      if (dispatch) expect(b.queueToStage[dispatch.key]).toBe("qualify");
    }
  });

  it("gives rental archetypes a Return & Inspect binding", () => {
    const rental = ALL_ARCHETYPES.find((a) => a.category === "asset-rental");
    if (!rental) return;
    const b = deriveTwinValueStreamBinding(rental);
    expect(b.stages.some((s) => s.stageKey === "return-inspect")).toBe(true);
  });
});
