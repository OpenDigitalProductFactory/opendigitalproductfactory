// apps/web/lib/build-pipeline.test.ts
// Tests for pure state machine functions in the build pipeline.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getResumeStep, shouldRetry, nextStep, buildFailedState } from "./build-pipeline";
import type { BuildExecutionState } from "./build-exec-types";
import { SPECIALIST_TOOLS } from "./specialist-prompts";

// ─── Mocks for stepGenerateCode integration test ──────────────────────────────

const mockRunAgenticLoop = vi.fn();
vi.mock("@/lib/agentic-loop", () => ({ runAgenticLoop: mockRunAgenticLoop }));

const mockPrisma = {
  featureBuild: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  agentThread: { findFirst: vi.fn().mockResolvedValue(null) },
};
vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));

// Platform-only tool names used to verify they are filtered out by stepGenerateCode
const MOCK_PLATFORM_ONLY_TOOLS = ["send_slack_message", "create_ticket", "manage_users", "list_all_agents"];

// Inline the tool list in the factory to avoid vi.mock hoisting issues with module-level variables
vi.mock("@/lib/mcp-tools", () => ({
  getAvailableTools: vi.fn().mockResolvedValue([
    { name: "read_sandbox_file" }, { name: "edit_sandbox_file" }, { name: "write_sandbox_file" },
    { name: "search_sandbox" }, { name: "list_sandbox_files" }, { name: "run_sandbox_command" },
    { name: "generate_code" }, { name: "describe_model" },
    { name: "search_design_intelligence" }, { name: "generate_design_system" },
    // Platform-only tools that stepGenerateCode must filter out
    { name: "send_slack_message" }, { name: "create_ticket" },
    { name: "manage_users" }, { name: "list_all_agents" },
  ]),
  toolsToOpenAIFormat: vi.fn().mockImplementation((tools: Array<{ name: string }>) =>
    tools.map(t => ({ type: "function", function: { name: t.name } }))
  ),
}));

vi.mock("./build-agent-prompts", () => ({
  getBuildContextSection: vi.fn().mockResolvedValue("mock-build-context"),
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

vi.mock("@/lib/brand/read", () => ({
  readBrandContext: vi.fn().mockResolvedValue({ structured: null, legacyMarkdown: null }),
}));

// Keep real SPECIALIST_TOOLS/SPECIALIST_AGENT_IDS/SPECIALIST_MODEL_REQS but stub buildSpecialistPrompt
vi.mock("./specialist-prompts", async (importOriginal) => {
  const real = await importOriginal<typeof import("./specialist-prompts")>();
  return { ...real, buildSpecialistPrompt: vi.fn().mockResolvedValue("mock-specialist-prompt") };
});

// Stub coding-agent so stepRunTests (code_generated step) doesn't hit real infra
vi.mock("./coding-agent", () => ({
  runSandboxTests: vi.fn().mockResolvedValue({ passed: true, testOutput: "", typeCheckPassed: true, typeCheckOutput: "" }),
  diagnoseTestFailures: vi.fn(),
}));

describe("getResumeStep", () => {
  it("returns 'pending' for null state", () => {
    expect(getResumeStep(null)).toBe("pending");
  });
  it("returns failedAt step for failed state", () => {
    const state: BuildExecutionState = {
      step: "failed", failedAt: "db_ready", retryCount: 3, startedAt: "2026-01-01T00:00:00Z",
    };
    expect(getResumeStep(state)).toBe("db_ready");
  });
  it("returns next step for in-progress state", () => {
    const state: BuildExecutionState = {
      step: "workspace_initialized", retryCount: 0, startedAt: "2026-01-01T00:00:00Z",
    };
    expect(getResumeStep(state)).toBe("db_ready");
  });
});

describe("shouldRetry", () => {
  it("allows retry when count is below max", () => {
    expect(shouldRetry("sandbox_created", 0)).toBe(true);
    expect(shouldRetry("sandbox_created", 2)).toBe(true);
  });
  it("denies retry when count equals max", () => {
    expect(shouldRetry("sandbox_created", 3)).toBe(false);
  });
  it("never retries tests_run or complete", () => {
    expect(shouldRetry("tests_run", 0)).toBe(false);
    expect(shouldRetry("complete", 0)).toBe(false);
  });
});

describe("nextStep", () => {
  it("returns the next step in order", () => {
    expect(nextStep("pending")).toBe("sandbox_created");
    expect(nextStep("sandbox_created")).toBe("workspace_initialized");
    expect(nextStep("workspace_initialized")).toBe("db_ready");
    expect(nextStep("tests_run")).toBe("complete");
  });
  it("returns null for complete or failed", () => {
    expect(nextStep("complete")).toBeNull();
    expect(nextStep("failed")).toBeNull();
  });
});

describe("buildFailedState", () => {
  it("sets step to failed with error details", () => {
    const base: BuildExecutionState = {
      step: "db_ready", retryCount: 2, startedAt: "2026-01-01T00:00:00Z", containerId: "abc",
    };
    const result = buildFailedState(base, "db_ready", "Connection refused");
    expect(result.step).toBe("failed");
    expect(result.failedAt).toBe("db_ready");
    expect(result.error).toBe("Connection refused");
    expect(result.containerId).toBe("abc");
  });
});

describe("SPECIALIST_TOOLS['software-engineer']", () => {
  it("contains only sandbox-scoped tool names (no platform tools)", () => {
    const tools = SPECIALIST_TOOLS["software-engineer"];
    expect(tools).toEqual([
      "read_sandbox_file", "edit_sandbox_file", "write_sandbox_file",
      "search_sandbox", "list_sandbox_files", "run_sandbox_command",
      "generate_code", "describe_model",
      "search_design_intelligence", "generate_design_system",
    ]);
    // No tool should be a known platform-only name
    const platformPatterns = [/^send_/, /^create_ticket$/, /^manage_users$/, /^list_all_agents$/];
    for (const name of tools) {
      expect(platformPatterns.some(p => p.test(name))).toBe(false);
    }
  });
});

describe("stepGenerateCode tool isolation", () => {
  beforeEach(() => {
    mockRunAgenticLoop.mockClear();
    mockRunAgenticLoop.mockResolvedValue({
      content: "Done",
      executedTools: [],
      providerId: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    mockPrisma.featureBuild.findUniqueOrThrow.mockResolvedValue({
      buildId: "test-build",
      brief: {
        title: "Test Feature",
        description: "A test feature",
        acceptanceCriteria: ["AC1"],
      },
      plan: {},
      portfolioId: "test-portfolio",
    });
  });

  it("passes only SPECIALIST_TOOLS['software-engineer'] names to runAgenticLoop", async () => {
    const { runBuildPipeline } = await import("./build-pipeline");

    // Start from db_ready so the pipeline resumes at deps_installed → stepGenerateCode
    const state: BuildExecutionState = {
      step: "db_ready",
      retryCount: 0,
      startedAt: "2026-01-01T00:00:00Z",
      containerId: "test-container",
    };

    await runBuildPipeline({
      buildId: "test-build",
      existingState: state,
      updateState: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    });

    expect(mockRunAgenticLoop).toHaveBeenCalledOnce();
    const calledWith = mockRunAgenticLoop.mock.calls[0]![0] as { tools: Array<{ name: string }> };
    const passedNames = calledWith.tools.map(t => t.name);

    const allowedNames = new Set(SPECIALIST_TOOLS["software-engineer"]);
    for (const name of passedNames) {
      expect(allowedNames.has(name), `unexpected platform tool "${name}" passed to runAgenticLoop`).toBe(true);
    }
    // No platform-only tools should have slipped through
    for (const platformTool of MOCK_PLATFORM_ONLY_TOOLS) {
      expect(passedNames).not.toContain(platformTool);
    }
  });

  it("passes SPECIALIST_AGENT_IDS['software-engineer'] as agentId", async () => {
    const { runBuildPipeline } = await import("./build-pipeline");
    const state: BuildExecutionState = {
      step: "db_ready", retryCount: 0, startedAt: "2026-01-01T00:00:00Z", containerId: "test-container",
    };
    await runBuildPipeline({
      buildId: "test-build",
      existingState: state,
      updateState: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    });
    const calledWith = mockRunAgenticLoop.mock.calls[0]![0] as { agentId: string; modelRequirements: unknown };
    expect(calledWith.agentId).toBe("AGT-BUILD-SE");
    expect(calledWith.modelRequirements).toMatchObject({ defaultMinimumTier: "frontier", defaultBudgetClass: "quality_first" });
  });
});
