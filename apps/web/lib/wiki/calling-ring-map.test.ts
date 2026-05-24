// BI-4AA1074B Slice 2: tests for the ring-scope predicate + calling-surface
// resolver. Pure module, no I/O — straight unit coverage of the four rules
// in spec §5.2.

import { describe, expect, it } from "vitest";
import {
  CALLING_RING_DEFAULTS,
  bothRings,
  principleMatchesRingScope,
  resolveCallerRingScope,
} from "./calling-ring-map";

describe("principleMatchesRingScope (spec §5.2 rules)", () => {
  it("rule 1: universal-ring on the principle always passes", () => {
    expect(
      principleMatchesRingScope(["universal-ring"], ["ring-1-coworker"]),
    ).toBe(true);
    expect(
      principleMatchesRingScope(
        ["universal-ring", "ring-2-workflow"],
        ["ring-5-hive"],
      ),
    ).toBe(true);
  });

  it("rule 2: empty principle scope passes (backward-compat for un-backfilled rows)", () => {
    expect(principleMatchesRingScope([], ["ring-1-coworker"])).toBe(true);
    expect(principleMatchesRingScope([], ["ring-5-hive"])).toBe(true);
  });

  it("rule 3: caller universal-ring passes every principle", () => {
    expect(
      principleMatchesRingScope(["ring-2-workflow"], ["universal-ring"]),
    ).toBe(true);
    expect(
      principleMatchesRingScope(
        ["ring-5-hive"],
        ["universal-ring", "ring-1-coworker"],
      ),
    ).toBe(true);
  });

  it("rule 4: non-empty intersection passes", () => {
    expect(
      principleMatchesRingScope(["ring-2-workflow"], ["ring-2-workflow"]),
    ).toBe(true);
    expect(
      principleMatchesRingScope(
        ["ring-2-workflow", "ring-4-sandbox-prod"],
        ["ring-4-sandbox-prod"],
      ),
    ).toBe(true);
  });

  it("rule 4: empty intersection fails", () => {
    expect(
      principleMatchesRingScope(["ring-1-coworker"], ["ring-5-hive"]),
    ).toBe(false);
    expect(
      principleMatchesRingScope(
        ["ring-2-workflow"],
        ["ring-3-archetype", "ring-4-sandbox-prod"],
      ),
    ).toBe(false);
  });
});

describe("resolveCallerRingScope", () => {
  it("returns the registered scope for a known surface", () => {
    expect(resolveCallerRingScope("build-studio-phase")).toEqual([
      "ring-2-workflow",
    ]);
    expect(resolveCallerRingScope("promotion-gate")).toEqual([
      "ring-4-sandbox-prod",
    ]);
    expect(resolveCallerRingScope("hive-contribution-gate")).toEqual([
      "ring-4-sandbox-prod",
      "ring-5-hive",
    ]);
  });

  it("falls back to universal-ring for unknown surfaces (so the kernel call still works)", () => {
    // Use a unique surface name per test run to avoid the seen-cache silencing the debug log.
    const surface = `unknown-surface-${Date.now()}`;
    expect(resolveCallerRingScope(surface)).toEqual(["universal-ring"]);
  });

  it("covers every ring in the CALLING_RING_DEFAULTS registry", () => {
    // Confidence check: every ring (except ring-3-archetype which has no
    // dedicated surface in the seed registry, and ring-5-hive which is
    // composed with ring-4) appears somewhere in the defaults.
    const allMapped = new Set(
      Object.values(CALLING_RING_DEFAULTS).flat(),
    );
    expect(allMapped.has("ring-1-coworker")).toBe(true);
    expect(allMapped.has("ring-2-workflow")).toBe(true);
    expect(allMapped.has("ring-3-archetype")).toBe(true);
    expect(allMapped.has("ring-4-sandbox-prod")).toBe(true);
    expect(allMapped.has("ring-5-hive")).toBe(true);
    expect(allMapped.has("external-coordination")).toBe(true);
    expect(allMapped.has("universal-ring")).toBe(true);
  });
});

describe("bothRings", () => {
  it("returns a two-element scope array preserving order", () => {
    expect(bothRings("ring-1-coworker", "ring-2-workflow")).toEqual([
      "ring-1-coworker",
      "ring-2-workflow",
    ]);
  });

  it("interoperates with principleMatchesRingScope (cross-ring boundary)", () => {
    const callerScope = bothRings("ring-1-coworker", "ring-2-workflow");
    expect(principleMatchesRingScope(["ring-2-workflow"], callerScope)).toBe(
      true,
    );
    expect(principleMatchesRingScope(["ring-1-coworker"], callerScope)).toBe(
      true,
    );
    expect(principleMatchesRingScope(["ring-5-hive"], callerScope)).toBe(false);
  });
});
