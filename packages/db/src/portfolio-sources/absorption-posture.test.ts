import { describe, expect, it } from "vitest";
import {
  ABSORPTION_STATUSES,
  ABSORPTION_VERDICTS,
  buildAbsorptionPostureSeedRows,
  defaultVerdictForTier,
  isAbsorptionSource,
  isAbsorptionStatus,
  isAbsorptionVerdict,
  postureIdFor,
} from "./absorption-posture.js";
import { VERTICAL_INCUMBENTS } from "./vertical-incumbents-manifest.js";

// P1 pure-logic tests (BI-BF909CE6). These exercise the seed-row builder and
// the enum predicates without the Prisma client, so they run in the source-only
// worktree; the DB-touching seed/accessor are covered by CI integration.

describe("absorption verdict vocabulary", () => {
  it("matches IncumbentCoverageAssessment.verdict exactly", () => {
    // Spec 2026-07-23 §5.2. If these drift, the per-customer coverage stage-1
    // default silently breaks.
    expect([...ABSORPTION_VERDICTS]).toEqual([
      "native_now",
      "adapter_bridge",
      "generic_connector",
      "provider_led",
      "do_not_absorb",
      "gap",
    ]);
  });

  it("predicates accept valid and reject invalid values", () => {
    expect(isAbsorptionVerdict("provider_led")).toBe(true);
    expect(isAbsorptionVerdict("native-now")).toBe(false);
    expect(isAbsorptionSource("seed")).toBe(true);
    expect(isAbsorptionSource("robot")).toBe(false);
    expect(isAbsorptionStatus("proposed")).toBe(true);
    expect(isAbsorptionStatus("done")).toBe(false);
  });
});

describe("conservative default verdicts (plan R1 — no overclaim)", () => {
  it("never defaults anything to native_now", () => {
    expect(defaultVerdictForTier("tier1-shared")).not.toBe("native_now");
    expect(defaultVerdictForTier("tier2-semi")).not.toBe("native_now");
    expect(defaultVerdictForTier("tier3-bespoke")).not.toBe("native_now");
  });

  it("defaults vertical operating systems to provider_led", () => {
    expect(defaultVerdictForTier("tier3-bespoke")).toBe("provider_led");
  });

  it("defaults shared connectors to generic_connector", () => {
    expect(defaultVerdictForTier("tier1-shared")).toBe("generic_connector");
    expect(defaultVerdictForTier("tier2-semi")).toBe("generic_connector");
  });
});

describe("posture seed rows", () => {
  const rows = buildAbsorptionPostureSeedRows();

  it("produces exactly one row per inventory provider", () => {
    expect(rows.length).toBe(VERTICAL_INCUMBENTS.length);
  });

  it("has a unique, deterministic postureId per row", () => {
    const ids = rows.map((r) => r.postureId);
    expect(new Set(ids).size).toBe(ids.length);
    // Deterministic — no Date.now/random, so re-seeding is idempotent.
    expect(postureIdFor("Mindbody", "fitness-management")).toBe(
      "posture-mindbody-fitness-management",
    );
  });

  it("seeds every row proposed + seed-sourced (nothing pre-confirmed)", () => {
    for (const r of rows) {
      expect(r.status).toBe("proposed");
      expect(r.source).toBe("seed");
      expect(ABSORPTION_STATUSES).toContain(r.status);
    }
  });

  it("carries the vertical's archetypeIds onto each posture", () => {
    const mindbody = rows.find((r) => r.providerName === "Mindbody");
    expect(mindbody?.archetypeIds).toEqual(["gym", "yoga-studio", "dance-studio"]);
  });

  it("derives connectorTier consistently with the verdict", () => {
    for (const r of rows) {
      expect(r.verdict).toBe(defaultVerdictForTier(r.connectorTier));
    }
  });
});
