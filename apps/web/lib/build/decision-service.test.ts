import { describe, expect, it, vi } from "vitest";
import { evaluateBuildStudioDecision } from "./decision-service";

describe("evaluateBuildStudioDecision", () => {
  it("returns an operator-safe recommendation when principle_decide has high confidence", async () => {
    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: {
        recommendation: { optionId: "shared-env", confidence: "high", margin: 1.2 },
        flags: { commandmentConflict: false },
        reasoning: "principle_decide recommends dpf-use-shared-nonprod-environment via MCP.",
      },
    });
    const result = await evaluateBuildStudioDecision({
      toolExecutor,
      userId: "user-1",
      request: {
        source: "build-studio",
        routeContext: "/build",
        buildId: "FB-1",
        phase: "build",
        question: "Which verification environment should this branch use?",
        options: [
          { id: "shared-env", description: "Use Nonprod A.", operatorLabel: "Use shared environment" },
          { id: "thread-server", description: "Start a per-thread server." },
        ],
      },
    });

    expect(toolExecutor).toHaveBeenCalledWith(
      "principle_decide",
      expect.objectContaining({
        context: "Which verification environment should this branch use?",
        callingPopulation: "in_platform_coworker",
      }),
      "user-1",
      { routeContext: "/build", featureBuildId: "FB-1" },
    );
    expect(result.status).toBe("recommended");
    expect(result.recommendation?.optionId).toBe("shared-env");
    expect(result.operatorActionLabel).toBe("Use shared environment");
    expect(result.reasonSummary).not.toMatch(/mcp|principle_decide|dpf-/i);
    expect(result.auditSummary).toContain("shared-env");
  });

  it("blocks when the kernel reports a commandment conflict", async () => {
    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: {
        recommendation: { optionId: "thread-server", confidence: "high", margin: 0.9 },
        flags: { commandmentConflict: true },
        reasoning: "A commandment blocks this action.",
      },
    });
    const result = await evaluateBuildStudioDecision({
      toolExecutor,
      userId: "user-1",
      request: {
        source: "build-studio",
        routeContext: "/build",
        buildId: "FB-1",
        phase: "build",
        question: "Start a new unmanaged server?",
        options: [
          { id: "shared-env", description: "Use Nonprod A.", operatorLabel: "Use shared environment" },
          { id: "thread-server", description: "Start a per-thread server." },
        ],
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.operatorActionLabel).toBe("Resolve blocker before continuing");
  });

  it("captures a kernel gap when the governed tool fails", async () => {
    const toolExecutor = vi.fn().mockResolvedValue({
      success: false,
      error: "principle_decide MCP unavailable",
    });

    const result = await evaluateBuildStudioDecision({
      toolExecutor,
      userId: "user-1",
      request: {
        source: "codex",
        routeContext: "/build",
        question: "Should this external handoff go straight to review?",
        options: [
          { id: "review", description: "Move to review." },
          { id: "verify", description: "Run local integration first." },
        ],
      },
    });

    expect(result.status).toBe("captured-gap");
    expect(result.operatorActionLabel).toBe("Send to founder review");
    expect(result.reasonSummary).toBe("the decision service governed tools unavailable");
  });

  it("captures a kernel gap when the governed tool throws", async () => {
    const toolExecutor = vi.fn().mockRejectedValue(new Error("principle_decide transport failed"));

    const result = await evaluateBuildStudioDecision({
      toolExecutor,
      userId: "user-1",
      request: {
        source: "build-studio",
        routeContext: "/build",
        question: "Can implementation start?",
        options: [
          { id: "start", description: "Start implementation." },
          { id: "revise", description: "Revise the plan." },
        ],
      },
    });

    expect(result.status).toBe("captured-gap");
    expect(result.operatorActionLabel).toBe("Send to founder review");
    expect(result.reasonSummary).toBe("the decision service transport failed");
  });
});
