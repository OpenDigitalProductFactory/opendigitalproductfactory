import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { requireApprovalProbeRuntime } from "@/lib/coworker/approval-convergence-probe-runtime";

import { registerServerToolGovernanceHooks } from "./register-tool-governance-hooks";

describe("server tool governance registration", () => {
  it("installs the AC-PROBE runtime: the live catalog and the same hooks bound to the probe's client (BI-129EFFD1)", async () => {
    expect(() => requireApprovalProbeRuntime()).toThrow("not available");
    registerServerToolGovernanceHooks();
    const runtime = requireApprovalProbeRuntime();
    expect(runtime.findTool("probe_pending_approval_conversion")).toMatchObject({ sideEffect: false });
    const event = {
      toolName: "find_coworker", rawParams: {}, userId: "u-1",
      userContext: { userId: "u-1", platformRole: "HR-000", isSuperuser: false },
      context: { agentId: "AGT-1", threadId: "t-1" }, source: "rest" as const,
    };
    const notifyCircuit = vi.fn();
    await expect(runtime.runGovernanceHooks(event, {} as never, { notifyCircuit })).resolves.toBeNull();
    expect(notifyCircuit).not.toHaveBeenCalled();
  });
});
