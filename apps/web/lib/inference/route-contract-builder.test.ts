import { describe, expect, it } from "vitest";
import { buildEffectiveRequestContract, buildInitialRouteContext } from "./route-contract-builder";

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
  it("requires JSON capability before selecting a route for a JSON activity", async () => {
    const contract = await buildEffectiveRequestContract({
      taskType: "build-review", messages: [{ role: "user", content: "Review and return JSON." }],
      routeContext: { sensitivity: "internal" }, taskRequirement: null,
      options: { activityContract: {
        activityId: "review", parentRef: {}, activityClass: "critique", title: "Review",
        distributionShape: "edge", riskClass: "high", successShape: "json",
        contextPolicy: "work-case-packet", tokenEnvelope: { maxInputTokens: 64000, maxOutputTokens: 16384, compression: "none" },
        evaluationPolicy: { evaluator: "review", minimumSignal: "review-passed" },
        requestContractHints: { taskType: "build-review" },
      } },
    });
    expect(contract.requiresStrictSchema).toBe(true);
  });
  it("retains required tool choice in the contract used for endpoint selection", async () => {
    const contract = await buildEffectiveRequestContract({
      taskType: "tool-action", messages: [{ role: "user", content: "Record the review." }],
      tools: [{ type: "function", function: { name: "record_review", parameters: {} } }],
      routeContext: { sensitivity: "internal" }, options: { toolChoice: "required" }, taskRequirement: null,
    });
    expect(contract).toMatchObject({ requiresTools: true, toolChoice: "required" });
  });
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
