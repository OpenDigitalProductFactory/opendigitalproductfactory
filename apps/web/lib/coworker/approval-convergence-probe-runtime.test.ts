// BI-7DE3F806: the AC-PROBE runtime is installed at boot (instrumentation.ts,
// registerServerToolGovernanceHooks) and required by the MCP tool. Next can load
// this module from different bundle chunks for the two, so a module-level
// variable installed by one is invisible to the other and the live tool refused
// with "server governance hooks are not registered". The runtime must be
// process-wide, as build-liveness.ts keeps its registry (BI-4EB33E54).
import { afterEach, describe, expect, it, vi } from "vitest";

const runtime = {
  findTool: () => undefined,
  runGovernanceHooks: async () => null,
};

afterEach(async () => {
  const { installApprovalProbeRuntime } = await import("./approval-convergence-probe-runtime");
  installApprovalProbeRuntime(null);
  vi.resetModules();
});

describe("approval probe runtime", () => {
  it("an install made through one module instance is visible from another", async () => {
    const boot = await import("./approval-convergence-probe-runtime");
    boot.installApprovalProbeRuntime(runtime);

    vi.resetModules();
    const route = await import("./approval-convergence-probe-runtime");

    expect(route).not.toBe(boot);
    expect(route.requireApprovalProbeRuntime()).toBe(runtime);
  });

  it("refuses when nothing installed it", async () => {
    const { requireApprovalProbeRuntime } = await import("./approval-convergence-probe-runtime");
    expect(() => requireApprovalProbeRuntime()).toThrow(/server governance hooks are not registered/);
  });
});
