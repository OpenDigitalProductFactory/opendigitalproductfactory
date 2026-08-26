import { describe, it, expect } from "vitest";
import { ALL_ARCHETYPES } from "./archetypes/index";
import { deriveTwinProfile } from "./twin-profile";
import { deriveTwinValueStreamBinding } from "./twin-value-stream";
import {
  deriveDemoBusiness,
  evaluateDemoDelight,
  summarizeDemoBusiness,
} from "./demo-business";

describe("deriveDemoBusiness", () => {
  // ── Scale gate: the delight oracle over ALL 94 archetypes (spec §5.3) ────────
  it.each(ALL_ARCHETYPES.map((a) => [a.archetypeId, a] as const))(
    "produces a non-degenerate demo for %s",
    (_id, archetype) => {
      const demo = deriveDemoBusiness(archetype);
      const profile = deriveTwinProfile(archetype);
      const verdict = evaluateDemoDelight(demo, profile);
      expect(verdict.violations).toEqual([]);
      expect(verdict.ok).toBe(true);
    },
  );

  // ── Determinism: same seed ⇒ deep-equal output (no Math.random/Date) ─────────
  it("is deterministic in the seed", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const a = deriveDemoBusiness(archetype);
      const b = deriveDemoBusiness(archetype);
      expect(a).toEqual(b);
    }
  });

  it("varies output by seed", () => {
    const archetype = ALL_ARCHETYPES[0];
    const a = deriveDemoBusiness(archetype, { seed: "seed-a" });
    const b = deriveDemoBusiness(archetype, { seed: "seed-b" });
    expect(a).not.toEqual(b);
  });

  // ── Flavor + injected enrichment override the derived defaults ───────────────
  it("applies the thin flavor layer", () => {
    const archetype = ALL_ARCHETYPES[0];
    const demo = deriveDemoBusiness(archetype, {
      flavor: {
        companyName: "Bright Smile Dental",
        currency: "USD",
        timezone: "America/New_York",
        staff: [{ name: "Dr. Ada Rowe", role: "Principal Dentist" }],
        customers: ["Jordan Reyes"],
        notes: "A calm, on-time practice.",
      },
    });
    expect(demo.companyName).toBe("Bright Smile Dental");
    expect(demo.currency).toBe("USD");
    expect(demo.timezone).toBe("America/New_York");
    expect(demo.workforce[0]).toMatchObject({ name: "Dr. Ada Rowe", role: "Principal Dentist" });
    expect(demo.customers[0].name).toBe("Jordan Reyes");
    expect(demo.narrative.notes).toBe("A calm, on-time practice.");
    expect(demo.finance.currency).toBe("USD");
  });

  it("prefers injected playbook / business-profile signal", () => {
    const archetype = ALL_ARCHETYPES[0];
    const demo = deriveDemoBusiness(archetype, {
      playbook: { primaryGoal: "Rebook every patient", keyMetrics: ["Rebooking rate"] },
      businessProfile: { whoWeServe: "Families in the neighbourhood." },
    });
    expect(demo.narrative.primaryGoal).toBe("Rebook every patient");
    expect(demo.narrative.keyMetrics).toEqual(["Rebooking rate"]);
    expect(demo.narrative.whoWeServe).toBe("Families in the neighbourhood.");
  });

  // ── Grounding: demand carries value-stream stages and twin queues ────────────
  it("maps queued demand to twin queues and value-stream stages", () => {
    for (const archetype of ALL_ARCHETYPES) {
      const demo = deriveDemoBusiness(archetype);
      const profile = deriveTwinProfile(archetype);
      const queueKeys = new Set(profile.queues.map((q) => q.key));
      for (const d of demo.demand) {
        if (d.queueKey) expect(queueKeys.has(d.queueKey)).toBe(true);
        expect(
          deriveTwinValueStreamBinding(archetype).stages.some(
            (stage) => stage.stageKey === d.stageKey,
          ),
        ).toBe(true);
      }
    }
  });

  // ── Golden snapshot: a compact digest across all 94 (spec §5.2) ──────────────
  it("matches the golden digest across all archetypes", () => {
    const digest = ALL_ARCHETYPES.map((a) => summarizeDemoBusiness(deriveDemoBusiness(a)));
    expect(digest).toMatchSnapshot();
  });
});
