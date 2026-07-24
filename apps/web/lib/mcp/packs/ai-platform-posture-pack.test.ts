import { beforeEach, describe, expect, it, vi } from "vitest";

const posture = vi.hoisted(() => ({ loadAiPlatformPosture: vi.fn() }));
vi.mock("@/lib/ai-platform-posture/get-ai-platform-posture", () => posture);

import { aiPlatformPosturePack } from "./ai-platform-posture-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["get_ai_platform_posture"];

const EXPECTED_GRANTS: Record<string, string[]> = {
  get_ai_platform_posture: ["agent_control_read"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ai-platform-posture pack — registration", () => {
  it("exposes exactly the one posture tool", () => {
    expect(aiPlatformPosturePack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(aiPlatformPosturePack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(aiPlatformPosturePack.packId).toBe("ai-platform-posture");
  });

  it("description is provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of aiPlatformPosturePack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("is read-only: view_platform capability, no side effects, read-only annotations", () => {
    const def = aiPlatformPosturePack.definitions[0]!;
    expect(def.requiredCapability).toBe("view_platform");
    expect(def.sideEffect).toBe(false);
    expect(def.executionMode).toBe("immediate");
    expect(def.annotations).toEqual({ readOnlyHint: true, idempotentHint: true });
  });

  it("accepts optional windowHours (number) and includeRetired (boolean) params, both non-required", () => {
    const def = aiPlatformPosturePack.definitions[0]!;
    expect(def.inputSchema).toMatchObject({
      type: "object",
      properties: {
        windowHours: { type: "number" },
        includeRetired: { type: "boolean" },
      },
      required: [],
    });
  });

  it("grants mirror agent-grants for the tool", () => {
    for (const t of EXPECTED_TOOLS) {
      expect(aiPlatformPosturePack.grants[t]).toEqual(EXPECTED_GRANTS[t]);
      expect(isToolAllowedByGrants(t, EXPECTED_GRANTS[t])).toBe(true);
    }
  });
});

describe("ai-platform-posture pack — handler behavior", () => {
  it("delegates to loadAiPlatformPosture with the caller's params and summarizes the result", async () => {
    posture.loadAiPlatformPosture.mockResolvedValue({
      generatedAt: "2026-07-24T00:00:00.000Z",
      windowHours: 24,
      providers: [{ providerId: "anthropic" }],
      modelProfiles: [{ modelId: "claude-sonnet" }, { modelId: "claude-haiku" }],
      tokenSpend: { period: { year: 2026, month: 7 }, byProvider: [], byAgent: [] },
      failoverChain: { fallbackRate: 0.05 },
      agentProviderAssignments: [],
      scheduledTasks: { counts: { activeAgentTasks: 3, failingAgentTasks: 1, enabledJobs: 5, failingJobs: 0 } },
    });

    const res = await aiPlatformPosturePack.handlers.get_ai_platform_posture(
      { windowHours: 48, includeRetired: true },
      "u1",
    );

    expect(posture.loadAiPlatformPosture).toHaveBeenCalledWith({ windowHours: 48, includeRetired: true });
    expect(res.success).toBe(true);
    expect(res.message).toContain("1 provider(s)");
    expect(res.message).toContain("2 model profile(s)");
    expect(res.message).toContain("5.0% fallback rate");
    expect(res.message).toContain("1 failing scheduled task(s)/job(s)");
    expect(res.data).toBeDefined();
  });

  it("passes undefined through for unset params (defaults resolved downstream)", async () => {
    posture.loadAiPlatformPosture.mockResolvedValue({
      generatedAt: "2026-07-24T00:00:00.000Z",
      windowHours: 24,
      providers: [],
      modelProfiles: [],
      tokenSpend: { period: { year: 2026, month: 7 }, byProvider: [], byAgent: [] },
      failoverChain: { fallbackRate: 0 },
      agentProviderAssignments: [],
      scheduledTasks: { counts: { activeAgentTasks: 0, failingAgentTasks: 0, enabledJobs: 0, failingJobs: 0 } },
    });

    await aiPlatformPosturePack.handlers.get_ai_platform_posture({}, "u1");

    expect(posture.loadAiPlatformPosture).toHaveBeenCalledWith({ windowHours: undefined, includeRetired: undefined });
  });
});
