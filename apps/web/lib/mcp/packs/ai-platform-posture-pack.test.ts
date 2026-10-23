import { beforeEach, describe, expect, it, vi } from "vitest";

const posture = vi.hoisted(() => ({ loadAiPlatformPosture: vi.fn(), loadScheduledAgentTaskPosture: vi.fn() }));
vi.mock("@/lib/ai-platform-posture/get-ai-platform-posture", () => posture);

import { aiPlatformPosturePack } from "./ai-platform-posture-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = ["get_ai_platform_posture"];

const EXPECTED_GRANTS: Record<string, string[]> = {
  get_ai_platform_posture: ["agent_control_read"],
};

beforeEach(() => {
  vi.resetAllMocks();
  posture.loadAiPlatformPosture.mockResolvedValue({ windowHours: 24, providers: [], modelProfiles: [], failoverChain: { fallbackRate: 0 }, scheduledTasks: { counts: { failingAgentTasks: 0, failingJobs: 0 } } });
});

describe("BI-E725AA43 exact scheduled-task handler", () => {
  const selected = { generatedAt: "2026-10-21T06:23:00.000Z", scope: "scheduled-task", requestedTaskId: "agent-task-fixture", found: true,
    scheduledTask: { taskId: "agent-task-fixture", agentId: "platform-engineer", title: "Synthetic monitor", isActive: true, nextRunAt: null, lastStatus: null, lastError: null },
    truncation: { agentId: false, title: false, lastStatus: false, lastError: false },
  };

  it("advertises one optional bounded selector while retaining existing authority", () => {
    expect(aiPlatformPosturePack.definitions[0]?.inputSchema).toMatchObject({ properties: { scheduledTaskId: { type: "string", minLength: 1, maxLength: 200 } }, required: [] });
    expect(aiPlatformPosturePack.definitions).toHaveLength(1);
    expect(aiPlatformPosturePack.definitions[0]).toMatchObject({ requiredCapability: "view_platform", sideEffect: false, executionMode: "immediate", annotations: { readOnlyHint: true, idempotentHint: true } });
    expect(aiPlatformPosturePack.grants.get_ai_platform_posture).toEqual(["agent_control_read"]);
  });

  it("dispatches the normalized exact selector before the global report even with global options", async () => {
    posture.loadScheduledAgentTaskPosture.mockResolvedValue(selected);
    const result = await aiPlatformPosturePack.handlers.get_ai_platform_posture({ scheduledTaskId: " agent-task-fixture ", windowHours: 48, includeRetired: true }, "u1");
    expect(posture.loadScheduledAgentTaskPosture).toHaveBeenCalledExactlyOnceWith("agent-task-fixture");
    expect(posture.loadAiPlatformPosture).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, data: selected });
    expect(result.message).not.toContain("provider(s)");
  });

  it.each(["", " \t\n ", null, undefined, 42, false, [], {}, "x".repeat(201)])("refuses supplied malformed selector %j without either reader", async (scheduledTaskId) => {
    const result = await aiPlatformPosturePack.handlers.get_ai_platform_posture({ scheduledTaskId }, "u1");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/scheduledTaskId/);
    expect(posture.loadScheduledAgentTaskPosture).not.toHaveBeenCalled();
    expect(posture.loadAiPlatformPosture).not.toHaveBeenCalled();
    expect(JSON.stringify(result).length).toBeLessThan(500);
  });

  it("returns explicit not-found data without pretending null status is a missing row", async () => {
    posture.loadScheduledAgentTaskPosture.mockResolvedValue({ ...selected, found: false, scheduledTask: null });
    const result = await aiPlatformPosturePack.handlers.get_ai_platform_posture({ scheduledTaskId: selected.requestedTaskId }, "u1");
    expect(result).toMatchObject({ success: true, data: { found: false, scheduledTask: null } });
    expect(result.message).toMatch(/not found/i);
    expect(posture.loadAiPlatformPosture).not.toHaveBeenCalled();
  });

  it("bounds the actual handler result when projected fields require maximum JSON escaping", async () => {
    posture.loadScheduledAgentTaskPosture.mockResolvedValue({ ...selected,
      requestedTaskId: "\u0000".repeat(200),
      scheduledTask: { ...selected.scheduledTask, taskId: "\u0000".repeat(200), agentId: "\u0001".repeat(200), title: "\u0002".repeat(300), lastStatus: "\u0003".repeat(100), lastError: "\u0004".repeat(4_000) },
      truncation: { agentId: true, title: true, lastStatus: true, lastError: true },
    });
    const result = await aiPlatformPosturePack.handlers.get_ai_platform_posture({ scheduledTaskId: "\u0000".repeat(200) }, "u1");
    expect(result.success).toBe(true);
    expect(result.message).toMatch(/truncated/);
    expect(JSON.stringify(result).length).toBeLessThan(32_000);
    expect(posture.loadAiPlatformPosture).not.toHaveBeenCalled();
  });
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
    expect(posture.loadScheduledAgentTaskPosture).not.toHaveBeenCalled();
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
    expect(posture.loadScheduledAgentTaskPosture).not.toHaveBeenCalled();
  });
});
