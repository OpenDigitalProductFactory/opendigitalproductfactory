import { describe, expect, it, vi } from "vitest";

const actuator = vi.hoisted(() => ({
  sandbox: vi.fn(async () => ({ containerId: "c".repeat(64), name: "dpf-sandbox-1", running: false })),
  start: vi.fn(async () => undefined),
  spawn: vi.fn(),
}));
vi.mock("../../../../../scripts/lib/scope-writer-observation.mjs", async (load) => ({
  ...await load<object>(), usesPrivateActuator: async () => true, readActuatorSandbox: actuator.sandbox,
}));
vi.mock("@/lib/build/sandbox/sandbox", async (load) => ({ ...await load<object>(), startSandbox: actuator.start }));
vi.mock("@/lib/shared/lazy-node", async (load) => ({ ...await load<object>(), lazyChildProcess: () => ({ exec: actuator.spawn, spawn: actuator.spawn }) }));
vi.mock("@/lib/build/build-engine-reconcile", () => ({ reconcileBuildEngines: async () => undefined }));

import { sandboxPack } from "./sandbox-pack";

describe("sandbox tools in the qualified portal (BI-224F56F1)", () => {
  it("reports the observed sandbox and starts it through the actuator, never running Docker", async () => {
    await expect(sandboxPack.handlers.check_sandbox({}, "user-1")).resolves.toMatchObject({ data: { status: "stopped" } });
    actuator.sandbox.mockResolvedValueOnce({ containerId: "c".repeat(64), name: "dpf-sandbox-1", running: false })
      .mockResolvedValue({ containerId: "c".repeat(64), name: "dpf-sandbox-1", running: true });
    await expect(sandboxPack.handlers.start_sandbox({}, "user-1")).resolves.toMatchObject({ success: true, data: { status: "running" } });
    expect(actuator.start).toHaveBeenCalledWith("dpf-sandbox-1");
    expect(actuator.spawn).not.toHaveBeenCalled();
  });
});
