// EP-COWORKER-RT / WS4 — no-regression guard for the Golden-Triangle hot-path seam.
//
// The wiring already lives at prepareRoute (apps/web/lib/inference/routed-inference.ts):
//   const posture = await resolveDispatchPosture(agentId, taskType);   // null when none set
//   const contract = await inferContract(taskType, messages, tools, undefined, {
//     ...(posture?.routeContext ?? {}),   // posture defaults FIRST …
//     sensitivity, …,
//     budgetClass: posture?.routeContext.budgetClass ?? options?.budgetClass,  // … explicit caller wins
//   });
//
// This test pins the load-bearing guarantee the design (§4 WS4 / §10.3) demands:
//   (a) NO posture set at any scope → the routeContext spread is empty → inferContract's
//       output is BYTE-IDENTICAL to the pre-posture path (cold-start no-op).
//   (b) A posture set → its budgetClass / reasoningDepth / minimumTier flow into the
//       contract (the central/coworker priority actually governs dispatch).
//
// It reconstructs the exact seam expression (resolveDispatchPosture → spread →
// inferContract) with a fake persistence client, so it exercises the real compiler,
// composer, and contract inference — not a stub.
import { describe, expect, it } from "vitest";

import type { GoldenTrianglePreference } from "@/lib/golden-triangle";
import { inferContract } from "@/lib/routing/request-contract";
import type { RequestContract } from "@/lib/routing/request-contract";

import { resolveDispatchPosture } from "./dispatch";
import type { GoldenTrianglePersistenceClient } from "./persistence";

const MESSAGES = [{ role: "user", content: "summarize this thread please" }];
const ASSURED: GoldenTrianglePreference = { preset: "assured", qualityWeight: 0.8, costWeight: 0.1, timeWeight: 0.1 };
const BALANCED: GoldenTrianglePreference = { preset: "balanced", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 };

/** Fake persistence over the single platform-profile row (platform default + per-agent map). */
function client(opts: { platform?: GoldenTrianglePreference; perAgent?: Record<string, GoldenTrianglePreference> }): GoldenTrianglePersistenceClient {
  const policy: Record<string, unknown> = {};
  if (opts.platform) policy.goldenTriangle = opts.platform;
  if (opts.perAgent) policy.goldenTrianglePerAgent = opts.perAgent;
  return {
    decisionPerspectiveProfile: {
      findFirst: async () => (Object.keys(policy).length ? { autonomyPolicy: policy } : null),
      updateMany: async () => ({ count: 0 }),
    },
  };
}

/** Reproduce the prepareRoute seam: resolve posture → spread into inferContract's routeContext. */
async function contractAtSeam(
  taskType: string,
  agentId: string | null,
  db: GoldenTrianglePersistenceClient,
  callerBudgetClass?: "minimize_cost" | "balanced" | "quality_first",
) {
  const posture = await resolveDispatchPosture(agentId, taskType, null, db);
  return inferContract(taskType, MESSAGES, undefined, undefined, {
    ...(posture?.routeContext ?? {}),
    sensitivity: "internal",
    budgetClass: posture?.routeContext.budgetClass ?? callerBudgetClass,
  });
}

/** Drop contractId (random per call) so two contracts can be compared structurally. */
function stable(contract: RequestContract): Omit<RequestContract, "contractId"> {
  const { contractId: _drop, ...rest } = contract;
  return rest;
}

describe("Golden-Triangle hot-path no-regression", () => {
  it("(a) NO posture set → contract is byte-identical to the pre-posture path", async () => {
    // Baseline: inferContract with only the always-present sensitivity (what the
    // seam sends when no posture and no caller budgetClass exist).
    const baseline = await inferContract("summarization", MESSAGES, undefined, undefined, {
      sensitivity: "internal",
    });
    const atSeam = await contractAtSeam("summarization", "agent-x", client({}));
    expect(stable(atSeam)).toEqual(stable(baseline));
  });

  it("(a') a Balanced default is inert — identical to no posture", async () => {
    const baseline = await inferContract("summarization", MESSAGES, undefined, undefined, {
      sensitivity: "internal",
    });
    const atSeam = await contractAtSeam("summarization", "agent-x", client({ platform: BALANCED }));
    expect(stable(atSeam)).toEqual(stable(baseline));
  });

  it("(b) a platform posture flows budgetClass + reasoningDepth + tier floor into the contract", async () => {
    const baseline = await inferContract("summarization", MESSAGES, undefined, undefined, {
      sensitivity: "internal",
    });
    const governed = await contractAtSeam("summarization", null, client({ platform: ASSURED }));
    // Assured compiles to quality_first + high reasoning + frontier tier floor.
    expect(governed.budgetClass).toBe("quality_first");
    expect(governed.reasoningDepth).toBe("high");
    expect(governed.minimumDimensions?.reasoning).toBe(85); // frontier floor
    // And it genuinely differs from the cold-start baseline.
    expect(governed.budgetClass).not.toBe(baseline.budgetClass);
  });

  it("(b') a coworker's own posture governs over the platform default", async () => {
    const governed = await contractAtSeam(
      "summarization",
      "agent-x",
      client({ platform: BALANCED, perAgent: { "agent-x": ASSURED } }),
    );
    expect(governed.budgetClass).toBe("quality_first");
    expect(governed.reasoningDepth).toBe("high");
  });

  it("never lets a non-Balanced posture get silently overridden by the Assignments budgetClass default", async () => {
    // The reconciliation: posture owns budgetClass; the always-sent AgentModelConfig
    // default ("balanced") must NOT clobber a Quality posture.
    const governed = await contractAtSeam(
      "summarization",
      "agent-x",
      client({ perAgent: { "agent-x": ASSURED } }),
      "balanced", // AgentModelConfig.budgetClass default, always present
    );
    expect(governed.budgetClass).toBe("quality_first");
  });
});
