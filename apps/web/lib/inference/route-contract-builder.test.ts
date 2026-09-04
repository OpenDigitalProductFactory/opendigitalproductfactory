import { describe, expect, it } from "vitest";
import { buildInitialRouteContext } from "./route-contract-builder";

// BI-8B4359DE / robust-build gap: `modelTier` expresses a cost/quality TIER
// preference (trivial-tail build work is sized to the on-box "local" tier), NOT
// a data-residency boundary. Conflating "prefer the local tier" with a hard
// `local_only` residency pinned every trivial build to the bundled local model —
// which is fenced by local-CI capacity reservation on a single host — so those
// builds could never route to (or fall back to) a connected cloud engine and
// failed at ideate under sustained load. The ONLY hard local-only boundary is
// the explicit platform switch (`localOnlyInference`); sensitivity clearance
// still independently protects sensitive data on every request.
describe("buildInitialRouteContext — modelTier is a preference, not a residency boundary", () => {
  const base = { sensitivity: "public" as const, posture: null };

  it("does NOT force local_only residency just because modelTier is 'local'", () => {
    const ctx = buildInitialRouteContext({
      ...base,
      options: { modelTier: "local" },
      localOnlyInference: false,
    });
    expect(ctx.residencyPolicy).not.toBe("local_only");
  });

  it("honors an explicit residencyPolicy override even when modelTier is 'local'", () => {
    const ctx = buildInitialRouteContext({
      ...base,
      options: { modelTier: "local", residencyPolicy: "any_enabled" },
      localOnlyInference: false,
    });
    expect(ctx.residencyPolicy).toBe("any_enabled");
  });

  it("STILL forces local_only when the platform local-only switch is on (hard boundary)", () => {
    const ctx = buildInitialRouteContext({
      ...base,
      options: { modelTier: "local" },
      localOnlyInference: true,
    });
    expect(ctx.residencyPolicy).toBe("local_only");
  });

  it("forces local_only under the platform switch regardless of a robust tier", () => {
    const ctx = buildInitialRouteContext({
      ...base,
      options: { modelTier: "robust" },
      localOnlyInference: true,
    });
    expect(ctx.residencyPolicy).toBe("local_only");
  });
});
