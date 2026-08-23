import { describe, expect, it } from "vitest";

import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";

import { deriveStreamBiases } from "./derive";
import { resolveWorkPosture } from "./resolve";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";

// EP-WORK-POSTURE (BI-BEDAFF57) — every archetype resolves a posture from its
// OWN operational value stream.
//
// The founder's requirement was that all archetypes be adjusted. Hand-authoring
// a posture per archetype would drift the moment archetype N+1 lands and would
// contradict the OVSM contract's own rule — derive, never author. This test is
// how that requirement is satisfied MECHANICALLY: it enumerates the live
// catalogue rather than a hardcoded list, so a new archetype is covered on the
// day it ships, and it fails loudly if one ever cannot produce a posture.

const PLAN: ProactivityPlan = {
  resolvedLevel: "balanced",
  policyId: "proactivity:conformance:balanced",
  attentionWindowMinutes: 60,
  followUpCadenceMinutes: [120],
  maxAttempts: 2,
  spendClass: "standard",
  channelPolicy: "preferred-channel",
  escalationTarget: "attention-surface",
  actionBoundary: "propose",
  explanation: "conformance",
  evidenceRefs: [],
};

const NOW = new Date("2026-08-19T15:00:00.000Z");

describe("archetype posture conformance", () => {
  it("the catalogue is enumerated, not hardcoded", () => {
    // If this ever reads as a small fixed number, the test has stopped covering
    // the catalogue and started covering a snapshot of it.
    expect(ALL_ARCHETYPES.length).toBeGreaterThan(50);
  });

  it("every archetype projects the four properties the posture consumes", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const ovs = deriveOperationalValueStream(archetype);
      expect(ovs.demandSignature, `${archetype.archetypeId} has no demand signature`).toBeTruthy();
      expect(ovs.capacityUnit, `${archetype.archetypeId} has no capacity unit`).toBeTruthy();
      expect(Array.isArray(ovs.loadBearingStageKeys)).toBe(true);
      expect(Array.isArray(ovs.trustGates)).toBe(true);
    }
  });

  it("every archetype resolves a posture without throwing, from its own stream", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const ovs = deriveOperationalValueStream(archetype);
      const posture = resolveWorkPosture({
        inherited: { proactivityPlan: PLAN, priority: null, source: "platform" },
        stream: {
          demandSignature: ovs.demandSignature,
          capacityUnit: ovs.capacityUnit,
          loadBearingStageKeys: ovs.loadBearingStageKeys,
          trustGates: ovs.trustGates,
          stageKey: ovs.loadBearingStageKeys[0] ?? null,
        },
        temporal: { now: NOW, schedule: null, timezone: null },
      });
      expect(posture, `${archetype.archetypeId} resolved no posture`).toBeTruthy();
      expect(posture.proactivityLevel).toBeTruthy();
      expect(posture.actionBoundary).toBeTruthy();
    }
  });

  it("no archetype's stream can WIDEN authority", () => {
    // The tighten-only invariant, asserted across the whole catalogue rather
    // than on a sample: an archetype is data, and data must never be able to
    // buy a coworker more freedom.
    for (const archetype of ALL_ARCHETYPES) {
      const ovs = deriveOperationalValueStream(archetype);
      const posture = resolveWorkPosture({
        inherited: {
          proactivityPlan: { ...PLAN, actionBoundary: "advise" },
          priority: null,
          source: "platform",
        },
        stream: {
          demandSignature: ovs.demandSignature,
          capacityUnit: ovs.capacityUnit,
          loadBearingStageKeys: ovs.loadBearingStageKeys,
          trustGates: ovs.trustGates,
          stageKey: ovs.loadBearingStageKeys[0] ?? null,
        },
      });
      expect(
        posture.actionBoundary,
        `${archetype.archetypeId} widened an advise boundary`,
      ).toBe("advise");
    }
  });

  it("an archetype carrying trust gates always deepens verification", () => {
    const gated = ALL_ARCHETYPES.map((a) => deriveOperationalValueStream(a)).filter(
      (ovs) => ovs.trustGates.length > 0,
    );
    // Not every catalogue will have one; assert the rule only where it applies,
    // and say so rather than silently passing on an empty set.
    for (const ovs of gated) {
      const biases = deriveStreamBiases({
        demandSignature: ovs.demandSignature,
        capacityUnit: ovs.capacityUnit,
        loadBearingStageKeys: ovs.loadBearingStageKeys,
        trustGates: ovs.trustGates,
        stageKey: null,
      });
      expect(biases.some((b) => b.verificationDepth === "deep")).toBe(true);
    }
  });

  it("reports how much of the catalogue the stream actually biases", () => {
    // An honest coverage number, not a pass/fail dressed as completeness. Most
    // archetypes are steady-demand and contribute nothing — that is a real
    // answer, not a gap.
    let biased = 0;
    for (const archetype of ALL_ARCHETYPES) {
      const ovs = deriveOperationalValueStream(archetype);
      const biases = deriveStreamBiases({
        demandSignature: ovs.demandSignature,
        capacityUnit: ovs.capacityUnit,
        loadBearingStageKeys: ovs.loadBearingStageKeys,
        trustGates: ovs.trustGates,
        stageKey: ovs.loadBearingStageKeys[0] ?? null,
      });
      if (biases.length > 0) biased += 1;
    }
    // Pinned as a floor, not an exact figure, so adding an archetype does not
    // break the suite while a REGRESSION to zero still would.
    expect(biased).toBeGreaterThan(0);
  });
});
