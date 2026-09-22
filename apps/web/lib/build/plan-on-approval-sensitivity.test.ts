import { beforeEach, describe, expect, it, vi } from "vitest";

const routeAndCall = vi.fn();
vi.mock("@/lib/inference/routed-inference", () => ({ routeAndCall: (...a: unknown[]) => routeAndCall(...a) }));

import { generateNormalizedPlan } from "./plan-on-approval";

const PLAN = JSON.stringify({ fileStructure: ["apps/web/lib/x.ts"], tasks: [{ id: 1, title: "t" }] });

describe("generateNormalizedPlan route sensitivity (BI-20D559AD)", () => {
  beforeEach(() => {
    routeAndCall.mockReset();
    routeAndCall.mockResolvedValue({ content: PLAN, providerId: "codex" });
  });

  it("routes with the deliverable-derived sensitivity when given", async () => {
    const r = await generateNormalizedPlan({
      buildId: "FB-1", title: "t", designDoc: {}, biTitle: null, biBody: null, verifiedPaths: [],
      sensitivity: "internal", log: async () => {},
    });
    expect("plan" in r).toBe(true);
    expect(routeAndCall.mock.calls[0]?.[2]).toBe("internal");
    // Non-interactive phase: never demand token streaming (BI-F84887FF).
    expect((routeAndCall.mock.calls[0]?.[3] as { requiresStreaming?: boolean }).requiresStreaming).toBe(false);
  });

  it("defaults to development (source-code class) when no sensitivity is supplied", async () => {
    await generateNormalizedPlan({
      buildId: "FB-1", title: "t", designDoc: {}, biTitle: null, biBody: null, verifiedPaths: [],
      log: async () => {},
    });
    expect(routeAndCall.mock.calls[0]?.[2]).toBe("development");
  });
});
