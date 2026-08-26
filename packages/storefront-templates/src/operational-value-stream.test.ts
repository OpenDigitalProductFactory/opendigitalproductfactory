import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import {
  deriveOperationalValueStream,
  type OperationalValueStream,
} from "./operational-value-stream";

function ovsmFor(archetypeId: string): OperationalValueStream {
  const archetype = ALL_ARCHETYPES.find((a) => a.archetypeId === archetypeId);
  if (!archetype) throw new Error(`test archetype not found: ${archetypeId}`);
  return deriveOperationalValueStream(archetype);
}

describe("deriveOperationalValueStream — invariants across all archetypes", () => {
  it("produces a well-formed OVSM for every seeded archetype", () => {
    expect(ALL_ARCHETYPES.length).toBeGreaterThanOrEqual(56);
    for (const archetype of ALL_ARCHETYPES) {
      const ovs = deriveOperationalValueStream(archetype);
      // Generic archetypes retain the six primary stages + two cross-cuts;
      // a leaf-authored process replaces that commercial backbone.
      const keys = ovs.stages.map((s) => s.key);
      if (!archetype.activationProfile?.processProfile?.valueStreams?.length) {
        for (const required of [
          "attract",
          "capture",
          "qualify",
          "deliver",
          "settle",
          "retain",
          "trust-compliance",
          "operate-improve",
        ]) {
          expect(keys).toContain(required);
        }
      }
      // Stages are ordered.
      const orders = ovs.stages.map((s) => s.order);
      expect([...orders]).toEqual([...orders].sort((a, b) => a - b));
      // Core derived facts are always present.
      expect(ovs.loadBearingStageKeys.length).toBeGreaterThan(0);
      expect(ovs.capacityUnit).toBeTruthy();
      expect(ovs.demandSignature).toBeTruthy();
      expect(ovs.it4itStageBinding.length).toBeGreaterThan(0);
      // Exactly the load-bearing stages are flagged.
      const flagged = ovs.stages.filter((s) => s.loadBearing).map((s) => s.key).sort();
      expect(flagged).toEqual([...ovs.loadBearingStageKeys].sort());
      // Generic trust gates live on the trust-compliance cross-cut. Leaf
      // profiles bind gates to the stage where the decision is made.
      const trustStage = ovs.stages.find((s) => s.key === "trust-compliance");
      if (trustStage) expect(trustStage.trustGateKeys).toEqual(ovs.trustGates);
      else expect(new Set(ovs.stages.flatMap((s) => s.trustGateKeys))).toEqual(new Set(ovs.trustGates));
    }
  });

  it("adds the return-inspect stage only for reservation-and-return archetypes", () => {
    const rentalIds = ["equipment-rental", "self-storage", "agricultural-cooperative", "production-equipment-rental"];
    for (const id of rentalIds) {
      expect(ovsmFor(id).stages.map((s) => s.key)).toContain("return-inspect");
    }
    // Non-rental archetypes never grow the stage.
    for (const archetype of ALL_ARCHETYPES) {
      if (rentalIds.includes(archetype.archetypeId)) continue;
      const ovs = deriveOperationalValueStream(archetype);
      expect(ovs.stages.map((s) => s.key)).not.toContain("return-inspect");
    }
  });
});

describe("deriveOperationalValueStream — representative archetypes", () => {
  it("pet-rescue: projects intake, welfare, and placement instead of a commercial funnel", () => {
    const ovs = ovsmFor("pet-rescue");

    expect(ovs.streams.map((stream) => stream.label)).toEqual([
      "Intake and safe placement",
      "Health and welfare",
      "Adoption and placement",
    ]);
    expect(ovs.stages.map((stage) => stage.key)).not.toContain("capture");
    expect(ovs.stages.map((stage) => stage.label)).not.toContain("Capture Demand");
    expect(ovs.stages.map((stage) => stage.key)).toEqual(
      expect.arrayContaining([
        "intake-capacity-decision",
        "intake-quarantine-placement",
        "welfare-medical-treatment",
        "welfare-exception",
        "welfare-adoption-readiness",
        "placement-custody-transfer",
        "placement-return-reentry",
      ]),
    );
    expect(ovs.supportingCapabilities).toEqual([
      "Fundraising",
      "Volunteer Coordination",
      "Supplies",
      "Compliance",
      "Reporting",
    ]);
  });

  it("pet-rescue: carries the acceptance paths and exception decisions operators must verify", () => {
    const ovs = ovsmFor("pet-rescue");
    const byKey = new Map(ovs.stages.map((stage) => [stage.key, stage]));
    const acceptancePaths = {
      intake: ["intake-report-handoff", "intake-identify-triage", "intake-capacity-decision", "intake-quarantine-placement"],
      welfareException: ["welfare-daily-care", "welfare-exception", "welfare-adoption-readiness"],
      adoption: ["placement-promotion", "placement-application-screening", "placement-meet-home-check", "placement-match-reservation", "placement-custody-transfer", "placement-follow-up"],
      failedPlacementReturn: ["placement-follow-up", "placement-return-reentry", "intake-identify-triage"],
    };

    for (const path of Object.values(acceptancePaths)) {
      for (const stageKey of path) expect(byKey.has(stageKey)).toBe(true);
    }
    expect(byKey.get("intake-capacity-decision")).toMatchObject({
      output: expect.stringMatching(/partner-transfer|safe waitlist/i),
      trustGateKeys: ["safe-capacity-decision"],
    });
    expect(byKey.get("welfare-exception")).toMatchObject({
      responsibleRole: "Duty manager",
      trustGateKeys: ["welfare-escalation"],
    });
    expect(byKey.get("placement-custody-transfer")?.output).toMatch(/custody transfer/i);
    expect(byKey.get("placement-return-reentry")).toMatchObject({
      handoffToStageKey: "intake-identify-triage",
      trustGateKeys: ["return-and-reentry-safety"],
    });
  });

  it("keeps a generic commercial stream for archetypes without a leaf process definition", () => {
    const ovs = ovsmFor("hair-salon");
    expect(ovs.streams).toHaveLength(1);
    expect(ovs.streams[0]?.stages.map((stage) => stage.key)).toContain("capture");
  });

  it("hair-salon: appointment-checkout, load-bearing qualify, slot-hours", () => {
    const ovs = ovsmFor("hair-salon");
    expect(ovs.loadBearingStageKeys).toContain("qualify");
    expect(ovs.capacityUnit).toBe("slot-hours");
  });

  it("veterinary-clinic: encounter-based, load-bearing deliver, clinical trust gate", () => {
    const ovs = ovsmFor("veterinary-clinic");
    expect(ovs.loadBearingStageKeys).toContain("deliver");
    expect(ovs.trustGates).toContain("clinical-adjacent-no-advice");
  });

  it("bakery: point-of-sale, load-bearing capture, perishable/durable stock", () => {
    const ovs = ovsmFor("bakery");
    expect(ovs.loadBearingStageKeys).toContain("capture");
    expect(["perishable-stock", "durable-stock"]).toContain(ovs.capacityUnit);
  });

  it("gym: subscription, load-bearing retain, physical hard cap", () => {
    const ovs = ovsmFor("gym");
    expect(ovs.loadBearingStageKeys).toContain("retain");
    expect(ovs.capacityUnit).toBe("physical-hard-cap");
  });

  it("it-managed-services: recurring-agreement, load-bearing deliver, strict estate gate", () => {
    const ovs = ovsmFor("it-managed-services");
    expect(ovs.loadBearingStageKeys).toContain("deliver");
    expect(ovs.trustGates).toContain("strict-estate-separation");
  });

  it("community-bank: account-based-fees, trust gate precedes qualify, KYC signal", () => {
    const ovs = ovsmFor("community-bank");
    expect(ovs.loadBearingStageKeys).toContain("trust-compliance");
    expect(ovs.trustGates).toContain("kyc-and-disclosure");
  });

  it("small-town-municipality: statutory, universal-service obligation", () => {
    const ovs = ovsmFor("small-town-municipality");
    expect(ovs.trustGates).toContain("universal-service-obligation");
  });

  it("charity: donation, load-bearing capture, donation receipt (no invoice)", () => {
    const ovs = ovsmFor("charity");
    expect(ovs.loadBearingStageKeys).toContain("capture");
    const settle = ovs.stages.find((s) => s.key === "settle");
    expect(settle?.metricBindings).toContain("donation-receipt");
    expect(settle?.metricBindings).not.toContain("invoice");
  });

  it("equipment-rental: reusable pooled asset, synchronized contention, return-inspect", () => {
    const ovs = ovsmFor("equipment-rental");
    expect(ovs.capacityUnit).toBe("reusable-pooled-asset");
    expect(ovs.demandSignature).toBe("synchronized-contention");
    expect(ovs.stages.map((s) => s.key)).toContain("return-inspect");
  });

  it("self-storage: reusable pooled asset", () => {
    expect(ovsmFor("self-storage").capacityUnit).toBe("reusable-pooled-asset");
  });

  it("agricultural-cooperative: member-owned equitable allocation + return-inspect", () => {
    const ovs = ovsmFor("agricultural-cooperative");
    expect(ovs.trustGates).toContain("member-equitable-allocation");
    expect(ovs.stages.map((s) => s.key)).toContain("return-inspect");
  });

  it("industrial equipment OEM: steady production throughput with strict customer-estate separation", () => {
    const ovs = ovsmFor("industrial-equipment-oem");

    expect(ovs.capacityUnit).toBe("service-throughput");
    expect(ovs.demandSignature).toBe("steady");
    expect(ovs.trustGates).toContain("strict-estate-separation");
  });
});
