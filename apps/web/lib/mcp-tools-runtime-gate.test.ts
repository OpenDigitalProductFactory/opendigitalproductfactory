/**
 * Integration test for the runtime kernel-commandment gate sitting in front
 * of executeTool (lib/mcp-tools.ts).
 *
 * Spec: docs/superpowers/specs/2026-05-24-runtime-kernel-commandments.md §3.6
 * Plan: docs/superpowers/plans/2026-05-24-runtime-kernel-commandments-slice-1.md
 *
 * Two paths covered here:
 *   1. Synthetic-probe path — uses the DPF_TEST_MCP_REFUSE_PROBE env hook
 *      so we don't need to register an mcp_tool pattern against a real
 *      handler. Confirms the gate fires + the probe handler body is never
 *      reached (text content check would FAIL with the probe body text
 *      if the gate were bypassed).
 *   2. Allow path — a non-matching tool name (also probe, but with env
 *      unset) falls through the gate to the probe's unknown-tool default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.fn();
const incMock = vi.fn();

vi.mock("@dpf/db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    prisma: {
      wikiPage: { findMany: (...args: unknown[]) => findManyMock(...args) },
    },
  };
});

vi.mock("@/lib/operate/metrics", () => ({
  kernelGateDecisionsTotal: { inc: (...args: unknown[]) => incMock(...args) },
}));

beforeEach(async () => {
  const { __resetCacheForTest } = await import("@/lib/kernel/load-enforceable-principles");
  __resetCacheForTest();
  findManyMock.mockReset();
  findManyMock.mockResolvedValue([]);  // production registry is empty in tests
  incMock.mockReset();
});

afterEach(() => {
  delete process.env.DPF_TEST_MCP_REFUSE_PROBE;
  delete process.env.DPF_AUTONOMOUS_SESSION_ID;
});

describe("executeTool — runtime gate integration", () => {
  it("refuses the synthetic probe in autonomous mode; probe body never runs", async () => {
    process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
    process.env.DPF_AUTONOMOUS_SESSION_ID = "test-session";

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("dpf_test_kernel_refuse_probe", {}, "user-x");

    expect(result.success).toBe(false);
    const text = JSON.stringify(result);
    expect(text).toContain("REFUSED");
    expect(text).toContain("__synthetic_refuse_probe__");
    // The probe handler body MUST NOT have been reached:
    expect(text).not.toContain("probe tool body — should not be reached");

    expect(incMock).toHaveBeenCalledWith({
      verdict: "refuse",
      principle_slug: "__synthetic_refuse_probe__",
      session_class: "autonomous",
    });
  });

  it("require_confirm path: returns the typed phrase requirement in interactive mode", async () => {
    process.env.DPF_TEST_MCP_REFUSE_PROBE = "1";
    // DPF_AUTONOMOUS_SESSION_ID unset → interactive
    // The synthetic principle is refuse-in-both-modes, so this still hits refuse.
    // To exercise require_confirm we need a confirm-in-interactive principle —
    // wire one via the findManyMock instead.
    findManyMock.mockResolvedValue([
      {
        id: "p1",
        slug: "test-confirm-principle",
        principleTier: "commandment",
        principleRuntimeEnforcement: {
          interactiveMode: "confirm",
          autonomousMode: "refuse",
          patterns: [{ kind: "mcp_tool", toolName: "dpf_test_kernel_refuse_probe", rationale: "test" }],
        },
      },
    ]);
    delete process.env.DPF_TEST_MCP_REFUSE_PROBE;  // synthetic OFF; rely on the mocked principle instead
    // Re-cache: ensure the mocked principles are what loads.
    const { __resetCacheForTest } = await import("@/lib/kernel/load-enforceable-principles");
    __resetCacheForTest();

    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("dpf_test_kernel_refuse_probe", {}, "user-x");

    expect(result.success).toBe(false);
    const text = JSON.stringify(result);
    expect(text).toContain("requires typed confirmation");
    expect(text).toMatch(/I-MEAN-IT-test-confirm-principle-[A-Z0-9]{4}/);
  });

  it("when env is unset, no principle matches and the probe returns the unknown-tool default", async () => {
    // DPF_TEST_MCP_REFUSE_PROBE NOT set → loader does not inject synthetic principle.
    // findManyMock returns [] (default) → no other principles match.
    // Gate verdict: allow. Probe body runs and returns the unregistered default.
    const { executeTool } = await import("./mcp-tools");
    const result = await executeTool("dpf_test_kernel_refuse_probe", {}, "user-x");

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("tool not registered");
    expect(incMock).toHaveBeenCalledWith({
      verdict: "allow",
      principle_slug: "_none",
      session_class: "interactive",
    });
  });
});
